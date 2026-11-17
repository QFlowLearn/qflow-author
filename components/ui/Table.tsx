import type { ComponentChildren } from 'preact';
import Button from './Button.tsx';

/** A native data table with keyboard-accessible horizontal scrolling. */
export function Table(props: { readonly label: string; readonly children: ComponentChildren }) {
  return (
    <div
      class='overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'
      tabIndex={0}
      role='region'
      aria-label={props.label}
    >
      <table class='ds-table ds-table-sm w-full [&_td]:align-top [&_td]:py-3 [&_th]:text-base-content'>
        <caption class='sr-only'>{props.label}</caption>
        {props.children}
      </table>
    </div>
  );
}

/** Sorting remains ordinary URL navigation and works without client JavaScript. */
export function SortHeader(props: {
  readonly label: string;
  readonly href: string;
  readonly direction?: 'asc' | 'desc';
}) {
  return (
    <th
      scope='col'
      aria-sort={props.direction === 'asc'
        ? 'ascending'
        : props.direction === 'desc'
        ? 'descending'
        : undefined}
    >
      <Button
        href={props.href}
        variant='ghost'
        class='min-h-11 h-auto w-max flex-nowrap justify-start gap-1 whitespace-nowrap px-1 text-xs'
      >
        <span>{props.label}</span>
        <span aria-hidden='true' class='shrink-0'>
          {props.direction === 'asc' ? '↑' : props.direction === 'desc' ? '↓' : '↕'}
        </span>
      </Button>
    </th>
  );
}
