import { mountIsland } from '../../../rendering/mount_island.ts';
import { assessmentQuestionPlacements } from '../../../assessment_content.ts';
import { assessmentArrangementVersion } from '../../../assessment_arrangement_version.ts';
import ArrangeBoardView from '../../../../islands/ArrangeBoard.tsx';
import { parseAssessmentPartOptions } from '../../../assessment_arrangement.ts';
import type { Part, Placement } from '../../../../islands/arrange_board/types.ts';
import { readDeliverySummary } from '../../../delivery_metadata.ts';
import { getPlacementQuestionViews } from '../../../services/questions.ts';
import { getAssessment } from '../../../services/assessment_records.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';
import Alert from '../../../../components/ui/Alert.tsx';
import Button from '../../../../components/ui/Button.tsx';

type Assessment = { id: string; title: string; placements?: Placement[]; parts?: Part[] };
type ItemMeta = { id: string; title: string; revision: number; questionType: string };

const methods = {
  async GET(ctx) {
    const id = ctx.params.id;
    const auth = requireAuthContext(ctx.state);
    const record = await getAssessment(auth, id);
    if (!record) return new Response(ctx.state.i18n.t('assessments.notFound'), { status: 404 });
    if (record.adaptivePlan) {
      const response = await ctx.render(
        <section id='assessment-arrangement-managed'>
          <Alert tone='neutral'>
            <p>{ctx.state.i18n.t('assessments.settings.adaptive')}</p>
            <Button href={`/assessments/${id}`}>
              {ctx.state.i18n.t('assessments.arrange.openCanvas')}
            </Button>
          </Alert>
        </section>,
      );
      response.headers.set('cache-control', 'private, no-store');
      return response;
    }
    const parts: Part[] = record.parts.map((part) => {
      const parsed = parseAssessmentPartOptions(part.options);
      if (!parsed.ok) throw new Error('Persisted assessment part settings are invalid.');
      return {
        id: part.id,
        title: part.title,
        options: parsed.options,
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
    const views = await getPlacementQuestionViews(
      auth,
      parts.flatMap((part) =>
        assessmentQuestionPlacements(part.placements).map((placement) => ({
          placementId: placement.id,
          itemId: placement.itemId,
          revision: placement.snapshotRev ?? null,
        }))
      ),
    );
    const items: Record<string, ItemMeta> = {};
    for (const view of Object.values(views)) {
      if (!view.draft.type) throw new Error('Arrange question type is missing.');
      items[view.placementId] = {
        id: view.placementId,
        title: view.title,
        revision: view.revision,
        questionType: view.draft.type,
      };
    }
    const assessment: Assessment = {
      id: record.id,
      title: record.title,
      parts,
    };
    const deliveryPreviewUrl = readDeliverySummary(record.metadata)?.previewUrl ?? null;
    const initialVersion = await assessmentArrangementVersion(id, parts);
    const response = await ctx.render(
      (
        <ArrangePage
          initialVersion={initialVersion}
          a={assessment}
          parts={parts}
          items={items}
          deliveryPreviewUrl={deliveryPreviewUrl}
          payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
            'assessments',
            'items',
          ])}
        />
      ),
    );
    response.headers.set('cache-control', 'private, no-store');
    return response;
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const assessmentArrangePageRoute = defineHttpRoute('/assessments/:id/arrange', {
  ...methods,
  HEAD: methods.GET,
});

type ArrangeProps = {
  initialVersion: string;
  a: Assessment;
  parts: Part[];
  items: Record<string, ItemMeta>;
  deliveryPreviewUrl?: string | null;
  payload: import('../../../i18n/payload.ts').I18nPayload;
};

export default function ArrangePage(
  { a, parts, items, deliveryPreviewUrl, payload, initialVersion }: ArrangeProps,
) {
  return (
    <section>
      <ArrangeBoard
        initialVersion={initialVersion}
        assessmentId={a.id}
        deliveryPreviewUrl={deliveryPreviewUrl}
        initialParts={parts}
        items={items}
        payload={payload}
      />
    </section>
  );
}

const ArrangeBoard = mountIsland({ component: 'ArrangeBoard', View: ArrangeBoardView });
