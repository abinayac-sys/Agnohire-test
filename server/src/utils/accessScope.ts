import { ROLES } from '@agnohire/shared';

/** Admins and superadmins are never scoped — they see everything. */
export function isSuperOrAdmin(role: string): boolean {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/**
 * Recruiters are restricted to the candidates explicitly allocated to them.
 *
 * A higher role (HR / Admin) uploads the candidate list and assigns batches of
 * candidates to a recruiter. From then on the recruiter must only ever see
 * those candidates — and everything hanging off them (applications, interviews,
 * schedules, reviews, offers, assessments) — never the rest of the sector.
 * Every other staff role keeps sector-wide visibility.
 */
export function isRecruiterScoped(role: string): boolean {
  return role === ROLES.HIRING_MANAGER;
}

/**
 * Prisma `Candidate` filter matching candidates currently assigned to this
 * recruiter. Use directly on a Candidate query, or nest under the relation that
 * reaches a candidate (e.g. `{ candidate: assignedCandidateWhere(userId) }`).
 */
export function assignedCandidateWhere(userId: string) {
  return {
    assignments: { some: { recruiterId: userId, status: 'ASSIGNED' } },
  };
}
