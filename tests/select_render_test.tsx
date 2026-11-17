import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import Select from '../components/ui/Select.tsx';

testCase(
  'select renders a persistent dropdown indicator without replacing native semantics',
  () => {
    const html = renderToString(
      <label>
        <span>Orientation</span>
        <Select value='horizontal'>
          <option value='horizontal'>Horizontal</option>
          <option value='vertical'>Vertical</option>
        </Select>
      </label>,
    );

    expect(html).toContain('<select');
    expect(html).toContain('appearance-none');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('m4 6 4 4 4-4');
  },
);
