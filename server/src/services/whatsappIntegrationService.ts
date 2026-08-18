import { logger } from '../config/logger.js';
import axios from 'axios';
import { decrypt, isEncrypted } from '../config/encryption.js';

export interface WhatsAppTestInput {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  useStoredAccessToken?: boolean;
}

export interface WhatsAppTestResult {
  ok: boolean;
  error?: string;
}

export async function testWhatsAppConnection(input: WhatsAppTestInput): Promise<WhatsAppTestResult> {
  const { phoneNumberId, accessToken, apiVersion, useStoredAccessToken } = input;

  let token = accessToken;
  if (useStoredAccessToken) {
    const existing = await prisma.integration.findFirst({
      where: { type: 'whatsapp' }
    });
    if (existing && existing.configJson) {
      try {
        const raw = isEncrypted(existing.configJson) ? decrypt(existing.configJson) : existing.configJson;
        const config = JSON.parse(raw);
        token = config.accessToken || accessToken;
      } catch (err: any) {
        logger.error('Failed to decrypt stored token for test connection', { error: err.message });
      }
    }
  }

  if (!phoneNumberId || !token) {
    return { ok: false, error: 'Phone Number ID and Access Token are required' };
  }

  const version = apiVersion || 'v23.0';

  try {
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}`;
    
    // Test the graph API with a generic read on the phone number object
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.data && response.data.id === phoneNumberId) {
      return { ok: true };
    }

    return { ok: false, error: 'Unexpected response from Meta Graph API' };
  } catch (err: any) {
    logger.error('WhatsApp Graph API test failed', { error: err.message, response: err.response?.data });
    return {
      ok: false,
      error: err.response?.data?.error?.message || err.message || 'Failed to connect to Meta Graph API',
    };
  }
}

import { prisma } from '../config/database.js';
import type { AIContext } from '../ai/toolRegistry/index.js';

export async function sendWhatsAppMessage(candidateId: string, message: string, ctx?: AIContext): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1. Get the candidate's phone number
    // deletedAt: null matches every other candidate lookup in the app —
    // without it a soft-deleted/GDPR-erased candidate could still be
    // messaged by the AI agent.
    const candidate = await prisma.candidate.findFirst({
      where: { id: candidateId, deletedAt: null }
    });

    if (!candidate || !candidate.phone) {
      return { ok: false, error: 'Candidate not found or phone number is missing.' };
    }

    // Prepare phone number (strip non-digits, ensure country code)
    const phone = candidate.phone.replace(/\D/g, '');

    // 2. Get the WhatsApp integration config via vaultService
    const integrationQuery: any = { type: 'whatsapp' };
    if (ctx?.sectorId) {
       integrationQuery.sectorId = ctx.sectorId;
    } else {
       integrationQuery.sectorId = null;
    }

    // Integration is keyed by `type`, not a `provider` column, and its config
    // is stored encrypted as `configJson` (see integrationService.readConfig) —
    // there is no plain `.config`/`.isActive` field on the model.
    integrationQuery.type = 'whatsapp';
    const integration = await prisma.integration.findFirst({
      where: integrationQuery
    });

    if (!integration || !integration.isEnabled || !integration.configJson) {
      return { ok: false, error: 'WhatsApp integration is not configured or not active.' };
    }

    const raw = isEncrypted(integration.configJson) ? decrypt(integration.configJson) : integration.configJson;
    const config = JSON.parse(raw) as any;
    const { phoneNumberId, accessToken, apiVersion } = config;

    if (!phoneNumberId || !accessToken) {
      return { ok: false, error: 'Incomplete WhatsApp integration config.' };
    }

    const version = apiVersion || 'v23.0';

    // 3. Send the message via Meta Graph API
    // Using simple text message format
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: {
        preview_url: false,
        body: message
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    logger.info(`WhatsApp message sent successfully to ${phone}`, { messageId: response.data?.messages?.[0]?.id });
    return { ok: true };
  } catch (err: any) {
    logger.error('Failed to send WhatsApp message', { error: err.message, response: err.response?.data });
    return { ok: false, error: err.response?.data?.error?.message || err.message || 'Failed to send WhatsApp message' };
  }
}

export interface WhatsAppMessageStructure {
  header?: string;
  body: string;
  cta?: { text: string; url: string } | null;
  footer?: string;
}

export interface WhatsAppDirectInput {
  phone: string;
  message: string;
  logoUrl?: string | null;
  mode?: 'text' | 'template';
  templateName?: string;
  templateParameters?: any[];
  cta?: { text: string; url: string } | null;
  whatsappData?: WhatsAppMessageStructure;
  pdfAttachments?: { filename: string; link: string; caption?: string }[];
  credentials: {
    phoneNumberId: string;
    accessToken: string;
    apiVersion?: string;
  };
}

export interface WhatsAppDirectResult {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  reason?: string;
  provider: 'whatsapp';
  providerMessageId?: string;
  error?: string;
}

export async function sendWhatsAppDirect(input: WhatsAppDirectInput): Promise<WhatsAppDirectResult> {
  const { phone, message, logoUrl, mode, templateName, templateParameters, cta, whatsappData, pdfAttachments, credentials } = input;
  const { phoneNumberId, accessToken, apiVersion } = credentials;

  if (!phoneNumberId || !accessToken) {
    return {
      status: 'FAILED',
      reason: 'Incomplete Credentials',
      provider: 'whatsapp',
      error: 'WhatsApp credentials (Phone Number ID and Access Token) are missing.',
    };
  }

  const version = apiVersion || 'v23.0';
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  // 1. Send public logo image first if available, publicly accessible, and NOT template mode
  const isPublicLogo = logoUrl && 
    logoUrl.startsWith('http') && 
    !logoUrl.includes('localhost') && 
    !logoUrl.includes('127.0.0.1');

  if (isPublicLogo && mode !== 'template') {
    try {
      const imgPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'image',
        image: {
          link: logoUrl,
        },
      };

      await axios.post(url, imgPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      logger.info(`WhatsApp logo image sent successfully to ${phone}`, { logoUrl });
    } catch (err: any) {
      // Graceful fallback to text-only on media delivery failure
      logger.warn('Failed to send WhatsApp logo media, falling back to text-only', { 
        error: err.message, 
        response: err.response?.data 
      });
    }
  }

  // 2. Send main message payload (support both text and template modes)
  let payload: any;
  if (mode === 'template') {
    const components: any[] = [];
    
    // Header Component
    if (isPublicLogo) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: {
              link: logoUrl,
            },
          },
        ],
      });
    }

    // Body Component
    const bodyText = whatsappData?.body || message;
    components.push({
      type: 'body',
      parameters: [
        {
          type: 'text',
          text: bodyText,
        },
      ],
    });

    // Button Component
    const buttonCta = cta || whatsappData?.cta;
    if (buttonCta && buttonCta.url) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [
          {
            type: 'text',
            text: buttonCta.url,
          },
        ],
      });
    }

    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName || 'agnohire_notification',
        language: {
          code: 'en_US',
        },
        components,
      },
    };
  } else if (mode === 'text' && templateName && templateParameters) {
    // Retain compatibility for explicit templateName/templateParameters if passed manually
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: 'en_US',
        },
        components: templateParameters,
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: {
        preview_url: false,
        body: message,
      },
    };
  }

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const messageId = response.data?.messages?.[0]?.id;
    logger.info(`WhatsApp message sent successfully to ${phone}`, { messageId });

    // 3. Send PDF attachments if available and have public links (after the main message!)
    if (pdfAttachments && pdfAttachments.length > 0) {
      for (const doc of pdfAttachments) {
        if (doc.link) {
          try {
            const docPayload = {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: phone,
              type: 'document',
              document: {
                link: doc.link,
                filename: doc.filename || 'Performance_Report.pdf',
                caption: doc.caption || undefined,
              },
            };

            await axios.post(url, docPayload, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            });
            logger.info(`WhatsApp document attachment sent successfully to ${phone}`, { link: doc.link });
          } catch (err: any) {
            logger.warn('Failed to send WhatsApp document attachment', { 
              error: err.message, 
              response: err.response?.data 
            });
          }
        }
      }
    }

    return {
      status: 'SENT',
      provider: 'whatsapp',
      providerMessageId: messageId,
    };
  } catch (err: any) {
    const errorMsg = err.response?.data?.error?.message || err.message || 'Failed to send WhatsApp message';
    const errorCode = err.response?.data?.error?.code;
    const errorType = err.response?.data?.error?.type;
    
    let reason = 'Meta API Error';
    if (errorCode === 190 || errorType === 'OAuthException') {
      reason = 'Authentication Failure';
    } else if (errorCode === 4 || errorCode === 80007) {
      reason = 'Rate Limited';
    }

    logger.error('Failed to send WhatsApp message', { error: err.message, response: err.response?.data });
    return {
      status: 'FAILED',
      reason,
      provider: 'whatsapp',
      error: errorMsg,
    };
  }
}

export const BANNER_THEMES: Record<string, { title: string; color: string }> = {
  interview_invite: { title: 'INTERVIEW INVITATION', color: '#2563eb' }, // Blue
  schedule_invite: { title: 'INTERVIEW SCHEDULE', color: '#16a34a' }, // Green
  assessment_invite: { title: 'ASSESSMENT INVITATION', color: '#7c3aed' }, // Purple
  assessment_result: { title: 'ASSESSMENT RESULT', color: '#7c3aed' }, // Purple
  tentative_offer: { title: 'TENTATIVE OFFER', color: '#d97706' }, // Gold
  offer_sent: { title: 'OFFER LETTER', color: '#d97706' }, // Gold
  offer_accepted: { title: 'OFFER ACCEPTED', color: '#16a34a' }, // Green
  document_request: { title: 'DOCUMENT REQUEST', color: '#ea580c' }, // Orange
  document_reupload: { title: 'DOCUMENT REQUEST', color: '#ea580c' }, // Orange
  documents_verified: { title: 'DOCUMENTS VERIFIED', color: '#16a34a' }, // Green
  onboarding_welcome: { title: 'WELCOME TO THE TEAM', color: '#0891b2' }, // Cyan
};

export function resolveBannerTheme(template: string, variables: Record<string, any>): { title: string; color: string } {
  if (template === 'interview_result') {
    const isPass = variables.passed === true;
    if (isPass) {
      return { title: 'CONGRATULATIONS', color: '#16a34a' }; // Green
    } else {
      return { title: 'APPLICATION UPDATE', color: '#dc2626' }; // Red
    }
  }
  return BANNER_THEMES[template] || { title: 'NOTIFICATION', color: '#2563eb' };
}

import { getTenantContext } from '../config/tenantContext.js';

export async function sendWhatsAppIfEnabled(input: {
  phone: string;
  template: string;
  variables: Record<string, any>;
  preferenceKey: string;
  pdfAttachments?: { filename: string; link: string; caption?: string }[];
  tenantId?: string | null;
}): Promise<WhatsAppDirectResult> {
  const { phone, template, variables, preferenceKey, pdfAttachments, tenantId } = input;

  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  if (!cleanPhone) {
    logger.warn(`WhatsApp skipped for template ${template}: Missing/Invalid Phone Number`);
    return {
      status: 'SKIPPED',
      reason: 'Missing or Invalid Phone Number',
      provider: 'whatsapp',
    };
  }

  // Multi-tenant Isolation: Resolve correct tenantId
  let activeTenantId = tenantId;
  if (!activeTenantId) {
    const ctx = getTenantContext();
    if (ctx && ctx.tenantId) {
      activeTenantId = ctx.tenantId;
    }
  }

  if (!activeTenantId) {
    const candidate = await prisma.candidate.findFirst({
      where: { phone: { contains: cleanPhone }, deletedAt: null },
      select: { tenantId: true }
    });
    if (candidate && candidate.tenantId) {
      activeTenantId = candidate.tenantId;
    }
  }

  const integration = await prisma.integration.findFirst({
    where: { 
      type: 'whatsapp',
      ...(activeTenantId ? { tenantId: activeTenantId } : {})
    }
  });

  if (!integration || !integration.configJson || !integration.isEnabled) {
    logger.warn(`WhatsApp skipped for template ${template}: Integration Disabled`);
    return {
      status: 'SKIPPED',
      reason: 'Integration Disabled',
      provider: 'whatsapp',
    };
  }

  let config: any;
  try {
    const raw = isEncrypted(integration.configJson) ? decrypt(integration.configJson) : integration.configJson;
    config = JSON.parse(raw);
  } catch (err: any) {
    logger.error(`WhatsApp failed for template ${template}: Decryption failed`, { error: err.message });
    return {
      status: 'FAILED',
      reason: 'Decryption failed',
      provider: 'whatsapp',
      error: err.message,
    };
  }

  if (config) {
    const preferences = config.preferences || {};
    if (!preferences[preferenceKey]) {
      logger.warn(`WhatsApp skipped for template ${template}: Preference "${preferenceKey}" Disabled`);
      return {
        status: 'SKIPPED',
        reason: 'Preference Disabled',
        provider: 'whatsapp',
      };
    }

    const { renderNotification } = await import('./notificationTemplateRenderer.js');
    const renderResult = await renderNotification({
      template,
      channel: 'whatsapp',
      variables,
    });

    const headerImageUrl = renderResult.branding.bannerUrl || renderResult.branding.logoUrl || null;

    const { phoneNumberId, accessToken, apiVersion, mode } = config;
    return sendWhatsAppDirect({
      phone: cleanPhone,
      message: renderResult.whatsappBody,
      logoUrl: headerImageUrl,
      mode: mode || 'text',
      templateName: template,
      cta: renderResult.cta,
      whatsappData: renderResult.whatsappData,
      pdfAttachments,
      credentials: {
        phoneNumberId: String(phoneNumberId),
        accessToken: String(accessToken),
        apiVersion: apiVersion ? String(apiVersion) : undefined,
      },
    });
  }

  return {
    status: 'FAILED',
    reason: 'Invalid Config',
    provider: 'whatsapp',
  };
}
