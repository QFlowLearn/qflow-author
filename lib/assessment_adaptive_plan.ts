import { isCanonicalUuid } from './uuid.ts';
import { questionBankHref } from './question_bank_link.ts';
import {
  parseQuestionBankPickerQuery,
  QuestionBankInputError,
  type QuestionBankQuestionsQuery,
} from './services/question_bank_query.ts';

/** Author choices; the five-question progression policy is fixed by this feature. */
export type AdaptiveSettings = {
  readonly query: QuestionBankQuestionsQuery;
  readonly versionId: string;
  readonly levelIds: readonly [string, string, string];
  readonly questionCount: number;
};
export type AdaptiveLevel = { readonly id: string; readonly label: string };
/** Placement IDs refer to the canonical pinned assessment membership, never copied question bodies. */
export type AdaptiveBlock = {
  readonly group: number;
  readonly level: number;
  readonly placementIds: readonly string[];
};
export type AdaptiveAssessmentPlan = {
  readonly revision: number;
  readonly buildId: string;
  readonly requestDigest: string;
  readonly partId: string;
  readonly settings: AdaptiveSettings;
  readonly audience: string;
  readonly levels: readonly [AdaptiveLevel, AdaptiveLevel, AdaptiveLevel];
  readonly blocks: readonly AdaptiveBlock[];
};
export type AdaptivePlanCommand =
  | { readonly kind: 'inspect'; readonly settings: AdaptiveSettings }
  | {
    readonly kind: 'build';
    readonly settings: AdaptiveSettings;
    readonly buildId: string;
    readonly expectedRevision: number;
  };
export type AdaptiveCoverage = {
  readonly audience: string;
  readonly levels:
    readonly (AdaptiveLevel & { readonly required: number; readonly available: number })[];
};
export type AdaptivePlanResponse =
  | { readonly kind: 'coverage'; readonly coverage: AdaptiveCoverage }
  | { readonly kind: 'shortfall'; readonly coverage: AdaptiveCoverage }
  | { readonly kind: 'built'; readonly plan: AdaptiveAssessmentPlan };
export type AdaptivePlanFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'not_empty'
  | 'not_draft'
  | 'conflict'
  | 'storage_failed';

/** The easiest level can appear first; the other two become reachable one group later each. */
export function adaptivePoolCounts(questionCount: number): readonly [number, number, number] {
  if (!validLength(questionCount)) throw new Error('Invalid adaptive assessment length.');
  return [questionCount, questionCount - 5, questionCount - 10];
}

/** Parse HTTP settings with the existing bank query codec and reject mixed category versions. */
export function parseAdaptiveSettings(value: unknown): AdaptiveSettings | null {
  if (
    !record(value) || !exact(value, ['selection', 'versionId', 'levelIds', 'questionCount']) ||
    typeof value.selection !== 'string' || value.selection.length > 8000 ||
    !isCanonicalUuid(value.versionId) ||
    !validLength(value.questionCount) || !Array.isArray(value.levelIds) ||
    value.levelIds.length !== 3 ||
    !value.levelIds.every(categoryId) || new Set(value.levelIds).size !== 3
  ) return null;
  let query: QuestionBankQuestionsQuery;
  try {
    query = parseQuestionBankPickerQuery(new URLSearchParams(value.selection));
  } catch (cause: unknown) {
    if (cause instanceof QuestionBankInputError) return null;
    throw cause;
  }
  const filter = query.enrichment;
  if (
    !filter || filter.difficulty !== null ||
    [filter.subject, filter.topic].some((f) =>
      f && (f.kind !== 'value' || f.versionId !== value.versionId || f.freshness === 'outdated')
    )
  ) return null;
  return {
    query: { ...query, page: 1, pageSize: 10 },
    versionId: value.versionId,
    levelIds: [value.levelIds[0], value.levelIds[1], value.levelIds[2]],
    questionCount: value.questionCount,
  };
}

/** Canonical wire/storage representation; query parsing and serialization retain one owner. */
export function adaptiveSettingsDocument(settings: AdaptiveSettings) {
  const href = questionBankHref(settings.query, 1);
  return {
    selection: href.slice(href.indexOf('?') + 1),
    versionId: settings.versionId,
    levelIds: settings.levelIds,
    questionCount: settings.questionCount,
  };
}

export function parseAdaptivePlanCommand(value: unknown): AdaptivePlanCommand | null {
  if (!record(value)) return null;
  const settings = parseAdaptiveSettings(value.settings);
  if (!settings) return null;
  if (value.kind === 'inspect' && exact(value, ['kind', 'settings'])) {
    return { kind: 'inspect', settings };
  }
  if (
    value.kind === 'build' && exact(value, ['kind', 'settings', 'buildId', 'expectedRevision']) &&
    isCanonicalUuid(value.buildId) &&
    typeof value.expectedRevision === 'number' && Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0
  ) {
    return {
      kind: 'build',
      settings,
      buildId: value.buildId,
      expectedRevision: value.expectedRevision,
    };
  }
  return null;
}

/** Serialize the plan once at persistence and HTTP boundaries. */
export function adaptivePlanDocument(plan: AdaptiveAssessmentPlan) {
  return { ...plan, settings: adaptiveSettingsDocument(plan.settings) };
}

/** Validate persisted plans, including the exact reachable blocks and unique placement membership. */
export function parseAdaptivePlan(value: unknown): AdaptiveAssessmentPlan | null {
  if (
    !record(value) ||
    !exact(value, [
      'revision',
      'buildId',
      'requestDigest',
      'partId',
      'settings',
      'audience',
      'levels',
      'blocks',
    ]) ||
    typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !isCanonicalUuid(value.buildId) || !isCanonicalUuid(value.partId) ||
    typeof value.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestDigest) ||
    typeof value.audience !== 'string' || !value.audience.trim() || value.audience.length > 1000 ||
    !Array.isArray(value.levels) || value.levels.length !== 3 || !Array.isArray(value.blocks)
  ) return null;
  const settings = parseAdaptiveSettings(value.settings);
  if (!settings) return null;
  const levels: AdaptiveLevel[] = [];
  for (const [index, level] of value.levels.entries()) {
    if (
      !record(level) || !exact(level, ['id', 'label']) || level.id !== settings.levelIds[index] ||
      !categoryId(level.id) || typeof level.label !== 'string' || !level.label.trim() ||
      level.label.length > 160
    ) return null;
    levels.push({ id: level.id, label: level.label });
  }
  const blocks: AdaptiveBlock[] = [];
  const seen = new Set<string>();
  for (let group = 0; group < settings.questionCount / 5; group++) {
    for (let level = 0; level <= Math.min(group, 2); level++) {
      const block = value.blocks[blocks.length];
      if (
        !record(block) || !exact(block, ['group', 'level', 'placementIds']) ||
        block.group !== group || block.level !== level || !Array.isArray(block.placementIds) ||
        block.placementIds.length !== 5 || !block.placementIds.every(isCanonicalUuid)
      ) return null;
      for (const id of block.placementIds) {
        if (seen.has(id)) return null;
        seen.add(id);
      }
      blocks.push({ group, level, placementIds: block.placementIds });
    }
  }
  if (blocks.length !== value.blocks.length) return null;
  return {
    revision: value.revision,
    buildId: value.buildId,
    requestDigest: value.requestDigest,
    partId: value.partId,
    settings,
    audience: value.audience,
    levels: [levels[0], levels[1], levels[2]],
    blocks,
  };
}

function validLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 15 && value <= 100 &&
    value % 5 === 0;
}
function categoryId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
