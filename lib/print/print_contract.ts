import { type InterfaceLocale, parseInterfaceLocale } from '../i18n/locale.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** One deliberately small paper presentation contract; order is always concrete and explicit. */
export type PrintConfiguration = {
  readonly title: string;
  readonly paper: 'a4' | 'letter';
  readonly locale: InterfaceLocale;
  readonly instructions: string;
  readonly responseLines: number;
  readonly responseOverrides: Readonly<Record<string, number>>;
  readonly order: 'authored';
  readonly approvePresentation: boolean;
};

/** Paper operations reject bad configuration instead of filling in missing settings. */
export function parsePrintConfiguration(input: unknown): PrintConfiguration | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Object.fromEntries(Object.entries(input));
  const fields = [
    'title',
    'paper',
    'locale',
    'instructions',
    'responseLines',
    'responseOverrides',
    'order',
    'approvePresentation',
  ];
  const locale = parseInterfaceLocale(value.locale);
  if (
    Object.keys(value).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(value, key)) ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 ||
    (value.paper !== 'a4' && value.paper !== 'letter') || !locale ||
    typeof value.instructions !== 'string' || value.instructions.length > 4000 ||
    !lines(value.responseLines) || value.order !== 'authored' ||
    typeof value.approvePresentation !== 'boolean' ||
    !value.responseOverrides || typeof value.responseOverrides !== 'object' ||
    Array.isArray(value.responseOverrides)
  ) return null;
  const overrides: Record<string, number> = {};
  for (const [id, count] of Object.entries(value.responseOverrides)) {
    if (!isCanonicalUuid(id) || !lines(count)) return null;
    overrides[id] = count;
  }
  return {
    title: value.title,
    paper: value.paper,
    locale,
    instructions: value.instructions,
    responseLines: value.responseLines,
    responseOverrides: overrides,
    order: 'authored',
    approvePresentation: value.approvePresentation,
  };
}

function lines(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input >= 3 && input <= 18;
}

/** Supported mathematics is structural data, never authored compiler source. */
export type PrintMath =
  | { readonly kind: 'identifier' | 'number' | 'operator'; readonly value: string }
  | { readonly kind: 'row'; readonly children: readonly PrintMath[] }
  | {
    readonly kind: 'sup' | 'sub' | 'fraction';
    readonly left: PrintMath;
    readonly right: PrintMath;
  }
  | { readonly kind: 'sqrt'; readonly body: PrintMath };

/** A canonical content projection with explicit visibility already resolved. */
export type PrintContent =
  | { readonly kind: 'text'; readonly text: string }
  | {
    readonly kind:
      | 'paragraph'
      | 'strong'
      | 'emphasis'
      | 'list'
      | 'ordered-list'
      | 'list-item'
      | 'quote'
      | 'group';
    readonly children: readonly PrintContent[];
    readonly language: string;
  }
  | { readonly kind: 'response'; readonly prompt: readonly PrintContent[] }
  | { readonly kind: 'break' }
  | {
    readonly kind: 'math';
    readonly expression: PrintMath;
    readonly block: boolean;
    readonly language: string;
  }
  | {
    readonly kind: 'image';
    readonly source: string;
    readonly alt: string;
    readonly language: string;
  };

/** All-or-nothing and direct mapped rules can be described without inventing a rubric. */
export type PrintScoring =
  | { readonly kind: 'match'; readonly correct: readonly string[]; readonly maximum: number }
  | {
    readonly kind: 'mapping';
    readonly entries: readonly { readonly option: string; readonly score: number }[];
    readonly defaultScore: number;
    readonly lower: number | null;
    readonly upper: number | null;
  }
  | {
    readonly kind: 'manual';
    readonly guidance: readonly PrintContent[];
    readonly maximum: number | null;
  };

/** Staff source model. This type must never be passed into the student renderer. */
export type PrintQuestion = {
  readonly language: string;
  readonly content: readonly PrintContent[];
  readonly choices: readonly { readonly id: string; readonly content: readonly PrintContent[] }[];
  readonly interaction: 'single' | 'multiple' | 'written';
  readonly selection: { readonly minimum: number; readonly maximum: number } | null;
  readonly scoring: PrintScoring;
  readonly shuffled: boolean;
};

/** Every placement, including unscored content, receives a concrete paper outcome. */
export type PrintFinding = {
  readonly responseSpace?: boolean;
  readonly placementId: string;
  readonly title: string;
  readonly outcome: 'Ready' | 'NeedsAdaptation' | 'Blocked';
  readonly codes: readonly string[];
};

/** A paper preflight is independent of QTI archive/transcoder evidence. */
export type PrintPreflight = {
  readonly destinationId: 'printable-pack';
  readonly outcome: 'ready' | 'needs-adaptation' | 'blocked';
  readonly items: readonly PrintFinding[];
};

/** Typed expected paper-operation failures at the application boundary. */
export type PrintFailureCode =
  | 'invalid_input'
  | 'forbidden'
  | 'not_found'
  | 'blocked'
  | 'stale_preview'
  | 'operation_conflict'
  | 'storage_failed'
  | 'font_unsupported'
  | 'render_failed'
  | 'not_ready'
  | 'snapshot_corrupt';
export type PrintResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PrintFailureCode };
