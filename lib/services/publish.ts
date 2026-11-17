import { parseQtiXml } from '@longsightgroup/qti3-core';
import { readAuthoredAnswerFeedback } from '../answer_feedback_qti.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { validateQtiXml } from '../qti_validate.ts';
import { recognizeEditableChoiceSource } from '../import/adapters/qti3/parse_item.ts';
import {
  buildItemXmlFromPreparedDraft,
  type PreparedDriverDraft,
  prepareDriverDraft,
} from '../qti_build.ts';
import type { Draft } from '../types/draft.ts';
import { stripRailOnlyDraftFields } from '../types/draft_utils.ts';
import type { RequestContext } from '../tenants.ts';
import type { QuestionProvenanceCommand } from '../question_provenance.ts';
import { toFieldIssues } from '../validation_fields.ts';
import {
  getQuestionPublicationBaseline,
  type PreparedSaveQuestionRevisionInput,
  type QuestionPublicationBaseline,
} from './questions.ts';
import { prepareQuestionRevision } from '../question_revision_preparation.ts';
import { copyQuestionSourceXml } from '../question_variants.ts';

type PrepareQuestionPublicationDeps = {
  getQuestionPublicationBaseline: typeof getQuestionPublicationBaseline;
  validateQtiXml: typeof validateQtiXml;
  prepareDriverDraft?: typeof prepareDriverDraft;
};

type PublicationPreparationDeps = Pick<
  PrepareQuestionPublicationDeps,
  'validateQtiXml' | 'prepareDriverDraft'
>;

export type PublishQuestionErrorBody = {
  error: string;
  message: string;
  issues: Array<{ field: string; message: string }>;
};

export type PublishQuestionResult =
  | {
    ok: true;
    status: 201;
    body: { itemId: string; rev: number; identifier: string };
  }
  | {
    ok: false;
    status: 400 | 404 | 409 | 422;
    body: PublishQuestionErrorBody;
  };

export type PublishFailureStatus = Extract<PublishQuestionResult, { ok: false }>['status'];

/** A validated question revision ready for one persistence transaction. */
export type PreparedQuestionPublication = {
  readonly itemId: string;
  readonly revision: number;
  readonly identifier: string;
  readonly saveInput: PreparedSaveQuestionRevisionInput;
};

/** Result of validating and serializing a question without persisting it. */
export type PrepareQuestionPublicationResult =
  | { readonly ok: true; readonly prepared: PreparedQuestionPublication }
  | { readonly ok: false; readonly error: Extract<PublishQuestionResult, { ok: false }> };

/** Caller-resolved identity and revision facts used by publication preparation. */
export type ResolvedQuestionPublicationSource =
  | { readonly _tag: 'New'; readonly itemId: string }
  | { readonly _tag: 'Copy'; readonly itemId: string; readonly qtiXml: string }
  | { readonly _tag: 'Revision'; readonly baseline: QuestionPublicationBaseline };

export function publishHttpResponse(result: PublishQuestionResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
}

const defaultDeps: PrepareQuestionPublicationDeps = {
  getQuestionPublicationBaseline,
  validateQtiXml,
};

const defaultPreparationDeps: PublicationPreparationDeps = { validateQtiXml };

/** Validates and serializes a question draft for transactional persistence. */
export async function prepareQuestionPublication(
  auth: RequestContext,
  body: Draft,
  deps: PrepareQuestionPublicationDeps = defaultDeps,
): Promise<PrepareQuestionPublicationResult> {
  const itemId = body.itemId ?? crypto.randomUUID();
  const baseline = await deps.getQuestionPublicationBaseline(auth, itemId);
  const source: ResolvedQuestionPublicationSource = baseline
    ? { _tag: 'Revision', baseline }
    : { _tag: 'New', itemId };
  return await prepareQuestionPublicationFromSource(body, source, deps);
}

/** Prepares a publication from a caller-resolved new identity or current revision. */
export async function prepareQuestionPublicationFromSource(
  body: Draft,
  source: ResolvedQuestionPublicationSource,
  deps: PublicationPreparationDeps = defaultPreparationDeps,
): Promise<PrepareQuestionPublicationResult> {
  const baseline = source._tag === 'Revision' ? source.baseline : null;
  const itemId = source._tag === 'Revision' ? source.baseline.questionId : source.itemId;
  const latestRev = baseline?.revision.number ?? 0;
  const nextRev = latestRev + 1;
  const xmlIdentifier = questionPublicationIdentifier(itemId, nextRev);

  const prepared = (deps.prepareDriverDraft ?? prepareDriverDraft)(body);
  if (!prepared.ok) {
    return {
      ok: false,
      error: publishError(
        prepared.reason === 'driver_error' ? 400 : 422,
        prepared.reason,
        prepared.reason === 'driver_error'
          ? prepared.issues[0]?.message ?? 'Unknown question type.'
          : 'Draft failed validation.',
        prepared.issues,
      ),
    };
  }

  if (
    body.maximumScore !== undefined && body.preserveSourceXml === true && !baseline &&
    source._tag !== 'Copy'
  ) {
    const message = 'Cannot preserve source XML: no source revision exists.';
    return {
      ok: false,
      error: publishError(422, 'missing_source_xml', message, [{ field: 'maximumScore', message }]),
    };
  }

  if (
    baseline &&
    (body.preserveSourceXml === true
      ? body.maximumScore !== undefined
      : baseline.revision.event.contentBasis === 'source' &&
        prepared.prepared.driver.capabilities?.points)
  ) {
    const sourcePoints = recognizeEditableChoiceSource(baseline.revision.qtiXml);
    if (sourcePoints._tag === 'SourceOnly') {
      const message =
        'Points cannot be edited safely for this source scoring program. Retain the original and review its scoring.';
      return {
        ok: false,
        error: publishError(422, 'source_points_not_editable', message, [{
          field: 'maximumScore',
          message,
        }]),
      };
    }
    if (
      body.preserveSourceXml !== true && body.maximumScore === undefined &&
      sourcePoints.maximumScore !== undefined
    ) {
      const message =
        'This source specifies points. Enter an explicit point value before editing so its scoring is not replaced by an unset default.';
      return {
        ok: false,
        error: publishError(422, 'source_points_not_preserved', message, [{
          field: 'maximumScore',
          message,
        }]),
      };
    }
    if (body.preserveSourceXml === true && body.maximumScore !== sourcePoints.maximumScore) {
      const message =
        'Changing points requires generated scoring; preserved source XML keeps its original points.';
      return {
        ok: false,
        error: publishError(422, 'preserved_points_mismatch', message, [{
          field: 'maximumScore',
          message,
        }]),
      };
    }
  }

  const { typeId, driver, draft: driverDraft } = prepared.prepared;
  const scoringOpt = body.responseMode === 'partial' ? 'map_response' as const : 'match_correct';
  const xmlResult = resolvePublishXml(
    body,
    source,
    prepared.prepared,
    {
      identifier: xmlIdentifier,
      scoring: scoringOpt,
    },
  );
  if (!xmlResult.ok) return { ok: false, error: xmlResult.error };
  const { xml, preservedSourceXml } = xmlResult;

  const validation = await deps.validateQtiXml(xml);
  if (!validation.ok) {
    return {
      ok: false,
      error: publishError(
        422,
        'validation_failed',
        'Item failed our internal validation. Please double-check the question content.',
        toFieldIssues(validation.errors),
      ),
    };
  }

  const tags = Array.isArray(body.tags) ? body.tags : [...(baseline?.tags ?? [])];
  const requiredFlag = typeof driverDraft.required === 'boolean' ? driverDraft.required : undefined;
  const answerMasking = Boolean(driverDraft.answerMasking);
  const serializedDraft = driver.serialize(stripRailOnlyDraftFields(driverDraft));
  const draftPayload = {
    ...serializedDraft,
    type: typeId,
    title: driverDraft.title ?? baseline?.title ?? 'Untitled',
    responseMode: driverDraft.responseMode ?? serializedDraft.responseMode ?? 'all_or_nothing',
    tags,
    required: requiredFlag,
    answerMasking,
    ...(body.note === undefined ? {} : { note: body.note }),
  } as Record<string, unknown>;
  const provenance: QuestionProvenanceCommand = baseline
    ? {
      _tag: 'Revision',
      operation: baseline.revision.event.contentBasis === 'source' && !preservedSourceXml
        ? 'transformed'
        : 'revised',
      expectedParentRevision: baseline.revision.number,
    }
    : { _tag: 'Authored' };

  const saveInput = await prepareQuestionRevision({
    questionId: itemId,
    title: draftPayload.title as string,
    tags,
    body: draftPayload,
    reviewSuggestions: [],
    metadata: {
      identifier: xmlIdentifier,
      type: typeId,
      responseMode: draftPayload.responseMode,
      preservedSourceXml,
    },
    provenance,
    qtiXml: xml,
    note: body.note ?? null,
    draftState: 'published' as const,
  });

  return {
    ok: true,
    prepared: {
      itemId,
      revision: nextRev,
      identifier: xmlIdentifier,
      saveInput,
    },
  };
}

export function publishFailure(
  status: PublishFailureStatus,
  error: string,
  message: string,
  issues: Array<{ field: string; message: string }>,
): Extract<PublishQuestionResult, { ok: false }> {
  return { ok: false, status, body: { error, message, issues } };
}

export function staleSourceRevisionFailure(): Extract<PublishQuestionResult, { ok: false }> {
  return publishFailure(
    409,
    'stale_source_revision',
    'This item changed while you were editing it.',
    [{
      field: 'itemId',
      message: 'Return to the item and open a new working draft.',
    }],
  );
}

export function archivedQuestionFailure(): Extract<PublishQuestionResult, { ok: false }> {
  return publishFailure(
    409,
    'item_archived',
    'Restore this item before publishing another revision.',
    [{
      field: 'itemId',
      message: 'Restore the item, then publish the revision again.',
    }],
  );
}

function publishError(
  status: 400 | 409 | 422,
  error: string,
  message: string,
  issues: Array<{ field: string; message: string }>,
): Extract<PublishQuestionResult, { ok: false }> {
  return publishFailure(status, error, message, issues);
}

function resolvePublishXml(
  body: Draft,
  source: ResolvedQuestionPublicationSource,
  prepared: PreparedDriverDraft,
  buildOptions: Parameters<typeof buildItemXmlFromPreparedDraft>[1],
):
  | { ok: true; xml: string; preservedSourceXml: boolean }
  | { ok: false; error: Extract<PublishQuestionResult, { ok: false }> } {
  if (source._tag === 'Copy') {
    const copied = copyQuestionSourceXml(source.qtiXml, buildOptions.identifier);
    if (copied.ok) return { ok: true, xml: copied.xml, preservedSourceXml: true };
    return {
      ok: false,
      error: publishError(
        422,
        'invalid_source_xml',
        'The saved source XML cannot be copied safely.',
        [{
          field: 'general',
          message: 'Retain the original question and review its saved QTI XML before copying.',
        }],
      ),
    };
  }
  const latestRevision = source._tag === 'Revision' ? source.baseline.revision : null;
  if (body.preserveSourceXml === true && latestRevision) {
    const sourceItem = parseQtiXml(latestRevision.qtiXml).document?.item;
    const sourceFeedback = sourceItem ? readAuthoredAnswerFeedback(sourceItem) : undefined;
    if (
      canonicalJsonStringify(body.answerFeedback ?? null) !==
      canonicalJsonStringify(sourceFeedback ?? null)
    ) {
      return {
        ok: false,
        error: publishError(
          422,
          'preserved_feedback_mismatch',
          'Editing feedback requires generated processing; preserved source XML keeps its original explanations.',
          [{
            field: 'general',
            message: 'Keep the original feedback while source XML is preserved.',
          }],
        ),
      };
    }

    if (latestRevision.qtiXml) {
      return { ok: true, xml: latestRevision.qtiXml, preservedSourceXml: true };
    }
    return {
      ok: false,
      error: publishError(
        422,
        'missing_source_xml',
        'Cannot preserve source XML: latest revision has no QTI XML.',
        [{ field: 'preserveSourceXml', message: 'Latest revision has no stored QTI XML.' }],
      ),
    };
  }

  const built = buildItemXmlFromPreparedDraft(prepared, buildOptions);
  if (!built.ok) {
    return {
      ok: false,
      error: publishError(
        422,
        'invalid_draft',
        built.issues[0]?.message ?? 'Failed to build QTI XML from draft.',
        built.issues,
      ),
    };
  }
  return { ok: true, xml: built.xml, preservedSourceXml: false };
}

/** Stable QTI identifier for one immutable question revision. */
export function questionPublicationIdentifier(itemId: string, revision: number): string {
  return `item-${itemId}-r${revision}`;
}
