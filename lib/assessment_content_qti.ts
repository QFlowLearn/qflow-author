import type { QtiContentNode, QtiTestRubricBlock } from '@longsightgroup/qti3-core';
import {
  type AssessmentStandaloneContent,
  parseAssessmentStandaloneContent,
} from './assessment_standalone_content.ts';
import { xmlEscape } from './xml.ts';

/** Project the supported content model into literal, portable QTI content-body markup. */
export function assessmentContentQtiFragment(content: AssessmentStandaloneContent): string {
  switch (content.kind) {
    case 'text':
      return paragraph(content.text);
    case 'image':
      return `<div><img src="${attribute(content.src)}" alt="${attribute(content.alt)}"/>${
        paragraph(content.longDescription)
      }</div>`;
    case 'video':
      return `<div>${
        paragraph(content.title)
      }<video controls="controls" preload="none" aria-label="${
        attribute(content.title)
      }"><source src="${attribute(content.src)}" type="${
        attribute(content.mimeType)
      }"/><track kind="captions" src="${attribute(content.captionSrc)}" srclang="${
        attribute(content.captionLanguage)
      }" default="default"/></video>${paragraph(content.transcript)}</div>`;
    case 'video-link':
      return `<div><p><a href="${attribute(content.url)}">${literal(content.title)}</a></p>${
        paragraph(content.networkNotice)
      }${paragraph(content.transcript)}</div>`;
  }
}

/** Adapt one shared-parsed static section rubric without importing private-audience content. */
export function parseStandaloneRubric(
  node: QtiTestRubricBlock['node'],
): AssessmentStandaloneContent | null {
  if (!(node.attributes.view ?? '').split(/\s+/).includes('candidate')) return null;
  const rubric = element(node, 'qti-rubric-block', ['view', 'use']);
  if (rubric.attributes.use !== 'instructions') {
    throw new Error('Only static candidate instructions can become standalone content.');
  }
  const body = element(singleChild(rubric), 'qti-content-body', []);
  return parseAssessmentContentFragment(singleChild(body));
}

/** Parse one canonical literal/media fragment at an external QTI boundary. */
export function parseAssessmentContentFragment(root: QtiContentNode): AssessmentStandaloneContent {
  let value: unknown;
  if (root.kind === 'element' && root.qtiName === 'p') {
    value = { kind: 'text', text: paragraphText(root) };
  } else {
    const wrapper = element(root, 'div', []);
    const contents = structuralChildren(wrapper);
    if (contents.length === 2 && contents[0].kind === 'element' && contents[0].qtiName === 'img') {
      const image = element(contents[0], 'img', ['src', 'alt']);
      if (image.children.length) throw new Error('Standalone images cannot contain markup.');
      value = {
        kind: 'image',
        src: image.attributes.src,
        alt: image.attributes.alt,
        longDescription: paragraphText(contents[1]),
      };
    } else if (
      contents.length === 3 && contents[1].kind === 'element' && contents[1].qtiName === 'video'
    ) {
      const video = element(contents[1], 'video', ['controls', 'preload', 'aria-label']);
      const title = paragraphText(contents[0]);
      if (
        video.attributes.controls !== 'controls' || video.attributes.preload !== 'none' ||
        video.attributes['aria-label'] !== title
      ) {
        throw new Error('Standalone video playback or label differs from the supported policy.');
      }
      const children = structuralChildren(video);
      if (children.length !== 2) {
        throw new Error('Standalone video requires one source and captions track.');
      }
      const source = element(children[0], 'source', ['src', 'type']);
      const captions = element(children[1], 'track', ['kind', 'src', 'srclang', 'default']);
      if (
        source.children.length || captions.children.length ||
        captions.attributes.kind !== 'captions' || captions.attributes.default !== 'default'
      ) {
        throw new Error('Standalone video contains unsupported source or captions markup.');
      }
      value = {
        kind: 'video',
        src: source.attributes.src,
        mimeType: source.attributes.type,
        title,
        captionSrc: captions.attributes.src,
        captionLanguage: captions.attributes.srclang,
        transcript: paragraphText(contents[2]),
      };
    } else if (contents.length === 3) {
      const title = element(contents[0], 'p', []);
      const link = element(singleChild(title), 'a', ['href']);
      value = {
        kind: 'video-link',
        url: link.attributes.href,
        title: literalText(link),
        networkNotice: paragraphText(contents[1]),
        transcript: paragraphText(contents[2]),
      };
    } else throw new Error('Standalone instructions contain unsupported formatted content.');
  }
  const parsed = parseAssessmentStandaloneContent(value);
  if (!parsed.ok) {
    throw new Error('Standalone instructions contain invalid content or media references.');
  }
  return parsed.content;
}

function element(
  node: QtiContentNode,
  name: string,
  attributes: readonly string[],
): Extract<QtiContentNode, { kind: 'element' }> {
  // Namespace declarations bind XML names; namespaceUri below validates the actual element.
  const authoredAttributes = node.kind === 'element'
    ? Object.keys(node.attributes).filter((key) => key !== 'xmlns' && !key.startsWith('xmlns:'))
    : [];
  if (
    node.kind !== 'element' || node.qtiName !== name ||
    node.namespaceUri !== 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0' ||
    authoredAttributes.length !== attributes.length ||
    attributes.some((attribute) => !Object.hasOwn(node.attributes, attribute))
  ) {
    throw new Error('Standalone instructions contain unsupported markup or attributes.');
  }
  return node;
}

function structuralChildren(
  node: Extract<QtiContentNode, { kind: 'element' }>,
): readonly QtiContentNode[] {
  return node.children.filter((child) => child.kind !== 'text' || child.text.trim() !== '');
}

function singleChild(node: Extract<QtiContentNode, { kind: 'element' }>): QtiContentNode {
  const children = structuralChildren(node);
  if (children.length !== 1) {
    throw new Error('Standalone instructions require one supported content root.');
  }
  return children[0];
}

export function paragraphText(node: QtiContentNode): string {
  return literalText(element(node, 'p', []));
}

function literalText(node: Extract<QtiContentNode, { kind: 'element' }>): string {
  return node.children.map((child) => {
    if (child.kind === 'text') return child.text;
    const lineBreak = element(child, 'br', []);
    if (lineBreak.children.length) {
      throw new Error('Standalone line breaks cannot contain content.');
    }
    return '\n';
  }).join('');
}

function literal(text: string): string {
  return xmlEscape(text).replaceAll('\r', '&#13;').replaceAll('\n', '<br/>');
}

function paragraph(text: string): string {
  return `<p>${literal(text)}</p>`;
}

function attribute(text: string): string {
  return xmlEscape(text).replaceAll('\t', '&#9;').replaceAll('\n', '&#10;').replaceAll(
    '\r',
    '&#13;',
  );
}
