/**
 * TEMP AI smoke harness — exercises every AI feature against real DB records
 * and reports the PERSISTED output so silent fallbacks are caught (the scorers
 * swallow AI errors internally). Run: npx tsx scripts/ai-smoke.ts
 */
import { prisma } from '../src/config/database.js';
import { parseResume } from '../src/services/resumeParseService.js';
import { scoreApplication } from '../src/services/fitScoreService.js';
import { scoreInterview } from '../src/services/interviewScoringService.js';
import { scoreAssignment } from '../src/services/assessmentScoringService.js';
import { analyzeInterview } from '../src/services/videoIntelligenceService.js';
import { getInsights } from '../src/services/analyticsService.js';

const line = (s: string) => console.log(s);
const ok = (f: string, d: string) => line(`✅ ${f.padEnd(22)} ${d}`);
const bad = (f: string, d: string) => line(`❌ ${f.padEnd(22)} ${d}`);

async function testResumeParse() {
  const f = 'resume-parse';
  try {
    const cand = await prisma.candidate.findFirst({ where: { deletedAt: null }, select: { id: true } });
    if (!cand) return bad(f, 'no candidate');
    const sample = `John Doe\nSenior Software Engineer\nEmail: john@example.com | Phone: +1-555-0100\n\nEXPERIENCE\nAcme Corp — Senior Engineer (2019-2024). Built Node.js/PostgreSQL services on AWS.\nBeta Inc — Engineer (2016-2019). React frontends.\n\nSKILLS: JavaScript, TypeScript, Node.js, PostgreSQL, AWS, React\n\nEDUCATION: BSc Computer Science, MIT, 2016`;
    const resume = await prisma.resume.create({
      data: {
        candidateId: cand.id,
        fileUrl: 'internal://ai-smoke',
        fileName: 'ai-smoke.txt',
        mimeType: 'text/plain',
        fileSize: sample.length,
        fileData: Buffer.from(sample),
        parseStatus: 'PENDING',
      },
      select: { id: true },
    });
    await parseResume(resume.id);
    const after = await prisma.resume.findUnique({ where: { id: resume.id }, select: { parseStatus: true, parsedData: true, parseError: true } });
    const pd = after?.parsedData as any;
    if (after?.parseStatus === 'COMPLETED' && pd && (pd.skills?.length || pd.name)) {
      ok(f, `status=${after.parseStatus} name="${pd.name ?? '?'}" skills=${(pd.skills ?? []).slice(0, 4).join(',')}`);
    } else {
      bad(f, `status=${after?.parseStatus} err=${after?.parseError ?? 'no parsed data'}`);
    }
    await prisma.resume.delete({ where: { id: resume.id } });
  } catch (e) { bad(f, (e as Error).message); }
}

async function testFitScore() {
  const f = 'fit-score';
  try {
    const app = await prisma.jobApplication.findFirst({ select: { id: true } });
    if (!app) return bad(f, 'no application');
    const r = await scoreApplication(app.id);
    if (r && typeof r.overall === 'number') ok(f, `overall=${r.overall} summary="${String((r as any).summary ?? (r as any).reasoning ?? '').slice(0, 60)}"`);
    else bad(f, `unexpected result ${JSON.stringify(r).slice(0, 80)}`);
  } catch (e) { bad(f, (e as Error).message); }
}

async function testInterviewScore() {
  const f = 'interview-scoring';
  try {
    const iv = await prisma.interview.findFirst({ select: { id: true } });
    if (!iv) return bad(f, 'no interview');
    await scoreInterview(iv.id);
    const res = await prisma.interviewResult.findFirst({ where: { interviewId: iv.id }, orderBy: { createdAt: 'desc' }, select: { aiSummary: true, percentageScore: true, aiDecision: true } });
    if (res?.aiSummary) ok(f, `score=${res.percentageScore}% decision=${res.aiDecision} summary="${res.aiSummary.slice(0, 60)}"`);
    else bad(f, `no aiSummary (AI may have failed). result=${JSON.stringify(res)}`);
  } catch (e) { bad(f, (e as Error).message); }
}

async function testAssessmentScore() {
  const f = 'assessment-scoring';
  try {
    const asg = await prisma.assessmentAssignment.findFirst({ select: { id: true } });
    if (!asg) return bad(f, 'no assessment assignment');
    await scoreAssignment(asg.id);
    const after = await prisma.assessmentAssignment.findUnique({ where: { id: asg.id }, select: { aiSummary: true, percentageScore: true, passed: true } });
    // aiSummary always set; a real AI summary does NOT start with the "Auto-scored" fallback.
    const aiReal = after?.aiSummary && !after.aiSummary.startsWith('Auto-scored');
    if (aiReal) ok(f, `score=${after!.percentageScore}% passed=${after!.passed} summary="${after!.aiSummary!.slice(0, 60)}"`);
    else bad(f, `fell back (no AI summary): "${after?.aiSummary?.slice(0, 70)}"`);
  } catch (e) { bad(f, (e as Error).message); }
}

async function testVideo() {
  const f = 'video-intelligence';
  try {
    const iv = await prisma.interview.findFirst({ select: { id: true, transcript: true } });
    if (!iv) return bad(f, 'no interview');
    if (!iv.transcript) {
      await prisma.interview.update({ where: { id: iv.id }, data: { transcript: 'Interviewer: Tell me about a challenging project. Candidate: I led a migration of a monolith to microservices, coordinating five engineers over three months, which cut deploy time by 70 percent. I focused on clear communication and incremental rollout.' } });
    }
    await analyzeInterview(iv.id);
    const after = await prisma.interviewResult.findUnique({ where: { interviewId: iv.id }, select: { communicationScore: true, skillMatchScore: true, transcriptSummary: true } });
    if (after && after.communicationScore != null) ok(f, `comm=${after.communicationScore} skill=${after.skillMatchScore} summary="${(after.transcriptSummary ?? '').slice(0, 50)}"`);
    else bad(f, `no AI scores (deterministic only). ${JSON.stringify(after)?.slice(0, 80)}`);
  } catch (e) { bad(f, (e as Error).message); }
}

async function testAnalytics() {
  const f = 'analytics-insights';
  try {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@agnohire.local' }, select: { id: true } });
    const ctx: any = { userId: admin?.id, sectorId: null, role: 'SUPERADMIN', isAdmin: true };
    const r: any = await getInsights({ granularity: 'month' }, ctx);
    if (r?.generated && r.summary) ok(f, `summary="${r.summary.slice(0, 80)}"`);
    else bad(f, `generated=${r?.generated} summary=${r?.summary ?? 'null'}`);
  } catch (e) { bad(f, (e as Error).message); }
}

const gap = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  line('\n=== AI SMOKE (live Gemini) ===');
  // Space features out (~14s) to respect the free-tier 5 req/min limit; the
  // client also backs off on 429, so this is belt-and-suspenders.
  await testResumeParse();    await gap(14000);
  await testFitScore();       await gap(14000);
  await testInterviewScore(); await gap(14000);
  await testAssessmentScore();await gap(14000);
  await testVideo();          await gap(14000);
  await testAnalytics();
  line('=== done ===\n');
  await prisma.$disconnect();
}
main();
