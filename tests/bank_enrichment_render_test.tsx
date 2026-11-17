import { expect, test as testCase } from 'vitest';

import { parseEnrichmentClassification } from '../lib/services/bank_enrichment_contract.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { BankEnrichmentExamples } from '../components/item_bank/BankEnrichmentExamples.tsx';
import { BankEnrichmentProgress } from '../components/item_bank/BankEnrichmentProgress.tsx';
import BankEnrichmentSetup from '../islands/BankEnrichmentSetup.tsx';
import BankEnrichmentBegin from '../islands/BankEnrichmentBegin.tsx';
import { CATALOGS } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { enrichmentDefinitionFixture } from './bank_enrichment_fixture.ts';
import { prepareEnrichmentQuestion } from '../lib/services/bank_enrichment_input.ts';
import { keepEnrichmentExample } from '../lib/bank_enrichment_editor.ts';
import type { EnrichmentPreviewResult } from '../lib/services/bank_enrichment_preview_codec.ts';
import type { EnrichmentJobView } from '../lib/services/bank_enrichment_job_read.ts';

testCase('localized setup keeps optional feedback separate from the full-bank action', () => {
  const questionId = crypto.randomUUID(), revisionId = crypto.randomUUID();
  const source = prepareEnrichmentQuestion(questionId, revisionId, {
    title: 'Question from an earlier sample',
    type: 'single_select',
    bodyHtml: '',
    promptHtml: '<p>Which structure?</p>',
    choices: [{ id: 'a', text: 'Nucleus <tag>' }, { id: 'b', text: 'Membrane' }],
    correctId: 'a',
  });
  if (!(source.ok)) expect.unreachable('Expected source.ok');
  const draft = keepEnrichmentExample(enrichmentDefinitionFixture(), {
    questionId,
    revisionId,
    classification: {
      subject: { state: 'assigned', valueIds: ['life'] },
      topic: { state: 'assigned', valueIds: ['cells'] },
      difficulty: { state: 'assigned', valueIds: ['hard'] },
    },
  });
  const result: EnrichmentPreviewResult = {
    definition: draft,
    examples: [],
    measuredQuestionCount: 20,
    measuredCostMicros: 1000,
    estimatedRunMicros: 390000,
    elapsedMs: 3000,
  };
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const payload = createI18nPayload(locale, CATALOGS[locale], ['items']);
    const i18n = createI18n(locale, CATALOGS[locale]);
    const setup = renderToString(
      <BankEnrichmentSetup
        affectedSelection={false}
        id={crypto.randomUUID()}
        initialDimensions={['subject', 'topic', 'difficulty']}
        previewOperationId={crypto.randomUUID()}
        result={result}
        questions={[source.value]}
        base={null}
        count={7787}
        capturedAt={new Date().toISOString()}
        budgetMicros={25000000}
        payload={payload}
      />,
    );
    expect(setup).toContain('role="tablist"');
    expect(setup).toContain(i18n.t('items.organize.tag'));
    expect(setup).toContain(i18n.t('items.organize.ready', { count: 7787 }));
    if (setup.includes('kimi')) expect.unreachable("Expected !setup.includes('kimi')");
    if (setup.includes('items.organize.')) {
      expect.unreachable("Expected !setup.includes('items.organize.')");
    }
    const examples = renderToString(
      <BankEnrichmentExamples
        draft={draft}
        result={result}
        questions={[source.value]}
        onChange={() => {}}
        i18n={i18n}
      />,
    );
    expect(examples).toContain(source.value.title);
    expect(examples).toContain('Nucleus &lt;tag>');
    expect(examples).toContain(i18n.t('items.organize.removeExample'));
    expect(examples).toContain('selected value="hard"');
    const topicTeaching = {
      ...draft,
      examples: draft.examples.map((e) => ({
        ...e,
        classification: { ...e.classification, difficulty: null },
      })),
    };
    const partial = renderToString(
      <BankEnrichmentExamples
        draft={topicTeaching}
        result={result}
        questions={[source.value]}
        onChange={() => {}}
        i18n={i18n}
      />,
    );
    expect(partial).toContain('selected value="__untaught"');
    expect(partial).toContain(i18n.t('items.organize.notTaught'));

    const newer = {
      ...source.value,
      revisionId: crypto.randomUUID(),
      title: 'New question version',
    };
    const refreshed = renderToString(
      <BankEnrichmentExamples
        draft={draft}
        result={{
          ...result,
          examples: [{
            questionId,
            revisionId: newer.revisionId,
            classification:
              parseEnrichmentClassification(draft.examples[0].classification, draft) ?? (() => {
                throw new Error('Invalid complete preview fixture');
              })(),
            rationale: 'fixture',
          }],
        }}
        questions={[source.value, newer]}
        onChange={() => {}}
        i18n={i18n}
      />,
    );
    expect(refreshed).toContain(source.value.title);
    expect(refreshed).toContain(newer.title);
    expect(refreshed).toContain(i18n.t('items.organize.exampleEarlier'));
    const begin = renderToString(
      <BankEnrichmentBegin
        operationId={crypto.randomUUID()}
        queryString=''
        schemes={[]}
        payload={payload}
      />,
    );
    expect(begin).toContain('required');
    expect(begin).toContain(i18n.t('items.organize.sample'));
  }
});
testCase('progress reports failures honestly and does not offer a futile budget retry', () => {
  const id = crypto.randomUUID();
  const job: EnrichmentJobView = {
    id,
    snapshotId: crypto.randomUUID(),
    scopeCount: 7787,
    capturedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    kind: 'classify',
    state: 'failed',
    schemeId: crypto.randomUUID(),
    errorCode: 'budget_exceeded',
    command: {
      snapshotId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      dimensions: ['subject', 'topic', 'difficulty'],
      replacement: 'preserve_manual',
    },
    progress: {
      total: 7787,
      completed: 7787,
      counts: {
        pending: 0,
        classified: 20,
        unassigned: 0,
        protected: 0,
        outdated: 0,
        failed: 7767,
        cancelled: 0,
      },
    },
    usage: {
      limitMicros: 25000000,
      chargedMicros: 0,
      reservedMicros: 0,
      attempts: 0,
      uncertain: 0,
      unsettled: 0,
    },
  };
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
    const i18n = createI18n(locale, CATALOGS[locale]);
    const props = {
      job,
      i18n,
      operationId: id,
      payload: createI18nPayload(locale, CATALOGS[locale], ['items']),
    };
    const html = renderToString(<BankEnrichmentProgress {...props} />);
    expect(html).toContain(i18n.t('items.organize.errorBudget'));
    expect(html).toContain(i18n.t('items.organize.outcome.failed'));
    expect(html.includes(i18n.t('items.organize.resume'))).toStrictEqual(false);
    const retry = renderToString(
      <BankEnrichmentProgress {...props} job={{ ...job, errorCode: 'workflow_stopped' }} />,
    );
    expect(retry).toContain(i18n.t('items.organize.resume'));
    if (retry.includes('workflow_stopped')) {
      expect.unreachable("Expected !retry.includes('workflow_stopped')");
    }
  }
});
