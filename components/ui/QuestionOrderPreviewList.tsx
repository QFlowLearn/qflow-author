import AssessmentContentBlock from './AssessmentContentBlock.tsx';
import { Fragment } from 'preact';
import type { AssessmentQuestionOrderPreview } from '../../lib/assessment_question_order_preview.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

/** Read-only learner positions retain part scope and show each saved authored position. */
export default function QuestionOrderPreviewList(props: {
  readonly value: AssessmentQuestionOrderPreview;
}) {
  const i18n = useI18n();
  return (
    <div role='region' aria-label={i18n.t('assessments.orderPreview.example')} class='space-y-4'>
      {props.value.parts.map((part, index) => (
        <section key={part.id}>
          <h4 class='font-semibold break-words'>
            {i18n.t('assessments.settings.part', { number: index + 1, title: part.title })}
          </h4>
          <p class='text-sm text-base-content'>
            {i18n.t(
              part.shuffleQuestions
                ? 'assessments.partSettings.shuffledQuestionOrder'
                : 'assessments.partSettings.authoredQuestionOrder',
            )}
          </p>
          {(() => {
            const boundaries = [
              ...new Set([
                ...part.instructions.map((instruction) => instruction.beforeQuestionNumber - 1),
                part.questions.length,
              ]),
            ];
            let start = 0;
            return boundaries.map((end) => {
              const groupStart = start;
              start = end;
              return (
                <Fragment key={end}>
                  {end > groupStart && (
                    <ol start={groupStart + 1} class='mt-2 list-decimal pl-6 space-y-2'>
                      {part.questions.slice(groupStart, end).map((question) => (
                        <li key={question.placementId} data-placement-id={question.placementId}>
                          <span class='block break-words'>{question.title}</span>
                          <span class='block text-sm text-base-content'>
                            {i18n.t('assessments.orderPreview.authoredPosition', {
                              number: `${index + 1}.${question.authoredPosition}`,
                            })}
                            {question.fixed && ` · ${i18n.t('assessments.orderPreview.fixed')}`}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {part.instructions.filter((instruction) =>
                    instruction.beforeQuestionNumber === end + 1
                  ).map((instruction) => (
                    <AssessmentContentBlock
                      key={instruction.placementId}
                      content={instruction.content}
                      label={i18n.t(
                        instruction.content.kind === 'text'
                          ? 'assessments.builder.textBlock'
                          : instruction.content.kind === 'image'
                          ? 'assessments.builder.imageBlock'
                          : 'assessments.builder.videoBlock',
                      )}
                    />
                  ))}
                </Fragment>
              );
            });
          })()}
        </section>
      ))}
    </div>
  );
}
