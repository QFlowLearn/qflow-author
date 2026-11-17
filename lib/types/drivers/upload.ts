import type { TypeDriver } from '../registry.ts';
import type { UploadDraft } from '../upload.ts';
import { defaultsUpload, toQti3UploadAuthoringItem, validateUpload } from '../upload.ts';

export const uploadDriver: TypeDriver<UploadDraft> = {
  id: 'upload',
  label: 'Upload',
  defaults: () => defaultsUpload(),
  validate: (d) => validateUpload(d),
  toQti3AuthoringItem: (d, opts) => toQti3UploadAuthoringItem(d, opts),
};
