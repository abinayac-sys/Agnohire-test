/** Typed application errors carrying an HTTP status + machine code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: Record<string, string[]>) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

/** Plan quota reached — HTTP 402 with machine-readable current/limit detail. */
export class QuotaExceededError extends AppError {
  constructor(metric: string, current: number, limit: number) {
    super(402, 'QUOTA_EXCEEDED', `Plan limit reached for ${metric} (${current}/${limit}). Upgrade your plan to continue.`, {
      [metric]: [`current=${current}`, `limit=${limit}`],
    });
  }
}

/** Subscription not ACTIVE/TRIALING — writes are blocked until renewal. */
export class SubscriptionInactiveError extends AppError {
  constructor(status: string) {
    super(402, 'SUBSCRIPTION_INACTIVE', `Subscription is ${status}. Renew or update payment to continue.`);
  }
}

/** Tenant not yet approved by marketing — login is blocked (holding page). */
export class TenantPendingApprovalError extends AppError {
  constructor(status: string) {
    const message =
      status === 'REJECTED'
        ? 'This workspace was not approved. Please contact our team.'
        : 'Your workspace is under review. Our team will contact you shortly to activate it.';
    super(403, 'TENANT_PENDING_APPROVAL', message, { approvalStatus: [status] });
  }
}

/** Scheduled maintenance is live — non-superadmin access is blocked platform-wide. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, string[]>, message = 'Validation failed') {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}
