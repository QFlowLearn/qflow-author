import { expect, test as testCase } from 'vitest';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { createRevisionDraftSessionQueue } from '../lib/client/revision_draft_session.ts';
import {
  itemEditorFailureMessage,
  itemEditorFieldIssues,
} from '../islands/item_editor/ItemEditorProvider.tsx';
import {
  parseItemEditorFailureCode,
  publishDraftRequest,
  PublishRequestFailure,
} from '../islands/item_editor/useItemEditorPersistence.ts';
import { publishFailure, publishHttpResponse } from '../lib/services/publish.ts';

for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
  testCase(`item-editor failures are localized and closed in ${locale}`, async () => {
    const parsed = parseInterfaceLocale(locale);
    if (!parsed) throw new Error(`Unsupported test locale: ${locale}`);
    const i18n = createI18n(parsed, catalogForLocale(parsed));
    const save = itemEditorFailureMessage(i18n, 'save_failed');
    const alignment = itemEditorFailureMessage(i18n, 'alignment_failed');
    expect(itemEditorFailureMessage(i18n, 'stale_revision')).toStrictEqual(
      i18n.t('editor.staleRevision'),
    );
    expect(save).toStrictEqual(i18n.t('editor.saveFailed'));
    expect(alignment).toStrictEqual(i18n.t('editor.alignmentFailed'));
    const fieldIssues = itemEditorFieldIssues(i18n, [
      { field: 'title', code: 'invalid_field' },
      { field: 'title', code: 'invalid_field' },
      { field: 'general', code: 'invalid_field' },
    ]);
    expect(fieldIssues.title).toStrictEqual([i18n.t('editor.fieldInvalid')]);
    expect(fieldIssues.general).toStrictEqual([i18n.t('editor.fieldInvalid')]);
    expect(Object.values(fieldIssues).flat().includes('HOSTILE-FIELD-MESSAGE')).toStrictEqual(
      false,
    );
    expect(save).not.toStrictEqual('HOSTILE-SAVE-DETAIL');
    expect(alignment).not.toStrictEqual('HOSTILE-ALIGNMENT-DETAIL');
    const errors: string[] = [];
    const queue = createRevisionDraftSessionQueue(
      () => {
        throw new Error('HOSTILE-AUTOSAVE-DETAIL');
      },
      (code) => errors.push(code),
    );
    queue.enqueueAutosave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(errors).toStrictEqual(['save_failed']);
  });
}

testCase(
  'editor recognizes only the structured revision conflict and keeps diagnostics private',
  () => {
    expect(parseItemEditorFailureCode(409, { error: 'stale_parent_revision', message: 'HOSTILE' }))
      .toStrictEqual('stale_revision');
    for (
      const input of [null, [], 'stale_parent_revision', { message: 'stale_parent_revision' }, {
        error: 'HOSTILE',
      }]
    ) {
      expect(parseItemEditorFailureCode(409, input)).toStrictEqual('save_failed');
    }
    expect(parseItemEditorFailureCode(500, { error: 'stale_parent_revision' })).toStrictEqual(
      'save_failed',
    );
  },
);

testCase('publish HTTP serialization and client parsing omit hostile diagnostics', async () => {
  const response = publishHttpResponse(publishFailure(
    422,
    'invalid_draft',
    'HOSTILE-TOP-LEVEL-MESSAGE',
    [
      { field: 'title', message: 'HOSTILE-FIELD-MESSAGE' },
      { field: 'itemId', message: 'HOSTILE-ID-MESSAGE' },
      { field: 'itemId', message: 'DUPLICATE-ID-MESSAGE' },
    ],
  ));
  const body = await response.json();
  expect(body.error).toStrictEqual('invalid_draft');
  expect(body.message).toStrictEqual('HOSTILE-TOP-LEVEL-MESSAGE');
  expect(body.issues).toStrictEqual([
    { field: 'title', message: 'HOSTILE-FIELD-MESSAGE' },
    { field: 'itemId', message: 'HOSTILE-ID-MESSAGE' },
    { field: 'itemId', message: 'DUPLICATE-ID-MESSAGE' },
  ]);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'invalid_draft',
            message: 'HOSTILE-TOP-LEVEL-MESSAGE',
            issues: [{ field: 'title', message: 'HOSTILE-FIELD-MESSAGE' }],
          }),
          { status: 422 },
        ),
      );
    const failure = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        publishDraftRequest('/api/drafts/id/publish', {})
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof PublishRequestFailure)) {
        expect.unreachable('Expected PublishRequestFailure');
      }
      return caught;
    })();
    expect(failure.code).toStrictEqual('save_failed');
    expect(failure.issues).toStrictEqual([{ field: 'title', code: 'invalid_field' }]);

    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'HOSTILE-MALFORMED-SUCCESS' }), { status: 200 }),
      );
    const malformed = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        publishDraftRequest('/api/drafts/id/publish', {})
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof PublishRequestFailure)) {
        expect.unreachable('Expected PublishRequestFailure');
      }
      return caught;
    })();
    expect(malformed.code).toStrictEqual('save_failed');

    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ itemId: 'item-1', rev: 2, identifier: 'q-2' }), {
          status: 201,
        }),
      );
    expect(await publishDraftRequest('/api/drafts/id/publish', {})).toStrictEqual({
      itemId: 'item-1',
      rev: 2,
      identifier: 'q-2',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
