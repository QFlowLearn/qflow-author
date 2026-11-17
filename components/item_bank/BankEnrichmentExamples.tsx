import Button from '../ui/Button.tsx';
import SafeHtml from '../ui/SafeHtml.tsx';
import Select from '../ui/Select.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import { BankField } from './ui.tsx';
import { EnrichmentSection } from './BankEnrichmentLayout.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import { sanitizeBodyHtml } from '../../lib/sanitize.ts';
import type { EnrichmentQuestion } from '../../lib/services/bank_enrichment_input.ts';
import {
  changeEnrichmentExample,
  type EnrichmentEditorDraft,
  keepEnrichmentExample,
} from '../../lib/bank_enrichment_editor.ts';

import {
  ENRICHMENT_DIMENSIONS,
  enrichmentVocabulary,
  parseEnrichmentExampleClassification,
} from '../../lib/services/bank_enrichment_contract.ts';
import type { EnrichmentPreviewResult } from '../../lib/services/bank_enrichment_preview_codec.ts';

/** Ten examples provide optional quick feedback; they never become a full-bank approval queue. */
export function BankEnrichmentExamples(
  props: {
    readonly result: EnrichmentPreviewResult;
    readonly draft: EnrichmentEditorDraft;
    readonly questions: readonly EnrichmentQuestion[];
    readonly onChange: (draft: EnrichmentEditorDraft) => void;
    readonly i18n: I18n;
  },
) {
  const { draft, i18n } = props;
  const displayed = [
    ...props.result.examples,
    ...draft.examples.filter((example) =>
      !props.result.examples.some((sample) => sample.revisionId === example.revisionId)
    ),
  ];
  return (
    <EnrichmentSection
      title={i18n.t('items.organize.examples')}
      description={i18n.t('items.organize.examplesHelp')}
    >
      <ol class='divide-y divide-base-300'>
        {displayed.map((displayedExample, index) => {
          const saved = draft.examples.find((e) => e.revisionId === displayedExample.revisionId);
          const measured = props.result.examples.find((e) =>
            e.revisionId === displayedExample.revisionId
          );
          const example = saved ?? displayedExample;
          const differentSavedRevision = !saved &&
            draft.examples.some((e) => e.questionId === example.questionId);
          const question = props.questions.find((q) =>
            q.questionId === example.questionId && q.revisionId === example.revisionId
          );
          if (!question) throw new Error('Missing pinned example content.');
          const subject = example.classification.subject?.state === 'assigned'
            ? example.classification.subject.valueIds[0]
            : '';
          const difficulty = example.classification.difficulty?.state === 'assigned'
            ? example.classification.difficulty.valueIds[0]
            : example.classification.difficulty === null
            ? '__untaught'
            : '';
          const topics = example.classification.topic?.state === 'assigned'
            ? example.classification.topic.valueIds
            : [];
          return (
            <li key={example.revisionId} class='py-4'>
              <details open={index === 0}>
                <summary class='cursor-pointer py-2 font-medium break-words'>
                  {question.title}
                </summary>
                <div class='space-y-4 pt-3'>
                  <SafeHtml
                    class='prose max-w-prose text-sm'
                    html={sanitizeBodyHtml(question.bodyHtml + question.promptHtml)}
                  />
                  <ol class='list-inside list-[upper-alpha] space-y-1 text-sm'>
                    {question.choices.map((choice) => (
                      <li key={choice.id}>
                        {choice.html.length > 0
                          ? <SafeHtml class='inline' html={sanitizeBodyHtml(choice.html)} />
                          : choice.text}{' '}
                        {choice.id === question.correctId && (
                          <strong>({i18n.t('items.organize.correctAnswer')})</strong>
                        )}
                      </li>
                    ))}
                  </ol>
                  {measured && (
                    <p class='text-sm text-base-content/80'>
                      {i18n.t('items.organize.lastPreview', {
                        values: ENRICHMENT_DIMENSIONS.map((dimension) => {
                          const value = measured.classification[dimension];
                          return value.state === 'assigned'
                            ? value.valueIds.map((id) => {
                              const category = enrichmentVocabulary(
                                props.result.definition,
                                dimension,
                              ).find((c) => c.id === id);
                              if (!category) {
                                throw new Error(
                                  'Preview category is missing from its producing vocabulary.',
                                );
                              }
                              return category.label;
                            }).join(', ')
                            : i18n.t('items.organize.unassigned');
                        }).join(' · '),
                      })}
                    </p>
                  )}
                  {saved
                    ? (
                      <>
                        <div class='grid gap-4 sm:grid-cols-2'>
                          <BankField label={i18n.t('items.organize.subject')}>
                            <Select
                              value={subject}
                              name={`example-subject-${question.questionId}`}
                              onChange={(event) =>
                                props.onChange(
                                  changeEnrichmentExample(
                                    draft,
                                    question.questionId,
                                    'subject',
                                    event.currentTarget.value ? [event.currentTarget.value] : [],
                                  ),
                                )}
                            >
                              <option value=''>{i18n.t('items.organize.unassigned')}</option>
                              {draft.subjects.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                              ))}
                            </Select>
                          </BankField>
                          <BankField label={i18n.t('items.organize.difficulty')}>
                            <Select
                              value={difficulty}
                              name={`example-difficulty-${question.questionId}`}
                              onChange={(event) =>
                                props.onChange(
                                  changeEnrichmentExample(
                                    draft,
                                    question.questionId,
                                    'difficulty',
                                    event.currentTarget.value === '__untaught'
                                      ? null
                                      : event.currentTarget.value
                                      ? [event.currentTarget.value]
                                      : [],
                                  ),
                                )}
                            >
                              <option value=''>{i18n.t('items.organize.unassigned')}</option>
                              <option value='__untaught'>
                                {i18n.t('items.organize.notTaught')}
                              </option>
                              {draft.difficulty.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                              ))}
                            </Select>
                          </BankField>
                        </div>
                        <fieldset class='space-y-2'>
                          <legend class='text-sm font-medium'>
                            {i18n.t('items.organize.exampleTopics')}
                          </legend>
                          <div class='flex flex-wrap gap-4'>
                            {draft.topics.filter((t) => t.subjectId === subject).map((topic) => (
                              <label
                                key={topic.id}
                                class='inline-flex min-h-11 items-center gap-2 text-sm'
                              >
                                <Checkbox
                                  checked={topics.includes(topic.id)}
                                  disabled={!topics.includes(topic.id) && topics.length >= 3}
                                  onChange={(event) =>
                                    props.onChange(
                                      changeEnrichmentExample(
                                        draft,
                                        question.questionId,
                                        'topic',
                                        event.currentTarget.checked
                                          ? [...topics, topic.id]
                                          : topics.filter((id) => id !== topic.id),
                                      ),
                                    )}
                                />
                                {topic.label}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            props.onChange({
                              ...draft,
                              examples: draft.examples.filter((e) =>
                                e.questionId !== example.questionId
                              ),
                            })}
                        >
                          {i18n.t('items.organize.removeExample')}
                        </Button>
                      </>
                    )
                    : (
                      <div class='space-y-2'>
                        <Button
                          type='button'
                          size='sm'
                          disabled={differentSavedRevision || draft.examples.length >= 20 ||
                            !parseEnrichmentExampleClassification(example.classification, draft)}
                          onClick={() => props.onChange(keepEnrichmentExample(draft, example))}
                        >
                          {i18n.t('items.organize.useExample')}
                        </Button>
                        {differentSavedRevision && (
                          <p class='text-sm'>{i18n.t('items.organize.exampleEarlier')}</p>
                        )}
                        {draft.examples.length >= 20 && (
                          <p class='text-sm'>{i18n.t('items.organize.exampleLimit')}</p>
                        )}
                        {!parseEnrichmentExampleClassification(example.classification, draft) &&
                          <p class='text-sm'>{i18n.t('items.organize.exampleRefresh')}</p>}
                      </div>
                    )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </EnrichmentSection>
  );
}
