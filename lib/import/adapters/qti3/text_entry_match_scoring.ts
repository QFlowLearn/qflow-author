import type { QtiAssessmentItem, QtiResponseRule } from '@longsightgroup/qti3-core';

/** Match-correct scoring that one independent text-entry answer can represent exactly. */
export type TextEntryMatchScoring =
  | { readonly ok: true; readonly score: number }
  | { readonly ok: false; readonly error: TextEntryScoringImportError };

/** Import-boundary refusal translated into a retained source and an explicit review notice. */
export class TextEntryScoringImportError extends Error {
  readonly _tag = 'TextEntryScoringImportError' as const;
  constructor(reason: string) {
    super(`Text-entry scoring cannot be preserved for editing: ${reason}`);
    this.name = 'TextEntryScoringImportError';
  }
}

/** Recognize the complete match-and-zero program rather than inferring points from a maximum. */
export function readTextEntryMatchScoring(item: QtiAssessmentItem): TextEntryMatchScoring {
  const interaction = item.interactions[0];
  const declaration = item.responseDeclarations[0];
  if (
    item.adaptive || item.templateProcessing || item.templateDeclarations.length ||
    item.modalFeedback.length || item.interactions.length !== 1 ||
    interaction?.type !== 'textEntry' || item.responseDeclarations.length !== 1 ||
    declaration?.identifier !== interaction.responseIdentifier ||
    declaration.cardinality !== 'single'
  ) {
    return refused(
      'Dependent or multiple-response scoring cannot be represented by one answer score.',
    );
  }
  if (
    !['string', 'integer', 'float'].includes(declaration.baseType ?? '') ||
    (typeof declaration.correctResponse !== 'string' &&
      typeof declaration.correctResponse !== 'number') ||
    declaration.correctResponse === '' ||
    (typeof declaration.correctResponse === 'number' &&
      !Number.isFinite(declaration.correctResponse))
  ) return refused('The source needs one explicit supported correct value.');
  if (
    item.outcomeDeclarations.some((outcome) => !['SCORE', 'MAXSCORE'].includes(outcome.identifier))
  ) {
    return refused('Additional outcome behavior cannot be represented by one answer score.');
  }
  const processing = item.responseProcessing;
  if (!processing) return refused('The source has no explicit automatic scoring program.');
  if (processing.expressions?.length) {
    return refused('The source has additional scoring expressions.');
  }
  if (processing.template) {
    if (
      !processing.template.endsWith('/match_correct') || processing.rules.length ||
      processing.conditions.length || declaration.identifier !== 'RESPONSE'
    ) {
      return refused(
        'The response-processing template does not describe an independent match score.',
      );
    }
    return { ok: true, score: 1 };
  }
  const rule = processing.rules[0];
  if (processing.rules.length !== 1 || rule?.type !== 'responseCondition') {
    return refused('The source has scoring rules beyond one match-and-zero condition.');
  }
  const condition = rule.condition;
  const match = condition.ifExpression;
  if (
    match?.type !== 'matchCorrect' || match.identifier !== declaration.identifier ||
    match.correctIdentifier !== declaration.identifier || condition.elseIfs.length
  ) return refused('The condition does not match this response against its own correct value.');
  const correct = constantScore(condition.thenRules);
  const incorrect = constantScore(condition.elseRules);
  if (correct === null || correct < 0 || incorrect !== 0) {
    return refused(
      'The program must award a finite non-negative score for matching and zero otherwise.',
    );
  }
  return { ok: true, score: correct };
}

function constantScore(rules: readonly QtiResponseRule[]): number | null {
  const rule = rules[0];
  if (
    rules.length !== 1 || rule?.type !== 'setOutcomeValue' || rule.identifier !== 'SCORE' ||
    rule.expression.type !== 'baseValue' || typeof rule.expression.value !== 'number' ||
    !Number.isFinite(rule.expression.value)
  ) return null;
  return rule.expression.value;
}

function refused(reason: string): TextEntryMatchScoring {
  return { ok: false, error: new TextEntryScoringImportError(reason) };
}
