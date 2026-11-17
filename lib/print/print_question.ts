import {
  childElements,
  findAllDescendantsByLocalName,
  findChildByLocalName,
  localName,
  parseXmlStrict,
} from '../import/xml_dom.ts';
import type { PrintContent, PrintQuestion, PrintScoring } from './print_contract.ts';
import {
  parsePrintContent,
  printContentLanguage,
  printPresentationSupported,
} from './print_content.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';

type QuestionResult =
  | { readonly ok: true; readonly question: PrintQuestion }
  | { readonly ok: false; readonly code: string };

/** Inspect canonical QTI once. Student-visible nodes and staff scoring remain separate. */
export function parsePrintQuestion(xml: string): QuestionResult {
  if (xml.length > 200000 || /<!DOCTYPE|<!ENTITY|qflow-print-response/i.test(xml)) {
    return blocked('invalid_xml');
  }
  let document: Document;
  try {
    document = parseXmlStrict(xml, 'print item');
  } catch {
    return blocked('invalid_xml');
  }
  const root = document.documentElement;
  if (!boundedTree(root)) return blocked('content_depth');
  if (
    localName(root) !== 'qti-assessment-item' ||
    root.namespaceURI !== 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0'
  ) return blocked('invalid_xml');
  if (
    root.getAttribute('adaptive') === 'true' || root.getAttribute('time-dependent') === 'true' ||
    findChildByLocalName(root, 'qti-template-processing') ||
    findChildByLocalName(root, 'qti-template-declaration') ||
    findChildByLocalName(root, 'qti-stylesheet')
  ) return blocked('unsupported_behavior');
  const language = root.getAttribute('xml:lang');
  if (!language?.trim()) return blocked('language_missing');
  const body = findChildByLocalName(root, 'qti-item-body');
  if (!body) return blocked('invalid_xml');
  if ([root, body, ...descendants(body)].some((element) => !printPresentationSupported(element))) {
    return blocked('unsupported_presentation');
  }
  const interactions = descendants(body).filter((node) => localName(node).endsWith('-interaction'));
  if (interactions.length !== 1) return blocked('unsupported_interaction');
  const interaction = interactions[0];
  const kind = localName(interaction);
  if (kind !== 'qti-choice-interaction' && kind !== 'qti-extended-text-interaction') {
    return blocked('unsupported_interaction');
  }
  const responseId = interaction.getAttribute('response-identifier');
  const declarations = childElements(root).filter((node) =>
    localName(node) === 'qti-response-declaration'
  );
  const declaration = declarations[0];
  if (
    declarations.length !== 1 || !responseId || !isValidQtiIdentifier(responseId) ||
    declaration?.getAttribute('identifier') !== responseId
  ) return blocked('unsupported_scoring');
  const cardinality = declaration.getAttribute('cardinality');
  const written = kind === 'qti-extended-text-interaction';
  if (
    written && (cardinality !== 'single' || declaration.getAttribute('base-type') !== 'string' ||
      (interaction.hasAttribute('max-strings') &&
        interaction.getAttribute('max-strings') !== '1') ||
      interaction.hasAttribute('pattern-mask'))
  ) return blocked('unsupported_interaction');
  if (
    !written &&
    ((cardinality !== 'single' && cardinality !== 'multiple') ||
      declaration.getAttribute('base-type') !== 'identifier')
  ) return blocked('unsupported_scoring');
  const optionCount =
    childElements(interaction).filter((node) => localName(node) === 'qti-simple-choice').length;
  const minimum = interaction.hasAttribute('min-choices')
    ? numeric(interaction.getAttribute('min-choices'))
    : 0;
  const rawMaximum = interaction.hasAttribute('max-choices')
    ? numeric(interaction.getAttribute('max-choices'))
    : cardinality === 'single'
    ? 1
    : 0;
  const choiceMaximum = rawMaximum === 0 ? optionCount : rawMaximum;
  let selection: PrintQuestion['selection'] = null;
  if (!written) {
    if (
      minimum === null || choiceMaximum === null || !Number.isInteger(minimum) ||
      !Number.isInteger(choiceMaximum) ||
      minimum < 0 || choiceMaximum < minimum || choiceMaximum > optionCount ||
      (cardinality === 'single' && choiceMaximum !== 1)
    ) return blocked('unsupported_interaction');
    selection = { minimum, maximum: choiceMaximum };
  }

  const rubrics: PrintContent[] = [];
  for (const rubric of findAllDescendantsByLocalName(body, 'qti-rubric-block')) {
    const views = rubric.getAttribute('view')?.split(/\s+/) ?? [];
    if (
      !views.length ||
      views.some((view) =>
        !['candidate', 'scorer', 'author', 'proctor', 'testConstructor', 'tutor'].includes(view)
      )
    ) return blocked('unsupported_visibility');
    const parsed = parsePrintContent(rubric, language);
    if (!parsed.ok) return parsed;
    if (views.includes('scorer')) rubrics.push(...parsed.content);
    if (views.includes('candidate')) {
      const group = document.createElement('div');
      const rubricLanguage = printContentLanguage(rubric, language);
      if (!rubricLanguage) return blocked('language_invalid');
      group.setAttribute('xml:lang', rubricLanguage);
      while (rubric.firstChild) group.appendChild(rubric.firstChild);
      rubric.parentNode?.replaceChild(group, rubric);
    } else rubric.parentNode?.removeChild(rubric);
  }

  const choiceElements = childElements(interaction).filter((node) =>
    localName(node) === 'qti-simple-choice'
  );
  const choices: { id: string; content: readonly PrintContent[] }[] = [];
  for (const choice of choiceElements) {
    const id = choice.getAttribute('identifier');
    if (!id || choices.some((existing) => existing.id === id)) return blocked('invalid_choice');
    const parsed = parsePrintContent(choice, language);
    if (!parsed.ok) return parsed;
    choices.push({ id, content: parsed.content });
  }
  if (!written && (choices.length < 2 || choices.length > 12)) return blocked('choice_limit');
  const processing = findChildByLocalName(root, 'qti-response-processing');
  const maximum = maximumScore(root);
  let scoring: PrintScoring | null;
  if (written) {
    if (processing && (processing.hasAttribute('template') || childElements(processing).length)) {
      return blocked('unsupported_scoring');
    }
    if (!hasGuidance(rubrics)) return blocked('marking_guidance_required');
    scoring = { kind: 'manual', guidance: rubrics, maximum };
  } else {
    scoring = parseScoring(
      processing,
      declaration,
      responseId,
      choices.map((choice) => choice.id),
      maximum,
    );
  }
  if (!scoring) return blocked('unsupported_scoring');

  const marker = document.createElement('qflow-print-response');
  const interactionLanguage = printContentLanguage(interaction, language);
  if (!interactionLanguage) return blocked('language_invalid');
  marker.setAttribute('xml:lang', interactionLanguage);
  const prompt = findChildByLocalName(interaction, 'qti-prompt');
  if (prompt) marker.appendChild(prompt.cloneNode(true));
  const allowed = ['qti-prompt', 'qti-simple-choice'];
  if (childElements(interaction).some((node) => !allowed.includes(localName(node)))) {
    return blocked('unsupported_content');
  }
  interaction.parentNode?.replaceChild(marker, interaction);
  const visible = parsePrintContent(body, language);
  if (!visible.ok) return visible;
  return {
    ok: true,
    question: {
      language,
      content: visible.content,
      choices,
      interaction: written ? 'written' : cardinality === 'single' ? 'single' : 'multiple',
      scoring,
      selection,
      shuffled: interaction.getAttribute('shuffle') === 'true',
    },
  };
}

function parseScoring(
  processing: Element | null,
  declaration: Element,
  responseId: string,
  options: readonly string[],
  maximum: number | null,
): PrintScoring | null {
  if (!processing) return null;
  const correct = findChildByLocalName(declaration, 'qti-correct-response');
  const keyNodes = correct ? childElements(correct) : [];
  if (keyNodes.some((node) => localName(node) !== 'qti-value' || childElements(node).length)) {
    return null;
  }
  const keys = keyNodes.map((node) => node.textContent ?? '');
  if (
    !keys.length || keys.some((key) => !options.includes(key)) || new Set(keys).size !== keys.length
  ) return null;
  if (declaration.getAttribute('cardinality') === 'single' && keys.length !== 1) return null;
  const template = processing.getAttribute('template');
  if (template) {
    if (childElements(processing).length) return null;
    const type = officialTemplate(template);
    if (type === 'matchCorrect') {
      return maximum === null || maximum === 1
        ? { kind: 'match', correct: keys, maximum: 1 }
        : null;
    }
    if (type !== 'mapResponse') return null;
    const mapping = findChildByLocalName(declaration, 'qti-mapping');
    if (!mapping) return null;
    const defaultScore = numeric(mapping.getAttribute('default-value'));
    if (defaultScore === null) return null;
    const entries: { option: string; score: number }[] = [];
    for (const entry of childElements(mapping)) {
      const option = entry.getAttribute('map-key'),
        score = numeric(entry.getAttribute('mapped-value'));
      if (
        localName(entry) !== 'qti-map-entry' || !option || !options.includes(option) ||
        score === null || entries.some((e) => e.option === option) ||
        (entry.hasAttribute('case-sensitive') && entry.getAttribute('case-sensitive') !== 'true')
      ) return null;
      entries.push({ option, score });
    }
    const lower = mapping.hasAttribute('lower-bound')
      ? numeric(mapping.getAttribute('lower-bound'))
      : null;
    const upper = mapping.hasAttribute('upper-bound')
      ? numeric(mapping.getAttribute('upper-bound'))
      : null;
    if (
      (mapping.hasAttribute('lower-bound') && lower === null) ||
      (mapping.hasAttribute('upper-bound') && upper === null) ||
      (lower !== null && upper !== null && lower > upper)
    ) return null;
    return { kind: 'mapping', entries, defaultScore, lower, upper };
  }
  // Only the writer's exact scaled match-correct tree is supported, not arbitrary custom rules.
  if (maximum === null || maximum <= 0) return null;
  const expected =
    `<qti-response-processing><qti-response-condition><qti-response-if><qti-match><qti-variable identifier="${responseId}"/><qti-correct identifier="${responseId}"/></qti-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">${maximum}</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value></qti-response-else></qti-response-condition></qti-response-processing>`;
  const canonical = parseXmlStrict(expected, 'owned scoring pattern').documentElement;
  return signature(processing) === signature(canonical)
    ? { kind: 'match', correct: keys, maximum }
    : null;
}

function maximumScore(root: Element): number | null {
  const score = childElements(root).find((node) =>
    localName(node) === 'qti-outcome-declaration' && node.getAttribute('identifier') === 'SCORE'
  );
  return score?.hasAttribute('normal-maximum')
    ? numeric(score.getAttribute('normal-maximum'))
    : null;
}
function numeric(value: string | null): number | null {
  if (value === null || !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function signature(node: Element): string {
  const attrs = Array.from(node.attributes).map((attr) => [attr.name, attr.value]).sort((
    [a],
    [b],
  ) => a.localeCompare(b));
  const children = childElements(node);
  return JSON.stringify([
    localName(node),
    attrs,
    children.length ? children.map(signature) : node.textContent?.trim(),
  ]);
}
function descendants(root: Element): Element[] {
  const result: Element[] = [], pending = [...childElements(root)].reverse();
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    result.push(next);
    pending.push(...childElements(next).reverse());
  }
  return result;
}
function boundedTree(root: Element): boolean {
  const pending = [{ element: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    if (next.depth > 30 || ++count > 10000) return false;
    for (const element of childElements(next.element)) {
      pending.push({ element, depth: next.depth + 1 });
    }
  }
  return true;
}
function officialTemplate(template: string): 'matchCorrect' | 'mapResponse' | null {
  const root = 'https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/';
  if ([`${root}match_correct`, `${root}match_correct.xml`].includes(template)) {
    return 'matchCorrect';
  }
  if ([`${root}map_response`, `${root}map_response.xml`].includes(template)) return 'mapResponse';
  return null;
}
function hasGuidance(nodes: readonly PrintContent[]): boolean {
  return nodes.some((node) =>
    node.kind === 'text' ? node.text.trim().length > 0 : node.kind === 'image' ||
      ('children' in node && hasGuidance(node.children))
  );
}
function blocked(code: string): Extract<QuestionResult, { readonly ok: false }> {
  return { ok: false, code };
}
