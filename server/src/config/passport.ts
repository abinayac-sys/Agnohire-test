import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './database.js';
import { runAsPlatform } from './tenantContext.js';
import { ROLES } from '@agnohire/shared';

export interface OAuthResult {
  userId: string;
}

/**
 * Configures the Google OAuth strategy when credentials are present.
 * On callback we find-or-create the User + OAuthAccount. New self-service
 * sign-ups default to the CANDIDATE role; staff are provisioned by an admin.
 */
export function configurePassport(): void {
  if (!env.google.enabled) {
    logger.warn('Google OAuth not configured — dev email login only');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.google.clientId,
        clientSecret: env.google.clientSecret,
        callbackURL: '/api/auth/google/callback',
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile: Profile, done) => {
        try {
          // Pre-auth: no tenant context and the user is matched by globally
          // unique email across all tenants, so this must bypass RLS on User.
          const userId = await runAsPlatform(() =>
            findOrCreateOAuthUser(profile, accessToken, refreshToken),
          );
          // The OAuth step carries only { userId }; tokens are issued in the
          // callback controller where the full principal is loaded.
          done(null, { userId } as unknown as Express.User);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: Express.User, done) => done(null, user));
  logger.info('Google OAuth strategy configured');
}

async function findOrCreateOAuthUser(
  profile: Profile,
  accessToken: string,
  refreshToken?: string,
): Promise<string> {
  const email = profile.emails?.[0]?.value?.toLowerCase();
  if (!email) throw new Error('Google profile has no email');

  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'google',
        providerAccountId: profile.id,
      },
    },
  });
  if (existingAccount) return existingAccount.userId;

  // Link to an existing user by email, or create a new candidate user. Must
  // exclude soft-deleted rows, or a deleted account's email would either
  // silently resurrect it or collide with the partial unique index on create.
  let user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  if (!user) {
    const candidateRole = await prisma.role.findUniqueOrThrow({
      where: { name: ROLES.CANDIDATE },
    });
    user = await prisma.user.create({
      data: {
        email,
        fullName: profile.displayName || email,
        avatarUrl: profile.photos?.[0]?.value,
        roleId: candidateRole.id,
      },
    });
  }

  await prisma.oAuthAccount.create({
    data: {
      userId: user.id,
      provider: 'google',
      providerAccountId: profile.id,
      accessToken,
      refreshToken,
    },
  });
  return user.id;
}

export { passport };
