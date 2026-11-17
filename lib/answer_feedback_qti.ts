import type { QtiAssessmentItem, QtiContentNode } from '@longsightgroup/qti3-core';
import type { Qti3ResponseFeedback, Qti3TrustedXmlFragment } from '@longsightgroup/qti3-writer';
import {
  type AnswerFeedback,
  type AnswerFeedbackExplanation,
  parseAnswerFeedback,
} from './answer_feedback.ts';
import {
  assessmentContentQtiFragment,
  paragraphText,
  parseAssessmentContentFragment,
} from './assessment_content_qti.ts';
import { xmlEscape } from './xml.ts';

/** Only validated literal content is branded for the shared whole-response feedback writer. */
export function toQtiResponseFeedback(
  feedback: AnswerFeedback | undefined,
): Qti3ResponseFeedback | undefined {
  if (feedback === undefined) return undefined;
  const parsed = parseAnswerFeedback(feedback);
  if (!parsed.ok) throw new Error('Invalid answer feedback.');
  const content = (entry: AnswerFeedbackExplanation) => ({
    contentHtml: literalFeedbackFragment(
      `<div class="qflow-answer-feedback">${
        assessmentContentQtiFragment({ kind: 'text', text: entry.text })
      }${
        entry.link
          ? `<p><a href="${xmlEscape(entry.link.url)}">${
            xmlEscape(entry.link.label).replaceAll('\r', '&#13;')
          }</a></p>`
          : ''
      }${entry.media ? assessmentContentQtiFragment(entry.media) : ''}</div>`,
    ),
  });
  return {
    ...(parsed.value.correct ? { correct: content(parsed.value.correct) } : {}),
    ...(parsed.value.incorrect ? { incorrect: content(parsed.value.incorrect) } : {}),
  };
}

/** Recognize our exact content shape; the caller must also prove processing XML identity. */
export function readAuthoredAnswerFeedback(item: QtiAssessmentItem): AnswerFeedback | undefined {
  if (!item.modalFeedback.length) return undefined;
  const result: {
    correct: AnswerFeedbackExplanation | null;
    incorrect: AnswerFeedbackExplanation | null;
  } = { correct: null, incorrect: null };
  try {
    for (const feedback of item.modalFeedback) {
      const key = feedback.identifier === 'CORRECT'
        ? 'correct'
        : feedback.identifier === 'INCORRECT'
        ? 'incorrect'
        : null;
      if (
        !key || result[key] || feedback.outcomeIdentifier !== 'RESPONSE_FEEDBACK' ||
        feedback.showHide !== 'show' || feedback.title !== undefined
      ) return undefined;
      const roots = structural(feedback.content);
      if (roots.length !== 1) return undefined;
      const body = exactElement(roots[0], 'qti-content-body', []);
      const bodies = structural(body.children);
      if (bodies.length !== 1) return undefined;
      const root = exactElement(bodies[0], 'div', ['class']);
      if (root.attributes.class !== 'qflow-answer-feedback') return undefined;
      const children = structural(root.children);
      const text = paragraphText(children[0]);
      let position = 1;
      let link: AnswerFeedbackExplanation['link'] = null;
      const next = children[position];
      if (next?.kind === 'element' && next.qtiName === 'p') {
        const paragraph = exactElement(children[position++], 'p', []);
        const links = structural(paragraph.children);
        if (links.length !== 1) return undefined;
        const anchor = exactElement(links[0], 'a', ['href']);
        if (anchor.children.some((node) => node.kind !== 'text')) return undefined;
        link = {
          url: anchor.attributes.href,
          label: anchor.children.map((node) => node.kind === 'text' ? node.text : '').join(''),
        };
      }
      const media = children[position]
        ? parseAssessmentContentFragment(children[position++])
        : null;
      if (position !== children.length || media?.kind === 'text') return undefined;
      result[key] = { text, link, media };
    }
    const parsed = parseAnswerFeedback(result);
    return parsed.ok ? parsed.value : undefined;
  } catch (_cause: unknown) {
    return undefined;
  }
}

function structural(nodes: readonly QtiContentNode[]): QtiContentNode[] {
  return nodes.filter((node) => node.kind !== 'text' || !!node.text.trim());
}
function exactElement(
  node: QtiContentNode,
  name: string,
  keys: readonly string[],
): Extract<QtiContentNode, { kind: 'element' }> {
  if (
    !node || node.kind !== 'element' || node.qtiName !== name ||
    node.namespaceUri !== 'http://www.imsglobal.org/xsd/imsqtiasi_v3p0'
  ) throw new Error('Unsupported feedback markup.');
  const attributes = Object.keys(node.attributes).filter((key) =>
    key !== 'xmlns' && !key.startsWith('xmlns:')
  );
  if (
    attributes.length !== keys.length || keys.some((key) => !Object.hasOwn(node.attributes, key))
  ) throw new Error('Unsupported feedback attributes.');
  return node;
}

function literalFeedbackFragment(value: string): Qti3TrustedXmlFragment {
  // SAFETY: only the exact escaped and validated literal/media serializer above calls this boundary.
  return value as Qti3TrustedXmlFragment;
}
