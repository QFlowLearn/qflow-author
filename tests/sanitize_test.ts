import { expect, test as testCase } from 'vitest';

import { sanitizeBodyHtml, sanitizeInlineHtml } from '../lib/sanitize.ts';

testCase('inline clipboard sanitization unwraps unsupported tags using the same allowlist', () => {
  const dirty = '<font face="Arial"><b onclick="evil()">One &amp; Two</b></font>';
  expect(sanitizeInlineHtml(dirty, { disallowedTags: 'unwrap' })).toStrictEqual(
    '<b>One &amp; Two</b>',
  );
  expect(sanitizeInlineHtml(dirty)).toContain('&lt;font face="Arial"&gt;');
  expect(sanitizeInlineHtml('&lt;font&gt;literal&lt;/font&gt;', { disallowedTags: 'unwrap' }))
    .toStrictEqual('&lt;font&gt;literal&lt;/font&gt;');
});

testCase('sanitizeBodyHtml removes disallowed tags and attributes', () => {
  const dirty =
    '<div><script>alert(1)</script><p onclick="evil()">Hi</p><span style="color:red">x</span></div>';
  const clean = sanitizeBodyHtml(dirty);
  if (clean.includes('<script')) expect.unreachable("Expected !clean.includes('<script')");
  if (clean.includes('onclick')) expect.unreachable("Expected !clean.includes('onclick')");
  if (clean.includes('style="')) expect.unreachable("Expected !clean.includes('style=\"')");
  expect(clean).toContain('<div>');
  expect(clean).toContain('<p>Hi</p>');
});

testCase('sanitizeInlineHtml preserves allowed anchor attrs', () => {
  const html =
    '<a href="https://example.com" target="_blank" rel="opener" onclick="evil()">Link</a>';
  const clean = sanitizeInlineHtml(html);
  expect(clean).toContain('rel="noopener noreferrer"');
  if (clean.includes('rel="opener"')) {
    expect.unreachable('Expected !clean.includes(\'rel="opener"\')');
  }
  if (clean.includes('onclick')) expect.unreachable("Expected !clean.includes('onclick')");
});

testCase('sanitizeInlineHtml neutralizes entity-encoded URL schemes', () => {
  const clean = sanitizeInlineHtml('<a href="javascript&colon;alert(1)">Link</a>');
  expect(clean).toContain('href="javascript&amp;colon;alert(1)"');
  if (clean.includes('href="javascript&colon;')) {
    expect.unreachable("Expected !clean.includes('href=\"javascript&colon;')");
  }
});

testCase('sanitizeInlineHtml keeps data attributes and contenteditable', () => {
  const dirty =
    '<span data-qti-entry="RESP1" data-nope="x" contenteditable="false" style="color:red">Slot</span>';
  const clean = sanitizeInlineHtml(dirty);
  expect(clean).toContain('data-qti-entry="RESP1"');
  expect(clean).toContain('data-nope="x"');
  expect(clean).toContain('contenteditable="false"');
  if (clean.includes('style="')) expect.unreachable("Expected !clean.includes('style=\"')");
});

testCase('sanitizeBodyHtml emits XML-safe void tags (br/img/hr)', () => {
  const dirty = '<p>Line<br>Two<img src="/a.png" alt="a"><hr></p>';
  const clean = sanitizeBodyHtml(dirty);
  expect(clean).toContain('<br/>');
  expect(clean).toContain('<img src="/a.png" alt="a"/>');
  expect(clean).toContain('<hr/>');
  if (clean.includes('</br>')) expect.unreachable("Expected !clean.includes('</br>')");
  if (clean.includes('</img>')) expect.unreachable("Expected !clean.includes('</img>')");
  if (clean.includes('</hr>')) expect.unreachable("Expected !clean.includes('</hr>')");
});

testCase('sanitizeInlineHtml preserves data-ssml and data-reading-type', () => {
  const dirty =
    `<span data-ssml='{"sub":{"alias":"Froyd"}}' data-reading-type="computer-read-aloud">Freud</span>`;
  const clean = sanitizeInlineHtml(dirty);
  expect(clean).toContain('data-ssml="{&quot;sub&quot;:{&quot;alias&quot;:&quot;Froyd&quot;}}"');
  expect(clean).toContain('data-reading-type="computer-read-aloud"');
});

testCase('sanitization is idempotent for encoded text and attributes', () => {
  const dirty = '<p>A &amp; B <a href="/search?a=1&amp;b=2" title="ignored">Link</a></p>';
  const once = sanitizeBodyHtml(dirty);

  expect(once).toContain('A &amp; B');
  expect(once).toContain('href="/search?a=1&amp;b=2"');
  if (!(sanitizeBodyHtml(once) === once)) {
    expect.unreachable('Expected sanitizeBodyHtml(once) === once');
  }
});
