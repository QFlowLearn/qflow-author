import { childElements, findChildByLocalName as child } from '../../import/xml_dom.ts';

const template = 'https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct';

/** Project optional presentation into the supported plain-text single-choice pool contract.
 * Owns the parsed derivative only; never changes the saved question. Media and custom scoring
 * remain ineligible because removing them could change the question or its correct answer.
 */
export function prepareSakaiSource(root: Element):
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: string } {
  const warnings = new Set<string>();
  const body = child(root, 'qti-item-body');
  const interaction = child(body, 'qti-choice-interaction');
  if (!body || !interaction) return { ok: false, code: 'sakai.unsupported_interaction_or_scoring' };
  const prose = childElements(body).filter((node) => node !== interaction);
  const choices = childElements(interaction);
  if (
    prose.some((node) => node.localName !== 'p' || !plainPresentation(node)) ||
    choices.some((node) => !plainPresentation(node))
  ) return { ok: false, code: 'sakai.essential_content_unsupported' };
  const rich =
    [...prose, ...choices].some((node) =>
      childElements(node).length > 0 || (node.localName === 'p' && node.attributes.length > 0)
    ) || prose.length > 1;
  if (rich) {
    warnings.add('sakai.presentation_simplified');
    for (const node of choices) node.textContent = presentationText(node);
    if (prose.length) {
      const prompt = root.ownerDocument.createElement('p');
      prompt.textContent = prose.map(presentationText).join('\n\n');
      body.insertBefore(prompt, prose[0]);
      for (const node of prose) body.removeChild(node);
    }
  }
  if (interaction.getAttribute('shuffle') === 'true') {
    interaction.setAttribute('shuffle', 'false');
    warnings.add('sakai.fixed_choice_order');
  }
  return isSupportedSakaiSource(root)
    ? { ok: true, warnings: [...warnings].sort() }
    : { ok: false, code: 'sakai.unsupported_interaction_or_scoring' };
}

function plainPresentation(node: Element): boolean {
  // Sub/sup, math, media and linked resources carry meaning and cannot be flattened here.
  return childElements(node).every((element) =>
    ['strong', 'em', 'b', 'i', 'span', 'br'].includes(element.localName) &&
    Array.from({ length: element.attributes.length }, (_, i) => element.attributes[i].name)
      .every((name) => ['class', 'style', 'xml:lang', 'lang'].includes(name)) &&
    plainPresentation(element)
  );
}

function presentationText(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (node.nodeType === 1 && node.nodeName.toLowerCase() === 'br') return '\n';
  if (!node.childNodes.length) {
    return '';
  }
  return Array.from(
    { length: node.childNodes.length },
    (_, i) => presentationText(node.childNodes[i]),
  ).join('');
}

function isSupportedSakaiSource(root: Element): boolean {
  if (
    root.localName !== 'qti-assessment-item' ||
    root.namespaceURI !== 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0' ||
    root.getAttribute('time-dependent') !== 'false'
  ) return false;
  const children = childElements(root);
  const rootAttributes = new Set([
    'xmlns',
    'xmlns:xsi',
    'xsi:schemaLocation',
    'identifier',
    'title',
    'time-dependent',
    'xml:lang',
  ]);
  for (let i = 0; i < root.attributes.length; i++) {
    if (!rootAttributes.has(root.attributes[i].name)) return false;
  }
  if (children.length !== 4) return false;
  const response = child(root, 'qti-response-declaration');
  const outcome = child(root, 'qti-outcome-declaration');
  const body = child(root, 'qti-item-body');
  const processing = child(root, 'qti-response-processing');
  if (!response || !outcome || !body || !processing) return false;
  if (
    response.getAttribute('cardinality') !== 'single' ||
    response.getAttribute('base-type') !== 'identifier' ||
    childElements(response).length !== 1 || response.attributes.length !== 3 ||
    outcome.getAttribute('identifier') !== 'SCORE' ||
    outcome.getAttribute('cardinality') !== 'single' ||
    outcome.getAttribute('base-type') !== 'float' || childElements(outcome).length ||
    outcome.attributes.length !== 3 ||
    processing.getAttribute('template') !== template ||
    processing.attributes.length !== 1 || childElements(processing).length
  ) return false;
  const correct = child(response, 'qti-correct-response');
  const values = correct && childElements(correct);
  if (
    !correct || !values || correct.attributes.length || values.length !== 1 ||
    values[0].localName !== 'qti-value' ||
    childElements(values[0]).length || values[0].attributes.length || body.attributes.length
  ) return false;
  const content = childElements(body);
  const interaction = child(body, 'qti-choice-interaction');
  if (
    !interaction || interaction.getAttribute('max-choices') !== '1' ||
    interaction.getAttribute('min-choices') !== '1' ||
    interaction.getAttribute('shuffle') !== 'false' ||
    interaction.getAttribute('response-identifier') !== response.getAttribute('identifier') ||
    interaction.attributes.length !== 4
  ) return false;
  // A single plain paragraph has been reconciled in Sakai.
  if (
    content.filter((node) => node !== interaction).some((node) =>
      node.localName !== 'p' || node.attributes.length || childElements(node).length
    ) || content.length > 2
  ) return false;
  const choices = childElements(interaction);
  const identifiers = choices.map((choice) => choice.getAttribute('identifier'));
  return choices.length >= 2 && choices.length <= 26 &&
    choices.every((choice) =>
      choice.localName === 'qti-simple-choice' &&
      choice.attributes.length === 1 && !childElements(choice).length &&
      Boolean(choice.textContent?.trim())
    ) &&
    identifiers.every(Boolean) && new Set(identifiers).size === choices.length &&
    identifiers.includes(values[0].textContent);
}
