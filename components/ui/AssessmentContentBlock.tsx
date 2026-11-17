import Button from './Button.tsx';
import type { AssessmentStandaloneContent } from '../../lib/assessment_standalone_content.ts';

/** Display canonical unscored content without a learner response or a separate player. */
export default function AssessmentContentBlock(props: {
  readonly content: AssessmentStandaloneContent;
  readonly label: string;
  readonly edit?: {
    readonly id: string;
    readonly label: string;
    readonly disabled: boolean;
    readonly run: () => void | Promise<unknown>;
  };
}) {
  return (
    <article class='rounded-xl border border-base-200 bg-base-100 p-4 sm:p-5'>
      <h3 class='mb-3 text-sm font-medium text-base-content/70'>{props.label}</h3>
      <Content content={props.content} />
      {props.edit && (
        <Button
          type='button'
          id={props.edit.id}
          size='sm'
          variant='ghost'
          class='mt-3'
          disabled={props.edit.disabled}
          onClick={props.edit.run}
        >
          {props.edit.label}
        </Button>
      )}
    </article>
  );
}

function Content({ content }: { readonly content: AssessmentStandaloneContent }) {
  switch (content.kind) {
    case 'text':
      return (
        <p class='whitespace-pre-wrap break-words leading-7 text-base-content'>{content.text}</p>
      );
    case 'image':
      return (
        <figure class='space-y-3'>
          <img src={content.src} alt={content.alt} class='h-auto max-w-full rounded-lg' />
          {content.longDescription && (
            <figcaption class='whitespace-pre-wrap break-words leading-7'>
              {content.longDescription}
            </figcaption>
          )}
        </figure>
      );
    case 'video':
      return (
        <div class='space-y-3'>
          <p class='font-medium break-words'>{content.title}</p>
          <video controls preload='none' aria-label={content.title} class='max-w-full rounded-lg'>
            <source src={content.src} type={content.mimeType} />
            <track
              kind='captions'
              src={content.captionSrc}
              srcLang={content.captionLanguage}
              default
            />
          </video>
          <p class='whitespace-pre-wrap break-words leading-7'>{content.transcript}</p>
        </div>
      );
    case 'video-link':
      return (
        <div class='space-y-3'>
          <Button href={content.url} target='_blank' rel='noopener noreferrer'>
            {content.title}
          </Button>
          <p class='text-sm text-base-content/70'>{content.networkNotice}</p>
          <p class='whitespace-pre-wrap break-words leading-7'>{content.transcript}</p>
        </div>
      );
  }
}
