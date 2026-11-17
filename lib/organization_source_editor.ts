import type { EnrichmentDefinition } from './services/bank_enrichment_contract.ts';
import type { OrganizationSetup } from './services/question_organization_contract.ts';

export type OrganizationSection = {
  readonly sourceId: string;
  readonly sectionKey: string;
  readonly title: string;
  readonly filename: string;
  readonly count: number;
};

/** An explicit author action seeds editable topics; equal titles never merge separate sources. */
export function proposeSectionTopics(input: {
  readonly definition: EnrichmentDefinition;
  readonly mappings: OrganizationSetup['sourceMappings'];
  readonly sections: readonly OrganizationSection[];
  readonly collectionName: string;
  readonly audience: string;
  readonly newId: () => string;
}): { definition: EnrichmentDefinition; mappings: OrganizationSetup['sourceMappings'] } | null {
  const sections = input.sections.filter((s) =>
    !input.mappings.some((m) => m.sourceId === s.sourceId && m.sectionKey === s.sectionKey)
  );
  const topics = input.definition.topics.filter((t) =>
    !(t.id === 'topic' && !t.label && !t.definition)
  );
  if (!sections.length || topics.length + sections.length > 250) return null;
  const subject = input.definition.subjects[0];
  if (!subject) return null;
  const labels = new Set(topics.map((t) => t.label.toLowerCase()));
  const added = sections.map((s) => {
    const base = s.title.trim();
    let label = base.slice(0, 80), suffix = 2;
    while (labels.has(label.toLowerCase())) {
      const ending = ` (${suffix++})`;
      label = base.slice(0, 80 - ending.length) + ending;
    }
    labels.add(label.toLowerCase());
    return {
      id: `source-${input.newId()}`,
      subjectId: subject.id,
      label,
      definition: base.slice(0, 1000),
    };
  });
  return {
    definition: {
      ...input.definition,
      name: input.definition.name || input.collectionName.slice(0, 160),
      audience: input.definition.audience || input.audience,
      subjects: input.definition.subjects.map((s, i) =>
        i === 0
          ? {
            ...s,
            label: s.label || input.collectionName.slice(0, 80),
            definition: s.definition || input.collectionName.slice(0, 1000),
          }
          : s
      ),
      topics: [...topics, ...added],
    },
    mappings: [
      ...input.mappings,
      ...sections.map((s, i) => ({
        sourceId: s.sourceId,
        sectionKey: s.sectionKey,
        topicId: added[i].id,
      })),
    ],
  };
}
