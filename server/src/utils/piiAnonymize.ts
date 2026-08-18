/**
 * Prisma update payload that irreversibly scrubs a deleted User row's PII
 * while keeping the row (and its id) intact. Deleting a User outright is not
 * viable here — JobRequisition.createdById and other relations are required,
 * non-nullable foreign keys, so a real DELETE would either fail outright or
 * cascade into jobs/candidates/interviews/audit history far beyond the user
 * being removed. Anonymizing achieves the actual goal (the person's data is
 * gone, their email is free to reuse) without that blast radius.
 *
 * The email is replaced with a per-user, globally unique placeholder on the
 * reserved `.invalid` TLD (RFC 2606) — guaranteed to never collide with, or
 * be mistaken for, a real address again.
 */
export function anonymizedUserFields(userId: string) {
  return {
    email: `deleted-${userId}@deleted.invalid`,
    fullName: 'Deleted User',
    phone: null,
    avatarUrl: null,
    address: null,
    bio: null,
    dateOfBirth: null,
    department: null,
    gender: null,
    jobTitle: null,
    location: null,
    passwordHash: null,
    resetToken: null,
    resetTokenExp: null,
    verifyToken: null,
  };
}
