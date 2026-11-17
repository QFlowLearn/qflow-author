import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { createQtiMigratorAdapter } from './qti_migrator.ts';

export const qti21Adapter = createQtiMigratorAdapter({
  ...IMPORT_ADAPTER_DESCRIPTORS.qti21,
  formats: ['qti21', 'qti22'],
});
