import { expect, test as testCase } from 'vitest';
import { run } from './helpers/imports_queue_fixture.ts';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import ImportsIndex from '../lib/http/routes/import_pages/list.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase('imports queue renders bulk migration states and retry action', () => {
  const runs = [
    run({ id: 'queued-run', filename: 'queued.zip', status: 'queued' }),
    run({
      id: 'analyzing-run',
      filename: 'analyzing.zip',
      status: 'analyzing',
    }),
    run({ id: 'failed-run', filename: 'failed.zip', status: 'failed' }),
    run({ id: 'ready-run', filename: 'ready.zip', status: 'analyzed' }),
  ];
  const html = renderToString(
    <ImportsIndex
      runs={runs}
      allRuns={runs}
      status=''
      queueCount={2}
      retryError={null}
      i18n={createI18n('en-US', catalogForLocale('en-US'))}
    />,
  );

  expect(html).toContain('Import runs');
  expect(html).toContain('2 files added to the import queue');
  expect(html).toContain('Bring your files');
  expect(html).toContain('href="/imports/new"');
  expect(html).toContain('Apply filter');
  expect(html).toContain('Queued');
  expect(html).toContain('Analyzing');
  expect(html).toContain('Ready');
  expect(html).toContain('Failed');
  expect(html).toContain('Retry');
  expect(html).toContain('name="action" value="retry"');
  expect(html).toContain('href="/imports/ready-run"');
});
