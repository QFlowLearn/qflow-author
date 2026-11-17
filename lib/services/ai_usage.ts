import { and, eq, gte, sql } from 'drizzle-orm';

import type { OpenRouterMode } from '../ai/openrouter.ts';
import { db, type QflowDatabase } from '../db.ts';
import { aiUsageTable, users } from '../db/schema.ts';
import type { WorkerContext } from '../tenants.ts';

export type PlanTier = 'free' | 'pro' | 'enterprise';

export type PlanLimits = {
  monthlyGenerations: number | null;
  maxQuestionsPerGeneration: number;
  allowThorough: boolean;
};

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    monthlyGenerations: 10,
    maxQuestionsPerGeneration: 5,
    allowThorough: false,
  },
  pro: {
    monthlyGenerations: 100,
    maxQuestionsPerGeneration: 20,
    allowThorough: true,
  },
  enterprise: {
    monthlyGenerations: null,
    maxQuestionsPerGeneration: 50,
    allowThorough: true,
  },
};

export type AIGenerationAllowance = {
  allowed: boolean;
  reason: 'ok' | 'limit_exceeded' | 'upgrade_required' | 'question_limit';
  plan: PlanTier;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetDate: string;
  maxQuestionsPerGeneration: number;
  allowThorough: boolean;
};

export function parsePlanTier(raw: unknown): PlanTier {
  if (raw === 'free' || raw === 'pro' || raw === 'enterprise') return raw;
  throw new Error(`Invalid user plan tier: ${String(raw)}`);
}

export function startOfUsageMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function nextUsageResetDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export async function checkAIGenerationAllowance(
  ctx: WorkerContext,
  input: { mode: OpenRouterMode; requestedQuestions: number },
  database: QflowDatabase = db,
): Promise<AIGenerationAllowance> {
  const plan = await getUserPlanTier(database, ctx.userId);
  const limits = PLAN_LIMITS[plan];
  const monthStart = startOfUsageMonth();
  const resetDate = nextUsageResetDate().toISOString();
  const used = await getMonthlyGenerationCount(database, ctx, monthStart);

  if (input.mode === 'thorough' && !limits.allowThorough) {
    return {
      allowed: false,
      reason: 'upgrade_required',
      plan,
      limit: limits.monthlyGenerations,
      used,
      remaining: remainingCount(limits.monthlyGenerations, used),
      resetDate,
      maxQuestionsPerGeneration: limits.maxQuestionsPerGeneration,
      allowThorough: limits.allowThorough,
    };
  }

  if (input.requestedQuestions > limits.maxQuestionsPerGeneration) {
    return {
      allowed: false,
      reason: 'question_limit',
      plan,
      limit: limits.monthlyGenerations,
      used,
      remaining: remainingCount(limits.monthlyGenerations, used),
      resetDate,
      maxQuestionsPerGeneration: limits.maxQuestionsPerGeneration,
      allowThorough: limits.allowThorough,
    };
  }

  const remaining = remainingCount(limits.monthlyGenerations, used);
  if (remaining !== null && remaining <= 0) {
    return {
      allowed: false,
      reason: 'limit_exceeded',
      plan,
      limit: limits.monthlyGenerations,
      used,
      remaining: 0,
      resetDate,
      maxQuestionsPerGeneration: limits.maxQuestionsPerGeneration,
      allowThorough: limits.allowThorough,
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    plan,
    limit: limits.monthlyGenerations,
    used,
    remaining,
    resetDate,
    maxQuestionsPerGeneration: limits.maxQuestionsPerGeneration,
    allowThorough: limits.allowThorough,
  };
}

async function getUserPlanTier(database: QflowDatabase, userId: string): Promise<PlanTier> {
  const rows = await database.select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows.length) throw new Error('AI generation user was not found.');
  return parsePlanTier(rows[0].plan);
}

async function getMonthlyGenerationCount(
  database: QflowDatabase,
  ctx: WorkerContext,
  monthStart: Date,
): Promise<number> {
  const rows = await database.select({
    used: sql<number>`COUNT(*)`,
  })
    .from(aiUsageTable)
    .where(and(
      eq(aiUsageTable.tenantId, ctx.tenantId),
      eq(aiUsageTable.userId, ctx.userId),
      gte(aiUsageTable.createdAt, monthStart),
    ));
  return Number(rows[0]?.used ?? 0);
}

function remainingCount(limit: number | null, used: number): number | null {
  if (limit === null) return null;
  return Math.max(0, limit - used);
}
