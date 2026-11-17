import {
  parseQtiXml,
  type QtiAssessmentItem,
  type QtiInteraction,
} from '@longsightgroup/qti3-core';
import type { QtiTranscodeFidelity, QtiTranscodeItemReport } from '@longsightgroup/qti3-transcoder';

import { sha256Hex } from '../sha256.ts';
import type { AssessmentTranscodeEvidence } from './assessment.ts';
import {
  type AssessmentExportFidelityReceipt,
  QTI3_PACKAGE_VERSIONS,
} from './assessment_export_receipt.ts';
import type { AssessmentExportRequirements } from './assessment_export_requirements.ts';
import type { SelectableAssessmentExportTarget } from './assessment_export_targets.ts';

declare const assessmentExportPreflightIdBrand: unique symbol;
declare const assessmentExportAcknowledgementTokenBrand: unique symbol;
declare const assessmentCanonicalRevisionIdBrand: unique symbol;

/** Content-addressed identity of one exact export evaluation and its requirements. */
export type AssessmentExportPreflightId = string & {
  readonly [assessmentExportPreflightIdBrand]: 'AssessmentExportPreflightId';
};

/** Content-addressed proof that the author acknowledged the current warning set. */
export type AssessmentExportAcknowledgementToken = string & {
  readonly [assessmentExportAcknowledgementTokenBrand]: 'AssessmentExportAcknowledgementToken';
};

/** Content-addressed identity of the canonical assessment and item source documents. */
export type AssessmentCanonicalRevisionId = string & {
  readonly [assessmentCanonicalRevisionIdBrand]: 'AssessmentCanonicalRevisionId';
};

/** Outcome precedence shared by the preflight workspace and package gate. */
export type AssessmentExportOutcome =
  | 'preserved'
  | 'transformed'
  | 'warning'
  | 'blocked';

/** Source scoring semantics inferred from the validated canonical QTI item. */
export type AssessmentExportSourceScoring = 'automatic' | 'manual-or-unscored';

type QtiTranscodeInteractionReport = QtiTranscodeItemReport['mappings'][number];

/** One qti3 mapping plus the source scoring requirement used by QFlow policy. */
export type AssessmentExportPreflightMapping = QtiTranscodeInteractionReport & {
  readonly sourceScoring: AssessmentExportSourceScoring;
};

type AssessmentExportPreflightItemBase = {
  readonly itemId: string;
  readonly itemIdentifier: string;
  readonly title: string;
  readonly fidelity: QtiTranscodeFidelity | 'canonical' | 'unresolved';
  readonly mappings: readonly AssessmentExportPreflightMapping[];
  readonly affectedPaths: readonly string[];
  readonly diagnosticCodes: readonly string[];
};

/** Per-item destination outcome derived from the canonical item and qti3 report. */
export type AssessmentExportPreflightItem =
  | (AssessmentExportPreflightItemBase & { readonly _tag: 'Preserved' })
  | (AssessmentExportPreflightItemBase & { readonly _tag: 'Transformed' })
  | (AssessmentExportPreflightItemBase & {
    readonly _tag: 'Warning';
    readonly acknowledgement: 'Required';
  })
  | (AssessmentExportPreflightItemBase & { readonly _tag: 'Blocked' });

/** Explicit requirement change that can resolve a blocked preflight with a disclosed consequence. */
export type AssessmentExportRepair =
  | {
    readonly _tag: 'AcceptManualScoring';
    readonly id: 'accept-manual-scoring';
    readonly label: 'Allow manual grading';
    readonly consequence: string;
    readonly affectedItemIds: readonly string[];
  }
  | {
    readonly _tag: 'AcceptDiagnosedFallbacks';
    readonly id: 'accept-diagnosed-fallbacks';
    readonly label: 'Allow described interaction changes';
    readonly consequence: string;
    readonly affectedItemIds: readonly string[];
  };

type AssessmentExportPreflightBase = {
  readonly schema: 'qflow.export-preflight.v1';
  readonly preflightId: AssessmentExportPreflightId;
  readonly assessmentId: string;
  readonly canonicalRevisionId: AssessmentCanonicalRevisionId;
  readonly destinationId: SelectableAssessmentExportTarget['id'];
  readonly targetContractId: SelectableAssessmentExportTarget['targetContractId'];
  readonly qti3Packages: AssessmentExportFidelityReceipt['target']['qti3Packages'];
  readonly requirements: AssessmentExportRequirements;
  readonly items: readonly AssessmentExportPreflightItem[];
  readonly packageDiagnosticCodes: readonly string[];
  readonly warningCodes: readonly string[];
  readonly acknowledgementToken: AssessmentExportAcknowledgementToken | null;
  readonly repairs: readonly AssessmentExportRepair[];
  readonly overallOutcome: AssessmentExportOutcome;
};

/**
 * Real execution result for one canonical source revision and exact destination contract.
 *
 * Build-blocked preflights deliberately have no package or fidelity evidence. Evaluated
 * preflights always carry the complete, internally linked artifact evidence.
 */
export type AssessmentExportPreflight =
  | (AssessmentExportPreflightBase & {
    readonly _tag: 'Evaluated';
    readonly canonicalPackageSha256: string;
    readonly artifact: AssessmentExportFidelityReceipt['artifact'];
    readonly fidelityReceiptId: AssessmentExportFidelityReceipt['receiptId'];
  })
  | (AssessmentExportPreflightBase & {
    readonly _tag: 'BuildBlocked';
    readonly overallOutcome: 'blocked';
    readonly canonicalPackageSha256: null;
    readonly artifact: null;
    readonly fidelityReceiptId: null;
  });

type CreateAssessmentExportPreflightInput = {
  readonly target: SelectableAssessmentExportTarget;
  readonly requirements: AssessmentExportRequirements;
  readonly receipt: AssessmentExportFidelityReceipt;
  readonly canonicalRevisionId: AssessmentCanonicalRevisionId;
  readonly itemsXml: Readonly<Record<string, string>>;
  readonly transcodeEvidence: AssessmentTranscodeEvidence | null;
  readonly omittedOrganizationItemIds?: readonly string[];
};

type CreateBuildBlockedPreflightInput = {
  readonly assessmentId: string;
  readonly target: SelectableAssessmentExportTarget;
  readonly requirements: AssessmentExportRequirements;
  readonly canonicalRevisionId: AssessmentCanonicalRevisionId;
  readonly itemsXml: Readonly<Record<string, string>>;
  readonly diagnosticCodes: readonly string[];
};

type CanonicalPreflightItem = {
  readonly itemId: string;
  readonly identifier: string;
  readonly title: string;
  readonly interactions: readonly QtiInteraction[];
  readonly item: QtiAssessmentItem;
};

const AUTOMATIC_SCORING_LOST = 'qflow.requirement.automatic_scoring_lost';
const INTERACTION_NOT_PRESERVED = 'qflow.requirement.interaction_not_preserved';
const ITEM_REPORT_MISSING = 'qflow.preflight.item_report_missing';
const SOURCE_INTERACTION_MISSING = 'qflow.preflight.source_interaction_missing';

/** Creates a content address for the canonical source documents before packaging begins. */
export async function createAssessmentCanonicalRevisionId(input: {
  readonly assessmentId: string;
  readonly assessmentXml: string;
  readonly itemsXml: Readonly<Record<string, string>>;
}): Promise<AssessmentCanonicalRevisionId> {
  const identity = JSON.stringify({
    schema: 'qflow.canonical-assessment-revision.v1',
    assessmentId: input.assessmentId,
    assessmentXml: input.assessmentXml,
    items: Object.entries(input.itemsXml).sort(([left], [right]) => left.localeCompare(right)),
  });
  const digest = await sha256Hex(new TextEncoder().encode(identity));
  // SAFETY: sha256Hex establishes the 64-character lowercase hexadecimal invariant.
  return digest as AssessmentCanonicalRevisionId;
}

/** Derives visible item outcomes, repairs, freshness, and acknowledgement from qti3 evidence. */
export async function createAssessmentExportPreflight(
  input: CreateAssessmentExportPreflightInput,
): Promise<AssessmentExportPreflight> {
  const canonicalItems = Object.entries(input.itemsXml).map(([itemId, xml]) =>
    parseCanonicalPreflightItem(itemId, xml)
  );
  const reportsBySourcePath = indexReportsBySourcePath(input.transcodeEvidence?.reports ?? []);
  const omittedOrganization = new Set(input.omittedOrganizationItemIds ?? []);
  const items = canonicalItems.map((item): AssessmentExportPreflightItem => {
    const evaluated = evaluateItem(item, input.target, input.requirements, reportsBySourcePath);
    if (!omittedOrganization.has(item.itemId)) return evaluated;
    const diagnosticCodes = sortedUnique([
      ...evaluated.diagnosticCodes,
      'qflow.export.stale_organization_omitted',
    ]);
    return evaluated._tag === 'Blocked' ? { ...evaluated, diagnosticCodes } : {
      ...evaluated,
      _tag: 'Warning',
      acknowledgement: 'Required',
      diagnosticCodes,
    };
  });
  const packageDiagnosticCodes = sortedUnique(input.receipt.packageDiagnosticCodes);
  const packageErrorDiagnosticCodes = sortedUnique(
    input.transcodeEvidence?.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code) ?? [],
  );
  const warningCodes = sortedUnique([
    ...packageDiagnosticCodes.filter(requiresExportAcknowledgement),
    ...items.flatMap((item) => item._tag === 'Warning' ? item.diagnosticCodes : []),
  ]);
  const overallOutcome = aggregateOutcome(
    items,
    packageDiagnosticCodes.filter(requiresExportAcknowledgement),
    packageErrorDiagnosticCodes,
  );
  const repairs = buildRepairs(items);
  const preflightIdentity = new TextEncoder().encode(JSON.stringify({
    canonicalPackageSha256: input.receipt.assessment.canonicalPackageSha256,
    targetContractId: input.target.targetContractId,
    qti3Packages: input.receipt.target.qti3Packages,
    requirements: input.requirements,
    items,
    packageDiagnosticCodes,
    packageErrorDiagnosticCodes,
    overallOutcome,
    artifactSha256: input.receipt.artifact.sha256,
  }));
  const preflightId = await createPreflightId(preflightIdentity);
  const acknowledgementToken = overallOutcome === 'warning'
    ? await createAcknowledgementToken(preflightId, warningCodes)
    : null;

  return {
    _tag: 'Evaluated',
    schema: 'qflow.export-preflight.v1',
    preflightId,
    assessmentId: input.receipt.assessment.id,
    canonicalRevisionId: input.canonicalRevisionId,
    canonicalPackageSha256: input.receipt.assessment.canonicalPackageSha256,
    destinationId: input.target.id,
    targetContractId: input.target.targetContractId,
    qti3Packages: input.receipt.target.qti3Packages,
    requirements: input.requirements,
    items,
    packageDiagnosticCodes,
    warningCodes,
    acknowledgementToken,
    repairs,
    overallOutcome,
    artifact: input.receipt.artifact,
    fidelityReceiptId: input.receipt.receiptId,
  };
}

function requiresExportAcknowledgement(code: string): boolean {
  // Evidence status stays visible in the receipt. It describes verification, not a loss
  // of question content, scoring or learner behavior, so it does not gate download.
  return ![
    'product_import_evidence.not_recorded',
    'profile_release_evidence.not_recorded',
    'qti3_conformance.not_run',
  ].includes(code);
}

/** Creates an honest item-level blocked preflight when no destination artifact can be produced. */
export async function createBuildBlockedAssessmentExportPreflight(
  input: CreateBuildBlockedPreflightInput,
): Promise<AssessmentExportPreflight> {
  const diagnosticCodes = sortedUnique(input.diagnosticCodes);
  const items = Object.entries(input.itemsXml).map(([itemId, xml]) => {
    const parsed = parseQtiXml(xml);
    const item = parsed.ok && parsed.document ? parsed.document.item : null;
    return {
      _tag: 'Blocked' as const,
      itemId,
      itemIdentifier: item?.identifier ?? itemId,
      title: item?.title ?? 'Unresolved question',
      fidelity: 'unresolved' as const,
      mappings: [],
      affectedPaths: [`items/${itemId}.xml`],
      diagnosticCodes,
    };
  });
  const preflightIdentity = new TextEncoder().encode(JSON.stringify({
    canonicalRevisionId: input.canonicalRevisionId,
    targetContractId: input.target.targetContractId,
    requirements: input.requirements,
    items,
    packageDiagnosticCodes: diagnosticCodes,
    overallOutcome: 'blocked',
  }));
  return {
    _tag: 'BuildBlocked',
    schema: 'qflow.export-preflight.v1',
    preflightId: await createPreflightId(preflightIdentity),
    assessmentId: input.assessmentId,
    canonicalRevisionId: input.canonicalRevisionId,
    canonicalPackageSha256: null,
    destinationId: input.target.id,
    targetContractId: input.target.targetContractId,
    qti3Packages: qti3PackagesForTarget(input.target),
    requirements: input.requirements,
    items,
    packageDiagnosticCodes: diagnosticCodes,
    warningCodes: [],
    acknowledgementToken: null,
    repairs: [],
    overallOutcome: 'blocked',
    artifact: null,
    fidelityReceiptId: null,
  };
}

function evaluateItem(
  item: CanonicalPreflightItem,
  target: SelectableAssessmentExportTarget,
  requirements: AssessmentExportRequirements,
  reportsBySourcePath: ReadonlyMap<string, QtiTranscodeItemReport>,
): AssessmentExportPreflightItem {
  const base = {
    itemId: item.itemId,
    itemIdentifier: item.identifier,
    title: item.title,
  };
  if (target.compilation._tag === 'CanonicalPackage') {
    return {
      ...base,
      _tag: 'Preserved',
      fidelity: 'canonical',
      mappings: [],
      affectedPaths: [],
      diagnosticCodes: [],
    };
  }

  const report = reportsBySourcePath.get(`items/${item.itemId}.xml`);
  if (!report) {
    return {
      ...base,
      _tag: 'Blocked',
      fidelity: 'unresolved',
      mappings: [],
      affectedPaths: [],
      diagnosticCodes: [ITEM_REPORT_MISSING],
    };
  }
  const sourceScoring = sourceScoringForItem(item.item);
  const mappings = report.mappings.map((mapping) => ({
    ...mapping,
    sourceScoring,
  }));
  const automaticScoringLost = mappings.some((mapping) =>
    mapping.sourceScoring === 'automatic' && mapping.scoring !== 'automatic'
  );
  const interactionNotPreserved = mappings.some((mapping) =>
    mapping.fidelity === 'lossy' || mapping.fallback !== undefined
  );
  const missingSourceInteraction = mappings.some((mapping) =>
    mapping.index < 0 || mapping.index >= item.interactions.length
  );
  const policyCodes = [
    ...(automaticScoringLost &&
        requirements.scoring._tag === 'AutomaticScoringRequired'
      ? [AUTOMATIC_SCORING_LOST]
      : []),
    ...(interactionNotPreserved &&
        requirements.interaction._tag === 'BehaviorMustBePreserved'
      ? [INTERACTION_NOT_PRESERVED]
      : []),
    ...(missingSourceInteraction ? [SOURCE_INTERACTION_MISSING] : []),
  ];
  const diagnosticCodes = sortedUnique([...report.diagnosticCodes, ...policyCodes]);
  const projected = {
    ...base,
    fidelity: report.fidelity,
    mappings,
    affectedPaths: report.affectedPaths,
    diagnosticCodes,
  };
  if (policyCodes.length > 0) return { ...projected, _tag: 'Blocked' };
  if (
    report.fidelity === 'lossy' ||
    report.diagnosticCodes.length > 0 ||
    automaticScoringLost ||
    interactionNotPreserved
  ) {
    return { ...projected, _tag: 'Warning', acknowledgement: 'Required' };
  }
  if (report.fidelity === 'normalized') return { ...projected, _tag: 'Transformed' };
  return { ...projected, _tag: 'Preserved' };
}

function sourceScoringForItem(item: QtiAssessmentItem): AssessmentExportSourceScoring {
  // qti3 owns the parsed semantic model: response processing or a SCORE outcome declares that
  // the canonical item expects automated scoring, including custom processing without answer keys.
  return item.responseProcessing ||
      item.outcomeDeclarations.some((declaration) => declaration.identifier === 'SCORE')
    ? 'automatic'
    : 'manual-or-unscored';
}

function parseCanonicalPreflightItem(itemId: string, xml: string): CanonicalPreflightItem {
  const parsed = parseQtiXml(xml);
  if (!parsed.ok || !parsed.document) {
    throw new Error(`Validated canonical item ${itemId} could not be parsed for preflight.`);
  }
  return {
    itemId,
    identifier: parsed.document.item.identifier,
    title: parsed.document.item.title ?? 'Untitled question',
    interactions: parsed.document.item.interactions,
    item: parsed.document.item,
  };
}

function indexReportsBySourcePath(
  reports: readonly QtiTranscodeItemReport[],
): ReadonlyMap<string, QtiTranscodeItemReport> {
  const indexed = new Map<string, QtiTranscodeItemReport>();
  for (const report of reports) {
    if (!report.sourcePath) continue;
    if (indexed.has(report.sourcePath)) {
      throw new Error(`qti3 returned duplicate item report path ${report.sourcePath}.`);
    }
    indexed.set(report.sourcePath, report);
  }
  return indexed;
}

function aggregateOutcome(
  items: readonly AssessmentExportPreflightItem[],
  packageDiagnosticCodes: readonly string[],
  packageErrorDiagnosticCodes: readonly string[],
): AssessmentExportOutcome {
  if (
    packageErrorDiagnosticCodes.length > 0 ||
    items.some((item) => item._tag === 'Blocked')
  ) return 'blocked';
  if (packageDiagnosticCodes.length > 0 || items.some((item) => item._tag === 'Warning')) {
    return 'warning';
  }
  if (items.some((item) => item._tag === 'Transformed')) return 'transformed';
  return 'preserved';
}

function buildRepairs(
  items: readonly AssessmentExportPreflightItem[],
): readonly AssessmentExportRepair[] {
  const manualScoringItems = blockedItemIdsWithCode(items, AUTOMATIC_SCORING_LOST);
  const fallbackItems = blockedItemIdsWithCode(items, INTERACTION_NOT_PRESERVED);
  return [
    ...(manualScoringItems.length
      ? [{
        _tag: 'AcceptManualScoring' as const,
        id: 'accept-manual-scoring' as const,
        label: 'Allow manual grading' as const,
        consequence:
          'The destination will not score the affected responses automatically. Instructors must grade them in the LMS.',
        affectedItemIds: manualScoringItems,
      }]
      : []),
    ...(fallbackItems.length
      ? [{
        _tag: 'AcceptDiagnosedFallbacks' as const,
        id: 'accept-diagnosed-fallbacks' as const,
        label: 'Allow described interaction changes' as const,
        consequence:
          'The destination will receive the named fallback interactions. The original QTI 3 interactions remain unchanged in QFlowLearn.',
        affectedItemIds: fallbackItems,
      }]
      : []),
  ];
}

function blockedItemIdsWithCode(
  items: readonly AssessmentExportPreflightItem[],
  code: string,
): readonly string[] {
  return items.flatMap((item) =>
    item._tag === 'Blocked' && item.diagnosticCodes.includes(code) ? [item.itemId] : []
  );
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function qti3PackagesForTarget(
  target: SelectableAssessmentExportTarget,
): AssessmentExportFidelityReceipt['target']['qti3Packages'] {
  const transcoder = target.compilation._tag === 'CanonicalPackage'
    ? null
    : QTI3_PACKAGE_VERSIONS.transcoder;
  return {
    core: QTI3_PACKAGE_VERSIONS.core,
    writer: QTI3_PACKAGE_VERSIONS.writer,
    conformance: QTI3_PACKAGE_VERSIONS.conformance,
    transcoder,
  };
}

async function createPreflightId(identity: Uint8Array): Promise<AssessmentExportPreflightId> {
  const digest = await sha256Hex(identity);
  // SAFETY: sha256Hex establishes the 64-character lowercase hexadecimal invariant.
  return digest as AssessmentExportPreflightId;
}

async function createAcknowledgementToken(
  preflightId: AssessmentExportPreflightId,
  warningCodes: readonly string[],
): Promise<AssessmentExportAcknowledgementToken> {
  const digest = await sha256Hex(
    new TextEncoder().encode(`${preflightId}\n${warningCodes.join('\n')}`),
  );
  // SAFETY: sha256Hex establishes the 64-character lowercase hexadecimal invariant.
  return digest as AssessmentExportAcknowledgementToken;
}
