import type { ComponentChildren } from 'preact';
import { useI18n } from '../../lib/i18n/context.tsx';

import { sanitizeBodyHtml, sanitizeInlineHtml } from '../../lib/sanitize.ts';
import SafeHtml from './SafeHtml.tsx';

/** Question content displayed around an edited image in the composition preview. */
export type ImageCompositionContext = {
  readonly bodyHtml: string;
  readonly promptHtml: string;
  readonly accessibleDescription: string;
};

type Props = {
  readonly composition: ImageCompositionContext;
  readonly children: ComponentChildren;
};

/** Show an edited image with the question content that will surround it. */
export default function ImageQuestionCompositionPreview(
  { composition, children }: Props,
) {
  const i18n = useI18n();
  const safeBodyHtml = sanitizeBodyHtml(composition.bodyHtml);
  const safePromptHtml = sanitizeInlineHtml(composition.promptHtml);
  const description = composition.accessibleDescription.trim();

  return (
    <section
      class='overflow-hidden rounded-lg border border-base-300 bg-base-100'
      aria-label={i18n.t('editor.questionCompositionPreview')}
    >
      <div class='mx-auto max-w-3xl space-y-4 p-4 sm:p-5'>
        {safeBodyHtml
          ? (
            <SafeHtml
              html={safeBodyHtml}
              class='text-sm leading-6 text-base-content'
            />
          )
          : (
            <p class='text-sm text-base-content/60'>
              {i18n.t('editor.questionTextPreview')}
            </p>
          )}

        {safePromptHtml && (
          <div class='rounded-md bg-base-200 px-3 py-2'>
            <p class='text-xs font-medium text-base-content/70'>{i18n.t('editor.instruction')}</p>
            <SafeHtml
              html={safePromptHtml}
              class='mt-1 text-sm leading-6 text-base-content'
            />
          </div>
        )}

        <div class='flex min-h-48 items-center justify-center overflow-auto rounded-md bg-base-100 p-2'>
          {children}
        </div>
      </div>

      <dl class='border-t border-base-200 bg-base-200/50 px-4 py-3 text-xs sm:px-5'>
        <dt class='font-medium text-base-content/70'>{i18n.t('editor.accessibleDescription')}</dt>
        <dd class={description ? 'mt-1 text-base-content' : 'mt-1 text-warning'}>
          {description || i18n.t('editor.noAccessibleDescription')}
        </dd>
      </dl>
    </section>
  );
}
