import nodemailer, { type Transporter } from 'nodemailer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { configService } from './configService.js';
import { getPublicAttachmentFile } from './attachmentService.js';
import { getTenantContext } from '../config/tenantContext.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { CONFIG_KEYS } from '@agnohire/shared';

/** Content-ID used to inline the brand logo so it renders even when the public
 *  asset URL is unreachable from the recipient's inbox (e.g. a localhost dev
 *  deployment). Email HTML references `cid:brandlogo`. */
export const BRAND_LOGO_CID = 'brandlogo';

/** Lazily load + cache the default logo bytes from the client's public assets.
 *  Used as the fallback when the current tenant has not configured its own
 *  tenant logo. Tries a few likely locations so it works in dev (monorepo)
 *  and bundled builds; if none resolve, returns null and emails fall back to
 *  the alt-text brand name. */
let defaultLogoCache: Buffer | null | undefined;
function loadDefaultBrandLogo(): Buffer | null {
  if (defaultLogoCache !== undefined) return defaultLogoCache;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../client/public/logo.png'),
    resolve(here, '../../client/public/logo.png'),
    resolve(process.cwd(), '../client/public/logo.png'),
    resolve(process.cwd(), 'client/public/logo.png'),
  ];
  for (const path of candidates) {
    try {
      defaultLogoCache = readFileSync(path);
      return defaultLogoCache;
    } catch {
      /* try next */
    }
  }
  logger.warn('Default brand logo not found for email inlining — using alt text');
  defaultLogoCache = null;
  return null;
}

type Logo = { buffer: Buffer; mimeType: string };

/** Cache of resolved tenant logo bytes, keyed by the COMPANY_LOGO attachment
 *  id (not tenantId — sidesteps invalidation when a tenant re-uploads, since a
 *  new upload gets a new attachment id). */
const tenantLogoCache = new Map<string, Logo>();

/** Resolve the logo to inline for the current tenant: their own COMPANY_LOGO
 *  override (uploaded via Settings, same mechanism that brands the app header)
 *  if set, else the platform default logo file. */
async function loadBrandLogo(): Promise<Logo | null> {
  const attachmentId = await configService.getString(CONFIG_KEYS.COMPANY_LOGO, '');
  if (!attachmentId) {
    const buffer = loadDefaultBrandLogo();
    return buffer ? { buffer, mimeType: 'image/png' } : null;
  }

  const cached = tenantLogoCache.get(attachmentId);
  if (cached) return cached;

  try {
    const file = await getPublicAttachmentFile(attachmentId);
    const logo: Logo = { buffer: file.buffer, mimeType: file.mimeType };
    tenantLogoCache.set(attachmentId, logo);
    return logo;
  } catch (err) {
    logger.warn('Tenant logo attachment not found for email inlining — using default', {
      tenantId: getTenantContext()?.tenantId ?? null,
      attachmentId,
      error: (err as Error).message,
    });
    const buffer = loadDefaultBrandLogo();
    return buffer ? { buffer, mimeType: 'image/png' } : null;
  }
}

/**
 * SMTP mail delivery, configured entirely from the database (Admin Console /
 * Module 14) per the zero-hardcoded-config rule. Reads `email.*` settings via
 * ConfigService; the SMTP password is an encrypted secret.
 *
 * Graceful by design: if SMTP is not configured (no host), every send is a
 * no-op that logs and returns `{ sent: false }` — callers never need to guard.
 *
 * The transporter is cached and rebuilt only when the underlying config
 * changes (detected via a cheap signature), so config edits take effect without
 * a restart.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Optional tag stored on the EmailLog row (e.g. 'interview-invite'). */
  templateId?: string;
  /** What this email is about (e.g. 'Interview', 'Offer') — for send-once dedupe. */
  entityType?: string;
  entityId?: string;
  attachments?: { filename: string; content?: Buffer; path?: string; contentType?: string; cid?: string }[];
}

/** Records every delivery attempt to EmailLog (best-effort; never throws). */
async function logEmail(
  msg: MailMessage,
  status: 'SENT' | 'FAILED' | 'SKIPPED',
  errorMsg?: string,
): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        toEmail: msg.to,
        subject: msg.subject,
        templateId: msg.templateId ?? null,
        status,
        errorMsg: errorMsg ?? null,
        sentAt: status === 'SENT' ? new Date() : null,
        entityType: msg.entityType ?? null,
        entityId: msg.entityId ?? null,
      },
    });
  } catch (err) {
    logger.warn('Failed to write EmailLog', { error: (err as Error).message });
  }
}

/**
 * True if a SENT email of this template already went out for the given entity
 * (or, when no entity is provided, to the given address). Used by sendMailOnce.
 */
export async function alreadySent(msg: { templateId?: string; to: string; entityId?: string }): Promise<boolean> {
  if (!msg.templateId) return false;
  // Key on template + recipient (+ entity when known). This lets the SAME
  // candidate receive the same template for two DIFFERENT interviews/offers,
  // while still blocking a duplicate of the same one — and lets each interviewer
  // on a panel get their own copy.
  const prior = await prisma.emailLog.findFirst({
    where: {
      templateId: msg.templateId,
      status: 'SENT',
      toEmail: msg.to,
      ...(msg.entityId ? { entityId: msg.entityId } : {}),
    },
    select: { id: true },
  });
  return Boolean(prior);
}

/**
 * Sends an email at most once per (template + entity). A repeat attempt returns
 * `{ sent: false, skipped: 'already-sent' }` instead of delivering a duplicate.
 * `force` overrides. Use for one-time emails (invites, offers, results); leave
 * recurring mail (reminders) on plain sendMail.
 */
export async function sendMailOnce(msg: MailMessage, force = false): Promise<MailResult> {
  if (!force && (await alreadySent(msg))) {
    return { sent: false, skipped: 'already-sent' };
  }
  return sendMail(msg);
}

export interface MailResult {
  sent: boolean;
  skipped?: 'not-configured' | 'already-sent';
  messageId?: string;
  error?: string;
}

interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromHeader: string;
  secure: boolean;
}

let cached: { sig: string; transporter: Transporter } | null = null;

/** Wraps a bare address as `"Display Name" <address>` so mail clients show a
 *  proper sender name instead of falling back to the address's raw local-part
 *  (e.g. Gmail rendering "agnohire" from "agnohire@gmail.com"). Leaves an
 *  already-formatted `"Name" <addr>` value untouched. */
function formatFrom(address: string, displayName: string): string {
  if (!address || /<.+>/.test(address)) return address;
  const name = displayName?.trim();
  return name ? `"${name.replace(/"/g, '')}" <${address}>` : address;
}

async function loadSettings(): Promise<SmtpSettings> {
  const [host, port, user, pass, from, secure, companyName] = await Promise.all([
    configService.getString(CONFIG_KEYS.SMTP_HOST),
    configService.getNumber(CONFIG_KEYS.SMTP_PORT, 587),
    configService.getString(CONFIG_KEYS.SMTP_USER),
    configService.getRaw(CONFIG_KEYS.SMTP_PASS),
    configService.getString(CONFIG_KEYS.SMTP_FROM, 'no-reply@agnohire.local'),
    configService.getBool(CONFIG_KEYS.SMTP_SECURE, false),
    configService.getString(CONFIG_KEYS.COMPANY_NAME, 'AgnoHire'),
  ]);
  return { host, port, user, pass: pass ?? '', from, fromHeader: formatFrom(from, companyName), secure };
}

function signatureOf(s: SmtpSettings): string {
  // Password length (not value) is enough to detect a change without logging it.
  return `${s.host}|${s.port}|${s.user}|${s.pass.length}|${s.from}|${s.secure}`;
}

function getTransporter(s: SmtpSettings): Transporter {
  const sig = signatureOf(s);
  if (cached && cached.sig === sig) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  });
  cached = { sig, transporter };
  return transporter;
}

/** Whether SMTP is configured (a host is set). */
export async function isMailConfigured(): Promise<boolean> {
  return configService.isConfigured(CONFIG_KEYS.SMTP_HOST);
}

/** Drops the cached transporter; call after SMTP config changes. */
export function resetMailer(): void {
  cached = null;
}

/**
 * Sends an email. Returns `{ sent: false, skipped }` when SMTP is unconfigured
 * (logged, never throws on config absence). Real send errors are caught and
 * returned so notification flows never break the request that triggered them.
 */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const settings = await loadSettings();
  if (!settings.host) {
    logger.info('Email skipped — SMTP not configured', {
      to: msg.to,
      subject: msg.subject,
    });
    await logEmail(msg, 'SKIPPED', 'SMTP not configured');
    return { sent: false, skipped: 'not-configured' };
  }
  try {
    const transporter = getTransporter(settings);
    // Inline the brand logo as a CID attachment when the HTML references it or uses a relative branding URL.
    const attachments: any[] = msg.attachments ? [...msg.attachments] : [];
    let processedHtml = msg.html;
    
    // Check for a relative branding URL in the HTML (e.g. /api/system/branding/general.company_logo?v=UUID)
    const brandingMatch = processedHtml.match(/src="\/api\/system\/branding\/[a-zA-Z._-]+[?&]v=([a-zA-Z0-9-]+)"/);
    if (brandingMatch) {
      const attachmentId = brandingMatch[1];
      logger.info('mailerService: Found custom logo attachment in HTML, inlining...', { attachmentId });
      try {
        const logo = await getPublicAttachmentFile(attachmentId);
        attachments.push({
          filename: 'logo.png',
          content: logo.buffer,
          cid: BRAND_LOGO_CID,
          contentType: logo.mimeType,
          contentDisposition: 'inline',
        });
        processedHtml = processedHtml.replace(/src="\/api\/system\/branding\/[a-zA-Z._-]+[?&]v=[a-zA-Z0-9-]+"/g, `src="cid:${BRAND_LOGO_CID}"`);
      } catch (err) {
        logger.error('mailerService: Failed to load custom logo attachment for email inlining', { attachmentId, error: (err as Error).message });
      }
    } else if (processedHtml.includes(`cid:${BRAND_LOGO_CID}`)) {
      const logo = await loadBrandLogo();
      if (logo) {
        attachments.push({
          filename: 'logo.png',
          content: logo.buffer,
          cid: BRAND_LOGO_CID,
          contentType: logo.mimeType,
          contentDisposition: 'inline',
        });
      }
    }
    const info = await transporter.sendMail({
      from: settings.fromHeader,
      to: msg.to,
      subject: msg.subject,
      html: processedHtml,
      text: msg.text ?? stripHtml(processedHtml),
      ...(attachments.length ? { attachments } : {}),
    });
    logger.info('Email sent', { to: msg.to, subject: msg.subject, messageId: info.messageId });
    await logEmail(msg, 'SENT');
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const error = (err as Error).message;
    logger.error('Email send failed', { to: msg.to, subject: msg.subject, error });
    await logEmail(msg, 'FAILED', error);
    return { sent: false, error };
  }
}

/** Verifies the SMTP connection/credentials (used by an admin "test" action). */
export async function verifyMailer(): Promise<MailResult> {
  const settings = await loadSettings();
  if (!settings.host) return { sent: false, skipped: 'not-configured' };
  try {
    await getTransporter(settings).verify();
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
