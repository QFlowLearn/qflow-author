import {
  DEFAULT_IMPORT_ADAPTER_DESCRIPTORS,
  IMPORT_ADAPTER_DESCRIPTORS,
} from '../import/adapter_descriptors.ts';
import {
  formatSourceByteLimit,
  MAX_NATIVE_QTI_ENTRY_BYTES,
  MAX_NATIVE_QTI_EXPANDED_BYTES,
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_ARCHIVE_EXPANDED_BYTES,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_FILES,
} from './policy.ts';

type SourceFormat = {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
};

type RecoverySourceAdvisory = SourceFormat & {
  readonly message: string;
};

export const GENERATION_SOURCE_FORMATS = [
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
  },
  {
    id: 'docx',
    label: 'Word',
    extensions: ['.docx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown'],
    mimeTypes: ['text/markdown'],
  },
  {
    id: 'text',
    label: 'plain text',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
  },
] as const;

const RECOVERY_SOURCE_ADVISORIES = [
  {
    id: 'examview-native',
    label: 'native ExamView',
    extensions: ['.tst', '.bnk'],
    message:
      'QFlowLearn does not parse native ExamView files or bypass their passwords. In ExamView, export a Canvas, Blackboard, or Moodle package, then add that package here.',
  },
] as const satisfies readonly RecoverySourceAdvisory[];

export const RECOVERY_SOURCE_ACCEPT = acceptFor([
  ...DEFAULT_IMPORT_ADAPTER_DESCRIPTORS,
  ...RECOVERY_SOURCE_ADVISORIES,
]);
export const GENERATION_SOURCE_ACCEPT = acceptFor(GENERATION_SOURCE_FORMATS);
export const RESPONDUS_SOURCE_ACCEPT = acceptFor([
  IMPORT_ADAPTER_DESCRIPTORS.respondusStandard,
]);

/** Concise recovery batch limits shared by every recovery entry point. */
export const RECOVERY_BATCH_LIMIT_HELP = `Up to ${MAX_SOURCE_FILES} files and ${
  formatSourceByteLimit(MAX_SOURCE_BATCH_BYTES)
} total.`;

export const RECOVERY_SOURCE_HELP = `${
  DEFAULT_IMPORT_ADAPTER_DESCRIPTORS.map((format) => format.label).join(', ')
}. Native ExamView files receive export instructions. ${RECOVERY_BATCH_LIMIT_HELP} After extraction, a ZIP package can contain up to ${MAX_SOURCE_ARCHIVE_ENTRIES.toLocaleString()} entries and ${
  formatSourceByteLimit(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES)
} of content. Native QTI 3 packages support ${
  formatSourceByteLimit(MAX_NATIVE_QTI_EXPANDED_BYTES)
} expanded content, ${formatSourceByteLimit(MAX_NATIVE_QTI_ENTRY_BYTES)} per entry, and ${
  formatSourceByteLimit(MAX_SOURCE_ARCHIVE_EXPANDED_BYTES)
} total assets.`;

export function findRecoverySourceAdvisory(filename: string): string | null {
  const normalized = filename.trim().toLowerCase();
  const advisory = RECOVERY_SOURCE_ADVISORIES.find((format) =>
    format.extensions.some((extension) => normalized.endsWith(extension))
  );
  return advisory?.message ?? null;
}

function acceptFor(formats: ReadonlyArray<{ readonly extensions: readonly string[] }>): string {
  return [...new Set(formats.flatMap((format) => format.extensions))].join(',');
}
