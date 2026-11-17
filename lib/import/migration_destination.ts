import { importedQuestionPlacements, type ImportResult, type ImportWarning } from './types.ts';
import type { SourcePurpose } from '../source_intake/registry.ts';
import { assessMigrationCommitBlueprintCoverage } from './migration_blueprint_coverage.ts';
import type { MigrationRunRecord } from './migration_types.ts';
import {
  type AssessmentBlueprint,
  type DefinedAssessmentBlueprint,
  parseAssessmentBlueprint,
  requireDefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';
import { parseUuid } from '../persistence_parse.ts';

/** The fixed destination of a conversion; bank intake has no assessment blueprint. */
export type WorkspaceBankDestination = {
  readonly _tag: 'WorkspaceBank';
  readonly collectionId: string | null;
};

/** Entry selection precedes assessment blueprint authoring. */
export type SourceIntakeDestination = WorkspaceBankDestination | { readonly _tag: 'Assessment' };

/** A reviewed run retains its assessment blueprint or bank filing destination. */
export type MigrationDestination =
  | WorkspaceBankDestination
  | { readonly _tag: 'Assessment'; readonly blueprint: AssessmentBlueprint };

/** Reconstruct destination policy from its constrained persistence columns. */
export function parseMigrationDestination(row: {
  readonly destination: string;
  readonly collectionId: string | null;
  readonly blueprint: unknown;
}): MigrationDestination {
  if (row.destination === 'WorkspaceBank' && row.blueprint === null) {
    return {
      _tag: 'WorkspaceBank',
      collectionId: row.collectionId === null
        ? null
        : parseUuid(row.collectionId, 'Invalid collection ID.'),
    };
  }
  if (row.destination === 'Assessment' && row.collectionId === null) {
    return { _tag: 'Assessment', blueprint: parseAssessmentBlueprint(row.blueprint) };
  }
  throw new Error('Invalid persisted conversion destination.');
}

export type MigrationCommittedDestination =
  | WorkspaceBankDestination
  | { readonly _tag: 'Assessment'; readonly assessmentId: string };

/** Resolve the committed resource without inventing an assessment for a bank import. */
export function migrationCommittedHref(destination: MigrationCommittedDestination): string {
  return destination._tag === 'Assessment'
    ? `/assessments/${destination.assessmentId}`
    : destination.collectionId === null
    ? '/items'
    : `/items?collection=${destination.collectionId}`;
}

/** A commit requires a defined assessment blueprint; bank commits have no blueprint. */
export type ReadyMigrationDestination = WorkspaceBankDestination | {
  readonly _tag: 'Assessment';
  readonly blueprint: DefinedAssessmentBlueprint;
};

/** Refine the destination before entering final persistence. */
export function requireReadyMigrationDestination(
  destination: MigrationDestination,
): ReadyMigrationDestination {
  return destination._tag === 'WorkspaceBank'
    ? destination
    : { _tag: 'Assessment', blueprint: requireDefinedAssessmentBlueprint(destination.blueprint) };
}

/** One purpose policy shared by entry parsing, HTTP intake and durable enqueue. */
export function migrationPurposeError(
  destination: SourceIntakeDestination,
  purpose: SourcePurpose,
): string | null {
  return destination._tag === 'WorkspaceBank' && purpose !== 'recover_existing'
    ? 'Bank imports recover existing questions.'
    : null;
}

/** Surface context which cannot survive the destination's structural boundary. */
export function migrationDestinationWarnings(
  destination: SourceIntakeDestination,
  parsed: ImportResult,
): ImportWarning[] {
  if (destination._tag === 'Assessment') return [];
  return parsed.parts.flatMap((part) => {
    if (
      !part.options?.instructionsHtml && !part.options?.feedback?.length &&
      !part.placements.some((placement) => 'content' in placement)
    ) return [];
    const questions = importedQuestionPlacements(part.placements);
    const message =
      'Assessment-level instructions or feedback cannot be preserved on a standalone bank question.';
    return questions.length
      ? questions.map((placement) => ({
        code: 'BANK_PART_CONTEXT_UNSUPPORTED',
        path: placement.href,
        message,
      }))
      : [{ code: 'BANK_PART_CONTEXT_UNSUPPORTED', message }];
  });
}

/** Validate the destination-specific coverage after shared item reconciliation succeeds. */
export function assertMigrationDestinationCoverage(
  destination: MigrationDestination,
  items: MigrationRunRecord['items'],
  approvedIds: ReadonlySet<string>,
): void {
  const ready = requireReadyMigrationDestination(destination);
  if (ready._tag === 'WorkspaceBank') return;
  const coverage = assessMigrationCommitBlueprintCoverage(ready.blueprint, items, approvedIds);
  if (!coverage.complete) {
    const targetMismatches = coverage.targets.filter((target) =>
      target.remaining > 0 || target.excess > 0
    )
      .map((target) => `${target.id}: ${target.actual}/${target.count}`).join('; ');
    throw new Error(
      `Selected questions do not match the blueprint. ${coverage.unassigned} unassigned; ${coverage.unknownTarget} use removed targets; ${coverage.incompatibleQuestionType} use an incompatible question type; target counts: ${
        targetMismatches || 'matched'
      }.`,
    );
  }
}
