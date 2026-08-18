import type { Plan } from '@prisma/client';
import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import type { CreatePlanInput, UpdatePlanInput, PlanAdminDto } from '@agnohire/shared';

/**
 * Platform-superadmin Plan catalogue management. Plan is NOT a tenant-scoped
 * model, so every access is wrapped in runAsPlatform (async callback — a lazy
 * PrismaPromise must be awaited inside the bypass context, never returned raw).
 */

function toDto(plan: Plan & { _count?: { tenants: number } }): PlanAdminDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    priceMonthly: plan.priceMonthly != null ? Number(plan.priceMonthly) : null,
    priceYearly: plan.priceYearly != null ? Number(plan.priceYearly) : null,
    currency: plan.currency,
    isActive: plan.isActive,
    razorpayPlanIdMonthly: plan.razorpayPlanIdMonthly,
    razorpayPlanIdYearly: plan.razorpayPlanIdYearly,
    maxUsers: plan.maxUsers,
    maxInterviewedCandidates: plan.maxInterviewedCandidates,
    maxActiveJobs: plan.maxActiveJobs,
    maxCandidates: plan.maxCandidates,
    maxSchedules: plan.maxSchedules,
    maxOrganizations: plan.maxOrganizations,
    maxWorkspaces: plan.maxWorkspaces,
    storageMb: plan.storageMb,
    pricePerOrganization: plan.pricePerOrganization != null ? Number(plan.pricePerOrganization) : null,
    pricePerWorkspace: plan.pricePerWorkspace != null ? Number(plan.pricePerWorkspace) : null,
    pricePerUser: plan.pricePerUser != null ? Number(plan.pricePerUser) : null,
    pricePerCandidate: plan.pricePerCandidate != null ? Number(plan.pricePerCandidate) : null,
    minOrganizations: plan.minOrganizations,
    minWorkspaces: plan.minWorkspaces,
    minUsers: plan.minUsers,
    minCandidates: plan.minCandidates,
    trialDays: plan.trialDays,
    aiEnabled: plan.aiEnabled,
    proctoringEnabled: plan.proctoringEnabled,
    tenantCount: plan._count?.tenants ?? 0,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export async function listPlans(): Promise<PlanAdminDto[]> {
  return runAsPlatform(async () => {
    const plans = await prisma.plan.findMany({
      include: { _count: { select: { tenants: true } } },
      orderBy: [{ priceMonthly: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map(toDto);
  });
}

export async function createPlan(input: CreatePlanInput): Promise<PlanAdminDto> {
  return runAsPlatform(async () => {
    const existing = await prisma.plan.findUnique({ where: { code: input.code } });
    if (existing) throw new ConflictError(`A plan with code ${input.code} already exists`);
    const plan = await prisma.plan.create({
      data: {
        code: input.code,
        name: input.name,
        priceMonthly: input.priceMonthly ?? null,
        priceYearly: input.priceYearly ?? null,
        currency: input.currency,
        isActive: input.isActive,
        razorpayPlanIdMonthly: input.razorpayPlanIdMonthly ?? null,
        razorpayPlanIdYearly: input.razorpayPlanIdYearly ?? null,
        maxUsers: input.maxUsers ?? null,
        maxInterviewedCandidates: input.maxInterviewedCandidates ?? null,
        maxActiveJobs: input.maxActiveJobs ?? null,
        maxCandidates: input.maxCandidates ?? null,
        maxSchedules: input.maxSchedules ?? null,
        maxOrganizations: input.maxOrganizations ?? null,
        maxWorkspaces: input.maxWorkspaces ?? null,
        storageMb: input.storageMb ?? null,
        pricePerOrganization: input.pricePerOrganization ?? null,
        pricePerWorkspace: input.pricePerWorkspace ?? null,
        pricePerUser: input.pricePerUser ?? null,
        pricePerCandidate: input.pricePerCandidate ?? null,
        minOrganizations: input.minOrganizations ?? null,
        minWorkspaces: input.minWorkspaces ?? null,
        minUsers: input.minUsers ?? null,
        minCandidates: input.minCandidates ?? null,
        aiEnabled: input.aiEnabled,
        proctoringEnabled: input.proctoringEnabled,
      },
      include: { _count: { select: { tenants: true } } },
    });
    return toDto(plan);
  });
}

export async function updatePlan(id: string, input: UpdatePlanInput): Promise<PlanAdminDto> {
  return runAsPlatform(async () => {
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Plan not found');
    const plan = await prisma.plan.update({
      where: { id },
      // Only defined keys are written; `undefined` leaves the column untouched,
      // while an explicit `null` clears a limit (→ unlimited).
      data: {
        name: input.name,
        priceMonthly: input.priceMonthly,
        priceYearly: input.priceYearly,
        currency: input.currency,
        isActive: input.isActive,
        razorpayPlanIdMonthly: input.razorpayPlanIdMonthly,
        razorpayPlanIdYearly: input.razorpayPlanIdYearly,
        maxUsers: input.maxUsers,
        maxInterviewedCandidates: input.maxInterviewedCandidates,
        maxActiveJobs: input.maxActiveJobs,
        maxCandidates: input.maxCandidates,
        maxSchedules: input.maxSchedules,
        maxOrganizations: input.maxOrganizations,
        maxWorkspaces: input.maxWorkspaces,
        storageMb: input.storageMb,
        pricePerOrganization: input.pricePerOrganization,
        pricePerWorkspace: input.pricePerWorkspace,
        pricePerUser: input.pricePerUser,
        pricePerCandidate: input.pricePerCandidate,
        minOrganizations: input.minOrganizations,
        minWorkspaces: input.minWorkspaces,
        minUsers: input.minUsers,
        minCandidates: input.minCandidates,
        aiEnabled: input.aiEnabled,
        proctoringEnabled: input.proctoringEnabled,
      },
      include: { _count: { select: { tenants: true } } },
    });
    return toDto(plan);
  });
}
