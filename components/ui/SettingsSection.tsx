import { useDomId } from '../../lib/rendering/island_context.tsx';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** A keyboard-accessible settings disclosure that keeps edited controls mounted. */
export default function SettingsSection(
  { label, group, children, notice, defaultOpen = false, needsAttention = false }: {
    readonly label: string;
    readonly group: string;
    readonly children: ComponentChildren;
    readonly notice?: ComponentChildren;
    readonly defaultOpen?: boolean;
    readonly needsAttention?: boolean;
  },
) {
  const id = useDomId();
  const [open, setOpen] = useState(defaultOpen || needsAttention);
  useEffect(() => {
    if (needsAttention) setOpen(true);
  }, [needsAttention]);
  return (
    <section data-settings-group={group} class='border-t border-base-200 first:border-t-0'>
      <h3>
        <button
          type='button'
          id={`settings-heading-${id}`}
          aria-expanded={open}
          aria-controls={`settings-panel-${id}`}
          class='flex min-h-11 w-full items-center justify-between gap-3 rounded-xs py-3 text-start text-sm font-semibold text-base-content hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          onClick={() => setOpen((current) => !current)}
        >
          <span>{label}</span>
          <svg
            aria-hidden='true'
            viewBox='0 0 16 16'
            class={`h-4 w-4 shrink-0 ${open ? 'rotate-180' : ''}`}
          >
            <path d='m4 6 4 4 4-4' fill='none' stroke='currentColor' stroke-width='1.5' />
          </svg>
        </button>
      </h3>
      {notice && <div class='pb-3'>{notice}</div>}
      <div
        id={`settings-panel-${id}`}
        aria-labelledby={`settings-heading-${id}`}
        hidden={!open}
        class='space-y-4 pb-4'
      >
        {children}
      </div>
    </section>
  );
}
