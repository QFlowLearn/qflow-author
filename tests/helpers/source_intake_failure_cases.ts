import type { InterfaceLocale } from '../../lib/i18n/locale.ts';

export const SOURCE_INTAKE_FAILURE_CODES = [
  'invalid_idempotency_key',
  'payload_too_large',
  'unsupported_media_type',
  'invalid_request',
  'missing_source',
  'too_many_files',
  'invalid_purpose',
  'invalid_adapter',
  'invalid_file',
  'invalid_selection',
  'conflict',
  'method_not_allowed',
  'configuration_unavailable',
  'unexpected',
  'source_too_large',
  'text_too_long',
] as const;
export const SOURCE_INTAKE_LIMIT_CODES = [
  'payload_too_large',
  'too_many_files',
  'source_too_large',
  'text_too_long',
] as const;
export const SOURCE_SELECTION_ERROR_CODES = [
  'missing_source',
  'missing_selection',
  'selection_mismatch',
  'unsupported_source',
  'invalid_confidence',
] as const;
export const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
export const codes = [
  ...new Set([...SOURCE_INTAKE_FAILURE_CODES, ...SOURCE_SELECTION_ERROR_CODES]),
] as const;
export type Code = typeof codes[number];
export type Scenario =
  | Code
  | 'malformed'
  | 'invalid-json'
  | `execute-${Code}`
  | 'inspect-message'
  | 'inspect-extra'
  | 'inspect-unknown'
  | 'inspect-missing-limit'
  | 'inspect-wrong-limit'
  | 'inspect-limit-zero'
  | 'inspect-params-extra'
  | 'inspect-wrong-purpose'
  | 'inspect-wrong-count'
  | 'inspect-poisoned-200'
  | 'inspect-unknown-adapter-200'
  | 'inspect-network'
  | 'inspect-retry'
  | 'inspect-invalid-json-500'
  | 'inspect-invalid-json-200'
  | 'execute-malformed'
  | 'execute-message'
  | 'execute-extra'
  | 'execute-unknown'
  | 'execute-missing-limit'
  | 'execute-wrong-limit'
  | 'execute-limit-zero'
  | 'execute-params-extra'
  | 'execute-invalid-json-500'
  | 'execute-invalid-json-200'
  | 'execute-extra-success-200'
  | 'execute-wrong-purpose-200'
  | 'execute-network'
  | 'execute-retry';
export const hostile = 'HOSTILE_UPSTREAM_PROSE';
export type Capture = {
  locale: InterfaceLocale;
  scenario: Scenario;
  kind: 'inspect' | 'execute';
  purpose: string;
  files: Array<{ name: string; type: string; size: number; text: string }>;
  adapters: Array<{ field: string; value: string }>;
  key: string | null;
  text: string | null;
};
export const bodyFor = (scenario: Scenario): Record<string, unknown> => {
  if (scenario === 'malformed') return { code: 'source_too_large', message: hostile };
  if (scenario === 'invalid-json') return {};
  const code = scenario.startsWith('execute-') ? scenario.slice(8) as Code : scenario;
  if (SOURCE_INTAKE_LIMIT_CODES.includes(code as typeof SOURCE_INTAKE_LIMIT_CODES[number])) {
    return { code, params: { limit: 1234 } };
  }
  return { code };
};
export const malformedBody = (scenario: Scenario, kind: 'inspect' | 'execute'): unknown => {
  if (scenario === 'execute-malformed') return { code: 42 };
  if (scenario.endsWith('-limit-zero')) return { code: 'source_too_large', params: { limit: 0 } };
  if (scenario.endsWith('-params-extra')) {
    return { code: 'source_too_large', params: { limit: 1234, extra: hostile } };
  }
  if (scenario.endsWith('-message')) return { message: hostile };
  if (scenario.endsWith('-extra')) {
    return { code: 'source_too_large', params: { limit: 1234 }, message: hostile };
  }
  if (scenario.endsWith('-unknown')) return { code: 'HOSTILE_UNKNOWN_CODE' };
  if (scenario.endsWith('-missing-limit')) return { code: 'source_too_large' };
  if (scenario.endsWith('-wrong-limit')) {
    return { code: 'source_too_large', params: { limit: 'not-a-number' } };
  }
  if (
    scenario.endsWith('-invalid-json') || scenario.endsWith('-invalid-json-500') ||
    scenario.endsWith('-invalid-json-200')
  ) return '{';
  if (scenario === 'inspect-wrong-purpose') {
    return {
      purpose: 'generate_new',
      inspections: [{
        _tag: 'resolved',
        sourceName: 'matrix Ω.pdf',
        candidate: {
          adapter: { id: 'pdf', version: '1' },
          label: 'PDF document',
          confidence: 1,
          reason: 'file_type',
        },
      }],
    };
  }
  if (scenario === 'inspect-unknown-adapter-200') {
    return {
      purpose: 'recover_existing',
      inspections: [{
        _tag: 'resolved',
        sourceName: 'matrix Ω.pdf',
        candidate: {
          adapter: { id: 'future_adapter', version: '1' },
          label: 'Legacy source format',
          confidence: 1,
          reason: 'file_type',
        },
      }],
    };
  }
  if (scenario === 'execute-wrong-purpose-200') {
    return {
      purpose: 'generate_new',
      batchId: '00000000-0000-4000-8000-0000000000a1',
      runIds: ['00000000-0000-4000-8000-0000000000a2'],
      statusUrl: '/imports/batches/00000000-0000-4000-8000-0000000000a1',
      redirectTo: '/imports/00000000-0000-4000-8000-0000000000a2',
    };
  }
  if (scenario.endsWith('-wrong-count')) return { purpose: 'recover_existing', inspections: [] };
  if (scenario.endsWith('-poisoned') || scenario === 'inspect-poisoned-200') {
    return kind === 'inspect'
      ? {
        purpose: 'recover_existing',
        inspections: [{
          _tag: 'resolved',
          sourceName: 'matrix Ω.pdf',
          message: hostile,
          candidate: {
            adapter: { id: 'pdf', version: '1' },
            label: 'PDF document',
            confidence: 1,
            reason: 'file_type',
          },
        }],
      }
      : {
        purpose: 'recover_existing',
        batchId: '00000000-0000-4000-8000-0000000000a1',
        runIds: ['00000000-0000-4000-8000-0000000000a2'],
        statusUrl: '/imports/batches/x',
        redirectTo: '/imports/x',
        error: hostile,
      };
  }
  if (scenario === 'execute-extra-success-200') {
    return {
      purpose: 'recover_existing',
      batchId: '00000000-0000-4000-8000-0000000000a1',
      runIds: ['00000000-0000-4000-8000-0000000000a2'],
      statusUrl: '/imports/batches/00000000-0000-4000-8000-0000000000a1',
      redirectTo: '/imports/00000000-0000-4000-8000-0000000000a2',
      message: hostile,
    };
  }
  return { code: 'unknown' };
};
