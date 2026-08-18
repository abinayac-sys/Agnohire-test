interface FakeReqContext {
  userId: string;
  role?: string | null;
  sectorId?: string | null;
  ip?: string;
}

/**
 * Builds a request-shaped object for AI tool calls that lack a real Express
 * request, carrying every field recordAudit reads (user.sub/role/sectorId,
 * ip, headers['user-agent']) so tool-driven mutations never write empty
 * audit rows.
 */
export function buildFakeReq(ctx: FakeReqContext): any {
  return {
    user: {
      sub: ctx.userId,
      role: ctx.role ?? null,
      sectorId: ctx.sectorId ?? null,
    },
    headers: { 'user-agent': 'agno-copilot' },
    ip: ctx.ip ?? '127.0.0.1',
  };
}
