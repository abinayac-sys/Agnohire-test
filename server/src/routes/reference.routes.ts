import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { prisma } from '../config/database.js';

const router = Router();

router.use(authenticate);

/** GET /api/reference/sectors — lightweight sector list for form dropdowns. */
router.get(
  '/sectors',
  asyncHandler(async (_req, res) => {
    const sectors = await prisma.sector.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    return ok(res, { sectors });
  }),
);

/** GET /api/reference/domains?sectorId= — domain list, optionally scoped. */
router.get(
  '/domains',
  asyncHandler(async (req, res) => {
    const sectorId =
      typeof req.query.sectorId === 'string' ? req.query.sectorId : undefined;
    const domains = await prisma.domain.findMany({
      where: {
        isActive: true,
        ...(sectorId ? { sectorId } : {}),
      },
      select: { id: true, name: true, sectorId: true, parentId: true },
      orderBy: { name: 'asc' },
    });
    return ok(res, { domains });
  }),
);

/** GET /api/reference/users — minimal user list for mention/assignment pickers. */
router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        role: { select: { name: true, displayName: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return ok(res, { users });
  }),
);

export default router;
