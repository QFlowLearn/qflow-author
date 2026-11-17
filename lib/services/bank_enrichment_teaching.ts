import { clefTeachingExamplesFit } from '../ai/clef_organization_provider.ts';
import { loadEnrichmentSources } from './bank_enrichment_sources.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { QflowDatabaseTransaction } from '../db.ts';
import {
  enrichmentAssignments,
  enrichmentChanges,
  enrichmentSchemeVersions,
} from '../db/bank_enrichment_schema.ts';
import { enrichmentRuns } from '../db/bank_enrichment_job_schema.ts';
import { questionRevisions, questions } from '../db/question_schema.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { uuidV5 } from '../uuid_v5.ts';
import {
  type EnrichmentDefinition,
  parseEnrichmentDefinition,
} from './bank_enrichment_contract.ts';
import {
  type EnrichmentCurrentChanges,
  loadCurrentEnrichmentChanges,
} from './bank_enrichment_changes.ts';
import { prepareEnrichmentQuestion } from './bank_enrichment_input.ts';
import { advanceOrganizationTeaching } from './question_organization_teaching.ts';

/** Complete a correction/undo with at most 20 taught topics, inside its authorized transaction. */
export async function saveCorrectionTeaching(
  tx: QflowDatabaseTransaction,
  run: typeof enrichmentRuns.$inferSelect,
  sourceDefinition: EnrichmentDefinition,
  now: Date,
): Promise<void> {
  const [latest] = await tx.select().from(enrichmentSchemeVersions).where(and(
    eq(enrichmentSchemeVersions.tenantId, run.tenantId),
    eq(enrichmentSchemeVersions.schemeId, run.schemeId),
  )).orderBy(desc(enrichmentSchemeVersions.version)).limit(1);
  const definition = latest && parseEnrichmentDefinition(latest.definition);
  if (!definition) throw new Error('Teaching vocabulary is missing.');
  // Never overwrite a newer audience, taxonomy or instruction edit with an older correction.
  const vocabulary = (value: EnrichmentDefinition) =>
    canonicalJsonStringify({ ...value, examples: [], replacements: [] });
  if (vocabulary(definition) !== vocabulary(sourceDefinition)) return;
  const candidates = run.kind === 'correct'
    ? await tx.select({
      questionId: enrichmentChanges.questionId,
      revisionId: enrichmentChanges.revisionId,
      body: questionRevisions.body,
    }).from(enrichmentChanges)
      .innerJoin(enrichmentAssignments, eq(enrichmentAssignments.changeId, enrichmentChanges.id))
      .innerJoin(
        questions,
        and(
          eq(questions.id, enrichmentChanges.questionId),
          eq(questions.latestRevisionId, enrichmentChanges.revisionId),
        ),
      )
      .innerJoin(questionRevisions, eq(questionRevisions.id, enrichmentChanges.revisionId))
      .where(and(
        eq(enrichmentChanges.tenantId, run.tenantId),
        eq(enrichmentChanges.schemeId, run.schemeId),
        eq(enrichmentChanges.operationId, run.id),
        eq(enrichmentChanges.dimension, 'topic'),
        eq(enrichmentChanges.origin, 'human'),
        eq(questions.lifecycleState, 'active'),
        sql`${enrichmentChanges.value}->>'state' = 'assigned'`,
        sql`${questionRevisions.body}->>'type' = 'single_select'`,
      )).orderBy(enrichmentChanges.questionId).limit(20)
    : [];
  const ids = [
    ...new Set([
      ...definition.examples.map((e) => e.questionId),
      ...candidates.map((c) => c.questionId),
    ]),
  ];
  if (!ids.length) return;
  const current = new Map<string, EnrichmentCurrentChanges>();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const batch = await loadCurrentEnrichmentChanges(
      tx,
      run.tenantId,
      run.schemeId,
      ids.slice(offset, offset + 20),
    );
    for (const [id, values] of batch) current.set(id, values);
  }
  const additions: EnrichmentDefinition['examples'][number][] = [];
  for (const candidate of candidates) {
    const topic = current.get(candidate.questionId)?.topic;
    if (
      topic?.operationId !== run.id || topic.value?.state !== 'assigned' ||
      topic.value.valueIds.length !== 1
    ) continue;
    if (!prepareEnrichmentQuestion(candidate.questionId, candidate.revisionId, candidate.body).ok) {
      continue;
    }
    const topicId = topic.value.valueIds[0];
    const category = definition.topics.find((t) => t.id === topicId);
    if (!category) throw new Error('Teaching topic is missing.');
    additions.push({
      questionId: candidate.questionId,
      revisionId: candidate.revisionId,
      classification: {
        subject: { state: 'assigned', valueIds: [category.subjectId] },
        topic: topic.value,
        difficulty: null,
      },
    });
  }
  // A clear or successful undo removes that question's example. Later human edits retain theirs.
  const retained = definition.examples.filter((e) =>
    current.get(e.questionId)?.topic?.operationId !== run.id
  );
  const proposed = [...additions, ...retained];
  const sources = new Map<string, EnrichmentQuestion>();
  for (let offset = 0; offset < proposed.length; offset += 20) {
    for (
      const source of await loadEnrichmentSources(
        tx,
        run.tenantId,
        proposed.slice(offset, offset + 20),
      )
    ) {
      if (source.content.ok) sources.set(source.revisionId, source.content.value);
    }
  }
  const examples: EnrichmentDefinition['examples'][number][] = [];
  const teaching: { question: EnrichmentQuestion; topicId: string }[] = [];
  for (const example of proposed) {
    if (examples.length === 20) break;
    const topic = example.classification.topic;
    if (topic?.state === 'assigned' && topic.valueIds.length === 1) {
      const question = sources.get(example.revisionId);
      if (!question) continue;
      const nextTeaching = [...teaching, { question, topicId: topic.valueIds[0] }];
      if (!clefTeachingExamplesFit(definition, nextTeaching)) continue;
      teaching.push({ question, topicId: topic.valueIds[0] });
    }
    examples.push(example);
  }
  if (canonicalJsonStringify(examples) === canonicalJsonStringify(definition.examples)) return;
  const next = parseEnrichmentDefinition({ ...definition, examples, replacements: [] });
  if (!next) throw new Error('Invalid correction teaching definition.');
  const id = await uuidV5(run.id, 'correction-teaching');
  await tx.insert(enrichmentSchemeVersions).values({
    id,
    tenantId: run.tenantId,
    schemeId: run.schemeId,
    version: latest.version + 1,
    definition: next,
    createdBy: run.createdBy,
    createdAt: now,
  });
  await advanceOrganizationTeaching(tx, run, latest.id, id, next, now);
}
