import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import type { JwtPayload, InterviewTokenPayload } from '@agnohire/shared';

export function signAccessToken(
  payload: Omit<JwtPayload, 'type'>,
  ttlMinutes: number,
): string {
  return jwt.sign({ ...payload, type: 'access' }, env.jwtSecret, {
    expiresIn: `${ttlMinutes}m`,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type');
  return decoded;
}

export function signInterviewToken(
  payload: Omit<InterviewTokenPayload, 'type'>,
  ttlHours: number,
): string {
  return jwt.sign({ ...payload, type: 'interview' }, env.jwtSecret, {
    expiresIn: `${ttlHours}h`,
  });
}

export function verifyInterviewToken(token: string): InterviewTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as InterviewTokenPayload;
  if (decoded.type !== 'interview') throw new Error('Invalid token type');
  return decoded;
}

/** Opaque refresh token — returned to the client; only its hash is stored. */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * SHA-256 of a refresh token. We store only this hash so a DB read can't yield
 * usable session tokens. The token is high-entropy (48 random bytes), so a plain
 * hash is sufficient (no salt/bcrypt needed) and keeps lookups O(1) and unique.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Single-use token for password reset links. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
