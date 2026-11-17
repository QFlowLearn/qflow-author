/** Runtime and intake metadata shared by one deterministic import adapter. */
export type ImportAdapterDescriptor = {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly priority: number;
};

/** Stable configured adapter inventory and deterministic inspection order. */
export const DEFAULT_IMPORT_ADAPTER_KEYS = [
  'qti3',
  'imscc',
  'qti21',
  'qti12',
  'blackboard',
  'examViewXml',
  'moodleXml',
  'respondusStandard',
  'gift',
  'aiken',
] as const;

/** Key used to bind one configured adapter descriptor to its implementation. */
export type ImportAdapterDescriptorKey = typeof DEFAULT_IMPORT_ADAPTER_KEYS[number];

/** Canonical metadata for every configured assessment import adapter. */
export const IMPORT_ADAPTER_DESCRIPTORS = {
  qti3: {
    id: 'qti3',
    version: '1',
    label: 'QTI 3.0 Package',
    extensions: ['.zip'],
    priority: 100,
  },
  imscc: {
    id: 'imscc',
    version: '1',
    label: 'IMS Common Cartridge',
    extensions: ['.imscc', '.zip'],
    priority: 89,
  },
  qti21: {
    id: 'qti21',
    version: '1',
    label: 'QTI 2.0/2.1/2.2',
    extensions: ['.xml', '.zip'],
    priority: 90,
  },
  qti12: {
    id: 'qti12',
    version: '1',
    label: 'QTI 1.2/1.2.1',
    extensions: ['.xml', '.dat', '.zip'],
    priority: 80,
  },
  blackboard: {
    id: 'blackboard',
    version: '1',
    label: 'Blackboard',
    extensions: ['.zip', '.dat', '.xml'],
    priority: 78,
  },
  examViewXml: {
    id: 'examview-xml',
    version: '1',
    label: 'ExamView XML 4',
    extensions: ['.xml'],
    priority: 92,
  },
  moodleXml: {
    id: 'moodle_xml',
    version: '1',
    label: 'Moodle XML',
    extensions: ['.xml'],
    priority: 85,
  },
  respondusStandard: {
    id: 'respondus-standard',
    version: '1',
    label: 'Respondus Standard Format',
    extensions: ['.txt', '.respondus', '.docx'],
    priority: 78,
  },
  gift: {
    id: 'gift',
    version: '1',
    label: 'GIFT',
    extensions: ['.txt', '.gift', '.gft'],
    priority: 70,
  },
  aiken: {
    id: 'aiken',
    version: '1',
    label: 'Aiken',
    extensions: ['.txt', '.aiken'],
    priority: 68,
  },
} as const satisfies Readonly<Record<ImportAdapterDescriptorKey, ImportAdapterDescriptor>>;

/** Canonical descriptors in runtime inspection order. */
export const DEFAULT_IMPORT_ADAPTER_DESCRIPTORS: readonly ImportAdapterDescriptor[] =
  DEFAULT_IMPORT_ADAPTER_KEYS.map((key) => IMPORT_ADAPTER_DESCRIPTORS[key]);
