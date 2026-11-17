import type { SanitizedHtml } from '../../lib/sanitize.ts';

type Props = {
  readonly html?: SanitizedHtml | null;
  readonly class?: string;
};

/** Renders HTML that has already passed through QFlow's allowlist sanitizer. */
export default function SafeHtml({ html, class: className }: Props) {
  // eslint-disable-next-line react/no-danger
  return <div class={className} dangerouslySetInnerHTML={{ __html: html ?? '' }} />;
}
