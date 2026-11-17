import { and, desc, eq } from 'drizzle-orm';
import type { QflowDatabase } from '../db.ts';
import { assessments, enrichmentSchemeVersions } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';
import { parseEnrichmentDefinition } from './bank_enrichment_contract.ts';

import { getAssessment } from './assessment_records.ts';
import { loadAssessmentItemExports } from '../export/assessment_loader.ts';
import {
  buildValidatedQti3Assessment,
  toAssessmentExportSelectionDocument,
} from '../export/assessment.ts';
import {
  type AdaptivePreviewScenario,
  previewAdaptiveAssessment,
} from '../assessment_adaptive_preview.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';

type Preview = { readonly xml: string } | {
  readonly answered: number;
  readonly levels: readonly string[];
};

/** Read authorized setup choices and preview the frozen form through its exported QTI. */
export class AssessmentAdaptiveRead {
  constructor(private readonly database: QflowDatabase) {}

  /** Include category versions retained by the author-selected bank scope. */
  async categoryOptions(ctx: RequestContext, assessmentId: string, schemeId: string) {
    if (!await hasWorkspaceCapability(ctx, 'manage_content', this.database)) return null;
    const [assessment] = await this.database.select({ id: assessments.id }).from(assessments).where(
      and(eq(assessments.id, assessmentId), eq(assessments.tenantId, ctx.tenantId)),
    );
    if (!assessment) return null;
    const versions = await this.database.select().from(enrichmentSchemeVersions).where(
      and(
        eq(enrichmentSchemeVersions.tenantId, ctx.tenantId),
        eq(enrichmentSchemeVersions.schemeId, schemeId),
      ),
    ).orderBy(desc(enrichmentSchemeVersions.version)).limit(100);
    return versions.map((version) => {
      const definition = parseEnrichmentDefinition(version.definition);
      if (!definition) throw new Error('Invalid category-set definition.');
      return {
        id: version.id,
        version: version.version,
        audience: definition.audience,
        levels: definition.difficulty.map(({ id, label }) => ({ id, label })),
      };
    });
  }

  /** Return runnable QTI or a simulated route, without creating a learner attempt. */
  async preview(
    ctx: RequestContext,
    assessmentId: string,
    scenario: AdaptivePreviewScenario | 'answer',
  ): Promise<EnrichmentResult<Preview, 'forbidden' | 'not_found' | 'invalid_assessment'>> {
    if (!await hasWorkspaceCapability(ctx, 'manage_content', this.database)) {
      return { ok: false, code: 'forbidden' };
    }
    const assessment = await getAssessment(ctx, assessmentId, this.database);
    if (!assessment?.adaptivePlan) return { ok: false, code: 'not_found' };
    const resolved = await loadAssessmentItemExports(
      this.database,
      ctx,
      toAssessmentExportSelectionDocument(assessment),
    );
    const exported = await buildValidatedQti3Assessment(resolved.document);
    if (!exported.validation.ok) return { ok: false, code: 'invalid_assessment' };
    if (scenario === 'answer') return { ok: true, value: { xml: exported.xml } };
    const result = previewAdaptiveAssessment(exported.xml, scenario);
    const labels = new Map(
      assessment.adaptivePlan.levels.map((level, index) => [`QFLOW_LEVEL_${index}`, level.label]),
    );
    return {
      ok: true,
      value: {
        answered: result.answered,
        levels: result.route.filter((_, index) => index % 5 === 0).map((entry) => {
          const label = labels.get(entry.level);
          if (!label) throw new Error('Preview level is not declared.');
          return label;
        }),
      },
    };
  }
}
