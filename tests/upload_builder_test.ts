import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsUpload } from '../lib/types/upload.ts';

testCase('upload export emits upload interaction XML', async () => {
  const draft = defaultsUpload();
  draft.title = 'Upload';
  draft.responseIdentifier = 'RESPONSE';
  draft.uploadMaxFileSize = 1024;
  draft.uploadFileTypes = '.pdf,.xlsx';
  draft.uploadMultiple = true;

  const xml = exportQti3TestItemXml('upload', draft, { identifier: 'item-upload-1' });
  if (!xml.includes('<qti-upload-interaction')) {
    throw new Error('missing upload interaction');
  }
  if (!xml.includes('base-type="file"')) {
    throw new Error('missing file base-type');
  }
  if (!xml.includes('data-max-size="1024"')) {
    throw new Error('missing max size');
  }
  if (!xml.includes('data-file-types=".pdf,.xlsx"')) {
    throw new Error('missing file types');
  }
  if (!xml.includes('data-multiple="true"')) {
    throw new Error('missing multiple flag');
  }
  await assertQtiXmlWellFormed(xml);
});
