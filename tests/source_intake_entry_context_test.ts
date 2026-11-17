import { expect, test as testCase } from 'vitest';

import { parseSourceIntakeEntryContext as parseEntry } from '../lib/source_intake/entry_context.ts';

const parseSourceIntakeEntryContext = (params: URLSearchParams) =>
  parseEntry(params, { _tag: 'Assessment' });

testCase('source-intake entry parser selects the focused Respondus recovery path', () => {
  const result = parseSourceIntakeEntryContext(
    new URLSearchParams({ intent: 'recover', source: 'respondus' }),
  );

  expect(result).toStrictEqual({
    ok: true,
    context: {
      destination: { _tag: 'Assessment' },
      initialPurpose: 'recover_existing',
      entrySource: 'respondus',
    },
  });
});

testCase('source-intake entry parser rejects unknown and conflicting routes', () => {
  expect(parseSourceIntakeEntryContext(new URLSearchParams({ source: 'examview' })).ok)
    .toStrictEqual(false);
  expect(
    parseSourceIntakeEntryContext(
      new URLSearchParams({ intent: 'generate', source: 'respondus' }),
    ).ok,
  ).toStrictEqual(false);
  expect(parseSourceIntakeEntryContext(new URLSearchParams({ intent: 'surprise' })).ok)
    .toStrictEqual(false);
});

testCase('bank intake entry fixes recovery destination without an assessment blueprint', () => {
  const collectionId = crypto.randomUUID();
  expect(parseEntry(new URLSearchParams(), { _tag: 'WorkspaceBank', collectionId })).toStrictEqual({
    ok: true,
    context: {
      destination: { _tag: 'WorkspaceBank', collectionId },
      initialPurpose: 'recover_existing',
    },
  });
  expect(parseEntry(new URLSearchParams(), { _tag: 'WorkspaceBank', collectionId: null }).ok)
    .toStrictEqual(true);
  expect(
    parseEntry(new URLSearchParams('intent=generate'), {
      _tag: 'WorkspaceBank',
      collectionId: null,
    }).ok,
  ).toStrictEqual(false);
  expect(parseEntry(new URLSearchParams(), { _tag: 'WorkspaceBank', collectionId: 'forged' }).ok)
    .toStrictEqual(false);
});

testCase(
  'bank generation rejection describes bank policy without claiming a Respondus source',
  () => {
    expect(parseEntry(new URLSearchParams('intent=generate'), {
      _tag: 'WorkspaceBank',
      collectionId: null,
    })).toStrictEqual({
      ok: false,
      message: 'Bank imports recover existing questions.',
    });
  },
);
