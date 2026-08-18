import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, restoreTenantContext } from '../middlewares/auth.middleware.js';
import { attachmentUpload } from '../utils/storage.js';
import * as attachment from '../controllers/attachment.controller.js';
import { prisma } from '../config/database.js';

const router = Router();

// Middleware to authenticate either a standard user or a public candidate with a valid offer token
function authenticateOrPublicToken(req: Request, res: Response, next: NextFunction) {
  authenticate(req, res, (err) => {
    if (!err) {
      return next();
    }

    const token = req.headers['x-offer-token'] || req.query.offerToken;
    if (typeof token === 'string' && token) {
      prisma.offer.findFirst({
        where: {
          acceptanceToken: token,
          deletedAt: null,
        },
      }).then((offer) => {
        if (offer) {
          req.publicOfferToken = token;
          return next();
        }
        return next(err);
      }).catch((dbErr) => {
        next(dbErr);
      });
    } else {
      next(err);
    }
  });
}

// Generic file upload/download. Any authenticated staff user or candidate with a valid token may upload
// multer's form-parsing can drop the AsyncLocalStorage tenant-context set by
// authenticateOrPublicToken (see restoreTenantContext's own doc comment) —
// without re-establishing it here, the upload silently lands with
// tenantId: null, and every later tenant-scoped lookup of that attachment
// (including the uploader's own "View"/"Download") 404s as "File not found".
router.post('/', authenticateOrPublicToken, attachmentUpload.single('file'), restoreTenantContext, attachment.upload);
router.get('/:id/download', authenticateOrPublicToken, attachment.download);

export default router;
