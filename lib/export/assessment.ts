import { parseQtiXml } from '@longsightgroup/qti3-core';
import { AssessmentExportError } from './assessment_export_error.ts';
import type { AssessmentContentPlacement } from '../assessment_standalone_content.ts';
import { assessmentQuestionPlacements } from '../assessment_content.ts';
import type { OrganizationByItem } from '../organization_transfer.ts';
import {
  type QtiTranscodeDiagnostic,
  type QtiTranscodeFailureCode,
  type QtiTranscodePackageResult,
  transcodeQti3Package,
} from '@longsightgroup/qti3-transcoder';
import { inflateSync } from 'fflate';

import {
  type AssetDepsByItem,
  buildPackageManifestXml,
  type PackageAsset,
} from '../package_export.ts';
import type { QtiValidationError, QtiValidationResult } from '../qti_validate.ts';
import { validateQtiXml } from '../qti_validate.ts';
import type { AssessmentRecord } from '../services/assessment_records.ts';
import type { StandardsByItem } from '../standards.ts';
import type { TagsByItem } from '../question_tags.ts';
import { buildAssessmentTestXml, type Part } from '../test_export.ts';
import { writeQti3AssessmentTest } from '@longsightgroup/qti3-writer';
import { compileAdaptiveAssessment } from '../assessment_adaptive_export.ts';
import type { AdaptiveAssessmentPlan } from '../assessment_adaptive_plan.ts';
import { writeZip } from '../zip.ts';
import type { SelectableAssessmentExportTarget } from './assessment_export_targets.ts';
import { assessmentExportSettingsDiagnostics } from './assessment_export_settings.ts';
import { parseAssessmentPartOptions } from '../assessment_arrangement.ts';

/** Canonical assessment structure consumed by every package target. */
export type AssessmentExportDocument = {
  readonly adaptivePlan?: AdaptiveAssessmentPlan;
  readonly assessment: { readonly id: string; readonly title?: string };
  readonly parts: readonly Part[];
};

/** Persisted assessment structure whose placements still select question revisions. */
export type AssessmentExportSelectionDocument = {
  readonly adaptivePlan?: AdaptiveAssessmentPlan;
  readonly assessment: { readonly id: string; readonly title?: string };
  readonly parts: readonly {
    readonly id: string;
    readonly title: string;
    readonly placements: readonly (AssessmentContentPlacement | {
      readonly id: string;
      readonly itemId: string;
      readonly snapshotRev: number | null;
      readonly fixed?: boolean;
    })[];
    readonly options?: Part['options'];
  }[];
};

type AssessmentPackageEntry = {
  readonly name: string;
  readonly data: Uint8Array;
  readonly date: Date;
};

/** Canonical QTI 3 package material required before target compilation. */
export type AssessmentExportPackageInput = {
  readonly document: AssessmentExportDocument;
  readonly assessmentXml: string;
  readonly itemsXml: Readonly<Record<string, string>>;
  readonly assets: readonly PackageAsset[];
  readonly assetIdsByItem?: AssetDepsByItem;
  readonly assessmentAssetIds?: readonly string[];
  readonly standardsByItem?: StandardsByItem;
  readonly tagsByItem?: TagsByItem;
  readonly organizationByItem?: OrganizationByItem;
};

type SuccessfulQtiTranscodePackageResult = Extract<
  QtiTranscodePackageResult,
  { readonly ok: true }
>;

/**
 * QFlow-owned projection of the evidence fields returned by qti3.
 *
 * qti3 owns item conversion evidence. QFlow also records assessment-level adaptations.
 */
export type AssessmentTranscodeEvidence = Pick<
  SuccessfulQtiTranscodePackageResult,
  'profile' | 'target' | 'fidelity' | 'reports' | 'diagnostics'
>;

/** Typed outcome of canonical package creation and optional qti3 target compilation. */
export type AssessmentPackageConversionResult =
  | {
    readonly ok: true;
    readonly canonicalPackage: Uint8Array;
    readonly artifact: Uint8Array;
    readonly transcodeEvidence: AssessmentTranscodeEvidence | null;
  }
  | {
    readonly ok: false;
    readonly code: QtiTranscodeFailureCode | 'target_artifact_missing';
    readonly diagnostics: readonly QtiTranscodeDiagnostic[];
  };

const encoder = new TextEncoder();
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

/** Projects a persisted assessment into the revision selections required for package export. */
export function toAssessmentExportSelectionDocument(
  assessment: AssessmentRecord,
): AssessmentExportSelectionDocument {
  return {
    adaptivePlan: assessment.adaptivePlan,
    assessment: { id: assessment.id, title: assessment.title },
    parts: assessment.parts.map((part) => ({
      id: part.id,
      title: part.title,
      placements: part.placements.map((placement) =>
        'content' in placement ? placement : ({
          id: placement.id,
          itemId: placement.itemId,
          snapshotRev: placement.snapshotRev,
          fixed: placement.fixed,
        })
      ),
      options: parseStoredExportPartOptions(part.options),
    })),
  };
}

function parseStoredExportPartOptions(value: unknown): NonNullable<Part['options']> {
  const parsed = parseAssessmentPartOptions(value);
  if (!parsed.ok) throw new Error('Persisted assessment part options are invalid.');
  return parsed.options;
}

/** Builds and validates the canonical QTI 3 assessment-test document. */
export async function buildValidatedQti3Assessment(
  document: AssessmentExportDocument,
): Promise<{ readonly xml: string; readonly validation: QtiValidationResult }> {
  let xml: string;
  if (document.adaptivePlan) {
    const written = writeQti3AssessmentTest(
      compileAdaptiveAssessment(document.assessment, document.parts, document.adaptivePlan),
    );
    if (!written.ok) throw new Error('Adaptive assessment could not be serialized.');
    xml = written.value;
  } else xml = buildAssessmentTestXml(document.assessment, [...document.parts]);
  return { xml, validation: await validateQtiXml(xml) };
}

/** Combines a canonical assessment-test validation with every referenced item validation. */
export async function validateAssessmentItemExports(
  assessmentValidation: QtiValidationResult,
  itemsXml: Readonly<Record<string, string>>,
): Promise<QtiValidationResult> {
  if (!assessmentValidation.ok) return assessmentValidation;

  const itemResults = await Promise.all(
    Object.entries(itemsXml).map(async ([itemId, xml]) => {
      const result = await validateQtiXml(xml);
      return result.ok ? [] : result.errors.map((error) => ({
        ...error,
        message: `Item ${itemId}: ${error.message}`,
      }));
    }),
  );
  const errors: QtiValidationError[] = itemResults.flat();
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Builds the canonical QTI 3 package entries used for direct QTI 3 export. */
export function buildQti3AssessmentPackageEntries(
  {
    document,
    assessmentXml,
    itemsXml,
    assets,
    assetIdsByItem,
    standardsByItem,
    tagsByItem,
    organizationByItem,
    assessmentAssetIds,
  }: AssessmentExportPackageInput,
): AssessmentPackageEntry[] {
  const manifestXml = buildPackageManifestXml(
    document.assessment.id,
    [...document.parts],
    [...assets],
    assetIdsByItem,
    standardsByItem,
    tagsByItem,
    organizationByItem,
    assessmentAssetIds,
  );
  return buildAssessmentPackageEntriesFromManifest(
    manifestXml,
    assessmentXml,
    itemsXml,
    assets,
  );
}

/** Exports the canonical QTI 3 package directly or through one configured target profile. */
export async function convertQti3AssessmentPackage(
  input: AssessmentExportPackageInput,
  target: SelectableAssessmentExportTarget,
): Promise<AssessmentPackageConversionResult> {
  requireAssessmentAnswerFeedbackRelease(input.document, input.itemsXml);
  const sourceZip = await writeZip(buildQti3AssessmentPackageEntries(input));
  if (target.compilation._tag === 'CanonicalPackage') {
    return {
      ok: true,
      canonicalPackage: sourceZip,
      artifact: sourceZip,
      transcodeEvidence: null,
    };
  }
  // Compile a static derivative for profile destinations while retaining the adaptive source
  // in canonicalPackage. Every saved placement is included; no adaptive path is invented.
  const profileSourceZip = input.document.adaptivePlan
    ? await writeZip(buildQti3AssessmentPackageEntries({
      ...input,
      assessmentXml: buildAssessmentTestXml(input.document.assessment, [...input.document.parts]),
    }))
    : sourceZip;
  const result = await transcodeQti3Package(
    {
      kind: 'zip',
      bytes: profileSourceZip,
      inflateRaw: (bytes) => inflateSync(bytes),
    },
    { profile: target.compilation.profileId },
  );
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      diagnostics: result.diagnostics,
    };
  }
  let artifact: Uint8Array;
  if (target.compilation._tag === 'ProfileArchive') {
    artifact = result.zip;
  } else {
    const profileFile = selectProfileFile(result.files, target.compilation.path);
    if (profileFile === null) {
      return {
        ok: false,
        code: 'target_artifact_missing',
        diagnostics: [{
          code: 'package.required_artifact.missing',
          severity: 'error',
          message:
            `Profile ${target.compilation.profileId} did not emit ${target.compilation.path}.`,
          path: target.compilation.path,
        }],
      };
    }
    artifact = profileFile;
  }
  const evidence = projectTranscodeEvidence(result);
  const assessmentDiagnostics: readonly QtiTranscodeDiagnostic[] = [
    ...assessmentExportSettingsDiagnostics(input.document, target),
    ...Object.entries(input.itemsXml).flatMap(([itemId, xml]) =>
      parseQtiXml(xml).document?.item.modalFeedback.length
        ? [{
          code: 'qflow.export.answer_feedback_omitted',
          severity: 'warning' as const,
          message:
            'Answer explanations, their conditions, links and media are omitted from this destination. All questions are retained. Use native QTI 3 with Harbor to retain answer feedback.',
          path: `items/${itemId}.xml`,
        }]
        : []
    ),
    ...(input.document.adaptivePlan
      ? [{
        code: 'qflow.export.adaptive_sequence_omitted',
        severity: 'warning' as const,
        message: `Exported as a standard quiz with all ${
          input.document.parts.reduce(
            (count, part) => count + assessmentQuestionPlacements(part.placements).length,
            0,
          )
        } saved questions in order. Adaptive branching and the ${input.document.adaptivePlan.settings.questionCount}-question adaptive path are omitted.`,
        path: 'assessment.xml',
      }]
      : []),
  ];
  const transcodeEvidence: AssessmentTranscodeEvidence = assessmentDiagnostics.length > 0
    ? {
      ...evidence,
      fidelity: 'lossy',
      diagnostics: [...evidence.diagnostics, ...assessmentDiagnostics],
    }
    : evidence;
  return {
    ok: true,
    canonicalPackage: sourceZip,
    artifact,
    transcodeEvidence,
  };
}

function buildAssessmentPackageEntriesFromManifest(
  manifestXml: string,
  assessmentXml: string,
  itemsXml: Readonly<Record<string, string>>,
  assets: readonly PackageAsset[],
): AssessmentPackageEntry[] {
  return [
    { name: 'imsmanifest.xml', data: encoder.encode(manifestXml), date: ZIP_EPOCH },
    { name: 'assessment.xml', data: encoder.encode(assessmentXml), date: ZIP_EPOCH },
    ...Object.entries(itemsXml).sort(([left], [right]) => left.localeCompare(right)).map((
      [itemId, xml],
    ) => ({
      name: `items/${itemId}.xml`,
      data: encoder.encode(xml),
      date: ZIP_EPOCH,
    })),
    ...[...assets].sort((left, right) => left.name.localeCompare(right.name)).map((asset) => ({
      name: `assets/${asset.name}`,
      data: asset.data,
      date: ZIP_EPOCH,
    })),
  ];
}

function selectProfileFile(
  files: readonly { readonly path: string; readonly data: string | Uint8Array }[],
  path: string,
): Uint8Array | null {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) return null;
  return typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
}

function projectTranscodeEvidence(
  result: SuccessfulQtiTranscodePackageResult,
): AssessmentTranscodeEvidence {
  return {
    profile: result.profile,
    target: result.target,
    fidelity: result.fidelity,
    reports: result.reports.map((report) => ({
      identifier: report.identifier,
      ...(report.sourcePath === undefined ? {} : { sourcePath: report.sourcePath }),
      fidelity: report.fidelity,
      mappings: report.mappings.map((mapping) => ({
        index: mapping.index,
        sourceInteraction: mapping.sourceInteraction,
        emittedInteraction: mapping.emittedInteraction,
        fidelity: mapping.fidelity,
        scoring: mapping.scoring,
        ...(mapping.fallback === undefined ? {} : { fallback: mapping.fallback }),
        affectedPaths: [...mapping.affectedPaths],
        diagnosticCodes: [...mapping.diagnosticCodes],
      })),
      affectedPaths: [...report.affectedPaths],
      diagnosticCodes: [...report.diagnosticCodes],
    })),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    })),
  };
}

/** Authored explanations require an explicit assessment policy before any learner artifact exists. */
export function requireAssessmentAnswerFeedbackRelease(
  document: AssessmentExportDocument,
  itemsXml: Readonly<Record<string, string>>,
): void {
  for (const [index, part] of document.parts.entries()) {
    const containsFeedback = part.placements.some((placement) => {
      if ('content' in placement) return false;
      const item = parseQtiXml(itemsXml[placement.itemId] ?? '').document?.item;
      return !!item?.modalFeedback.length;
    });
    if (containsFeedback && part.options?.answerFeedbackRelease === undefined) {
      throw new AssessmentExportError(
        `Choose an answer feedback release setting for part ${
          index + 1
        } before exporting or publishing. Open the part settings and select after submission or never.`,
      );
    }
  }
}
