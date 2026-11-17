import { expect, test as testCase } from 'vitest';

import { attachmentContentDisposition } from '../lib/http/attachment_content_disposition.ts';

testCase('attachmentContentDisposition quotes ordinary filenames', () => {
  expect(attachmentContentDisposition('assessment-export.zip')).toStrictEqual(
    'attachment; filename="assessment-export.zip"',
  );
});

testCase('attachmentContentDisposition removes header and quoted-string control characters', () => {
  expect(attachmentContentDisposition('bad"\r\n\\\tname.zip')).toStrictEqual(
    'attachment; filename="bad_____name.zip"',
  );
});
