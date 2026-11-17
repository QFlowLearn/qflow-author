import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import QtiFidelity from '../lib/http/routes/public_pages/qti_fidelity.tsx';
import Qti3ImportRequirements from '../lib/http/routes/public_pages/qti3_import.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';

const i18n = createI18n('en-US', catalogForLocale('en-US'));

testCase('import compatibility guide explains the workflow in author-facing language', () => {
  const html = renderToString(<QtiFidelity i18n={i18n} />);

  expect(html).toContain('Import compatibility');
  expect(html).toContain('What QFlowLearn preserves');
  expect(html).toContain('How to use the report');
  expect(html).toContain('Choose one or more files. QFlowLearn detects the format for you.');
  expect(html).toContain('Create the assessment');
  expect(html).toContain('Warnings identify a review task');
  expect(html).toContain('The report describes every conversion');
  expect(html).toContain('href="/help/qti-sample-report"');
  expect(html).toContain('View sample report');
  expect(html.includes('Fidelity')).toStrictEqual(false);
});

testCase('QTI 3 requirements page keeps preparation and recovery guidance together', () => {
  const html = renderToString(<Qti3ImportRequirements i18n={i18n} />);

  expect(html).toContain('Prepare a QTI 3 package');
  expect(html).toContain('Package basics');
  expect(html).toContain('Supported question types');
  expect(html).toContain('If QFlowLearn cannot read the package');
  expect(html).toContain('View import compatibility');
  expect(html).toContain('Bring your files');
  expect(html).toContain('href="/assessments/new?intent=recover"');
});
