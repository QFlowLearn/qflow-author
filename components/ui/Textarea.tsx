import type { JSX, Ref } from 'preact';

type Props = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  textareaRef?: Ref<HTMLTextAreaElement>;
  appearance?: 'default' | 'quiet';
  autoSize?: boolean;
};

/** Shared multiline field with optional compact content sizing and a quiet editing surface. */
export default function Textarea({
  class: cls,
  textareaRef,
  appearance = 'default',
  autoSize = false,
  ...rest
}: Props) {
  const classes = [
    'ds-textarea',
    '',
    'w-full',
    appearance === 'quiet'
      ? '!border-x-transparent !border-t-transparent !border-b-base-content/50 !bg-base-200/40 hover:!bg-base-200/70 focus:!border-b-secondary aria-[invalid=true]:!border-b-error [&.ds-textarea-error]:!border-b-error'
      : '',
    autoSize ? 'min-h-11 max-h-80 resize-y [field-sizing:content]' : '',
    cls || '',
  ].filter(Boolean).join(' ');
  return <textarea ref={textareaRef} class={classes} {...rest} />;
}
