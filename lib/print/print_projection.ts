import { catalogForLocale } from '../i18n/catalogs.ts';
import { createI18n } from '../i18n/messages.ts';
import type {
  PrintConfiguration,
  PrintContent,
  PrintMath,
  PrintQuestion,
  PrintResult,
} from './print_contract.ts';
import type { PrintPreparedPart } from './print_preflight.ts';
import type { PrintImage } from './print_image.ts';

/** Renderer content cannot name source uploads, database objects, comments or answer declarations. */
export type PaperContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'response'; readonly prompt: readonly PaperContent[] }
  | {
    readonly kind: 'math';
    readonly expression: PrintMath;
    readonly block: boolean;
    readonly language: string;
  }
  | {
    readonly kind: 'image';
    readonly asset: number;
    readonly alt: string;
    readonly language: string;
  }
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
    readonly children: readonly PaperContent[];
    readonly language: string;
  };

type PaperQuestion = {
  readonly kind: 'question';
  readonly number: number;
  readonly language: string;
  readonly content: readonly PaperContent[];
  readonly choices: readonly {
    readonly label: string;
    readonly content: readonly PaperContent[];
  }[];
  readonly responseLines: number;
  readonly selection: string;
};
type MarkingQuestion = PaperQuestion & {
  readonly marking: {
    readonly rules: readonly string[];
    readonly guidance: readonly PaperContent[];
  };
};
type PaperBase = {
  readonly title: string;
  readonly form: string;
  readonly createdAt: string;
  readonly paper: 'a4' | 'us-letter';
  readonly locale: string;
  readonly instructions: string;
  readonly labels: {
    readonly document: string;
    readonly question: string;
    readonly response: string;
    readonly marking: string;
    readonly continued: string;
  };
  readonly images: readonly {
    readonly bytes: Uint8Array;
    readonly format: 'png' | 'jpeg';
  }[];
};
type PaperPart<Question extends PaperQuestion> = {
  readonly title: string;
  readonly instructions: readonly PaperContent[];
  readonly entries:
    readonly (Question | { readonly kind: 'content'; readonly content: readonly PaperContent[] })[];
};

/** Student projection has no marking fields at any depth. */
export type StudentPaper = PaperBase & {
  readonly kind: 'student';
  readonly parts: readonly PaperPart<PaperQuestion>[];
};
/** Staff projection is a separately constructed renderer document. */
export type MarkingPaper = PaperBase & {
  readonly kind: 'marking';
  readonly parts: readonly PaperPart<MarkingQuestion>[];
};
export type PaperDocument = StudentPaper | MarkingPaper;

type ProjectionInput = {
  readonly configuration: PrintConfiguration;
  readonly form: string;
  readonly createdAt: string;
  readonly parts: readonly PrintPreparedPart[];
  readonly assets: ReadonlyMap<string, PrintImage>;
};
type ProjectionAssets = {
  readonly available: ReadonlyMap<string, PrintImage>;
  readonly indexes: Map<string, number>;
  readonly images: { readonly bytes: Uint8Array; readonly format: 'png' | 'jpeg' }[];
};

/** Project explicit public fields; never spread the staff source model into student input. */
export function projectStudentPaper(input: ProjectionInput): PrintResult<StudentPaper> {
  return projectPaper(input, 'student');
}
/** Build a distinct staff model from the same frozen numbering and option order. */
export function projectMarkingPaper(input: ProjectionInput): PrintResult<MarkingPaper> {
  return projectPaper(input, 'marking');
}

function projectPaper(input: ProjectionInput, kind: 'student'): PrintResult<StudentPaper>;
function projectPaper(input: ProjectionInput, kind: 'marking'): PrintResult<MarkingPaper>;
function projectPaper(
  input: ProjectionInput,
  kind: 'student' | 'marking',
): PrintResult<PaperDocument> {
  const i18n = createI18n(input.configuration.locale, catalogForLocale(input.configuration.locale));
  const assets: ProjectionAssets = { available: input.assets, indexes: new Map(), images: [] };
  let number = 0;
  const parts: PaperPart<PaperQuestion | MarkingQuestion>[] = [];
  for (const part of input.parts) {
    const instructions = projectContent(part.instructions, assets);
    if (!instructions) return { ok: false, code: 'storage_failed' };
    const entries:
      (PaperQuestion | MarkingQuestion | { kind: 'content'; content: readonly PaperContent[] })[] =
        [];
    for (const placement of part.placements) {
      const content = projectContent(
        placement.kind === 'question' ? placement.question.content : placement.content,
        assets,
      );
      if (!content) return { ok: false, code: 'storage_failed' };
      if (placement.kind === 'content') {
        entries.push({ kind: 'content', content });
        continue;
      }
      const question = placement.question;
      const choices: PaperQuestion['choices'][number][] = [];
      for (const [index, choice] of question.choices.entries()) {
        const content = projectContent(choice.content, assets);
        if (!content) return { ok: false, code: 'storage_failed' };
        choices.push({ label: String.fromCharCode(65 + index), content });
      }
      const common: PaperQuestion = {
        kind: 'question',
        number: ++number,
        language: question.language,
        content,
        choices,
        responseLines: question.interaction === 'written'
          ? input.configuration.responseOverrides[placement.id] ?? input.configuration.responseLines
          : 0,
        selection: question.selection
          ? i18n.t('print.selection', {
            min: question.selection.minimum,
            max: question.selection.maximum,
          })
          : '',
      };
      if (kind === 'student') entries.push(common);
      else {
        const marking = markingProjection(question, assets, (id, values) => i18n.t(id, values));
        if (!marking) return { ok: false, code: 'storage_failed' };
        entries.push({ ...common, marking });
      }
    }
    parts.push({ title: part.title, instructions, entries });
  }
  const base: PaperBase = {
    title: input.configuration.title,
    form: input.form,
    createdAt: input.createdAt,
    paper: input.configuration.paper === 'a4' ? 'a4' : 'us-letter',
    locale: input.configuration.locale,
    instructions: input.configuration.instructions,
    images: assets.images,
    labels: {
      document: i18n.t(kind === 'student' ? 'print.student' : 'print.marking'),
      question: i18n.t('print.question'),
      response: i18n.t('print.response'),
      marking: i18n.t('print.marking'),
      continued: i18n.t('print.continued'),
    },
  };
  if (kind === 'student') return { ok: true, value: { ...base, kind, parts } };
  // Every entry in the staff branch above was explicitly constructed with marking data.
  const staffParts: PaperPart<MarkingQuestion>[] = [];
  for (const part of parts) {
    const entries: PaperPart<MarkingQuestion>['entries'][number][] = [];
    for (const entry of part.entries) {
      if (entry.kind === 'content') entries.push(entry);
      else if ('marking' in entry) entries.push(entry);
      else throw new Error('Marking projection lost its scoring model.');
    }
    staffParts.push({ title: part.title, instructions: part.instructions, entries });
  }
  return { ok: true, value: { ...base, kind, parts: staffParts } };
}

function projectContent(
  content: readonly PrintContent[],
  assets: ProjectionAssets,
): readonly PaperContent[] | null {
  const result: PaperContent[] = [];
  for (const node of content) {
    if (node.kind === 'image') {
      const asset = assets.available.get(node.source);
      if (!asset) return null;
      let index = assets.indexes.get(node.source);
      if (index === undefined) {
        index = assets.images.length;
        assets.indexes.set(node.source, index);
        assets.images.push({
          bytes: asset.bytes,
          format: asset.mediaType === 'image/png' ? 'png' : 'jpeg',
        });
      }
      result.push({ kind: 'image', asset: index, alt: node.alt, language: node.language });
    } else if ('children' in node) {
      const children = projectContent(node.children, assets);
      if (!children) return null;
      result.push({ kind: node.kind, children, language: node.language });
    } else if (node.kind === 'response') {
      const prompt = projectContent(node.prompt, assets);
      if (!prompt) return null;
      result.push({ kind: 'response', prompt });
    } else if (node.kind === 'text') result.push({ kind: 'text', text: node.text });
    else if (node.kind === 'math') {
      result.push({
        kind: 'math',
        expression: node.expression,
        block: node.block,
        language: node.language,
      });
    } else result.push({ kind: 'break' });
  }
  return result;
}

function markingProjection(
  question: PrintQuestion,
  assets: ProjectionAssets,
  t: (id: string, values?: Readonly<Record<string, string | number>>) => string,
): MarkingQuestion['marking'] | null {
  const scoring = question.scoring;
  const label = (id: string) =>
    String.fromCharCode(65 + question.choices.findIndex((choice) => choice.id === id));
  if (scoring.kind === 'manual') {
    const guidance = projectContent(scoring.guidance, assets);
    return guidance
      ? {
        guidance,
        rules: [
          t('print.manual'),
          ...(scoring.maximum === null
            ? []
            : [t('print.maximum', { score: String(scoring.maximum) })]),
        ],
      }
      : null;
  }
  if (scoring.kind === 'match') {
    return {
      guidance: [],
      rules: [
        t('print.correct', { labels: scoring.correct.map(label).join(', ') }),
        t('print.exactScoring', { score: String(scoring.maximum) }),
      ],
    };
  }
  return {
    guidance: [],
    rules: [
      t('print.mapping'),
      ...scoring.entries.map((entry) =>
        t('print.mappingEntry', { option: label(entry.option), score: String(entry.score) })
      ),
      t('print.mappingDefault', { score: String(scoring.defaultScore) }),
      t('print.emptyZero'),
      ...(scoring.lower === null ? [] : [t('print.lower', { score: String(scoring.lower) })]),
      ...(scoring.upper === null ? [] : [t('print.upper', { score: String(scoring.upper) })]),
    ],
  };
}
