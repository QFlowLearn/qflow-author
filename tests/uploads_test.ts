import { expect, test as testCase } from 'vitest';

import { publicUrlForUpload } from '../lib/uploads.ts';

testCase('publicUrlForUpload reads request-scoped upload base when provided', () => {
  expect(publicUrlForUpload('upload-1')).toStrictEqual('/uploads/upload-1');
  expect(publicUrlForUpload('upload-1', {
    bindings: { QFLOW_UPLOAD_BASE: 'https://cdn.example/uploads/' },
  })).toStrictEqual('https://cdn.example/uploads/upload-1');
});
