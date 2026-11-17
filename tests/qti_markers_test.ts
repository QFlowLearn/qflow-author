import { expect, test as testCase } from 'vitest';

import { createMarkerHtml, listMarkerIds, replaceAllMarkers } from '../lib/qti_markers.ts';

testCase('qti_markers: create/list/replace works and preserves duplicates', () => {
  const token1 = createMarkerHtml({
    attr: 'data-qti-inline-choice',
    id: 'SLOT_1',
    label: 'Slot 1',
    className: 'ds-select ds-select-bordered',
    contentEditable: false,
  });
  const token2 = createMarkerHtml({
    attr: 'data-qti-inline-choice',
    id: 'SLOT_1',
    label: 'Slot 1',
    className: 'ds-select ds-select-bordered',
    contentEditable: false,
  });
  const html = `<p>A ${token1} B ${token2}</p>`;

  expect(listMarkerIds(html, 'data-qti-inline-choice')).toStrictEqual(['SLOT_1', 'SLOT_1']);

  const replaced = replaceAllMarkers(html, 'data-qti-inline-choice', ({ id }) => `<X>${id}</X>`);
  expect(replaced.ids).toStrictEqual(['SLOT_1', 'SLOT_1']);
  expect(replaced.html.includes('<X>SLOT_1</X>')).toStrictEqual(true);
});
