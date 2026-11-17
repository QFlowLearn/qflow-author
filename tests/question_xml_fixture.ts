/** Returns a small parseable QTI 3 item for persistence-boundary tests. */
export function questionXmlFixture(identifier = 'test-item'): string {
  if (!/^[A-Za-z_][A-Za-z0-9._-]*$/.test(identifier)) {
    throw new Error('The QTI fixture identifier is invalid.');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  identifier="${identifier}"
  title="Test item"
  time-dependent="false"
  xml:lang="en-US">
  <qti-item-body><p>Test item</p></qti-item-body>
</qti-assessment-item>`;
}
