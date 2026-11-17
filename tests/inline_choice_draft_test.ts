import { expect, test as testCase } from 'vitest';

import {
  defaultsInlineChoice,
  INLINE_CHOICE_MARKER_ATTR,
  validateInlineChoice,
} from '../lib/types/inline_choice.ts';

testCase('inline_choice draft defaults are valid and include a body marker', () => {
  const draft = defaultsInlineChoice();
  const errs = validateInlineChoice(draft);
  expect(errs).toStrictEqual([]);
  if (!((draft.bodyHtml ?? '').includes(INLINE_CHOICE_MARKER_ATTR))) {
    expect.unreachable("Expected (draft.bodyHtml ?? '').includes(INLINE_CHOICE_MARKER_ATTR)");
  }
});

testCase('inline_choice validation errors are human-readable', () => {
  const base = defaultsInlineChoice();

  if (!(validateInlineChoice({ ...base, title: '' }).some((e) => e === 'Title is required.'))) {
    expect.unreachable(
      "Expected validateInlineChoice({ ...base, title: '' }).some((e) => e === 'Title is required.')",
    );
  }

  // Unknown marker id in body
  const unknownBody = (base.bodyHtml ?? '').replace(
    /data-qti-inline-choice="[^"]+"/,
    'data-qti-inline-choice="UNKNOWN"',
  );
  if (
    !(validateInlineChoice({ ...base, bodyHtml: unknownBody }).some((e) =>
      e.includes('Body references unknown inline choice slot "UNKNOWN".')
    ))
  ) {
    expect.unreachable(
      "Expected validateInlineChoice({ ...base, bodyHtml: unknownBody }).some((e) => e.includes('Body refe",
    );
  }

  // Slot exists but not placed in body
  if (
    !(validateInlineChoice({
      ...base,
      inlineChoices: [
        ...base.inlineChoices,
        {
          id: 'RESPONSE_2',
          label: 'Blank 2',
          options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
          correctId: 'A',
        },
      ],
    }).some((e) => e.includes('Inline choice "RESPONSE_2" is not placed in the body.')))
  ) {
    expect.unreachable(
      "Expected validateInlineChoice({ ...base, inlineChoices: [ ...base.inlineChoices, { id: 'RESPONSE_2'",
    );
  }

  // Duplicate markers in body
  const marker = base.inlineChoices[0].id;
  const dupBody =
    `${base.bodyHtml}<p><span ${INLINE_CHOICE_MARKER_ATTR}="${marker}">dup</span></p>`;
  if (
    !(validateInlineChoice({ ...base, bodyHtml: dupBody }).some((e) =>
      e.includes('Duplicate inline choice slots found in body')
    ))
  ) {
    expect.unreachable(
      "Expected validateInlineChoice({ ...base, bodyHtml: dupBody }).some((e) => e.includes('Duplicate inl",
    );
  }
});
