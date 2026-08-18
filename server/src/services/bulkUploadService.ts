import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { fetchRemoteResume } from '../utils/remoteFile.js';
import { getTenantContext } from '../config/tenantContext.js';
import { assertWithinLimit } from './entitlementService.js';
import { EXPERIENCE_LEVEL, CANDIDATE_SOURCE, CONFIG_KEYS, ROLES } from '@agnohire/shared';
import type { CandidateUploadError } from '@agnohire/shared';
import { getQueue, QUEUE_NAMES } from '../jobs/queues.js';
import { scoreApplication } from './fitScoreService.js';
import { runWithTenant } from '../config/tenantContext.js';

/** A raw CSV row, header→value (header casing/spacing already normalized). */
export type CsvRow = Record<string, string>;

const EXPERIENCE_SET = new Set<string>(Object.values(EXPERIENCE_LEVEL));
const SOURCE_SET = new Set<string>(Object.values(CANDIDATE_SOURCE));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize a CSV header key: lowercase, strip spaces/underscores/hyphens. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Pick the first present value among candidate header aliases. */
function pick(row: CsvRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v.trim() !== '') return v.trim();
  }
  return '';
}

/**
 * Looser fallback for `pick`: tries the exact aliases first, then — because we
 * cannot enumerate every header spelling a real-world export might use (e.g.
 * "Candidate's Mobile No.", "E-Mail Id", "Current CTC / Location") — falls
 * back to matching any column whose normalized key CONTAINS one of the given
 * substrings, skipping any that contain an excluded substring (to keep
 * "jobtitle" out of a "title" match meant for currentRole, say). This is what
 * makes the importer accept "any format" rather than only the exact template
 * header names.
 */
function pickFuzzy(row: CsvRow, aliases: string[], contains: string[], excludes: string[] = []): string {
  const exact = pick(row, ...aliases);
  if (exact) return exact;
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v.trim() === '') continue;
    if (excludes.some((ex) => k.includes(ex))) continue;
    if (contains.some((s) => k.includes(s))) return v.trim();
  }
  return '';
}

/** Last-resort email detection: scan every column's value for something that
 * looks like an email address, regardless of what its header is called. */
function findEmailByContent(row: CsvRow): string {
  for (const v of Object.values(row)) {
    const trimmed = v?.trim();
    if (trimmed && EMAIL_RE.test(trimmed)) return trimmed.toLowerCase();
  }
  return '';
}

/**
 * Resume downloads happen over the network (up to RESUME_FETCH_TIMEOUT_MS
 * each) and used to run one row at a time inside the import loop — so a
 * handful of slow/broken links made even a 5-row sheet as slow as a 200-row
 * one, since the wait is dominated by network round-trips, not row count.
 * Fetching a bounded number concurrently instead means the total wait is
 * roughly (resume count / concurrency) timeouts, not (resume count) of them.
 */
const RESUME_FETCH_CONCURRENCY = 5;
const RESUME_FETCH_TIMEOUT_MS = 10_000;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

interface PendingResumeFetch {
  row: number;
  email: string;
  fullName: string;
  candidateId: string;
  resumeUrl: string;
  tenantId: string | null;
}

/** Downloads + attaches every pending resume concurrently; failures are appended to `errors`. */
async function attachPendingResumes(
  pending: PendingResumeFetch[],
  maxResumeBytes: number,
  errors: CandidateUploadError[],
): Promise<void> {
  if (pending.length === 0) return;
  await mapWithConcurrency(pending, RESUME_FETCH_CONCURRENCY, async (task) => {
    try {
      const fetched = await fetchRemoteResume(task.resumeUrl, {
        maxBytes: maxResumeBytes,
        fallbackName: task.fullName,
        timeoutMs: RESUME_FETCH_TIMEOUT_MS,
      });
      await tenantTransaction(async (tx) => {
        await tx.resume.updateMany({ where: { candidateId: task.candidateId }, data: { isPrimary: false } });
        const created = await tx.resume.create({
          data: {
            candidateId: task.candidateId,
            fileUrl: '',
            fileName: fetched.fileName,
            fileSize: fetched.size,
            mimeType: fetched.mimeType,
            fileData: fetched.buffer,
            isPrimary: true,
            parseStatus: 'PENDING',
            ...(task.tenantId && { tenantId: task.tenantId }),
          },
          select: { id: true },
        });
        await tx.resume.update({
          where: { id: created.id },
          data: { fileUrl: `/api/candidates/${task.candidateId}/resumes/${created.id}/download` },
        });
      });
    } catch (rerr) {
      errors.push({
        row: task.row,
        email: task.email,
        reason: `Resume not attached: ${(rerr as Error).message}`.slice(0, 200),
      });
    }
  });
}

function parseSkills(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

interface ParsedCandidate {
  fullName: string;
  email: string;
  phone: string | null;
  currentRole: string | null;
  location: string | null;
  experienceLevel: string | null;
  source: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  skills: string[];
  resumeUrl: string | null;
  jobRequisition: string | null;
}

/** Map + validate one normalized row. Returns the candidate or an error reason. */
function validateRow(row: CsvRow): { ok: true; data: ParsedCandidate } | { ok: false; email: string | null; reason: string } {
  const fullName = pickFuzzy(
    row,
    ['fullname', 'name', 'candidatename', 'applicantname', 'personname', 'employeename'],
    ['name'],
    ['company', 'file', 'user', 'reference', 'manager', 'recruiter', 'sector', 'domain'],
  );
  let email = pickFuzzy(
    row,
    ['email', 'emailaddress', 'mail', 'emailid', 'mailid', 'contactemail', 'personalemail', 'workemail'],
    ['email', 'mail'],
  ).toLowerCase();
  if (!email) email = findEmailByContent(row);

  if (!fullName) return { ok: false, email: email || null, reason: 'Missing full name' };
  if (!email) return { ok: false, email: null, reason: 'Missing email' };
  if (!EMAIL_RE.test(email)) return { ok: false, email, reason: 'Invalid email format' };

  const expRaw = pickFuzzy(row, ['experiencelevel', 'level', 'experience'], ['experience', 'seniority']).toUpperCase();
  const srcRaw = pickFuzzy(row, ['source', 'candidatesource', 'leadsource'], ['source']).toUpperCase();

  return {
    ok: true,
    data: {
      fullName,
      email,
      phone: pickFuzzy(
        row,
        ['phone', 'mobile', 'contact', 'phonenumber', 'mobilenumber', 'contactnumber', 'cellnumber', 'telephone'],
        ['phone', 'mobile', 'cell', 'contactno', 'tel'],
        ['email'],
      ) || null,
      currentRole: pickFuzzy(
        row,
        ['currentrole', 'role', 'title', 'designation', 'currentposition', 'currentjobtitle', 'position', 'jobrole'],
        ['role', 'designation', 'position'],
        ['jobtitle', 'jobrequisition'],
      ) || null,
      location: pickFuzzy(
        row,
        ['location', 'city', 'currentlocation', 'address', 'place', 'residence'],
        ['location', 'city', 'address'],
        ['email', 'mail'],
      ) || null,
      experienceLevel: EXPERIENCE_SET.has(expRaw) ? expRaw : null,
      source: SOURCE_SET.has(srcRaw) ? srcRaw : null,
      linkedinUrl: pickFuzzy(row, ['linkedinurl', 'linkedin', 'linkedinprofile', 'linkedinlink'], ['linkedin']) || null,
      githubUrl: pickFuzzy(row, ['githuburl', 'github', 'githubprofile', 'githublink'], ['github']) || null,
      skills: parseSkills(pickFuzzy(row, ['skills', 'skill', 'skillset', 'keyskills', 'technicalskills'], ['skill'])),
      resumeUrl:
        pickFuzzy(
          row,
          ['resumeurl', 'resume', 'resumelink', 'cvurl', 'cv', 'drivelink', 'resumedrivelink'],
          ['resume', 'cvlink', 'cvurl'],
        ) || null,
      jobRequisition:
        pickFuzzy(
          row,
          ['jobrequisition', 'requisition', 'job', 'jobtitle', 'jobrequisitionid', 'requisitionid'],
          ['requisition', 'jobtitle', 'jobid'],
        ) || null,
    },
  };
}
interface DuplicateCheckResult {
  duplicate: boolean;
  reason?: string;
  candidateId?: string;
}

async function checkCandidateDuplicate(
  email: string,
  phone: string | null | undefined,
  resumeUrl: string | null | undefined,
  linkedinUrl: string | null | undefined,
  githubUrl: string | null | undefined,
  tenantId: string,
): Promise<DuplicateCheckResult> {
  let existing = await prisma.candidate.findFirst({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { duplicate: true, reason: 'Duplicate Email', candidateId: existing.id };
  }

  if (phone) {
    existing = await prisma.candidate.findFirst({
      where: { phone, tenantId },
      select: { id: true },
    });
    if (existing) {
      return { duplicate: true, reason: 'Duplicate Mobile Number', candidateId: existing.id };
    }
  }

  if (resumeUrl) {
    const existingResume = await prisma.resume.findFirst({
      where: {
        tenantId,
        OR: [
          { fileUrl: resumeUrl },
          { fileName: resumeUrl },
        ],
      },
      select: { candidateId: true },
    });
    if (existingResume) {
      return { duplicate: true, reason: 'Duplicate Resume URL', candidateId: existingResume.candidateId };
    }
  }

  if (linkedinUrl) {
    existing = await prisma.candidate.findFirst({
      where: { linkedinUrl, tenantId },
      select: { id: true },
    });
    if (existing) {
      return { duplicate: true, reason: 'Duplicate LinkedIn URL', candidateId: existing.id };
    }
  }

  if (githubUrl) {
    existing = await prisma.candidate.findFirst({
      where: { githubUrl, tenantId },
      select: { id: true },
    });
    if (existing) {
      return { duplicate: true, reason: 'Duplicate GitHub URL', candidateId: existing.id };
    }
  }

  return { duplicate: false };
}

/**
 * Processes a bulk-import list: validates each row, de-duplicates by unique identifiers
 * (reusing existing candidates), creates new candidates, links them to the list,
 * and writes the final counts + error report. Used by the Bull processor and the
 * inline fallback. Must NOT import the dispatcher (avoids an import cycle).
 */
export async function processBulkUpload(listId: string, rows: CsvRow[], jobRequisitionId?: string | null): Promise<void> {
  const list = await prisma.candidateList.findFirst({ where: { id: listId } });
  if (!list) {
    logger.warn('processBulkUpload: list not found', { listId });
    return;
  }
  const processFn = async () => {
    const uploader = await prisma.user.findFirst({
      where: { id: list.uploadedById },
      select: { role: { select: { name: true } } },
    });
    const isUploaderAdmin = uploader && uploader.role && (uploader.role.name === ROLES.SUPERADMIN || uploader.role.name === ROLES.ADMIN);

    const errors: CandidateUploadError[] = [];
    // Rows that matched an EXISTING candidate (by email/phone/resume/LinkedIn/
    // GitHub) rather than creating a new one. They still count toward
    // validCount, but are reported separately so an overlapping second file
    // doesn't read as the app silently reshowing a previous import's data.
    const linked: CandidateUploadError[] = [];
    let validCount = 0;
    // Rows whose candidate was already a member of this exact list — e.g. the
    // same file re-uploaded. Not an error: just nothing new to import for that row.
    let skippedCount = 0;

    // Resume size ceiling (DB-config, sector-scoped) — read once for the batch.
    const maxResumeBytes =
      (await configService.getNumber(CONFIG_KEYS.RESUME_MAX_SIZE_MB, 5, list.sectorId ?? null)) *
      1024 *
      1024;
    // Resume downloads are deferred and fetched concurrently after this loop
    // (see attachPendingResumes) instead of blocking each row on its own
    // network round-trip — see RESUME_FETCH_CONCURRENCY.
    const pendingResumes: PendingResumeFetch[] = [];

    for (let i = 0; i < rows.length; i++) {
      // Normalize this row's keys once.
      const normalized: CsvRow = {};
      for (const [k, v] of Object.entries(rows[i])) normalized[normalizeKey(k)] = v;

      const result = validateRow(normalized);
      if (!result.ok) {
        errors.push({ row: i + 2, email: result.email, reason: result.reason }); // +2: header + 1-index
        continue;
      }

      try {
        const dupCheck = await checkCandidateDuplicate(
          result.data.email,
          result.data.phone,
          result.data.resumeUrl,
          result.data.linkedinUrl,
          result.data.githubUrl,
          list.tenantId,
        );

        let candidateId: string;
        let isNewCandidate = false;

        if (dupCheck.duplicate) {
          candidateId = dupCheck.candidateId!;
          // Soft-delete recovery
          const deletedCandidate = await prisma.candidate.findFirst({
            where: { id: candidateId, deletedAt: { not: null } },
            select: { id: true },
          });
          if (deletedCandidate) {
            await prisma.candidate.update({
              where: { id: candidateId },
              data: { deletedAt: null },
            });
          }
        } else {
          isNewCandidate = true;
          // SaaS quota: only a genuinely new candidate row consumes the plan
          // limit (matches createCandidate) — checked per-row so a batch stops
          // exactly at the limit instead of bypassing it entirely.
          const tenantId = getTenantContext()?.tenantId;
          if (tenantId) {
            await assertWithinLimit(tenantId, 'CANDIDATES', 1);
          }

          const createRes = await prisma.candidate.createMany({
            data: [{
              fullName: result.data.fullName,
              email: result.data.email,
              phone: result.data.phone,
              currentRole: result.data.currentRole,
              location: result.data.location,
              experienceLevel: result.data.experienceLevel,
              source: result.data.source ?? 'JOB_BOARD',
              linkedinUrl: result.data.linkedinUrl,
              githubUrl: result.data.githubUrl,
              skills: result.data.skills,
              sectorId: list.sectorId,
              ...(jobRequisitionId && { jobRequisitionId }),
            }],
            skipDuplicates: true,
          });

          const fetchedCandidate = await prisma.candidate.findFirst({
            where: { email: result.data.email },
            select: { id: true, deletedAt: true },
          });

          if (!fetchedCandidate) {
            throw new Error('Failed to create candidate and could not find existing');
          }
          
          candidateId = fetchedCandidate.id;

          if (createRes.count === 0) {
            isNewCandidate = false;
            if (fetchedCandidate.deletedAt) {
              await prisma.candidate.update({
                where: { id: candidateId },
                data: { deletedAt: null },
              });
            }
          }
        }

        // Already a member of THIS list — nothing new to do for this row.
        // (Re-uploading the same file should only pull in candidates that
        // aren't in the list yet, not re-report existing members as errors.)
        const alreadyInList = await prisma.candidateListItem.findFirst({
          where: { candidateId, candidateListId: list.id },
        });
        if (alreadyInList) {
          skippedCount++;
          continue;
        }

        // Auto-apply candidate to requisition if provided
        const reqVal = result.data.jobRequisition;
        let job = null;
        if (jobRequisitionId || reqVal) {
          job = jobRequisitionId
            ? await prisma.jobRequisition.findFirst({ where: { id: jobRequisitionId } })
            : await prisma.jobRequisition.findFirst({
                where: {
                  OR: [
                    { id: reqVal || undefined },
                    { title: { equals: reqVal || undefined, mode: 'insensitive' } },
                  ],
                },
              });
        }

        if (job) {
          if (job.status === 'OPEN') {
            const existingApp = await prisma.jobApplication.findFirst({
              where: { candidateId, jobRequisitionId: job.id },
            });
            if (existingApp) {
              if (dupCheck.duplicate) {
                errors.push({ row: i + 2, email: result.data.email, reason: 'Duplicate Job Application' });
                continue;
              }
            } else {
              const application = await prisma.jobApplication.create({
                data: {
                  candidateId,
                  jobRequisitionId: job.id,
                  status: 'APPLIED',
                },
              });
              const auto = await configService.getBool(CONFIG_KEYS.FIT_SCORE_AUTO, true);
              if (auto) {
                const fitQueue = getQueue(QUEUE_NAMES.FIT_SCORE);
                if (fitQueue) {
                  await fitQueue.add({ applicationId: application.id });
                } else {
                  void scoreApplication(application.id).catch((err) =>
                    logger.error('Inline fit score failed from bulk upload', { applicationId: application.id, err: (err as Error).message }),
                  );
                }
              }
            }
          } else {
            errors.push({
              row: i + 2,
              email: result.data.email,
              reason: `Job requisition "${job.title}" is not OPEN (status: ${job.status})`,
            });
            continue;
          }
        } else if (jobRequisitionId || reqVal) {
          errors.push({
            row: i + 2,
            email: result.data.email,
            reason: `Job requisition "${reqVal}" not found`,
          });
          continue;
        }

        // Link candidate to list — we already know they're not a member yet
        // (checked via `alreadyInList` above), so this is always a new row.
        await prisma.candidateListItem.create({
          data: { candidateListId: listId, candidateId },
        });

        if (!isUploaderAdmin) {
          const existingAssignment = await prisma.candidateAssignment.findFirst({
            where: { candidateId, recruiterId: list.uploadedById, status: 'ASSIGNED' },
          });
          if (!existingAssignment) {
            await prisma.candidateAssignment.create({
              data: {
                candidateId,
                recruiterId: list.uploadedById,
                assignedById: list.uploadedById,
                status: 'ASSIGNED',
                listId: list.id,
              },
            });
          }
        }

        validCount++;
        if (dupCheck.duplicate) {
          linked.push({ row: i + 2, email: result.data.email, reason: `Matched an existing candidate (${dupCheck.reason})` });
        }

        // Optional: pull the resume from the row's URL (e.g. a Google Drive
        // link) and attach it — deferred to attachPendingResumes() below so
        // it happens concurrently with the other rows' downloads rather than
        // blocking this row's turn in the loop on a network round-trip.
        if (result.data.resumeUrl && isNewCandidate) {
          pendingResumes.push({
            row: i + 2,
            email: result.data.email,
            fullName: result.data.fullName,
            candidateId,
            resumeUrl: result.data.resumeUrl,
            tenantId: list.tenantId,
          });
        }
      } catch (err) {
        errors.push({
          row: i + 2,
          email: result.data.email,
          reason: (err as Error).message?.slice(0, 200) ?? 'Unknown error',
        });
      }
    }

    await attachPendingResumes(pendingResumes, maxResumeBytes, errors);

    // Every row resolved to a candidate already in this exact list, and there
    // were no real errors — the file itself brought nothing new.
    const alreadyUploaded = errors.length === 0 && validCount === 0 && skippedCount > 0;

    await prisma.candidateList.update({
      where: { id: listId },
      data: {
        // ERROR means nothing was actually imported — NOT "every row logged an
        // error", since a resume-attach failure lands in this same array for a
        // candidate that otherwise imported fine (errors.length could equal
        // rows.length while validCount is > 0).
        status: validCount === 0 && errors.length > 0
          ? 'ERROR'
          : alreadyUploaded
            ? 'ALREADY_UPLOADED'
            : 'COMPLETED',
        totalCount: rows.length,
        validCount,
        errorCount: errors.length,
        errorReport: errors.length ? (errors as object) : Prisma.DbNull,
        linkedCount: linked.length,
        linkedReport: linked.length ? (linked as object) : Prisma.DbNull,
      },
    });

    if (validCount > 0 && list.assignedTo) {
      const { notify } = await import('./notificationService.js');
      await notify({
        recipientId: list.assignedTo,
        actorId: list.uploadedById,
        type: 'INFO',
        title: 'Bulk Import Assignment',
        message: `You have been assigned ${validCount} new candidate(s) from bulk import "${list.name}".`,
        entityType: 'CandidateList',
        entityId: list.id,
      }).catch((e) => logger.error('Failed to notify assignee on bulk import', { listId, err: (e as Error).message }));
    }

    logger.info('Bulk upload processed', { listId, total: rows.length, validCount, skipped: skippedCount, errors: errors.length });
  };

  if (list.tenantId) {
    await runWithTenant(list.tenantId, processFn);
  } else {
    await processFn();
  }
}

export async function previewCandidateList(
  rows: CsvRow[],
  _ctx: any,
  jobRequisitionId?: string | null
) {
  let jobSkills: string[] = [];
  if (jobRequisitionId) {
    const job = await prisma.jobRequisition.findFirst({
      where: { id: jobRequisitionId },
      select: { skills: true },
    });
    if (job) jobSkills = job.skills.map((s: string) => s.toLowerCase().trim());
  }

  const candidates: any[] = [];
  let matchedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const normalized: CsvRow = {};
    for (const [k, v] of Object.entries(rows[i])) normalized[normalizeKey(k)] = v;

    const result = validateRow(normalized);
    if (!result.ok) {
      candidates.push({
        fullName: pick(normalized, 'fullname', 'name', 'candidatename') || 'Unknown',
        email: result.email || '',
        phone: null,
        currentRole: null,
        location: null,
        experienceLevel: null,
        source: null,
        linkedinUrl: null,
        githubUrl: null,
        resumeUrl: null,
        skills: [],
        matchScore: 0,
        matchedSkills: [],
        missingSkills: jobSkills,
        status: 'ERROR',
        errorReason: result.reason,
        originalRowIndex: i + 2,
      });
      continue;
    }

    const { data } = result;
    // Skill match against the target job is informational only (surfaced as
    // fitScoreData on the resulting application) — it must NOT gate whether a
    // row can be imported. It used to auto-mark anyone under 60% match as
    // REJECT, which silently "rejected" candidates whose CSV simply didn't
    // list every job skill verbatim — every valid row is importable now.
    let matchScore = 100;
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];

    if (jobSkills.length > 0) {
      const candidateSkillsLower = new Set(data.skills.map((s: string) => s.toLowerCase().trim()));
      for (const reqSkill of jobSkills) {
        if (candidateSkillsLower.has(reqSkill.toLowerCase().trim())) {
          matchedSkills.push(reqSkill);
        } else {
          missingSkills.push(reqSkill);
        }
      }
      matchScore = Math.round((matchedSkills.length / jobSkills.length) * 100);
    }

    candidates.push({
      ...data,
      matchScore,
      matchedSkills,
      missingSkills,
      status: 'IMPORT',
      originalRowIndex: i + 2,
    });
    matchedCount++;
  }

  return {
    totalRecords: rows.length,
    matchedCount,
    candidates,
  };
}

export async function processSmartBulkUpload(listId: string, candidates: any[], jobRequisitionId?: string | null): Promise<void> {
  const list = await prisma.candidateList.findFirst({ where: { id: listId } });
  if (!list) {
    logger.warn('processSmartBulkUpload: list not found', { listId });
    return;
  }

  const uploader = await prisma.user.findFirst({
    where: { id: list.uploadedById },
    select: { role: { select: { name: true } } },
  });
  const isUploaderAdmin = uploader && uploader.role && (uploader.role.name === ROLES.SUPERADMIN || uploader.role.name === ROLES.ADMIN);

  const errors: CandidateUploadError[] = [];
  const linked: CandidateUploadError[] = [];
  let validCount = 0;
  // Rows whose candidate was already a member of this exact list — e.g. the
  // same file re-uploaded. Not an error: just nothing new to import for that row.
  let skippedCount = 0;

  const maxResumeBytes =
    (await configService.getNumber(CONFIG_KEYS.RESUME_MAX_SIZE_MB, 5, list.sectorId ?? null)) *
    1024 *
    1024;
  // Resume downloads are deferred and fetched concurrently after this loop
  // (see attachPendingResumes) instead of blocking each row on its own
  // network round-trip — see RESUME_FETCH_CONCURRENCY.
  const pendingResumes: PendingResumeFetch[] = [];

  for (let batchStart = 0; batchStart < candidates.length; batchStart += 5) {
    const chunk = candidates.slice(batchStart, batchStart + 5);
    await Promise.all(chunk.map(async (data) => {
    try {
      const dupCheck = await checkCandidateDuplicate(
        data.email,
        data.phone,
        data.resumeUrl,
        data.linkedinUrl,
        data.githubUrl,
        list.tenantId,
      );

      let candidateId: string;
      let isNewCandidate = false;

      if (dupCheck.duplicate) {
        candidateId = dupCheck.candidateId!;
        const deletedCandidate = await prisma.candidate.findFirst({
          where: { id: candidateId, deletedAt: { not: null } },
          select: { id: true },
        });
        if (deletedCandidate) {
          await prisma.candidate.update({
            where: { id: candidateId },
            data: { deletedAt: null },
          });
        }
      } else {
        isNewCandidate = true;
        // SaaS quota: only a genuinely new candidate row consumes the plan
        // limit (matches createCandidate) — checked per-row so a batch stops
        // exactly at the limit instead of bypassing it entirely.
        const tenantId = getTenantContext()?.tenantId;
        if (tenantId) {
          await assertWithinLimit(tenantId, 'CANDIDATES', 1);
        }

        const createRes = await prisma.candidate.createMany({
          data: [{
            fullName: data.fullName,
            email: data.email,
            phone: data.phone,
            currentRole: data.currentRole,
            location: data.location,
            experienceLevel: data.experienceLevel,
            source: data.source ?? 'JOB_BOARD',
            linkedinUrl: data.linkedinUrl,
            githubUrl: data.githubUrl,
            skills: data.skills,
            sectorId: list.sectorId,
            ...(jobRequisitionId && { jobRequisitionId }),
          }],
          skipDuplicates: true,
        });

        const fetchedCandidate = await prisma.candidate.findFirst({
          where: { email: data.email },
          select: { id: true, deletedAt: true },
        });

        if (!fetchedCandidate) {
          throw new Error('Failed to create candidate and could not find existing');
        }
        
        candidateId = fetchedCandidate.id;

        if (createRes.count === 0) {
          isNewCandidate = false;
          if (fetchedCandidate.deletedAt) {
            await prisma.candidate.update({
              where: { id: candidateId },
              data: { deletedAt: null },
            });
          }
        }
      }

      // Already a member of THIS list — nothing new to do for this row.
      const alreadyInList = await prisma.candidateListItem.findFirst({
        where: { candidateListId: listId, candidateId },
      });
      if (alreadyInList) {
        skippedCount++;
        return;
      }

      if (jobRequisitionId) {
        const existingApp = await prisma.jobApplication.findFirst({
          where: { candidateId, jobRequisitionId },
          select: { id: true },
        });
        if (existingApp) {
          if (dupCheck.duplicate) {
            errors.push({ row: data.originalRowIndex, email: data.email, reason: 'Duplicate Job Application' });
            return;
          }
        } else {
          const application = await prisma.jobApplication.create({
            data: {
              candidateId,
              jobRequisitionId,
              status: 'APPLIED',
              stage: 'APPLIED',
            },
          });
          // The preview's matchScore is a naive literal skill-string comparison
          // (and defaults to 100 when the job has no skills configured) — it's
          // only meant to help the recruiter eyeball rows before import, never
          // a real fit score. The real score must go through scoreApplication
          // (resume/experience grounding, normalized skill overlap, banding),
          // same as every other application creation path.
          const auto = await configService.getBool(CONFIG_KEYS.FIT_SCORE_AUTO, true);
          if (auto) {
            const fitQueue = getQueue(QUEUE_NAMES.FIT_SCORE);
            if (fitQueue) {
              await fitQueue.add({ applicationId: application.id });
            } else {
              void scoreApplication(application.id).catch((err) =>
                logger.error('Inline fit score failed from smart bulk upload', { applicationId: application.id, err: (err as Error).message }),
              );
            }
          }
        }
      }

      // Link candidate to list — we already know they're not a member yet.
      await prisma.candidateListItem.create({
        data: { candidateListId: listId, candidateId },
      });

      if (!isUploaderAdmin) {
        const existingAssignment = await prisma.candidateAssignment.findFirst({
          where: { candidateId, recruiterId: list.uploadedById, status: 'ASSIGNED' },
        });
        if (!existingAssignment) {
          await prisma.candidateAssignment.create({
            data: {
              candidateId,
              recruiterId: list.uploadedById,
              assignedById: list.uploadedById,
              status: 'ASSIGNED',
              listId: list.id,
            },
          });
        }
      }

      if (list.assignedTo) {
        const existingAssignment = await prisma.candidateAssignment.findFirst({
          where: { candidateId, recruiterId: list.assignedTo },
        });
        if (!existingAssignment) {
          await prisma.candidateAssignment.create({
            data: {
              candidateId,
              recruiterId: list.assignedTo,
              listId: list.id,
              assignedById: list.uploadedById,
            },
          });
        }
      }

      validCount++;
      if (dupCheck.duplicate) {
        linked.push({ row: data.originalRowIndex, email: data.email, reason: `Matched an existing candidate (${dupCheck.reason})` });
      }

      if (data.resumeUrl && isNewCandidate) {
        pendingResumes.push({
          row: data.originalRowIndex,
          email: data.email,
          fullName: data.fullName,
          candidateId,
          resumeUrl: data.resumeUrl,
          tenantId: null,
        });
      }
    } catch (err) {
      errors.push({
        row: data.originalRowIndex,
        email: data.email,
        reason: (err as Error).message?.slice(0, 200) ?? 'Unknown error',
      });
    }
  }));
  }

  await attachPendingResumes(pendingResumes, maxResumeBytes, errors);

  const alreadyUploaded = errors.length === 0 && validCount === 0 && skippedCount > 0;

  await prisma.candidateList.update({
    where: { id: listId },
    data: {
      // See processBulkUpload: a resume-attach failure lands in `errors` too,
      // so this must key off validCount, not errors.length === candidates.length.
      status: validCount === 0 && errors.length > 0
        ? 'ERROR'
        : alreadyUploaded
          ? 'ALREADY_UPLOADED'
          : 'COMPLETED',
      totalCount: candidates.length,
      validCount,
      errorCount: errors.length,
      errorReport: errors.length ? (errors as object) : Prisma.DbNull,
      linkedCount: linked.length,
      linkedReport: linked.length ? (linked as object) : Prisma.DbNull,
    },
  });

  if (validCount > 0 && list.assignedTo) {
    const { notify } = await import('./notificationService.js');
    await notify({
      recipientId: list.assignedTo,
      actorId: list.uploadedById,
      type: 'INFO',
      title: 'Bulk Import Assignment',
      message: `You have been assigned ${validCount} new candidate(s) from bulk import "${list.name}".`,
      entityType: 'CandidateList',
      entityId: list.id,
    }).catch((e) => logger.error('Failed to notify assignee on bulk import', { listId, err: (e as Error).message }));
  }

  logger.info('Smart bulk upload processed', { listId, total: candidates.length, validCount, errors: errors.length });
}
