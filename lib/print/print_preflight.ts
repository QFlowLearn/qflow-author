import { parseXmlStrict } from '../import/xml_dom.ts';
import { parsePrintContent } from './print_content.ts';
import type {
  PrintConfiguration,
  PrintContent,
  PrintFinding,
  PrintPreflight,
  PrintQuestion,
} from './print_contract.ts';
import { parsePrintQuestion } from './print_question.ts';
import type { PrintSource } from './print_snapshot.ts';

export type PrintPreparedPart = {
  readonly id: string;
  readonly title: string;
  readonly instructions: readonly PrintContent[];
  readonly placements: readonly (
    | { readonly kind: 'question'; readonly id: string; readonly question: PrintQuestion }
    | { readonly kind: 'content'; readonly id: string; readonly content: readonly PrintContent[] }
  )[];
};

/** Evaluate all placements and section behavior before reserving or compiling a paper. */
export function preflightPrint(
  source: PrintSource,
  configuration: PrintConfiguration,
  assetProblems: ReadonlyMap<string, string> = new Map(),
): {
  readonly preflight: PrintPreflight;
  readonly parts: readonly PrintPreparedPart[];
} {
  // Bound the complete paper before allocating any DOM/AST. Metadata and data URLs count too.
  const anchorCount = source.parts.reduce((count, part) => count + part.placements.length, 0);
  const questions = source.parts.reduce(
    (count, part) =>
      count + part.placements.filter((placement) => placement.kind !== 'content').length,
    0,
  );
  let sourceBytes =
    new TextEncoder().encode(JSON.stringify({ metadata: source.assessmentMetadata, configuration }))
      .length;
  for (const part of source.parts) {
    sourceBytes += new TextEncoder().encode(part.title + JSON.stringify(part.options)).length;
    for (const placement of part.placements) {
      sourceBytes += new TextEncoder().encode(
        placement.kind === 'question'
          ? placement.xml
          : placement.kind === 'content'
          ? JSON.stringify(placement.content)
          : '',
      ).length;
      if (sourceBytes > 500000) {
        break;
      }
    }
    if (sourceBytes > 500000) break;
  }
  if (source.parts.length > 100 || anchorCount > 200 || questions > 100 || sourceBytes > 500000) {
    return {
      parts: [],
      preflight: {
        destinationId: 'printable-pack',
        outcome: 'blocked',
        items: source.parts.flatMap((part) => [
          {
            placementId: part.id,
            title: part.title,
            outcome: 'Blocked' as const,
            codes: ['source_limit'],
          },
          ...part.placements.map((placement) => ({
            placementId: placement.id,
            title: placement.kind === 'question' ? placement.staffTitle : part.title,
            outcome: 'Blocked' as const,
            codes: ['source_limit'],
          })),
        ]),
      },
    };
  }
  const findings: PrintFinding[] = [], parts: PrintPreparedPart[] = [];
  let questionCount = 0;
  for (const part of source.parts) {
    const placements: PrintPreparedPart['placements'][number][] = [];
    const partCodes: string[] = [];
    if (source.adaptive) partCodes.push('adaptive_unsupported');
    if (
      part.options.timeLimits &&
      Object.values(part.options.timeLimits).some((value) => value !== undefined)
    ) partCodes.push('timing_unsupported');
    if (part.options.feedback?.length) partCodes.push('conditional_feedback');
    if (part.options.navigationMode === 'linear') partCodes.push('linear_navigation_unsupported');
    let instructions: readonly PrintContent[] = [];
    if (part.options.instructionsHtml) {
      const parsed = parseFragment(part.options.instructionsHtml, configuration.locale);
      if (parsed.ok) instructions = parsed.content;
      else partCodes.push(parsed.code);
    }
    partCodes.push(...assetCodes(contentImages(instructions), assetProblems));
    if (partCodes.length) {
      findings.push({
        placementId: part.id,
        title: part.title,
        outcome: 'Blocked',
        codes: partCodes,
      });
    }
    for (const placement of part.placements) {
      const codes = [...partCodes];
      let responseSpace = false;
      let needsAdaptation = !configuration.approvePresentation;
      if (placement.kind === 'unavailable') {
        questionCount++;
        codes.push(placement.reason ?? 'revision_unavailable');
      } else if (placement.kind === 'question') {
        questionCount++;
        const parsed = parsePrintQuestion(placement.xml);
        if (!parsed.ok) codes.push(parsed.code);
        else {
          responseSpace = parsed.question.interaction === 'written';
          const references = questionImageReferences(parsed.question);
          codes.push(...assetCodes(references, assetProblems));
          placements.push({ kind: 'question', id: placement.id, question: parsed.question });
          needsAdaptation ||= parsed.question.shuffled && !configuration.approvePresentation;
        }
      } else {
        const content = placement.content;
        if (content.kind === 'video' || content.kind === 'video-link') {
          codes.push('media_unsupported');
        } else if (content.kind === 'text') {
          placements.push({
            kind: 'content',
            id: placement.id,
            content: [{ kind: 'text', text: content.text }],
          });
        } else {
          codes.push(...assetCodes([content.src], assetProblems));
          placements.push({
            kind: 'content',
            id: placement.id,
            content: [
              {
                kind: 'image',
                source: content.src,
                alt: content.alt,
                language: configuration.locale,
              },
              ...(content.longDescription
                ? [{ kind: 'text' as const, text: content.longDescription }]
                : []),
            ],
          });
        }
      }
      const title = placement.kind === 'question'
        ? placement.staffTitle
        : placement.kind === 'content'
        ? part.title
        : '';
      findings.push({
        placementId: placement.id,
        title,
        responseSpace,
        outcome: codes.length ? 'Blocked' : needsAdaptation ? 'NeedsAdaptation' : 'Ready',
        codes: codes.length ? codes : needsAdaptation ? ['approve_paper_presentation'] : [],
      });
    }
    parts.push({ id: part.id, title: part.title, instructions, placements });
  }
  if (!questionCount || questionCount > 100) {
    findings.push({
      placementId: source.assessmentId,
      title: source.assessmentTitle,
      outcome: 'Blocked',
      codes: [questionCount ? 'question_limit' : 'empty_assessment'],
    });
  }
  if (JSON.stringify(parts).length > 160000) {
    findings.push({
      placementId: source.assessmentId,
      title: source.assessmentTitle,
      outcome: 'Blocked',
      codes: ['source_limit'],
    });
  }
  const outcome = findings.some((finding) => finding.outcome === 'Blocked')
    ? 'blocked'
    : findings.some((finding) => finding.outcome === 'NeedsAdaptation')
    ? 'needs-adaptation'
    : 'ready';
  return { preflight: { destinationId: 'printable-pack', outcome, items: findings }, parts };
}

/** Item/stimulus/rubric image references are retained from the authorized source, never fetched by renderer. */
export function printImageReferences(parts: readonly PrintPreparedPart[]): readonly string[] {
  return [
    ...new Set(
      parts.flatMap((
        part,
      ) => [
        ...contentImages(part.instructions),
        ...part.placements.flatMap((placement) =>
          placement.kind === 'question'
            ? questionImageReferences(placement.question)
            : contentImages(placement.content)
        ),
      ]),
    ),
  ];
}
function questionImageReferences(question: PrintQuestion): readonly string[] {
  return [
    ...contentImages(question.content),
    ...question.choices.flatMap((choice) => contentImages(choice.content)),
    ...(question.scoring.kind === 'manual' ? contentImages(question.scoring.guidance) : []),
  ];
}
function contentImages(content: readonly PrintContent[]): readonly string[] {
  return content.flatMap((node) =>
    node.kind === 'image'
      ? [node.source]
      : 'children' in node
      ? contentImages(node.children)
      : node.kind === 'response'
      ? contentImages(node.prompt)
      : []
  );
}
function parseFragment(html: string, language: string) {
  try {
    return parsePrintContent(
      parseXmlStrict(`<div>${html}</div>`, 'print instructions').documentElement,
      language,
    );
  } catch {
    return { ok: false as const, code: 'invalid_content' };
  }
}
function assetCodes(
  references: readonly string[],
  problems: ReadonlyMap<string, string>,
): readonly string[] {
  return [
    ...new Set(references.flatMap((reference) => {
      const code = problems.get(reference);
      return code === undefined ? [] : [code];
    })),
  ];
}
