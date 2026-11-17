import AssessmentBuilderView from '../../../../islands/AssessmentBuilder.tsx';
import { mountIsland } from '../../../rendering/mount_island.ts';
import { assessmentQuestionPlacements } from '../../../assessment_content.ts';
import { readAssessmentQuestionPointDefault } from '../../../services/assessment_question_defaults.ts';
import { authoringPreferencesService } from '../../../services/authoring_preferences.ts';
import { readInstructorDefaults } from '../../../services/instructor_defaults.ts';
import { getPlacementQuestionViews } from '../../../services/questions.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { readDeliverySummary } from '../../../delivery_metadata.ts';
import {
  type DeliveryPublishCapability,
  getDeliveryPublishCapability,
} from '../../../delivery_publish.ts';
import type { AssessmentBuilderProps } from '../../../../islands/AssessmentBuilder.tsx';
import type { AssessmentView, ItemMeta } from '../../../../islands/assessment_builder/types.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { collectQuestionReviewSuggestions } from '../../../question_review.ts';
import type { Draft } from '../../../types/draft.ts';
import type { QuestionTypeId } from '../../../types/registry.ts';
import {
  ASSESSMENT_TOOL_IDS,
  parseAssessmentToolQuery,
} from '../../../assessment_authoring_tool.ts';
import { getUserSettings } from '../../../services/user_settings.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { assessmentPlacementRemovalService } from '../../../services/assessment_placement_removal.ts';
import { parseAssessmentPartOptions } from '../../../assessment_arrangement.ts';

export const assessmentBuilderRoute = defineHttpRoute('/assessments/:id', { GET: get, HEAD: get });

async function get(ctx: HttpRequest) {
  const parsedTool = parseAssessmentToolQuery(ctx.url.searchParams);
  if (!parsedTool.ok) {
    return requestErrorResponse(
      ctx.state.i18n,
      'invalid_authoring_data',
      400,
    );
  }
  const id = ctx.params.id;
  const auth = requireAuthContext(ctx.state);
  const record = await getAssessment(auth, id);
  if (!record) return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
  const [
    placementViews,
    userSettings,
    authoringPreferences,
    instructorDefaults,
    assessmentQuestionPointDefaultResult,
    placementRemovalHistory,
  ] = await Promise
    .all([
      getPlacementQuestionViews(
        auth,
        record.parts.flatMap((part) =>
          assessmentQuestionPlacements(part.placements).map((placement) => ({
            placementId: placement.id,
            itemId: placement.itemId,
            revision: placement.snapshotRev ?? null,
          }))
        ),
      ),
      getUserSettings(auth.userId),
      authoringPreferencesService.read(auth, id),
      readInstructorDefaults(auth),
      readAssessmentQuestionPointDefault(auth, id),
      assessmentPlacementRemovalService.list(auth, id),
    ]);
  if (assessmentQuestionPointDefaultResult._tag === 'NotFound') {
    return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
  }
  const assessmentQuestionPointDefault = assessmentQuestionPointDefaultResult.value;
  const placements = new Map(
    record.parts.flatMap((part) => part.placements).map((placement) => [
      placement.id,
      placement,
    ]),
  );
  const items: Record<string, ItemMeta> = {};
  for (const view of Object.values(placementViews)) {
    const placement = placements.get(view.placementId);
    if (!placement || !('itemId' in placement)) {
      throw new Error(`Assessment placement ${view.placementId} is missing.`);
    }
    const blueprintTargetId = placement.blueprintTargetId ?? undefined;
    items[view.placementId] = {
      id: view.placementId,
      itemId: view.itemId,
      title: view.title,
      latestRev: view.revision,
      questionTypeId: requireQuestionType(view.draft),
      questionType: view.questionType,
      preview: view.preview,
      blueprintTargetId,
      reviewSuggestions: collectQuestionReviewSuggestions(view.draft, {
        blueprint: record.blueprint,
        blueprintTargetId,
        aiSuggestions: view.reviewSuggestions,
      }),
    };
  }
  const normalizedParts = record.parts.map((part) => {
    const settings = parseAssessmentPartOptions(part.options);
    if (!settings.ok) throw new Error('Stored assessment part settings are invalid.');
    return {
      id: part.id,
      title: part.title,
      options: settings.options,
      placements: part.placements.map((pl) =>
        'content' in pl ? pl : ({
          id: pl.id,
          itemId: pl.itemId,
          snapshotRev: pl.snapshotRev ?? undefined,
          blueprintTargetId: pl.blueprintTargetId ?? undefined,
          fixed: pl.fixed,
        })
      ),
    };
  });
  const assessment: AssessmentView = {
    id: record.id,
    adaptivePlan: record.adaptivePlan,
    title: record.title,
    brief: record.brief ?? undefined,
    gradeLevel: record.gradeLevel ?? undefined,
    targetCount: record.targetCount,
    attachmentId: record.attachmentId ?? undefined,
    delivery: readDeliverySummary(record.metadata),
    blueprint: record.blueprint,
    parts: normalizedParts,
  };
  if (parsedTool.tool === ASSESSMENT_TOOL_IDS.export) {
    const deliveryCapability: DeliveryPublishCapability = await getDeliveryPublishCapability(
      auth.tenantId,
    );
    const response = await ctx.render(
      <AssessmentPage
        a={assessment}
        items={items}
        choiceRichText={userSettings.choiceRichText}
        authoringPreferences={authoringPreferences}
        instructorDefaults={instructorDefaults}
        assessmentQuestionPointDefault={assessmentQuestionPointDefault}
        placementRemovalHistory={placementRemovalHistory}
        payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
          'assessments',
          'items',
          'authoring',
          'delivery',
        ])}
        playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
        activeTool={parsedTool.tool}
        deliveryCapability={deliveryCapability}
      />,
    );
    response.headers.set('cache-control', 'private, no-store');
    return response;
  }
  const response = await ctx.render(
    <AssessmentPage
      a={assessment}
      items={items}
      choiceRichText={userSettings.choiceRichText}
      authoringPreferences={authoringPreferences}
      instructorDefaults={instructorDefaults}
      assessmentQuestionPointDefault={assessmentQuestionPointDefault}
      placementRemovalHistory={placementRemovalHistory}
      payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
        'assessments',
        'items',
        'authoring',
        ...(parsedTool.tool === ASSESSMENT_TOOL_IDS.plan ? ['imports'] as const : []),
      ])}
      playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
      activeTool={parsedTool.tool}
    />,
  );
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

function requireQuestionType(draft: Draft): QuestionTypeId {
  if (!draft.type) throw new Error('Assessment question type is missing.');
  return draft.type;
}

function AssessmentPage(props: AssessmentBuilderProps) {
  return (
    <section>
      <AssessmentBuilderRoot {...props} />
    </section>
  );
}

const AssessmentBuilderRoot = mountIsland({
  component: 'AssessmentBuilder',
  View: AssessmentBuilderView,
});
