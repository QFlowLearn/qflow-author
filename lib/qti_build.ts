import { parseAnswerFeedback } from './answer_feedback.ts';
import { CatalogMetadataValidationError, injectItemMetadataIntoXml } from './catalog_metadata.ts';
import type { Draft } from './types/draft.ts';
import { normalizeDraftForDriver, resolveDriver } from './types/draft_utils.ts';
import { exportQti3AssessmentItemXml, QflowQti3WriterExportError } from './types/qti3_authoring.ts';
import type { NormalizedTypeDriver, QuestionTypeId } from './types/registry.ts';

export type QtiBuildIssue = {
  field: 'general';
  message: string;
};

export type PreparedDriverDraft = {
  typeId: QuestionTypeId;
  driver: NormalizedTypeDriver;
  draft: Draft;
  title: string;
};

export type PrepareDriverDraftResult =
  | { ok: true; prepared: PreparedDriverDraft }
  | {
    ok: false;
    reason: 'driver_error' | 'invalid_draft';
    issues: QtiBuildIssue[];
    typeId?: QuestionTypeId;
    title?: string;
  };

export function prepareDriverDraft(rawDraft: Draft): PrepareDriverDraftResult {
  let driverInfo;
  try {
    driverInfo = resolveDriver(rawDraft);
  } catch (err) {
    return {
      ok: false,
      reason: 'driver_error',
      issues: [{
        field: 'general',
        message: err instanceof Error ? err.message : 'Question type could not be resolved.',
      }],
    };
  }

  const { typeId, driver } = driverInfo;
  let draft = normalizeDraftForDriver(typeId, { ...rawDraft, type: typeId }) as Draft;
  const title = draft.title ?? 'Untitled';
  if (draft.answerFeedback !== undefined) {
    const feedback = parseAnswerFeedback(draft.answerFeedback);
    if (!feedback.ok || !['single_select', 'multi_select', 'inline_choice'].includes(typeId)) {
      return {
        ok: false,
        reason: 'invalid_draft',
        issues: [{
          field: 'general',
          message: 'Answer feedback is invalid or unsupported for this question type.',
        }],
        typeId,
        title,
      };
    }
    draft = { ...draft, answerFeedback: feedback.value };
  }
  const validation = driver.validate(draft);
  if (validation.length > 0) {
    return {
      ok: false,
      reason: 'invalid_draft',
      typeId,
      title,
      issues: validation.map((message) => ({ field: 'general', message })),
    };
  }

  return { ok: true, prepared: { typeId, driver, draft, title } };
}

export type BuildItemXmlOptions = {
  identifier: string;
  scoring?: 'map_response' | 'match_correct';
};

export type BuildItemXmlResult =
  | { ok: true; xml: string; typeId: QuestionTypeId; title: string }
  | { ok: false; issues: QtiBuildIssue[]; typeId: QuestionTypeId; title: string };

export function buildItemXmlFromPreparedDraft(
  prepared: PreparedDriverDraft,
  options: BuildItemXmlOptions,
): BuildItemXmlResult {
  const { typeId, draft, title } = prepared;
  const scoring = options.scoring ??
    (draft.responseMode === 'partial' ? 'map_response' as const : 'match_correct');
  try {
    const xml = exportQti3AssessmentItemXml(typeId, draft, {
      identifier: options.identifier,
      scoring,
      required: typeof draft.required === 'boolean' ? draft.required : undefined,
      minChoices: typeof draft.minChoices === 'number' ? draft.minChoices : undefined,
      maxChoices: typeof draft.maxChoices === 'number' ? draft.maxChoices : undefined,
      answerMasking: Boolean(draft.answerMasking),
    });
    return {
      ok: true,
      typeId,
      title,
      xml: injectItemMetadataIntoXml(xml, draft.catalogs, draft.stylesheets),
    };
  } catch (err) {
    if (err instanceof CatalogMetadataValidationError) {
      return {
        ok: false,
        typeId,
        title,
        issues: err.issues.map((issue) => ({
          field: 'general',
          message: `${issue.path}: ${issue.message}`,
        })),
      };
    }
    if (err instanceof QflowQti3WriterExportError) {
      return {
        ok: false,
        typeId,
        title,
        issues: err.diagnostics.map((diagnostic) => ({
          field: 'general',
          message: `${diagnostic.path}: ${diagnostic.message}`,
        })),
      };
    }
    return {
      ok: false,
      typeId,
      title,
      issues: [{
        field: 'general',
        message: 'The question XML could not be prepared. Review its settings.',
      }],
    };
  }
}
