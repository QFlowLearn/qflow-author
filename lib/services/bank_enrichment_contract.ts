import { isCanonicalUuid } from '../uuid.ts';

/** The first release has exactly three independently correctable dimensions. */
export const ENRICHMENT_DIMENSIONS = ['subject', 'topic', 'difficulty'] as const;
/** An instructor-defined classification dimension. */
export type EnrichmentDimension = typeof ENRICHMENT_DIMENSIONS[number];
/** Stable vocabulary identity; labels may change in later scheme versions. */
export type EnrichmentCategory = {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
};
/** A topic belongs to exactly one subject within its scheme version. */
export type EnrichmentTopic = EnrichmentCategory & { readonly subjectId: string };
/** Absence is explicit; an empty assigned value is never a classification. */
export type EnrichmentValue =
  | { readonly state: 'assigned'; readonly valueIds: readonly string[] }
  | {
    readonly state: 'unassigned';
    readonly reason: 'outside_scheme' | 'insufficient_context' | 'unsupported_content';
  };
/** One question's classification, independent of its immutable source content. */
export type EnrichmentClassification = Readonly<Record<EnrichmentDimension, EnrichmentValue>>;
/** Null means this example does not teach that dimension. */
export type EnrichmentExampleClassification = Readonly<
  Record<EnrichmentDimension, EnrichmentValue | null>
>;
/** Complete versioned instructions used for preview and full classification. */
export type EnrichmentDefinition = {
  readonly name: string;
  readonly audience: string;
  readonly instructions: string;
  readonly subjects: readonly EnrichmentCategory[];
  readonly topics: readonly EnrichmentTopic[];
  /** Array order is the difficulty order, from easiest to hardest. */
  readonly difficulty: readonly EnrichmentCategory[];
  /** Removed identities map explicitly to a current value or to unassigned. */
  readonly replacements: readonly {
    readonly dimension: EnrichmentDimension;
    readonly fromId: string;
    readonly toId: string | null;
  }[];
  readonly examples: readonly {
    readonly questionId: string;
    readonly revisionId: string;
    readonly classification: EnrichmentExampleClassification;
  }[];
};
/** Tenant-scoped, immutable persisted scheme revision. */
export type EnrichmentSchemeVersion = {
  readonly id: string;
  readonly schemeId: string;
  readonly version: number;
  readonly definition: EnrichmentDefinition;
};
/** Existing project result convention, with errors narrowed at each service interface. */
export type EnrichmentResult<T, E extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: E };

/** Parse the entire vocabulary, audience, hierarchy and examples at the boundary. */
export function parseEnrichmentDefinition(input: unknown): EnrichmentDefinition | null {
  if (
    !record(input) ||
    !exact(input, [
      'name',
      'audience',
      'instructions',
      'subjects',
      'topics',
      'difficulty',
      'examples',
      'replacements',
    ]) ||
    !text(input.name, 160, true) || !text(input.audience, 1000, true) ||
    !text(input.instructions, 4000) || !Array.isArray(input.subjects) ||
    !Array.isArray(input.topics) || !Array.isArray(input.difficulty) ||
    !Array.isArray(input.examples) || input.examples.length > 20 ||
    !Array.isArray(input.replacements) || input.replacements.length > 310
  ) return null;
  const subjects = categories(input.subjects, 1, 50);
  const difficulty = categories(input.difficulty, 0, 10);
  if (
    !subjects || !difficulty || difficulty.length === 1 || input.topics.length < 1 ||
    input.topics.length > 250
  ) return null;
  const topics: EnrichmentTopic[] = [];
  for (const value of input.topics) {
    if (!record(value) || !exact(value, ['id', 'label', 'definition', 'subjectId'])) return null;
    const category = parseCategory({
      id: value.id,
      label: value.label,
      definition: value.definition,
    });
    if (!category || typeof value.subjectId !== 'string') return null;
    if (!subjects.some((subject) => subject.id === value.subjectId)) return null;
    topics.push({ ...category, subjectId: value.subjectId });
  }
  if (!uniqueCategories(topics)) return null;
  const definition: EnrichmentDefinition = {
    name: input.name.trim(),
    audience: input.audience.trim(),
    instructions: input.instructions.trim(),
    subjects,
    topics,
    difficulty,
    replacements: [],
    examples: [],
  };
  const replacements: EnrichmentDefinition['replacements'][number][] = [];
  for (const replacement of input.replacements) {
    if (!record(replacement) || !exact(replacement, ['dimension', 'fromId', 'toId'])) return null;
    const dimension = replacement.dimension;
    if (dimension !== 'subject' && dimension !== 'topic' && dimension !== 'difficulty') return null;
    if (
      typeof replacement.fromId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(replacement.fromId)
    ) return null;
    const vocabulary = enrichmentVocabulary(definition, dimension);
    if (vocabulary.some((category) => category.id === replacement.fromId)) return null;
    if (
      replacement.toId !== null &&
      (typeof replacement.toId !== 'string' ||
        !vocabulary.some((category) => category.id === replacement.toId))
    ) return null;
    replacements.push({ dimension, fromId: replacement.fromId, toId: replacement.toId });
  }
  if (new Set(replacements.map((r) => `${r.dimension}:${r.fromId}`)).size !== replacements.length) {
    return null;
  }
  const examples: EnrichmentDefinition['examples'][number][] = [];
  for (const value of input.examples) {
    if (!record(value) || !exact(value, ['questionId', 'revisionId', 'classification'])) {
      return null;
    }
    if (typeof value.questionId !== 'string' || !isCanonicalUuid(value.questionId)) return null;
    if (typeof value.revisionId !== 'string' || !isCanonicalUuid(value.revisionId)) return null;
    const classification = parseEnrichmentExampleClassification(value.classification, definition);
    if (!classification) return null;
    examples.push({ questionId: value.questionId, revisionId: value.revisionId, classification });
  }
  if (new Set(examples.map((example) => example.questionId)).size !== examples.length) return null;
  return { ...definition, examples, replacements };
}

/** Return the vocabulary owned by a dimension in this exact scheme version. */
export function enrichmentVocabulary(
  definition: EnrichmentDefinition,
  dimension: EnrichmentDimension,
): readonly EnrichmentCategory[] {
  switch (dimension) {
    case 'subject':
      return definition.subjects;
    case 'topic':
      return definition.topics;
    case 'difficulty':
      return definition.difficulty;
  }
}

/** Scheme edits must account for every removed ID, without inventing historical identities. */
export function validEnrichmentReplacementMap(
  previous: EnrichmentDefinition | null,
  next: EnrichmentDefinition,
): boolean {
  if (!previous) return next.replacements.length === 0;
  const removed = ENRICHMENT_DIMENSIONS.flatMap((dimension) => {
    const active = new Set(enrichmentVocabulary(next, dimension).map((category) => category.id));
    return enrichmentVocabulary(previous, dimension).filter((category) => !active.has(category.id))
      .map((category) => `${dimension}:${category.id}`);
  });
  return removed.length === next.replacements.length &&
    next.replacements.every((r) => removed.includes(`${r.dimension}:${r.fromId}`));
}

/** Parse provider, correction or stored output against the exact producing scheme. */
export function parseEnrichmentClassification(
  input: unknown,
  definition: EnrichmentDefinition,
): EnrichmentClassification | null {
  if (!record(input) || !exact(input, ENRICHMENT_DIMENSIONS)) return null;
  const subject = parseEnrichmentValue(input.subject, 'subject', definition);
  const topic = parseEnrichmentValue(input.topic, 'topic', definition);
  const difficulty = parseEnrichmentValue(input.difficulty, 'difficulty', definition);
  if (!subject || !topic || !difficulty) return null;
  if (topic.state === 'assigned') {
    if (subject.state !== 'assigned') return null;
    const subjectId = subject.valueIds[0];
    if (
      topic.valueIds.some((id) =>
        !definition.topics.some((t) => t.id === id && t.subjectId === subjectId)
      )
    ) {
      return null;
    }
  }
  return { subject, topic, difficulty };
}

/** Parse only explicitly taught dimensions, retaining a topic's required subject relationship. */
export function parseEnrichmentExampleClassification(
  input: unknown,
  definition: EnrichmentDefinition,
): EnrichmentExampleClassification | null {
  if (!record(input) || !exact(input, ENRICHMENT_DIMENSIONS)) return null;
  const parsed: Record<EnrichmentDimension, EnrichmentValue | null> = {
    subject: null,
    topic: null,
    difficulty: null,
  };
  for (const dimension of ENRICHMENT_DIMENSIONS) {
    if (input[dimension] === null) continue;
    const value = parseEnrichmentValue(input[dimension], dimension, definition);
    if (!value) return null;
    parsed[dimension] = value;
  }
  if (ENRICHMENT_DIMENSIONS.every((dimension) => parsed[dimension] === null)) return null;
  const subject = parsed.subject, topic = parsed.topic;
  if (
    topic?.state === 'assigned' && (subject?.state !== 'assigned' ||
      topic.valueIds.some((id) =>
        !definition.topics.some((t) => t.id === id && t.subjectId === subject.valueIds[0])
      ))
  ) return null;
  return parsed;
}

/** Parse a dimension value; callers validating a whole question also check its hierarchy. */
export function parseEnrichmentValue(
  input: unknown,
  dimension: EnrichmentDimension,
  definition: EnrichmentDefinition,
): EnrichmentValue | null {
  return parseEnrichmentVocabularyValue(
    input,
    dimension,
    enrichmentVocabulary(definition, dimension),
  );
}

/** Validate projected browse values with the same rules as full producing definitions. */
export function parseEnrichmentVocabularyValue(
  input: unknown,
  dimension: EnrichmentDimension,
  vocabulary: readonly { readonly id: string }[],
): EnrichmentValue | null {
  if (!record(input)) return null;
  if (input.state === 'unassigned') {
    if (!exact(input, ['state', 'reason'])) return null;
    switch (input.reason) {
      case 'outside_scheme':
      case 'insufficient_context':
      case 'unsupported_content':
        return { state: 'unassigned', reason: input.reason };
      default:
        return null;
    }
  }
  if (input.state !== 'assigned' || !exact(input, ['state', 'valueIds'])) return null;
  if (!Array.isArray(input.valueIds) || input.valueIds.length < 1) return null;
  if (input.valueIds.length > (dimension === 'topic' ? 3 : 1)) return null;
  const ids: string[] = [];
  for (const id of input.valueIds) {
    if (typeof id !== 'string' || !vocabulary.some((category) => category.id === id)) return null;
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) return null;
  return { state: 'assigned', valueIds: ids.sort() };
}

function categories(
  input: readonly unknown[],
  min: number,
  max: number,
): EnrichmentCategory[] | null {
  if (input.length < min || input.length > max) return null;
  const values: EnrichmentCategory[] = [];
  for (const value of input) {
    const parsed = parseCategory(value);
    if (!parsed) return null;
    values.push(parsed);
  }
  return uniqueCategories(values) ? values : null;
}

function parseCategory(input: unknown): EnrichmentCategory | null {
  if (!record(input) || !exact(input, ['id', 'label', 'definition'])) return null;
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(input.id)) return null;
  if (!text(input.label, 80, true) || !text(input.definition, 1000, true)) return null;
  return { id: input.id, label: input.label.trim(), definition: input.definition.trim() };
}

function uniqueCategories(values: readonly EnrichmentCategory[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length &&
    new Set(values.map((value) => value.label.toLowerCase())).size === values.length;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}
