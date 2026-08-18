import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { configService } from './configService.js';
import {
  CONFIG_KEYS,
  type CreateEmailTemplateInput,
  type UpdateEmailTemplateInput,
  type EmailTemplateItem,
} from '@agnohire/shared';
import { SYSTEM_TEMPLATES } from './emailTemplateMetadata.js';

const SELECT = {
  id: true, name: true, type: true, subject: true, body: true,
  sectorId: true, isDefault: true, createdAt: true, updatedAt: true,
} satisfies Prisma.EmailTemplateSelect;

function toItem(t: {
  id: string; name: string; type: string; subject: string; body: string;
  sectorId: string | null; isDefault: boolean; createdAt: Date; updatedAt: Date;
}): EmailTemplateItem {
  return {
    id: t.id, name: t.name, type: t.type, subject: t.subject, body: t.body,
    sectorId: t.sectorId, isDefault: t.isDefault,
    createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listEmailTemplates(): Promise<EmailTemplateItem[]> {
  const rows = await prisma.emailTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    select: SELECT
  });

  // Group custom templates by type
  const customGrouped = new Map<string, EmailTemplateItem[]>();
  for (const row of rows) {
    const item = toItem(row);
    if (!customGrouped.has(item.type)) {
      customGrouped.set(item.type, []);
    }
    customGrouped.get(item.type)!.push(item);
  }

  const merged: EmailTemplateItem[] = [];

  // 1. Add all system default templates (or their custom overrides in-place)
  for (const sys of SYSTEM_TEMPLATES) {
    const customs = customGrouped.get(sys.type) || [];

    let activeCustomIndex = customs.findIndex(c => c.id === `override-${sys.type}`);
    if (activeCustomIndex === -1) {
      activeCustomIndex = customs.findIndex(c => c.name === sys.name);
    }

    if (activeCustomIndex !== -1) {
      const activeCustom = customs[activeCustomIndex];
      merged.push({
        id: activeCustom.id,
        name: activeCustom.name,
        type: activeCustom.type,
        subject: activeCustom.subject,
        body: activeCustom.body,
        sectorId: activeCustom.sectorId,
        isDefault: activeCustom.isDefault,
        isSystemOverride: true,
        createdAt: activeCustom.createdAt,
        updatedAt: activeCustom.updatedAt,
      });

      // Remove it from customs list so it is not listed again as a separate card
      customs.splice(activeCustomIndex, 1);
    } else {
      // No custom overrides at all, return virtual system default card
      merged.push({
        id: `sys-${sys.type}`,
        name: sys.name,
        type: sys.type,
        subject: sys.defaultSubject,
        body: sys.defaultBody,
        sectorId: null,
        isDefault: true,
        isSystemOverride: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
  }

  // 2. Add all remaining inactive custom templates (separate cards)
  for (const customs of customGrouped.values()) {
    for (const custom of customs) {
      merged.push({
        ...custom,
        isSystemOverride: false,
      });
    }
  }

  return merged;
}

/** Only one template per type can be the default — clear the others when setting it. */
async function clearOtherDefaults(type: string, exceptId?: string) {
  await prisma.emailTemplate.updateMany({
    where: { type, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createEmailTemplate(data: CreateEmailTemplateInput, req: Request): Promise<EmailTemplateItem> {
  if (data.isDefault) await clearOtherDefaults(data.type);
  const t = await prisma.emailTemplate.create({
    data: {
      name: data.name, type: data.type, subject: data.subject, body: data.body,
      sectorId: data.sectorId ?? null, isDefault: data.isDefault ?? false,
    },
    select: SELECT,
  });
  await recordAudit(req, { action: 'CREATE', entity: 'EmailTemplate', entityId: t.id, description: `Created email template ${data.name}` });
  return toItem(t);
}

export async function updateEmailTemplate(id: string, data: UpdateEmailTemplateInput, req: Request): Promise<EmailTemplateItem> {
  // If the id is a virtual system ID, transparently create/update a custom override row in the database
  if (id.startsWith('sys-')) {
    const type = id.replace('sys-', '');
    const sys = SYSTEM_TEMPLATES.find(t => t.type === type);
    if (!sys) throw new NotFoundError('System template not found');

    const overrideId = `override-${type}`;
    const existingOverride = await prisma.emailTemplate.findUnique({ where: { id: overrideId } });
    if (existingOverride) {
      const t = await prisma.emailTemplate.update({
        where: { id: overrideId },
        data: {
          name: data.name || undefined,
          subject: data.subject || undefined,
          body: data.body || undefined,
          isDefault: data.isDefault !== undefined ? data.isDefault : undefined,
        },
        select: SELECT,
      });
      await recordAudit(req, { action: 'UPDATE', entity: 'EmailTemplate', entityId: t.id, description: `Updated custom override for email template ${t.name}` });
      return toItem(t);
    }

    const t = await prisma.emailTemplate.create({
      data: {
        id: overrideId,
        name: data.name || sys.name,
        type,
        subject: data.subject || sys.defaultSubject,
        body: data.body || sys.defaultBody,
        isDefault: false,
      },
      select: SELECT,
    });
    await recordAudit(req, { action: 'CREATE', entity: 'EmailTemplate', entityId: t.id, description: `Created custom override for email template ${t.name}` });
    return toItem(t);
  }

  const existing = await prisma.emailTemplate.findUnique({ where: { id }, select: { id: true, type: true } });
  if (!existing) throw new NotFoundError('Email template not found');
  if (data.isDefault) await clearOtherDefaults(existing.type, id);
  const t = await prisma.emailTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.subject !== undefined && { subject: data.subject }),
      ...(data.body !== undefined && { body: data.body }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    },
    select: SELECT,
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'EmailTemplate', entityId: id, description: `Updated email template ${t.name}` });
  return toItem(t);
}

export async function deleteEmailTemplate(id: string, req: Request): Promise<void> {
  if (id.startsWith('sys-')) {
    throw new BadRequestError('System default templates cannot be deleted');
  }
  const existing = await prisma.emailTemplate.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw new NotFoundError('Email template not found');
  // Hard delete, not the usual soft-delete-via-middleware: override rows use a
  // fixed `override-${type}` id (see updateEmailTemplate), and a soft-deleted
  // row would keep occupying that id — permanently blocking anyone from
  // customizing that template type again after a reset.
  await prisma.$executeRaw`DELETE FROM "EmailTemplate" WHERE id = ${id}`;
  await recordAudit(req, { action: 'DELETE', entity: 'EmailTemplate', entityId: id, description: `Deleted custom override for email template ${existing.name}` });
}
export async function applyLogoToAll(
  data: { useCustomLogo: boolean; customLogoId: string; logoWidth: number },
  req: Request
): Promise<void> {
  const { useCustomLogo, customLogoId, logoWidth } = data;

  await configService.set(CONFIG_KEYS.EMAIL_BRAND_LOGO_WIDTH, String(logoWidth));
  if (useCustomLogo && customLogoId) {
    await configService.set(CONFIG_KEYS.EMAIL_BRAND_LOGO, customLogoId);
  }

  const customTemplates = await prisma.emailTemplate.findMany({
    where: { deletedAt: null },
  });

  for (const t of customTemplates) {
    if (t.body && t.body.trim().startsWith('{') && t.body.trim().endsWith('}')) {
      try {
        const json = JSON.parse(t.body);
        json.useCustomLogo = useCustomLogo;
        json.customLogoId = customLogoId;
        json.logoWidth = logoWidth;
        await prisma.emailTemplate.update({
          where: { id: t.id },
          data: { body: JSON.stringify(json) },
        });
      } catch (e) {}
    }
  }

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'EmailTemplate',
    entityId: 'all',
    description: 'Applied logo settings to all templates and system configurations',
  });
}
