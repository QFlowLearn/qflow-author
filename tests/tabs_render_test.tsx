import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import Tabs from '../components/ui/Tabs.tsx';

const noOp = () => {};

testCase('tabs render linked panels and a roving tab stop', () => {
  const html = renderToString(
    <Tabs
      ariaLabel='Editor view'
      value='content'
      onChange={noOp}
      items={[
        { value: 'content', label: 'Content' },
        { value: 'preview', label: 'Preview' },
      ]}
      renderPanel={(value) => value === 'content' ? <p>Edit content</p> : <p>Preview content</p>}
    />,
  );

  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Editor view"');
  expect(html).toContain('aria-orientation="horizontal"');
  expect(html).toContain('ds-tabs-border');
  if (html.includes('ds-tabs-box')) {
    expect.unreachable("Expected !html.includes('ds-tabs-box')");
  }

  const contentTab = startTagForButton(html, 'Content');
  const previewTab = startTagForButton(html, 'Preview');
  const panels = startTagsWithRole(html, 'div', 'tabpanel');
  expect(panels.length).toStrictEqual(2);

  const contentTabId = attributeValue(contentTab, 'id');
  const contentPanelId = attributeValue(contentTab, 'aria-controls');
  const previewTabId = attributeValue(previewTab, 'id');
  const previewPanelId = attributeValue(previewTab, 'aria-controls');
  if (!contentTabId) expect.unreachable('Expected contentTabId');
  if (!contentPanelId) expect.unreachable('Expected contentPanelId');
  if (!previewTabId) expect.unreachable('Expected previewTabId');
  if (!previewPanelId) expect.unreachable('Expected previewPanelId');
  if (!(contentTabId !== previewTabId)) {
    expect.unreachable('Expected contentTabId !== previewTabId');
  }
  if (!(contentPanelId !== previewPanelId)) {
    expect.unreachable('Expected contentPanelId !== previewPanelId');
  }
  expect(attributeValue(contentTab, 'aria-selected')).toStrictEqual('true');
  expect(attributeValue(contentTab, 'tabindex')).toStrictEqual('0');
  expect(attributeValue(previewTab, 'aria-selected')).toStrictEqual('false');
  expect(attributeValue(previewTab, 'tabindex')).toStrictEqual('-1');

  const contentPanel = panels.find((panel) => attributeValue(panel, 'id') === contentPanelId);
  const previewPanel = panels.find((panel) =>
    attributeValue(panel, 'id') === attributeValue(previewTab, 'aria-controls')
  );
  if (!contentPanel) expect.unreachable('Expected contentPanel');
  if (!previewPanel) expect.unreachable('Expected previewPanel');
  expect(attributeValue(contentPanel, 'aria-labelledby')).toStrictEqual(contentTabId);
  expect(attributeValue(previewPanel, 'aria-labelledby')).toStrictEqual(previewTabId);
  if (contentPanel.includes('hidden')) {
    expect.unreachable("Expected !contentPanel.includes('hidden')");
  }
  expect(previewPanel).toContain('hidden');
  expect(html).toContain('Edit content');
  if (html.includes('Preview content')) {
    expect.unreachable("Expected !html.includes('Preview content')");
  }
});

function startTagForButton(html: string, label: string): string {
  const button = Array.from(html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g))
    .find((match) => match[2] === label);
  if (!button) expect.unreachable(`Missing button "${label}".`);
  return button[1];
}

function startTagsWithRole(html: string, tagName: string, role: string): string[] {
  const tags = Array.from(html.matchAll(new RegExp(`<${tagName}([^>]*)>`, 'g')))
    .map((match) => match[1]);
  return tags.filter((tag) => attributeValue(tag, 'role') === role);
}

function attributeValue(startTag: string, name: string): string | null {
  return startTag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;
}
