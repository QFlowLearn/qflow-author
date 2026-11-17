import { childElements, localName } from '../import/xml_dom.ts';
import type { PrintContent, PrintMath } from './print_contract.ts';
import { validateItemLanguage } from '../types/item_language.ts';

type ContentResult =
  | { readonly ok: true; readonly content: readonly PrintContent[] }
  | { readonly ok: false; readonly code: string };

/** Parse visible canonical XML content. Unknown content is a blocker, never omitted text. */
export function parsePrintContent(root: Element, language: string, depth = 0): ContentResult {
  if (depth > 30) return { ok: false, code: 'content_depth' };
  const rootLanguage = printContentLanguage(root, language);
  if (!rootLanguage) return { ok: false, code: 'language_invalid' };
  if (!printPresentationSupported(root)) return { ok: false, code: 'unsupported_presentation' };
  const content: PrintContent[] = [];
  for (let index = 0; index < root.childNodes.length; index++) {
    const node = root.childNodes.item(index);
    if (!node) continue;
    if (node.nodeType === 3 || node.nodeType === 4) {
      if (node.textContent) content.push({ kind: 'text', text: node.textContent });
      continue;
    }
    if (node.nodeType === 8) continue;
    if (node.nodeType !== 1) return { ok: false, code: 'unsupported_content' };
    // SAFETY: nodeType 1 establishes an XML Element at the DOM adapter boundary.
    const element = node as Element;
    const name = localName(element).replace(/^qti-/, '');
    const lang = printContentLanguage(element, rootLanguage);
    if (!lang) return { ok: false, code: 'language_invalid' };
    if (name === 'qflow-print-response') {
      const prompt = parsePrintContent(element, lang, depth + 1);
      if (!prompt.ok) return prompt;
      content.push({ kind: 'response', prompt: prompt.content });
      continue;
    }
    if (!printPresentationSupported(element)) {
      return { ok: false, code: 'unsupported_presentation' };
    }
    if (name === 'br') {
      content.push({ kind: 'break' });
      continue;
    }
    if (name === 'math') {
      const math = parseMath(element);
      if (!math) return { ok: false, code: 'unsupported_math' };
      content.push({
        kind: 'math',
        expression: math,
        block: element.getAttribute('display') === 'block',
        language: lang,
      });
      continue;
    }
    if (name === 'img') {
      const source = element.getAttribute('src'), alt = element.getAttribute('alt');
      if (!source || !alt?.trim()) return { ok: false, code: 'image_unavailable' };
      content.push({ kind: 'image', source, alt, language: lang });
      continue;
    }
    const kinds = {
      p: 'paragraph',
      div: 'group',
      span: 'group',
      strong: 'strong',
      b: 'strong',
      em: 'emphasis',
      i: 'emphasis',
      ul: 'list',
      ol: 'ordered-list',
      li: 'list-item',
      blockquote: 'quote',
      prompt: 'group',
      'content-body': 'group',
    } as const;
    if (!Object.hasOwn(kinds, name)) return { ok: false, code: 'unsupported_content' };
    // SAFETY: exact own-key membership was established immediately above.
    const kind = kinds[name as keyof typeof kinds];
    const nested = parsePrintContent(element, lang, depth + 1);
    if (!nested.ok) return nested;
    content.push({ kind, children: nested.content, language: lang });
  }
  return {
    ok: true,
    content: rootLanguage === language
      ? content
      : [{ kind: 'group', children: content, language: rootLanguage }],
  };
}

/** Conditional/hidden presentation has no automatic paper equivalent, including on roots. */
export function printPresentationSupported(element: Element): boolean {
  return ![
    'style',
    'hidden',
    'show-hide',
    'template-identifier',
    'data-show',
    'data-hide',
    'data-condition',
  ].some((name) => element.hasAttribute(name)) &&
    element.getAttribute('aria-hidden') !== 'true' &&
    !element.getAttribute('class')?.split(/\s+/).some((c) =>
      /^(?:qti-hidden|qti-visible|qti-feedback|qti-reveal)/.test(c)
    );
}

/** Resolve and validate authored language along the actual canonical ancestry. */
export function printContentLanguage(element: Element, inherited: string): string | null {
  const ancestry: Element[] = [element];
  let parent = element.parentNode;
  while (parent?.nodeType === 1) {
    // SAFETY: nodeType 1 establishes an XML Element.
    ancestry.unshift(parent as Element);
    parent = parent.parentNode;
  }
  let result = inherited;
  for (const ancestor of ancestry) {
    const language = ancestor.getAttribute('xml:lang') || ancestor.getAttribute('lang');
    if (language) {
      const parsed = validateItemLanguage(language);
      if (!parsed.ok) return null;
      result = parsed.value;
    }
  }
  return result;
}

/** Translate a bounded MathML subset into explicit renderer functions. No source evaluation. */
function parseMath(element: Element, depth = 0): PrintMath | null {
  if (depth > 12) return null;
  const name = localName(element);
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (!attribute || !['xmlns', 'xml:lang', 'lang', 'display'].includes(attribute.name)) {
      return null;
    }
    if (
      attribute.name === 'display' &&
      (name !== 'math' || !['inline', 'block'].includes(attribute.value))
    ) return null;
  }
  const children = childElements(element);
  const values = children.map((child) => parseMath(child, depth + 1));
  if (values.some((value) => value === null)) return null;
  if (name === 'mi' || name === 'mn' || name === 'mo') {
    if (children.length || !element.textContent || element.textContent.length > 64) return null;
    return {
      kind: name === 'mi' ? 'identifier' : name === 'mn' ? 'number' : 'operator',
      value: element.textContent,
    };
  }
  if (name === 'math' || name === 'mrow') {
    if (!values.length || values.length > 30) return null;
    return { kind: 'row', children: values.filter((value) => value !== null) };
  }
  const [left, right] = values;
  if (
    (name === 'msup' || name === 'msub' || name === 'mfrac') && values.length === 2 && left && right
  ) {
    return { kind: name === 'msup' ? 'sup' : name === 'msub' ? 'sub' : 'fraction', left, right };
  }
  if (name === 'msqrt' && values.length === 1 && left) return { kind: 'sqrt', body: left };
  return null;
}
