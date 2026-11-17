import { expect, test as testCase } from 'vitest';

import {
  nextUsageResetDate,
  parsePlanTier,
  PLAN_LIMITS,
  startOfUsageMonth,
} from '../lib/services/ai_usage.ts';

testCase('parsePlanTier accepts only canonical persisted values', () => {
  expect(parsePlanTier('free')).toStrictEqual('free');
  expect(parsePlanTier('pro')).toStrictEqual('pro');
  expect(parsePlanTier('enterprise')).toStrictEqual('enterprise');
  expect(() => parsePlanTier('PRO')).toThrowError(Error);
  expect(() => parsePlanTier('unknown')).toThrowError(Error);
  expect(() => parsePlanTier(null)).toThrowError(Error);
});

testCase('usage period helpers return month boundaries in UTC', () => {
  const now = new Date('2026-02-06T15:30:00.000Z');
  expect(startOfUsageMonth(now).toISOString()).toStrictEqual('2026-02-01T00:00:00.000Z');
  expect(nextUsageResetDate(now).toISOString()).toStrictEqual('2026-03-01T00:00:00.000Z');
});

testCase('plan limits include tiered question and mode constraints', () => {
  expect(PLAN_LIMITS.free.maxQuestionsPerGeneration).toStrictEqual(5);
  expect(PLAN_LIMITS.free.allowThorough).toStrictEqual(false);
  expect(PLAN_LIMITS.pro.maxQuestionsPerGeneration).toStrictEqual(20);
  expect(PLAN_LIMITS.pro.allowThorough).toStrictEqual(true);
  expect(PLAN_LIMITS.enterprise.monthlyGenerations).toStrictEqual(null);
});
