import type { ComponentChildren } from 'preact';
import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

/** A focused task page that keeps setup outside the question table. */
export function BankEnrichmentLayout(
  props: {
    readonly title: string;
    readonly backHref: string;
    readonly i18n: I18n;
    readonly children: ComponentChildren;
  },
) {
  return (
    <section class='mx-auto w-full max-w-5xl flex flex-col gap-6'>
      <header class='space-y-3'>
        <Button href={props.backHref} variant='ghost' size='sm'>
          {props.i18n.t('items.organize.back')}
        </Button>
        <h1 class='text-3xl font-medium tracking-tight'>{props.title}</h1>
      </header>
      {props.children}
    </section>
  );
}

/** Related settings share a quiet divider and legend instead of nested panels. */
export function EnrichmentSection(
  props: {
    readonly title: string;
    readonly description?: string;
    readonly children: ComponentChildren;
  },
) {
  return (
    <fieldset class='min-w-0 space-y-4 border-t border-base-300 pt-5'>
      <legend class='pe-3 text-lg font-medium'>{props.title}</legend>
      {props.description && (
        <p class='max-w-prose text-sm text-base-content/80'>{props.description}</p>
      )}
      {props.children}
    </fieldset>
  );
}
