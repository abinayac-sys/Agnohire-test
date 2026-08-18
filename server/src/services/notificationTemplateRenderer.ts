import { prisma } from '../config/database.js';
import { configService } from './configService.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import { compileTemplate, SYSTEM_TEMPLATES } from './emailTemplateMetadata.js';
import { resolveTemplate } from './emailTemplates.js';

export interface RenderNotificationOptions {
  template: string;
  channel?: 'email' | 'whatsapp';
  variables: Record<string, any>;
  overrides?: { subject?: string; body?: string };
}

export interface WhatsAppMessageStructure {
  header?: string;
  body: string;
  cta?: { text: string; url: string } | null;
  footer?: string;
}

export interface RenderNotificationResult {
  subject: string;
  html: string;
  whatsappBody: string;
  branding: {
    logoUrl?: string | null;
    bannerUrl?: string | null;
  };
  cta?: { text: string; url: string } | null;
  whatsappData?: WhatsAppMessageStructure;
}

/**
 * Unified notification renderer that resolves branding, email HTML, and structured WhatsApp payloads.
 */
export async function renderNotification(opts: {
  template: string;
  channel?: 'email' | 'whatsapp';
  variables: Record<string, any>;
  overrides?: { subject?: string; body?: string };
}): Promise<RenderNotificationResult> {
  const { template, variables, overrides } = opts;

  // 1. Render email HTML and Subject using the template engine
  const { subject, html } = await resolveTemplate(template, variables, false, overrides);

  // 2. Resolve template raw payload for WhatsApp extraction
  let custom = await prisma.emailTemplate.findFirst({
    where: { type: template, isDefault: true, deletedAt: null },
  });

  if (!custom) {
    custom = await prisma.emailTemplate.findUnique({
      where: { id: `override-${template}` },
    });
  }

  const sys = SYSTEM_TEMPLATES.find((t) => t.type === template);
  const rawBody = overrides?.body || custom?.body || sys?.defaultBody || '';

  let heading = '';
  let greeting = '';
  let message = '';
  let ctaText = '';
  let ctaUrl = '';
  let closing = '';
  let signature = '';

  try {
    const parsed = JSON.parse(rawBody);
    heading = compileTemplate(parsed.heading || '', variables);
    greeting = compileTemplate(parsed.greeting || '', variables);
    message = compileTemplate(parsed.message || '', variables);
    ctaText = compileTemplate(parsed.ctaText || '', variables);
    ctaUrl = compileTemplate(parsed.ctaUrl || '', variables);
    closing = compileTemplate(parsed.closing || '', variables);
    signature = compileTemplate(parsed.signature || '', variables);
  } catch {
    // If not JSON, use plain compiled text
    message = compileTemplate(rawBody, variables).replace(/<[^>]*>?/gm, '');
  }

  // Build WhatsApp formatted message
  const waParts: string[] = [];
  if (heading) waParts.push(`*${heading}*`);
  if (greeting) waParts.push(greeting);
  if (message) waParts.push(message);
  if (ctaUrl && ctaText) {
    waParts.push(`${ctaText}: ${ctaUrl}`);
  } else if (ctaUrl) {
    waParts.push(ctaUrl);
  }
  if (closing) waParts.push(closing);
  if (signature) waParts.push(signature);

  const whatsappBody = waParts.filter(Boolean).join('\n\n');

  // Resolve branding images
  const companyLogo = await configService.getString(CONFIG_KEYS.COMPANY_LOGO, '');
  const appIcon = await configService.getString(CONFIG_KEYS.APP_ICON, '');
  const brandLogo = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_LOGO, '');

  const logoUrl = brandLogo || companyLogo || appIcon || null;

  const cta = ctaUrl ? { text: ctaText || 'View Details', url: ctaUrl } : null;
  const whatsappData: WhatsAppMessageStructure = {
    header: heading || undefined,
    body: message || whatsappBody,
    cta,
    footer: signature || undefined,
  };

  return {
    subject,
    html,
    whatsappBody,
    branding: {
      logoUrl,
      bannerUrl: null,
    },
    cta,
    whatsappData,
  };
}
