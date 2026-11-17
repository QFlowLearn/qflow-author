import { expect, test as testCase } from 'vitest';

import { collectA11yIssues } from '../lib/a11y_checks.ts';
import type { Draft } from '../lib/types/draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

type NewA11yDraft = Omit<Draft, 'itemLanguage'>;

function authoredDraft(input: NewA11yDraft): Draft {
  return { ...input, itemLanguage: newAuthoringItemLanguage() };
}

testCase('collectA11yIssues flags missing alt text and invalid data-ssml', () => {
  const draft = authoredDraft({
    type: 'single_select',
    title: 'A11y checks',
    promptHtml: `<p><img src="/image.png"></p>`,
    bodyHtml: `<p><span data-ssml='{"sub":'>Bad SSML</span></p>`,
    choices: [
      { id: 'A', text: 'A' },
      { id: 'B', text: 'B' },
    ],
    correctId: 'A',
  });
  expect(draft.itemLanguage).toStrictEqual('en-US');
  const warnings = collectA11yIssues(draft);
  expect(warnings.some((warning) => warning.code === 'MISSING_ALT_TEXT')).toStrictEqual(true);
  expect(warnings.some((warning) => warning.code === 'INVALID_DATA_SSML')).toStrictEqual(true);
});

testCase('collectA11yIssues accepts empty alt text for decorative images', () => {
  const issues = collectA11yIssues(authoredDraft({
    type: 'extended_text',
    title: 'Decorative image',
    bodyHtml: '<p><img src="divider.png" alt=""></p>',
  }));
  expect(issues.some((issue) => issue.code === 'MISSING_ALT_TEXT')).toStrictEqual(false);
});

testCase('collectA11yIssues preserves catalog issue severity', () => {
  const draft = authoredDraft({
    type: 'single_select',
    title: 'Catalog checks',
    promptHtml: `<p><span data-catalog-idref="cat-1">term</span></p>`,
    bodyHtml: '<p>Body</p>',
    choices: [
      { id: 'A', text: 'A' },
      { id: 'B', text: 'B' },
    ],
    correctId: 'A',
    catalogs: [{
      id: 'cat-2',
      cards: [{
        support: { kind: 'predefined', value: 'glossary-on-screen' },
        entries: [{ contentHtml: '<p>Other</p>' }],
      }],
    }],
  });
  const issues = collectA11yIssues(draft);
  expect(
    issues.some((issue) =>
      issue.code === 'CATALOG_REFERENCE_MISSING' && issue.severity === 'error'
    ),
  ).toStrictEqual(true);
  expect(issues.some((issue) => issue.code === 'CATALOG_UNUSED' && issue.severity === 'warning'))
    .toStrictEqual(true);
});

testCase('collectA11yIssues excludes catalog and stylesheet metadata from item references', () => {
  const issues = collectA11yIssues(authoredDraft({
    type: 'extended_text',
    title: 'Catalog traversal',
    bodyHtml: '<p>Explain the term.</p>',
    catalogs: [{
      id: 'cat-1',
      cards: [{
        support: { kind: 'predefined', value: 'glossary-on-screen' },
        entries: [{
          contentHtml: '<p><span data-catalog-idref="cat-1"><img src="term.png"></span></p>',
        }],
      }],
    }],
    stylesheets: [{ href: 'https://example.com/item.css' }],
  }));

  expect(issues.some((issue) => issue.code === 'MISSING_ALT_TEXT')).toStrictEqual(true);
  expect(issues.some((issue) => issue.code === 'CATALOG_UNUSED')).toStrictEqual(true);
  expect(issues.some((issue) => issue.code === 'STYLESHEET_REFERENCE_UNSAFE')).toStrictEqual(true);
  expect(issues.some((issue) => issue.code === 'CATALOG_REFERENCE_MISSING')).toStrictEqual(false);
});

testCase('collectA11yIssues flags media captions/transcript gaps', () => {
  const draft = authoredDraft({
    type: 'media',
    title: 'Video',
    promptHtml: '<p>Watch this clip.</p>',
    bodyHtml: '<p>Then answer.</p>',
    mediaKind: 'video',
    mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
  });
  const warnings = collectA11yIssues(draft);
  expect(warnings.some((warning) => warning.code === 'MISSING_CAPTIONS')).toStrictEqual(true);
  expect(warnings.some((warning) => warning.code === 'MISSING_TRANSCRIPT')).toStrictEqual(true);
  expect(warnings.some((warning) => warning.code === 'MISSING_MEDIA_LABEL')).toStrictEqual(true);
});

testCase(
  'collectA11yIssues clears media caption/transcript warnings when fields are present',
  () => {
    const draft = authoredDraft({
      type: 'media',
      title: 'Video with accessibility assets',
      promptHtml: '<p>Watch this clip.</p>',
      bodyHtml: '<p>Then answer.</p>',
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaCaptionSrc: 'captions.vtt',
      mediaTranscript: 'Transcript text here.',
      mediaInteractionLabel: 'Instructional video',
      mediaObjectLabel: 'Plate movement demonstration',
    });
    const warnings = collectA11yIssues(draft);
    expect(warnings.some((warning) => warning.code === 'MISSING_CAPTIONS')).toStrictEqual(false);
    expect(warnings.some((warning) => warning.code === 'MISSING_TRANSCRIPT')).toStrictEqual(false);
    expect(warnings.some((warning) => warning.code === 'MISSING_MEDIA_LABEL')).toStrictEqual(false);
  },
);

testCase('collectA11yIssues distinguishes color-only directions from ordinary color words', () => {
  const base = authoredDraft({
    type: 'single_select',
    title: 'Color language',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
  });

  expect(
    collectA11yIssues({ ...base, bodyHtml: '<p>Choose the red option.</p>' }).some((issue) =>
      issue.code === 'COLOR_ONLY_INSTRUCTION'
    ),
  ).toStrictEqual(true);
  expect(
    collectA11yIssues({ ...base, bodyHtml: '<p>Which blue whale behavior is described?</p>' }).some(
      (issue) => issue.code === 'COLOR_ONLY_INSTRUCTION',
    ),
  ).toStrictEqual(false);
  expect(
    collectA11yIssues({
      ...base,
      bodyHtml: '<p>Choose the red option.</p><p>The first answer is plausible.</p>',
    }).some((issue) => issue.code === 'COLOR_ONLY_INSTRUCTION'),
  ).toStrictEqual(true);
});
