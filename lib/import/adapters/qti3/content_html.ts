import type {
  QtiAssessmentItem,
  QtiChoice,
  QtiContentNode,
  QtiInteraction,
} from '@longsightgroup/qti3-core';

type QtiGapMatchSegment = NonNullable<QtiInteraction['gapMatchSegments']>[number];
type QtiHottextSegment = NonNullable<QtiInteraction['hottextSegments']>[number];
import { createGapMarkerHtml } from '../../../types/gap_match.ts';
import { sanitizeBodyHtml } from '../../../sanitize.ts';
import { xmlEscape } from '../../../xml.ts';
import { extractAttr, normalizeQtiFragment } from '../../qti_fragments.ts';

export const normalizeQtiHtmlFragment = normalizeQtiFragment;

export function serializeContentNodes(nodes: QtiContentNode[]): string {
  return normalizeQtiHtmlFragment(serializeContentNodesInternal(nodes));
}

export function promptHtmlFromInteraction(interaction: QtiInteraction): string {
  if (interaction.promptContent?.length) {
    return normalizeQtiHtmlFragment(serializeContentNodes(interaction.promptContent));
  }
  const prompt = interaction.prompt?.trim();
  return prompt ? `<p>${xmlEscape(prompt)}</p>` : '';
}

export function choiceHtmlFromChoice(choice: QtiChoice): string {
  if (choice.content?.length) return serializeContentNodes(choice.content);
  const text = choice.text?.trim();
  return text ? xmlEscape(text) : '';
}

function sanitizeDraftHtml(
  html: string,
  options: { replaceObjects?: boolean } = {},
): string {
  const normalized = options.replaceObjects ? replaceObjectElements(html) : html;
  return sanitizeBodyHtml(normalized) || '<p></p>';
}

export function bodyHtmlFromContentNodes(
  nodes: QtiContentNode[],
  options: {
    excludeInteractionIndexes?: Set<number>;
    excludeElementNames?: Set<string>;
    replaceObjects?: boolean;
  } = {},
): string {
  const filtered = nodes.filter((node) => {
    if (node.kind === 'interaction') {
      return !options.excludeInteractionIndexes?.has(node.interactionIndex);
    }
    if (node.kind === 'element' && options.excludeElementNames?.has(node.qtiName)) {
      return false;
    }
    return node.kind !== 'feedback';
  });
  return sanitizeDraftHtml(serializeContentNodes(filtered), {
    replaceObjects: options.replaceObjects,
  });
}

export function bodyHtmlFromGapMatchSegments(segments: QtiGapMatchSegment[]): string {
  let html = '';
  for (const segment of segments) {
    if (segment.kind === 'text') {
      html += xmlEscape(segment.text);
      continue;
    }
    const widthClass = (segment.attributes.class ?? '')
      .split(/\s+/)
      .map((token) => token.trim())
      .find((token) => token.startsWith('qti-input-width-'));
    html += createGapMarkerHtml({
      id: segment.identifier,
      label: segment.identifier,
      widthClass,
    });
  }
  return sanitizeDraftHtml(`<p>${normalizeQtiHtmlFragment(html)}</p>`);
}

export function bodyHtmlWithInteractionMarkers(
  item: QtiAssessmentItem,
  renderInteraction: (interaction: QtiInteraction) => string,
  options: { replaceObjects?: boolean } = {},
): string {
  const html = item.body.map((node) => serializeBodyNode(item, node, renderInteraction)).join('');
  return sanitizeDraftHtml(html, { replaceObjects: options.replaceObjects });
}

export function extractRubricHtml(nodes: QtiContentNode[]): string | undefined {
  for (const node of nodes) {
    if (node.kind !== 'element' || node.qtiName !== 'qti-rubric-block') continue;
    const contentBody = node.children.find((child) =>
      child.kind === 'element' && child.qtiName === 'qti-content-body'
    );
    const rubricNodes = contentBody?.kind === 'element' ? contentBody.children : node.children;
    const html = serializeContentNodes(rubricNodes);
    const sanitized = sanitizeBodyHtml(html);
    return sanitized || undefined;
  }
  return undefined;
}

export function bodyHtmlFromHottextSegments(
  segments: QtiHottextSegment[],
  markerFor: (id: string, label: string) => string,
): string {
  let html = '';
  for (const segment of segments) {
    if (segment.kind === 'text') {
      html += xmlEscape(segment.text);
      continue;
    }
    const label = segment.text.replace(/<[^>]*>/g, '').trim() || segment.identifier;
    html += markerFor(segment.identifier, label);
  }
  return sanitizeDraftHtml(`<p>${normalizeQtiHtmlFragment(html)}</p>`);
}

function serializeBodyNode(
  item: QtiAssessmentItem,
  node: QtiContentNode,
  renderInteraction: (interaction: QtiInteraction) => string,
): string {
  return serializeContentNode(
    node,
    (children) =>
      children.map((child) => serializeBodyNode(item, child, renderInteraction)).join(''),
    (interactionNode) => {
      const interaction = item.interactions[interactionNode.interactionIndex];
      return interaction ? renderInteraction(interaction) : '';
    },
  );
}

function serializeContentNodesInternal(
  nodes: QtiContentNode[],
  renderInteraction?: (node: QtiContentNode & { kind: 'interaction' }) => string,
): string {
  const recurse = (childNodes: QtiContentNode[]): string =>
    childNodes.map((child) => serializeContentNode(child, recurse, renderInteraction)).join('');
  return recurse(nodes);
}

function serializeContentNode(
  node: QtiContentNode,
  recurse: (children: QtiContentNode[]) => string,
  renderInteraction?: (node: QtiContentNode & { kind: 'interaction' }) => string,
): string {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'element': {
      const tag = stripQtiPrefix(node.qtiName);
      const attrs = formatElementAttributes(node.attributes);
      return `<${tag}${attrs}>${recurse(node.children)}</${tag}>`;
    }
    case 'printedVariable': {
      const attrs = formatElementAttributes(node.attributes);
      return `<printedVariable identifier="${
        xmlEscape(node.identifier)
      }"${attrs}></printedVariable>`;
    }
    case 'feedback':
      return recurse(node.children);
    case 'interaction':
      return renderInteraction?.(node) ?? '';
  }
}

function stripQtiPrefix(name: string): string {
  return name.startsWith('qti-') ? name.slice(4) : name;
}

function formatElementAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .filter(([name]) => name !== 'xmlns' && !name.startsWith('xmlns:'))
    .map(([name, value]) => ` ${name}="${xmlEscape(value)}"`)
    .join('');
}

function replaceObjectElements(html: string): string {
  if (!html) return html;
  return html.replace(/<object\b([^>]*)>([\s\S]*?)<\/object>/gi, (_match, attrs, inner) => {
    const data = extractAttr(attrs, 'data');
    const alt = extractAttr(attrs, 'alt') ?? '';
    const img = data ? `<img src="${xmlEscape(data)}" alt="${xmlEscape(alt)}"/>` : '';
    return `${img}${inner ?? ''}`;
  });
}
