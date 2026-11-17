import { useDomId } from '../../lib/rendering/island_context.tsx';
import type { ComponentChildren, Ref } from 'preact';

import { useI18n } from '../../lib/i18n/context.tsx';
import Textarea from './Textarea.tsx';
import Select from './Select.tsx';
import Button from './Button.tsx';

type Props = {
  readonly children: ComponentChildren;
  readonly text: string;
  readonly sourceRef: Ref<HTMLTextAreaElement>;
  readonly maxLength: number;
  readonly type: string | undefined;
  readonly types: readonly { readonly value: string; readonly label: string }[];
  readonly status: string;
  readonly findings: readonly string[];
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly replacing: boolean;
  readonly onText: (text: string) => void;
  readonly onType: (type: string) => void;
  readonly onComposition: (active: boolean) => void;
  readonly onUseEditor: () => void;
  readonly onPrepare: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
};
/** Accessible, stable source field and explicit preparation controls within the item canvas. */
export default function QuestionTextPanel(props: Props) {
  const i18n = useI18n(), id = useDomId();
  return (
    <section
      class='grid min-w-0 gap-6 border-b border-base-300 pb-5 xl:grid-cols-2'
      aria-label={i18n.t('editor.assistance.title')}
    >
      <div class='min-w-0 space-y-3'>
        <label for={id} class='block text-sm font-medium'>
          {i18n.t('editor.assistance.title')}
        </label>
        <Textarea
          id={id}
          textareaRef={props.sourceRef}
          value={props.text}
          rows={6}
          maxLength={props.maxLength}
          aria-describedby={`${id}-hint`}
          onInput={(event) => props.onText(event.currentTarget.value)}
          onCompositionStart={() => props.onComposition(true)}
          onCompositionEnd={() => props.onComposition(false)}
        />
        <p id={`${id}-hint`} class='text-sm text-base-content/80'>
          {i18n.t('editor.assistance.hint')}
        </p>
        <label for={`${id}-type`} class='block text-sm font-medium'>
          {i18n.t('editor.assistance.typeLabel')}
        </label>
        <Select
          id={`${id}-type`}
          value={props.type ?? ''}
          onChange={(event) => props.onType(event.currentTarget.value)}
        >
          {props.type === undefined && <option value='' disabled />}
          {props.types.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </Select>
        <div class='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='primary'
            disabled={props.disabled || props.busy}
            onClick={props.onPrepare}
          >
            {i18n.t(props.replacing ? 'editor.assistance.replace' : 'editor.assistance.prepare')}
          </Button>
          <Button type='button' variant='ghost' onClick={props.onUseEditor}>
            {i18n.t('editor.assistance.useEditor')}
          </Button>
          {props.onUndo && (
            <Button type='button' variant='ghost' onClick={props.onUndo}>
              {i18n.t('editor.assistance.undo')}
            </Button>
          )}
          {props.onRedo && (
            <Button type='button' variant='ghost' onClick={props.onRedo}>
              {i18n.t('editor.assistance.redo')}
            </Button>
          )}
        </div>
        <p role='status' aria-live='polite' class='text-sm text-base-content/80'>{props.status}</p>
        {props.findings.length > 0 && (
          <ul class='list-disc space-y-1 pl-5 text-sm text-base-content/80'>
            {props.findings.map((finding) => <li key={finding}>{finding}</li>)}
          </ul>
        )}
      </div>
      {props.children}
    </section>
  );
}
