import {
  type QtiInteractionType,
  serializeSharedVocabularyAttributes,
  serializeSharedVocabularyClassNames,
} from '@longsightgroup/qti3-core';
import {
  parseInteractionVocabulary,
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../lib/shared_vocabulary.ts';

export function vocabularyRoundTrip(
  vocab: QtiInteractionVocabulary,
  interaction: QtiInteractionType,
): QtiInteractionVocabulary {
  const qtiState = qtiStateFromInteractionVocabulary(vocab);
  const className = serializeSharedVocabularyClassNames(qtiState, interaction).join(' ');
  return parseInteractionVocabulary(
    className,
    serializeSharedVocabularyAttributes(qtiState, interaction),
    interaction,
  );
}
