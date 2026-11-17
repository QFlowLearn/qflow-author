export type CurriculumStandardAlignment = {
  standardId: string;
  code?: string | null;
  label?: string | null;
  uri?: string | null;
  providerId?: string | null;
  resourceLabel?: string | null;
};

export type StandardsByItem = Record<string, CurriculumStandardAlignment[]>;

const STANDARD_COLLECTION_KEYS = [
  'standards',
  'standardAlignments',
  'standardsAlignments',
  'curriculumStandards',
  'learningStandards',
] as const;

export function extractCurriculumStandards(
  ...sources: Array<Record<string, unknown> | null | undefined>
): CurriculumStandardAlignment[] {
  const standards: CurriculumStandardAlignment[] = [];

  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    for (const key of STANDARD_COLLECTION_KEYS) {
      standards.push(...normalizeStandardCollection(source[key]));
    }
  }

  return dedupeStandards(standards);
}

export function normalizeStandardCollection(value: unknown): CurriculumStandardAlignment[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeStandardAlignment).filter((
      standard,
    ): standard is CurriculumStandardAlignment => Boolean(standard));
  }
  const normalized = normalizeStandardAlignment(value);
  return normalized ? [normalized] : [];
}

function normalizeStandardAlignment(value: unknown): CurriculumStandardAlignment | null {
  if (typeof value === 'string') {
    const text = cleanString(value);
    if (!text) return null;
    return {
      standardId: text,
      code: inferStandardCode(text),
      label: text,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = firstString(record, [
    'label',
    'targetName',
    'text',
    'standardLabel',
    'description',
    'statement',
    'fullStatement',
    'title',
  ]);
  const code = firstString(record, ['code', 'standardCode', 'humanCodingScheme']) ??
    (label ? inferStandardCode(label) : null);
  const uri = firstString(record, [
    'uri',
    'URI',
    'url',
    'standardUri',
    'standardURI',
    'caseItemURI',
    'caseItemUri',
    'targetUrl',
  ]);
  const standardId = firstString(record, [
    'standardId',
    'identifier',
    'id',
    'guid',
    'GUID',
    'caseItemId',
    'caseId',
  ]) ?? uri ?? code ?? label;

  if (!standardId) return null;

  return {
    standardId,
    code,
    label: label ?? code ?? standardId,
    uri,
    providerId: firstString(record, [
      'providerId',
      'providerID',
      'providerIdentifier',
      'provider',
      'source',
    ]),
    resourceLabel: firstString(record, ['resourceLabel']),
  };
}

function dedupeStandards(
  standards: CurriculumStandardAlignment[],
): CurriculumStandardAlignment[] {
  const seen = new Set<string>();
  const deduped: CurriculumStandardAlignment[] = [];

  for (const standard of standards) {
    const key = [
      standard.providerId ?? '',
      standard.standardId,
      standard.resourceLabel ?? '',
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(standard);
  }

  return deduped;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString(record[key]);
    if (value) return value;
  }
  return null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function inferStandardCode(label: string): string | null {
  const code = label.trim().split(/\s+/)[0] ?? '';
  return /[A-Za-z0-9]+(?:[.\-:][A-Za-z0-9]+)+/.test(code) ? code : null;
}
