import { useDomId } from '../../lib/rendering/island_context.tsx';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** A heading disclosure retains its form and exposes active values when collapsed. */
export default function SettingsDisclosure(props: {
  readonly title: string;
  readonly summary: string;
  readonly children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const id = useDomId();
  return (
    <section class='border-b border-base-300 pb-4'>
      <h3>
        <button
          type='button'
          class='flex w-full items-start gap-2 rounded py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden='true'>{open ? '▾' : '▸'}</span>
          <span class='min-w-0 flex-1'>
            <span class='block font-semibold break-words'>{props.title}</span>
            <span class='mt-1 block text-sm font-normal leading-5 text-base-content'>
              {props.summary}
            </span>
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} class='space-y-3 pt-3'>{props.children}</div>
    </section>
  );
}
