import { useDomId } from '../../lib/rendering/island_context.tsx';

import {
  type AnswerFeedbackExplanation,
  emptyAnswerFeedbackExplanation,
  parseAnswerFeedback,
} from '../../lib/answer_feedback.ts';
import { emptyAssessmentContentDraft } from '../../lib/assessment_standalone_content.ts';
import AssessmentContentEditorFields from '../../components/ui/AssessmentContentEditorFields.tsx';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import Select from '../../components/ui/Select.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useItemEditorState } from '../../islands/item_editor/context.ts';

/** Correctness belongs to shared QTI processing; this form authors only its explanations. */
export default function AnswerFeedbackEditor() {
  const state = useItemEditorState(), i18n = useI18n(), id = useDomId();
  const { draft, qtype, setDraft, points, feedbackUploading, setFeedbackUploadBusy } =
    state.content;
  if (!['single_select', 'multi_select', 'inline_choice'].includes(qtype)) return null;
  const frozen = state.persistence.saveStatus === 'saving' || feedbackUploading;
  const protectedSource = points.readOnly;
  const feedback = draft.answerFeedback ?? { correct: null, incorrect: null };
  const invalid = draft.answerFeedback !== undefined &&
    !parseAnswerFeedback(draft.answerFeedback).ok;
  function change(key: 'correct' | 'incorrect', entry: AnswerFeedbackExplanation | null) {
    setDraft((current) => {
      const next = {
        ...(current.answerFeedback ?? { correct: null, incorrect: null }),
        [key]: entry,
      };
      if (next.correct || next.incorrect) return { ...current, answerFeedback: next };
      const { answerFeedback: _removed, ...rest } = current;
      return rest;
    });
  }
  return (
    <div>
      <p class='mt-3 text-sm text-base-content/70'>
        {i18n.t(`editor.answerFeedback.${protectedSource ? 'protected' : 'help'}`)}
      </p>
      {!protectedSource && (
        <div class='mt-4 space-y-5'>
          {(['correct', 'incorrect'] as const).map((key) => {
            const entry = feedback[key];
            return (
              <fieldset key={key} class='min-w-0 space-y-3' disabled={frozen}>
                <legend class='mb-2 font-medium'>{i18n.t(`editor.answerFeedback.${key}`)}</legend>
                {!entry
                  ? (
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => change(key, emptyAnswerFeedbackExplanation())}
                    >
                      {i18n.t('editor.answerFeedback.add')}
                    </Button>
                  )
                  : (
                    <>
                      <label class='ds-form-control gap-2'>
                        <span>{i18n.t('editor.answerFeedback.text')}</span>
                        <Textarea
                          rows={4}
                          maxLength={100000}
                          value={entry.text}
                          onInput={(event) =>
                            change(key, { ...entry, text: event.currentTarget.value })}
                        />
                      </label>
                      {entry.link
                        ? (
                          <div class='space-y-3'>
                            <label class='ds-form-control gap-2'>
                              <span>{i18n.t('editor.answerFeedback.url')}</span>
                              <Input
                                type='url'
                                required
                                maxLength={2048}
                                value={entry.link.url}
                                onInput={(event) =>
                                  change(key, {
                                    ...entry,
                                    link: {
                                      label: entry.link?.label ?? '',
                                      url: event.currentTarget.value,
                                    },
                                  })}
                              />
                            </label>
                            <label class='ds-form-control gap-2'>
                              <span>{i18n.t('editor.answerFeedback.label')}</span>
                              <Input
                                required
                                maxLength={2000}
                                value={entry.link.label}
                                onInput={(event) =>
                                  change(key, {
                                    ...entry,
                                    link: {
                                      url: entry.link?.url ?? '',
                                      label: event.currentTarget.value,
                                    },
                                  })}
                              />
                            </label>
                            <Button
                              type='button'
                              size='sm'
                              onClick={() => change(key, { ...entry, link: null })}
                            >
                              {i18n.t('editor.answerFeedback.removeLink')}
                            </Button>
                          </div>
                        )
                        : (
                          <Button
                            type='button'
                            size='sm'
                            onClick={() => change(key, { ...entry, link: { url: '', label: '' } })}
                          >
                            {i18n.t('editor.answerFeedback.addLink')}
                          </Button>
                        )}
                      <label class='ds-form-control gap-2'>
                        <span>{i18n.t('editor.answerFeedback.media')}</span>
                        <Select
                          value={entry.media?.kind ?? 'none'}
                          onInput={(event) => {
                            const kind = event.currentTarget.value;
                            if (kind === 'none') change(key, { ...entry, media: null });
                            else if (
                              kind === 'image' || kind === 'video' || kind === 'video-link'
                            ) {
                              const media = emptyAssessmentContentDraft(
                                kind,
                                String(draft.itemLanguage),
                                i18n.t('assessments.contentEditor.networkNotice'),
                              );
                              if (media.kind !== 'text') change(key, { ...entry, media });
                            }
                          }}
                        >
                          {(['none', 'image', 'video', 'video-link'] as const).map((kind) => (
                            <option value={kind} key={kind}>
                              {i18n.t(`editor.answerFeedback.${kind}`)}
                            </option>
                          ))}
                        </Select>
                      </label>
                      {entry.media && (
                        <AssessmentContentEditorFields
                          content={entry.media}
                          error={invalid ? i18n.t('editor.answerFeedback.invalid') : null}
                          errorId={`${id}-invalid`}
                          invalid={invalid}
                          frozen={state.persistence.saveStatus === 'saving'}
                          busy={feedbackUploading}
                          onUploadBusy={setFeedbackUploadBusy}
                          onChange={(media) => {
                            if (media.kind === 'text') return;
                            setDraft((current) => {
                              const latest = current.answerFeedback?.[key];
                              if (!latest) return current;
                              return {
                                ...current,
                                answerFeedback: {
                                  ...current.answerFeedback,
                                  correct: current.answerFeedback?.correct ?? null,
                                  incorrect: current.answerFeedback?.incorrect ?? null,
                                  [key]: { ...latest, media },
                                },
                              };
                            });
                          }}
                        />
                      )}
                      <Button type='button' size='sm' onClick={() => change(key, null)}>
                        {i18n.t('editor.answerFeedback.remove')}
                      </Button>
                    </>
                  )}
              </fieldset>
            );
          })}
          {invalid && (
            <p id={`${id}-invalid`} class='text-sm text-error' role='status'>
              {i18n.t('editor.answerFeedback.invalid')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
