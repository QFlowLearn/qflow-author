export function xmlEscape(s: string) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function normalizeXmlForParsing(xml: string): string {
  const withoutBom = (xml ?? '').replace(/^\uFEFF+/, '');
  if (/^\s*<\?xml[\t\n\r ]/i.test(withoutBom)) {
    return withoutBom.replace(/^\s+/, '');
  }
  return withoutBom;
}
