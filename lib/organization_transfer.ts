import { canonicalJsonStringify } from './canonical_json.ts';
import { isCanonicalUuid } from './uuid.ts';
import {
  type EnrichmentDefinition,
  type EnrichmentDimension,
  type EnrichmentValue,
  parseEnrichmentDefinition,
  parseEnrichmentValue,
} from './services/bank_enrichment_contract.ts';

/** Portable vocabulary identities are unrelated to workspace-local database IDs. */
export type OrganizationVocabulary = {
  readonly schemeId: string;
  readonly versionId: string;
  readonly definition: EnrichmentDefinition;
};
export type OrganizationAssignment = {
  readonly schemeId: string;
  readonly versionId: string;
  readonly dimension: EnrichmentDimension;
  readonly value: EnrichmentValue;
};
/** Accepted source metadata, consumed into the classification ledger at import commit. */
export type OrganizationTransfer = {
  readonly schema: 'qflow.organization.v1';
  readonly vocabularies: readonly OrganizationVocabulary[];
  readonly assignments: readonly OrganizationAssignment[];
};
export type OrganizationByItem = Readonly<Record<string, OrganizationTransfer>>;
export const ORGANIZATION_NAMESPACE = 'https://qflowlearn.com/ns/organization/v1';

/** Export taxonomy and audience, excluding private example references and classifier prompts. */
export function portableDefinition(definition: EnrichmentDefinition): EnrichmentDefinition {
  return { ...definition, instructions: '', examples: [], replacements: [] };
}

/** Parse a bounded transfer; reject dangling identities, duplicates and contradictory hierarchy. */
export function parseOrganizationTransfer(value: unknown): OrganizationTransfer {
  if (
    !record(value) || !exact(value, ['schema', 'vocabularies', 'assignments']) ||
    value.schema !== 'qflow.organization.v1' || !Array.isArray(value.vocabularies) ||
    value.vocabularies.length > 16 || !Array.isArray(value.assignments) ||
    value.assignments.length > 48 || canonicalJsonStringify(value).length > 262144
  ) fail();
  const vocabularies: OrganizationVocabulary[] = [];
  for (const raw of value.vocabularies) {
    if (
      !record(raw) || !exact(raw, ['schemeId', 'versionId', 'definition']) ||
      typeof raw.schemeId !== 'string' || !isCanonicalUuid(raw.schemeId) ||
      typeof raw.versionId !== 'string' || !isCanonicalUuid(raw.versionId)
    ) fail();
    const definition = parseEnrichmentDefinition(raw.definition);
    if (
      !definition || definition.instructions || definition.examples.length ||
      definition.replacements.length ||
      vocabularies.some((v) => v.versionId === raw.versionId)
    ) fail();
    vocabularies.push({ schemeId: raw.schemeId, versionId: raw.versionId, definition });
  }
  const assignments: OrganizationAssignment[] = [];
  for (const raw of value.assignments) {
    if (!record(raw) || !exact(raw, ['schemeId', 'versionId', 'dimension', 'value'])) fail();
    const vocabulary = vocabularies.find((v) =>
      v.versionId === raw.versionId && v.schemeId === raw.schemeId
    );
    const dimension = raw.dimension;
    if (
      !vocabulary ||
      (dimension !== 'subject' && dimension !== 'topic' && dimension !== 'difficulty') ||
      assignments.some((a) => a.schemeId === raw.schemeId && a.dimension === dimension)
    ) fail();
    const parsed = parseEnrichmentValue(raw.value, dimension, vocabulary.definition);
    if (!parsed) fail();
    assignments.push({
      schemeId: vocabulary.schemeId,
      versionId: vocabulary.versionId,
      dimension,
      value: parsed,
    });
  }
  for (const assignment of assignments) {
    if (assignment.dimension !== 'topic' || assignment.value.state !== 'assigned') continue;
    const subject = assignments.find((a) =>
      a.schemeId === assignment.schemeId && a.dimension === 'subject'
    );
    const vocabulary = vocabularies.find((v) => v.versionId === assignment.versionId);
    if (!vocabulary) fail();
    const definition = vocabulary.definition;
    if (!subject || subject.value.state !== 'assigned') fail();
    const subjectId = subject.value.valueIds[0];
    if (
      assignment.value.valueIds.some((id) =>
        !definition.topics.some((t) => t.id === id && t.subjectId === subjectId)
      )
    ) fail();
  }
  if (vocabularies.some((v) => !assignments.some((a) => a.versionId === v.versionId))) fail();
  return { schema: 'qflow.organization.v1', vocabularies, assignments };
}
function fail(): never {
  throw new Error('Invalid portable question organization.');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
