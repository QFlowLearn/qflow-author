import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { createQtiMigratorAdapter } from './qti_migrator.ts';

export const qti12Adapter = createQtiMigratorAdapter({
  ...IMPORT_ADAPTER_DESCRIPTORS.qti12,
  formats: ['qti12'],
});
