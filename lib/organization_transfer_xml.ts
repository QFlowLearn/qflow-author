import { canonicalJsonStringify } from './canonical_json.ts';
import {
  ORGANIZATION_NAMESPACE,
  type OrganizationByItem,
  type OrganizationTransfer,
  parseOrganizationTransfer,
} from './organization_transfer.ts';
import { enrichmentVocabulary } from './services/bank_enrichment_contract.ts';
import { xmlEscape } from './xml.ts';

/** One shared package catalog avoids repeating vocabulary definitions for every question. */
export function organizationCatalogXml(items: OrganizationByItem): string {
  const catalog = new Map<string, OrganizationTransfer['vocabularies'][number]>();
  for (const raw of Object.values(items)) {
    const transfer = parseOrganizationTransfer(raw);
    for (const vocabulary of transfer.vocabularies) {
      const prior = catalog.get(vocabulary.versionId);
      if (prior && canonicalJsonStringify(prior) !== canonicalJsonStringify(vocabulary)) {
        throw new Error('Conflicting organization export vocabulary.');
      }
      catalog.set(vocabulary.versionId, vocabulary);
    }
  }
  if (!catalog.size) return '';
  return `<lom:lom xmlns:lom="http://ltsc.ieee.org/xsd/LOM"><qflow:organization-catalog xmlns:qflow="${ORGANIZATION_NAMESPACE}">${
    xmlEscape(
      canonicalJsonStringify({
        schema: 'qflow.organization.v1',
        vocabularies: [...catalog.values()].sort((a, b) => a.versionId.localeCompare(b.versionId)),
      }),
    )
  }</qflow:organization-catalog></lom:lom>`;
}

/** LOM children: labeled taxonomies and the exact QFlow contract for audience identity and clears. */
export function organizationItemXml(transfer: OrganizationTransfer | undefined): string {
  if (!transfer) return '';
  const classifications = transfer.assignments.flatMap((assignment) => {
    if (assignment.value.state !== 'assigned') return [];
    const vocabulary = transfer.vocabularies.find((v) => v.versionId === assignment.versionId);
    if (!vocabulary) throw new Error('Missing organization export vocabulary.');
    const categories = enrichmentVocabulary(vocabulary.definition, assignment.dimension);
    return assignment.value.valueIds.map((id) => {
      const category = categories.find((c) => c.id === id);
      if (!category) throw new Error('Missing organization export category.');
      return `<lom:classification><lom:purpose><lom:source>QFlow</lom:source><lom:value>${assignment.dimension}</lom:value></lom:purpose><lom:taxonPath><lom:source><lom:string>urn:qflow:vocabulary:${assignment.schemeId}:${assignment.versionId}:${assignment.dimension}</lom:string></lom:source><lom:taxon><lom:id>${
        xmlEscape(id)
      }</lom:id><lom:entry><lom:string>${
        xmlEscape(category.label)
      }</lom:string></lom:entry></lom:taxon></lom:taxonPath></lom:classification>`;
    });
  }).join('');
  return `${classifications}<qflow:organization xmlns:qflow="${ORGANIZATION_NAMESPACE}">${
    xmlEscape(
      canonicalJsonStringify({ schema: transfer.schema, assignments: transfer.assignments }),
    )
  }</qflow:organization>`;
}
