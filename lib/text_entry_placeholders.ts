import {
  createMarkerHtml,
  listMarkerIds,
  removeMarkerById,
  replaceAllMarkers,
  replaceMarkerById,
} from './qti_markers.ts';

export function createPlaceholderHtml(
  opts: { id: string; label: string; widthClass?: string },
): string {
  const classes = [
    'qti-entry-slot',
    'ds-input',
    'ds-input-bordered',
    opts.widthClass?.trim() || '',
  ].filter(Boolean).join(' ');
  return createMarkerHtml({
    attr: 'data-qti-entry',
    id: opts.id,
    label: opts.label,
    className: classes,
    contentEditable: false,
  });
}

export function listPlaceholderIds(html: string): string[] {
  return listMarkerIds(html, 'data-qti-entry');
}

export function replacePlaceholderById(
  html: string,
  id: string,
  replacementHtml: string,
): { html: string; replaced: boolean } {
  return replaceMarkerById(html, 'data-qti-entry', id, replacementHtml);
}

export function removePlaceholderById(html: string, id: string): string {
  return removeMarkerById(html, 'data-qti-entry', id);
}

export function replaceAllPlaceholders(
  html: string,
  replacer: (info: { id: string; match: string }) => string,
): { html: string; ids: string[] } {
  const { html: next, ids } = replaceAllMarkers(
    html,
    'data-qti-entry',
    ({ id, match }) => replacer({ id, match }),
  );
  return { html: next, ids };
}
