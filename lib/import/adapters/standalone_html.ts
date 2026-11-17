import {
  type AssessmentStandaloneContent,
  parseAssessmentStandaloneContent,
} from '../../assessment_standalone_content.ts';
import { resolvePackageAssetPath } from '../../asset_refs.ts';
import { DOMParser } from '@xmldom/xmldom';
import { localName } from '../xml_dom.ts';

/** Project normalized source HTML into unscored blocks in the same reading order. */
export function importStandaloneHtml(html: string, href: string): {
  readonly content: AssessmentStandaloneContent[];
  readonly omissions: string[];
} {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').documentElement;
  const content: AssessmentStandaloneContent[] = [];
  const omissions: string[] = [];
  let text = '';
  function flush(): void {
    const value = text.replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
    text = '';
    if (!value) return;
    const parsed = parseAssessmentStandaloneContent({ kind: 'text', text: value });
    if (!parsed.ok) throw new Error('Source passage exceeds supported standalone text limits.');
    content.push(parsed.content);
  }
  function visit(node: Node): void {
    if (node.nodeType === 3 || node.nodeType === 4) {
      text += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    // SAFETY: XML node type 1 establishes the DOM Element contract.
    const element = node as Element;
    const name = localName(element);
    if (['script', 'style', 'iframe', 'object', 'audio', 'video'].includes(name)) {
      omissions.push(`Unsupported ${name} content remains in the original source.`);
      return;
    }
    if (name === 'img') {
      flush();
      const src = resolvePackageAssetPath(element.getAttribute('src') ?? '', href);
      const image = parseAssessmentStandaloneContent({
        kind: 'image',
        src,
        alt: element.getAttribute('alt') ?? '',
        longDescription: '',
      });
      if (image.ok) content.push(image.content);
      else {
        omissions.push(
          'An image has no supported package reference or description. Restore it as an assessment image before delivery.',
        );
        const alt = element.getAttribute('alt');
        if (alt) text += alt;
      }
      return;
    }
    const block = [
      'p',
      'div',
      'br',
      'li',
      'tr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'pre',
    ].includes(name);
    if (block) text += '\n';
    for (let index = 0; index < element.childNodes.length; index += 1) {
      visit(element.childNodes[index]);
    }
    if (name === 'a' && element.getAttribute('href')) text += ` (${element.getAttribute('href')})`;
    if (name === 'td' || name === 'th') text += '\t';
    if (block) text += '\n';
  }
  visit(root);
  flush();
  return { content, omissions };
}
