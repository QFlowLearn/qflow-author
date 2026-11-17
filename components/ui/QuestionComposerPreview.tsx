import type { Draft } from '../../lib/types/draft.ts';
import type { QuestionCompletion } from '../../lib/authoring/question_composition.ts';
import { sanitizeBodyHtml } from '../../lib/sanitize.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import SafeHtml from './SafeHtml.tsx';

/** Stable author preview supports incomplete choices and visibly identifies suggested content. */
export default function QuestionComposerPreview(
  { draft, suggestions }: { readonly draft: Draft; readonly suggestions?: QuestionCompletion },
) {
  const i18n = useI18n();
  return (
    <section
      aria-label={i18n.t('editor.assistance.livePreview')}
      class='min-w-0 space-y-4 rounded-lg bg-base-200/50 p-4'
    >
      <h3 class='text-sm font-medium'>{i18n.t('editor.assistance.livePreview')}</h3>
      <p class='text-xs text-base-content/70'>
        {i18n.t(`editor.assistance.type.${draft.type}`)}
        {draft.shuffle ? ` · ${i18n.t('editor.assistance.randomized')}` : ''}
      </p>
      {draft.bodyHtml && (
        <SafeHtml
          html={sanitizeBodyHtml(draft.bodyHtml)}
          class='break-words text-base leading-relaxed'
        />
      )}
      {draft.type !== 'text_entry' && (
        <ol class='space-y-2'>
          {(draft.choices ?? []).map((choice, index) => (
            <li key={choice.id} class='flex items-start gap-3 rounded-md bg-base-100 p-3 text-sm'>
              <span class='font-medium text-base-content/65'>
                {String.fromCharCode(65 + index)}.
              </span>
              <div class='min-w-0 flex-1 break-words'>
                {choice.html
                  ? <SafeHtml html={sanitizeBodyHtml(choice.html)} />
                  : choice.text || (
                    <span class='text-base-content/50'>
                      {i18n.t('editor.assistance.emptyOption')}
                    </span>
                  )}
                {suggestions?.additionalChoices.includes(choice.text ?? '') && (
                  <span class='ml-2 text-xs text-base-content/65'>
                    {i18n.t('editor.assistance.suggested')}
                  </span>
                )}
                {(draft.correctId === choice.id || draft.correctIds?.includes(choice.id)) && (
                  <span class='ml-2 text-xs font-medium'>
                    {i18n.t('editor.assistance.correct')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {draft.type === 'text_entry' && (
        <p class='text-sm'>
          {i18n.t('editor.assistance.answer')}:{' '}
          {draft.textEntries?.[0]?.answers.map((answer) => answer.value).join(', ') || '—'}
        </p>
      )}
    </section>
  );
}
