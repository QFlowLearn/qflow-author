import type { QuestionContentBasis } from '../question_provenance.ts';
import type { QuestionPointEditingAuthority } from '../question_point_authority.ts';
import { recognizeEditableChoiceSource } from '../import/adapters/qti3/parse_item.ts';

/** Generated revisions use their canonical draft; imported revisions require source-program proof. */
export function questionPointEditingAuthority(input: {
  readonly contentBasis: QuestionContentBasis;
  readonly sourceXml: string;
}): QuestionPointEditingAuthority {
  if (input.contentBasis === 'qflow') return { _tag: 'Generated' };
  const recognized = recognizeEditableChoiceSource(input.sourceXml);
  return recognized._tag === 'SourceOnly'
    ? { _tag: 'SourceOnly' }
    : { _tag: 'SourceEditable', maximumScore: recognized.maximumScore };
}
