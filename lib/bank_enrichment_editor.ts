import {
  ENRICHMENT_DIMENSIONS,
  type EnrichmentDefinition,
  type EnrichmentDimension,
  type EnrichmentValue,
  enrichmentVocabulary,
  parseEnrichmentExampleClassification,
} from './services/bank_enrichment_contract.ts';

/** Form text may be incomplete while typing; parseEnrichmentDefinition is required on submission. */
export type EnrichmentEditorDraft = EnrichmentDefinition;
const fields = { subject: 'subjects', topic: 'topics', difficulty: 'difficulty' } as const;
const unassigned: EnrichmentValue = { state: 'unassigned', reason: 'outside_scheme' };

/** Moving a topic preserves each example's primary subject and removes incompatible topic values. */
export function regroupEnrichmentTopic(
  draft: EnrichmentEditorDraft,
  topicId: string,
  subjectId: string,
): EnrichmentEditorDraft {
  if (!draft.subjects.some((s) => s.id === subjectId)) return draft;
  const topics = draft.topics.map((t) => t.id === topicId ? { ...t, subjectId } : t);
  return {
    ...draft,
    topics,
    examples: draft.examples.map((example) => {
      const { subject, topic } = example.classification;
      if (topic?.state !== 'assigned') return example;
      const valueIds = topic.valueIds.filter((id) =>
        subject?.state === 'assigned' &&
        topics.some((t) => t.id === id && t.subjectId === subject.valueIds[0])
      );
      return {
        ...example,
        classification: {
          ...example.classification,
          topic: valueIds.length ? { state: 'assigned', valueIds } : unassigned,
        },
      };
    }),
  };
}

/** Sample results become instruction examples only on an explicit instructor action. */
export function keepEnrichmentExample(
  draft: EnrichmentEditorDraft,
  example: EnrichmentDefinition['examples'][number],
): EnrichmentEditorDraft {
  if (
    draft.examples.length >= 20 || draft.examples.some((e) => e.questionId === example.questionId)
  ) {
    return draft;
  }
  const classification = parseEnrichmentExampleClassification(example.classification, draft);
  return classification
    ? {
      ...draft,
      examples: [...draft.examples, {
        questionId: example.questionId,
        revisionId: example.revisionId,
        classification,
      }],
    }
    : draft;
}

/** Merge/removal updates example assignments and every affected replacement mapping together. */
export function removeEnrichmentCategory(
  draft: EnrichmentEditorDraft,
  dimension: EnrichmentDimension,
  fromId: string,
  toId: string | null,
): EnrichmentEditorDraft {
  if (fromId === toId || !enrichmentVocabulary(draft, dimension).some((c) => c.id === fromId)) {
    return draft;
  }
  if (toId !== null && !enrichmentVocabulary(draft, dimension).some((c) => c.id === toId)) {
    return draft;
  }
  if (
    dimension === 'topic' && toId !== null &&
    draft.topics.find((t) => t.id === fromId)?.subjectId !==
      draft.topics.find((t) => t.id === toId)?.subjectId
  ) return draft;
  let next = draft;
  if (dimension === 'subject' && toId === null) {
    for (const topic of draft.topics.filter((t) => t.subjectId === fromId)) {
      next = removeEnrichmentCategory(next, 'topic', topic.id, null);
    }
  }
  const remap = (value: EnrichmentValue | null): EnrichmentValue | null => {
    if (value?.state !== 'assigned') return value;
    const valueIds = [
      ...new Set(
        value.valueIds.flatMap((id) => id === fromId ? toId === null ? [] : [toId] : [id]),
      ),
    ];
    return valueIds.length ? { state: 'assigned', valueIds } : unassigned;
  };
  const examples = next.examples.map((example) => ({
    ...example,
    classification: {
      ...example.classification,
      [dimension]: remap(example.classification[dimension]),
    },
  }));
  const replacements = [
    ...next.replacements.map((r) =>
      r.dimension === dimension && r.toId === fromId ? { ...r, toId } : r
    ),
    { dimension, fromId, toId },
  ];
  if (dimension === 'subject') {
    return {
      ...next,
      subjects: next.subjects.filter((c) => c.id !== fromId),
      topics: next.topics.map((t) =>
        t.subjectId === fromId && toId !== null ? { ...t, subjectId: toId } : t
      ),
      examples,
      replacements,
    };
  }
  if (dimension === 'topic') {
    return {
      ...next,
      topics: next.topics.filter((c) => c.id !== fromId),
      examples,
      replacements,
    };
  }
  return {
    ...next,
    difficulty: next.difficulty.filter((c) => c.id !== fromId),
    examples,
    replacements,
  };
}

/** A saved version maps only identities removed from its actual predecessor. */
export function enrichmentDraftForSave(
  draft: EnrichmentEditorDraft,
  base: EnrichmentDefinition | null,
): EnrichmentDefinition {
  return {
    ...draft,
    replacements: base === null
      ? []
      : draft.replacements.filter((r) =>
        enrichmentVocabulary(base, r.dimension).some((c) => c.id === r.fromId)
      ),
  };
}

/** Keep example topics inside their chosen subject as the instructor adjusts examples. */
export function changeEnrichmentExample(
  draft: EnrichmentEditorDraft,
  questionId: string,
  dimension: EnrichmentDimension,
  valueIds: readonly string[] | null,
): EnrichmentEditorDraft {
  return {
    ...draft,
    examples: draft.examples.map((example) => {
      if (example.questionId !== questionId) return example;
      const value = valueIds === null
        ? null
        : valueIds.length
        ? { state: 'assigned' as const, valueIds }
        : unassigned;
      const classification = { ...example.classification, [dimension]: value };
      if (dimension === 'subject' && classification.topic?.state === 'assigned') {
        const topics = classification.topic.valueIds.filter((id) =>
          draft.topics.some((t) => t.id === id && t.subjectId === valueIds?.[0])
        );
        classification.topic = topics.length ? { state: 'assigned', valueIds: topics } : unassigned;
      }
      return { ...example, classification };
    }),
  };
}

/** Category edits preserve stable IDs, including when labels or definitions are temporarily empty. */
export function updateEnrichmentCategory(
  draft: EnrichmentEditorDraft,
  dimension: EnrichmentDimension,
  id: string,
  change: { readonly label?: string; readonly definition?: string },
): EnrichmentEditorDraft {
  const field = fields[dimension];
  return {
    ...draft,
    [field]: draft[field].map((category) =>
      category.id === id ? { ...category, ...change } : category
    ),
  };
}

/** Find the tab containing incomplete settings before native constraints can hide the problem. */
export function incompleteEnrichmentTab(
  draft: EnrichmentEditorDraft,
): 'vocabulary' | 'difficulty' | null {
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    const categories = enrichmentVocabulary(draft, dimension);
    if (
      categories.length < (dimension === 'difficulty' ? 2 : 1) ||
      categories.some((c) => !c.label.trim() || !c.definition.trim())
    ) return dimension === 'difficulty' ? 'difficulty' : 'vocabulary';
  }
  return null;
}
