import { parseAssessmentStandaloneContent } from './assessment_standalone_content.ts';
import { canonicalJsonStringify } from './canonical_json.ts';
import { assessmentQuestionPlacements } from './assessment_content.ts';
import type { AssessmentArrangementSnapshot } from './assessment_arrangement_version.ts';
import type { AssessmentQuestionOrderPreview } from './assessment_question_order_preview.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

/** Parse an example only when every identity, policy and position matches the captured saved parts. */
export function parseQuestionOrderPreview(
  value: unknown,
  version: string,
  expected: AssessmentArrangementSnapshot,
): AssessmentQuestionOrderPreview | null {
  if (
    !record(value) || !fields(value, ['version', 'parts']) || value.version !== version ||
    !Array.isArray(value.parts) || value.parts.length !== expected.length
  ) return null;
  const parts: AssessmentQuestionOrderPreview['parts'][number][] = [];
  for (const [partIndex, raw] of value.parts.entries()) {
    const part = expected[partIndex];
    if (
      !part || !record(raw) ||
      !fields(raw, ['id', 'title', 'shuffleQuestions', 'questions', 'instructions']) ||
      raw.id !== part.id || raw.title !== part.title ||
      raw.shuffleQuestions !== (part.options?.shuffleQuestions === true) ||
      !Array.isArray(raw.questions) ||
      raw.questions.length !== assessmentQuestionPlacements(part.placements).length
    ) return null;
    const placements = new Map(
      assessmentQuestionPlacements(part.placements).map((placement, index) => [
        placement.id,
        { placement, position: index + 1 },
      ]),
    );
    const seen = new Set<string>();
    const questions: AssessmentQuestionOrderPreview['parts'][number]['questions'][number][] = [];
    for (const [position, question] of raw.questions.entries()) {
      if (
        !record(question) || !fields(question, [
          'placementId',
          'itemId',
          'revision',
          'title',
          'authoredPosition',
          'fixed',
        ]) || typeof question.placementId !== 'string' || typeof question.title !== 'string' ||
        typeof question.revision !== 'number' || !Number.isSafeInteger(question.revision) ||
        question.revision < 1
      ) return null;
      const binding = placements.get(question.placementId);
      if (
        !binding || seen.has(question.placementId) ||
        question.itemId !== binding.placement.itemId ||
        question.authoredPosition !== binding.position ||
        question.fixed !== (binding.placement.fixed === true) ||
        (binding.placement.snapshotRev != null &&
          question.revision !== binding.placement.snapshotRev) ||
        ((!raw.shuffleQuestions || question.fixed === true) && position + 1 !== binding.position)
      ) return null;
      seen.add(question.placementId);
      questions.push({
        placementId: binding.placement.id,
        itemId: binding.placement.itemId,
        revision: question.revision,
        title: question.title,
        authoredPosition: binding.position,
        fixed: binding.placement.fixed === true,
      });
    }
    const expectedInstructions = [];
    let beforeQuestionNumber = 1;
    for (const placement of part.placements) {
      if ('itemId' in placement) beforeQuestionNumber++;
      else {expectedInstructions.push({
          placementId: placement.id,
          beforeQuestionNumber,
          content: placement.content,
        });}
    }
    if (
      !Array.isArray(raw.instructions) || raw.instructions.length !== expectedInstructions.length
    ) return null;
    for (const [index, instruction] of raw.instructions.entries()) {
      const expected = expectedInstructions[index];
      if (
        !record(instruction) ||
        !fields(instruction, ['placementId', 'beforeQuestionNumber', 'content']) ||
        instruction.placementId !== expected.placementId ||
        instruction.beforeQuestionNumber !== expected.beforeQuestionNumber
      ) return null;
      const parsed = parseAssessmentStandaloneContent(instruction.content);
      if (
        !parsed.ok ||
        canonicalJsonStringify(parsed.content) !== canonicalJsonStringify(expected.content)
      ) return null;
    }
    parts.push({
      id: part.id,
      title: part.title,
      shuffleQuestions: part.options?.shuffleQuestions === true,
      questions,
      instructions: expectedInstructions,
    });
  }
  return { version, parts };
}
