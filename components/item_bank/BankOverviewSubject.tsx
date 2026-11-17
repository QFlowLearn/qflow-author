import { useHydrated } from '../../lib/client/use_hydrated.ts';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import Button from '../ui/Button.tsx';

/** Reveal server-counted topics in the same native table; only disclosure state is client-side. */
export default function BankOverviewSubject(props: {
  readonly id: string;
  readonly heading: ComponentChildren;
  readonly label: string;
  readonly cells: ComponentChildren;
  readonly children: ComponentChildren;
  readonly note: string;
  readonly columnCount: number;
}) {
  const hydrated = useHydrated();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tbody>
        <tr>
          <th scope='row' class='min-w-40 max-w-80 whitespace-normal font-medium'>
            <Button
              type='button'
              disabled={!hydrated}
              variant='ghost'
              size='sm'
              aria-label={props.label}
              aria-expanded={expanded}
              aria-controls={props.id}
              onClick={() => setExpanded(!expanded)}
              class='h-auto flex-nowrap justify-start text-left'
            >
              <span aria-hidden='true'>{expanded ? '▾' : '▸'}</span>
              <span>{props.heading}</span>
            </Button>
          </th>
          {props.cells}
        </tr>
      </tbody>
      <tbody id={props.id} hidden={!expanded} class='bg-base-200/30'>
        {props.children}
        <tr>
          <td colSpan={props.columnCount} class='text-xs text-base-content/80'>{props.note}</td>
        </tr>
      </tbody>
    </>
  );
}
