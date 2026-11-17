import { expect, test as testCase } from 'vitest';

import { createElement } from 'preact';
import { renderPage as render } from './helpers/render_page.tsx';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { compareQuestionRevisionSnapshots } from '../lib/question_version_comparison.ts';
import { VersionChanges } from '../components/item_bank/VersionChanges.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

function snapshot(bodyChanges: Record<string, unknown> = {}) {
  const body = {
    ...TYPE_DRIVERS.single_select.defaults(),
    itemLanguage: newAuthoringItemLanguage(),
    ...bodyChanges,
  };
  return {
    body,
    qtiXml: exportQti3AssessmentItemXml(
      'single_select',
      prepareDriverDraftForBuild('single_select', body),
      { identifier: 'source' },
    ),
  };
}

testCase(
  'one comparison document reports B to C exactly once and identifies reordered choices',
  () => {
    const choices = [{ id: 'B', text: 'Bee' }, { id: 'C', text: 'Sea' }];
    const before = snapshot({ choices, correctId: 'B' });
    const after = snapshot({ choices: [...choices].reverse(), correctId: 'C' });
    const changes = compareQuestionRevisionSnapshots(before, after);
    const answers = changes.filter((change) => change.label === 'correctAnswer');
    expect(answers.length).toStrictEqual(1);
    expect([answers[0].before, answers[0].after]).toStrictEqual(['"B"', '"C"']);
    expect(changes.filter((change) => change.kind === 'reordered').map((change) => change.field))
      .toStrictEqual(['qti.interactions["RESPONSE"].choices.order']);
    if (changes.some((change) => change.field === 'correctId' || change.field === 'choices')) {
      expect.unreachable(
        "Expected !changes.some((change) => change.field === 'correctId' || change.field === 'choices')",
      );
    }
  },
);

testCase('source-only partial credit remains visible with unchanged draft projection', () => {
  const before = snapshot();
  const scoring =
    '<qti-mapping default-value="0"><qti-map-entry map-key="A" mapped-value="0.5"/></qti-mapping>';
  const after = {
    ...before,
    qtiXml: before.qtiXml.replace(
      '</qti-response-declaration>',
      scoring + '</qti-response-declaration>',
    ),
  };
  const changes = compareQuestionRevisionSnapshots(before, after);
  expect(changes.length).toStrictEqual(1);
  expect(changes[0].category).toStrictEqual('answer_and_scoring');
  expect(changes[0].after).toContain('0.5');
});

testCase(
  'full diagram and alt text evidence survives beyond 320 characters and renders escaped',
  () => {
    const before = snapshot({
      bodyHtml: '<p>' + 'x'.repeat(500) + '</p><img src="/old.svg" alt="Old diagram"/>',
    });
    const after = snapshot({
      bodyHtml: '<p>' + 'x'.repeat(500) +
        '</p><img src="/new.svg" alt="Accessible replacement &lt;script&gt;"/>',
    });
    const changes = compareQuestionRevisionSnapshots(before, after);
    if (
      !(changes.some((change) =>
        change.after.includes('/new.svg') && change.after.includes('Accessible replacement')
      ))
    ) {
      expect.unreachable(
        "Expected changes.some((change) => change.after.includes('/new.svg') && change.after.includes('Acces",
      );
    }
    const html = render(createElement(VersionChanges, {
      comparison: { fromRevision: 2, toRevision: 4, changes },
      i18n: createI18n('en-US', catalogForLocale('en-US')),
    }));
    expect(html).toContain('/new.svg');
    if (html.includes('<script>')) expect.unreachable("Expected !html.includes('<script>')");
    expect(html).toContain('<details');
    expect(html).toContain('tabindex="0"');
  },
);

testCase(
  'identified QTI members reject missing and duplicate identities even in unchanged documents',
  () => {
    const valid = snapshot();
    for (
      const xml of [
        valid.qtiXml.replace('identifier="B"', 'identifier="A"'),
        valid.qtiXml.replace('identifier="B"', ''),
      ]
    ) {
      expect(() =>
        compareQuestionRevisionSnapshots({ ...valid, qtiXml: xml }, { ...valid, qtiXml: xml })
      ).toThrowError(Error);
    }
  },
);

testCase(
  'authoring-only sets ignore ordering and canonical QTI ignores root item identifiers',
  () => {
    const before = snapshot({ tags: ['second', 'first'], standards: [] });
    const after = {
      ...before,
      body: { ...before.body, tags: ['first', 'second'] },
      qtiXml: before.qtiXml.replace('identifier="source"', 'identifier="renamed"'),
    };
    expect(compareQuestionRevisionSnapshots(before, after)).toStrictEqual([]);
    const changed = compareQuestionRevisionSnapshots(before, {
      ...after,
      body: { ...after.body, note: 'Corrected after review', standards: [{ standardId: 'TWO' }] },
    });
    expect(changed.map((change) => [change.field, change.category])).toStrictEqual([
      ['note', 'details'],
      ['standards', 'standards_and_accessibility'],
    ]);
  },
);
