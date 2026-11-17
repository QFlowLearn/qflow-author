import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import {
  type ClefOrganizationConfig,
  parseClefOrganizationConfig,
} from '../ai/clef_organization_provider.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { EnrichmentDefinition } from './bank_enrichment_contract.ts';

/** A saved collection policy; source-only processing never attempts model inference. */
export type OrganizationSetup = {
  readonly versionId: string;
  readonly classifier: { readonly kind: 'source_only' } | {
    readonly kind: 'clef';
    readonly config: ClefOrganizationConfig;
  };
  readonly filing: readonly { readonly topicId: string; readonly collectionId: string }[];
  readonly sourceMappings: readonly {
    readonly sourceId: string;
    readonly sectionKey: string;
    readonly topicId: string;
  }[];
};
/** The lineage and section come from accepted import provenance, never an inferred filename. */
export type OrganizationSource = { readonly sourceId: string; readonly sectionKey: string };
export type OrganizationFailure =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'storage_failed'
  | 'active_run';

/** Parse the whole policy against the exact saved vocabulary. */
export function parseOrganizationSetup(
  value: unknown,
  definition: EnrichmentDefinition,
): OrganizationSetup | null {
  if (
    !isEnrichmentRecord(value) ||
    Object.keys(value).sort().join(',') !== 'classifier,filing,sourceMappings,versionId' ||
    typeof value.versionId !== 'string' || !isCanonicalUuid(value.versionId) ||
    !isEnrichmentRecord(value.classifier) || !Array.isArray(value.filing) ||
    value.filing.length > 250 || !Array.isArray(value.sourceMappings) ||
    value.sourceMappings.length > 1000
  ) return null;
  let classifier: OrganizationSetup['classifier'];
  if (
    value.classifier.kind === 'source_only' && Object.keys(value.classifier).join(',') === 'kind'
  ) {
    classifier = { kind: 'source_only' };
  } else if (
    value.classifier.kind === 'clef' &&
    Object.keys(value.classifier).sort().join(',') === 'config,kind'
  ) {
    const config = parseClefOrganizationConfig(value.classifier.config);
    if (!config) return null;
    classifier = { kind: 'clef', config };
  } else return null;
  const topic = (id: unknown): id is string =>
    typeof id === 'string' && definition.topics.some((t) => t.id === id);
  const filing: OrganizationSetup['filing'][number][] = [];
  for (const entry of value.filing) {
    if (
      !isEnrichmentRecord(entry) ||
      Object.keys(entry).sort().join(',') !== 'collectionId,topicId' ||
      !topic(entry.topicId) || typeof entry.collectionId !== 'string' ||
      !isCanonicalUuid(entry.collectionId)
    ) return null;
    filing.push({ topicId: entry.topicId, collectionId: entry.collectionId });
  }
  if (new Set(filing.map((entry) => entry.topicId)).size !== filing.length) return null;
  const sourceMappings: OrganizationSetup['sourceMappings'][number][] = [];
  for (const entry of value.sourceMappings) {
    if (
      !isEnrichmentRecord(entry) ||
      Object.keys(entry).sort().join(',') !== 'sectionKey,sourceId,topicId' ||
      !topic(entry.topicId) || typeof entry.sourceId !== 'string' ||
      !isCanonicalUuid(entry.sourceId) ||
      typeof entry.sectionKey !== 'string' || !entry.sectionKey.trim() ||
      entry.sectionKey.length > 256
    ) return null;
    sourceMappings.push({
      sourceId: entry.sourceId,
      sectionKey: entry.sectionKey,
      topicId: entry.topicId,
    });
  }
  if (
    new Set(sourceMappings.map((entry) => JSON.stringify([entry.sourceId, entry.sectionKey])))
      .size !== sourceMappings.length
  ) return null;
  return { versionId: value.versionId, classifier, filing, sourceMappings };
}

/** Stored source identity cannot be partially present. */
export function parseOrganizationSource(value: unknown): OrganizationSource | null {
  return isEnrichmentRecord(value) &&
      Object.keys(value).sort().join(',') === 'sectionKey,sourceId' &&
      typeof value.sourceId === 'string' && isCanonicalUuid(value.sourceId) &&
      typeof value.sectionKey === 'string' && value.sectionKey.trim().length > 0 &&
      value.sectionKey.length <= 256
    ? { sourceId: value.sourceId, sectionKey: value.sectionKey }
    : null;
}
