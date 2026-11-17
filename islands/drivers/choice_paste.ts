import { nextChoiceId } from '../../lib/choice_labels.ts';
import { sanitizeInlineHtml } from '../../lib/sanitize.ts';
import { escapeHtmlText } from '../rich_text/html_escape.ts';
import type { Choice } from './types.ts';

/** Clipboard content translated into one choice per line or paragraph. */
export type ChoicePaste = {
  readonly entries: readonly { readonly text: string; readonly html: string }[];
  readonly singleHtml: string;
  readonly singleText: string;
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'SECTION', 'BLOCKQUOTE', 'PRE']);
const OMIT_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'IFRAME', 'OBJECT']);
/** Parses clipboard formats in the browser without mounting pasted HTML in the document. */
export function parseChoicePaste(text: string, html: string): ChoicePaste {
  const plainEntries = text.split(/\r\n?|\n|\u2028|\u2029/).flatMap((line) => {
    const value = line.trim();
    return value ? [{ text: value, html: `<p>${escapeHtmlText(value)}</p>` }] : [];
  });
  const richEntries = htmlSegments(parseHtml(html)).flatMap((segment) => {
    const safeHtml = sanitizeInlineHtml(segment.innerHTML.trim(), { disallowedTags: 'unwrap' });
    const content = parseHtml(safeHtml);
    const value = (content.textContent ?? '').trim();
    if (!value && !content.querySelector('img')) return [];
    return [{ text: value, html: `<p>${safeHtml}</p>` }];
  });
  // Clipboard HTML can flatten physical newlines into spaces. Preserve the text's lines;
  // retain supported formatting when the HTML describes the same answer boundaries.
  const matchingHtml = plainEntries.length === richEntries.length &&
    plainEntries.every((entry, index) =>
      entry.text.replace(/\s+/g, ' ') === richEntries[index].text.replace(/\s+/g, ' ')
    );
  const entries = plainEntries.length > 1 && !matchingHtml
    ? plainEntries
    : html.trim()
    ? richEntries
    : plainEntries;
  return {
    entries,
    singleHtml: entries.map((entry) => entry.html).join(''),
    singleText: entries.map((entry) => entry.text).join('\n'),
  };
}

/** Treats empty rich-text paragraphs as blank while retaining image-only choices. */
export function isChoiceEmpty(choice: Choice): boolean {
  if (choice.html === undefined) return !(choice.text ?? '').trim();
  const content = parseHtml(choice.html);
  return !(content.textContent ?? '').trim() && !content.querySelector('img');
}

/** Fills consecutive blank rows, then inserts additional choices with unique QTI identifiers. */
export function insertPastedChoices(
  choices: readonly Choice[],
  index: number,
  paste: ChoicePaste,
  richText: boolean,
): Choice[] {
  const ids = new Set(choices.map((choice) => choice.id));
  let consumed = 0;
  const inserted = paste.entries.map((entry) => {
    const existing = choices[index + consumed];
    let choice: Choice;
    if (existing && (consumed === 0 || isChoiceEmpty(existing))) {
      choice = existing;
      consumed += 1;
    } else {
      const id = nextChoiceId(ids);
      ids.add(id);
      choice = { id };
    }
    return { ...choice, text: entry.text, html: richText ? entry.html : undefined };
  });
  return [...choices.slice(0, index), ...inserted, ...choices.slice(index + consumed)];
}

function parseHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Splits the parsed tree at blocks and breaks, cloning open ancestors into each choice. */
function htmlSegments(root: DocumentFragment): HTMLElement[] {
  const segments: HTMLElement[] = [];
  let segment = document.createElement('div');
  let clones = new Map<Element, Element>();
  const finish = () => {
    if (segment.hasChildNodes()) segments.push(segment);
    segment = document.createElement('div');
    clones = new Map();
  };
  const append = (node: Node, ancestors: readonly Element[]) => {
    let parent: Element = segment;
    for (const ancestor of ancestors) {
      let clone = clones.get(ancestor);
      if (!clone) {
        clone = cloneElement(ancestor);
        parent.appendChild(clone);
        clones.set(ancestor, clone);
      }
      parent = clone;
    }
    parent.appendChild(node);
  };
  const visit = (node: Node, ancestors: readonly Element[], preformatted: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const lines = preformatted ? text.split(/\r\n?|\n/) : [text.replace(/\s+/g, ' ')];
      lines.forEach((line, index) => {
        if (index > 0) finish();
        if (line) append(document.createTextNode(line), ancestors);
      });
      return;
    }
    if (!(node instanceof Element) || OMIT_TAGS.has(node.tagName)) return;
    if (node.tagName === 'BR') {
      finish();
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName) || /^H[1-6]$/.test(node.tagName);
    if (block) finish();
    const openAncestors = block ? ancestors : [...ancestors, node];
    if (!node.hasChildNodes() && !block) append(cloneElement(node), ancestors);
    for (const child of node.childNodes) {
      visit(child, openAncestors, preformatted || node.tagName === 'PRE');
    }
    if (block) finish();
  };
  for (const child of root.childNodes) visit(child, [], false);
  finish();
  return segments;
}

function cloneElement(element: Element): Element {
  const clone = element.cloneNode(false);
  if (!(clone instanceof Element)) throw new Error('Expected an element clone');
  // A formatting ancestor can appear in several choices; its DOM ID cannot.
  clone.removeAttribute('id');
  return clone;
}
