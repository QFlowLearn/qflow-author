import type { QuestionPointEditingAuthority } from '../../lib/question_point_authority.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Draft } from '../../lib/types/draft.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { TYPE_DRIVERS } from '../../lib/types/registry.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import { parseQuestionPointsInput, questionPointsInputText } from '../../lib/question_points.ts';

/** Own transient numeric editing separately from the finite canonical persisted value. */
export function useQuestionPoints(
  draft: Draft,
  type: QuestionTypeId,
  setDraft: (value: Draft | ((current: Draft) => Draft)) => void,
  authority: QuestionPointEditingAuthority,
  i18n: I18n,
  publicationLocked: boolean,
) {
  const [touched, setTouched] = useState(false);
  const edits = useRef(0);
  const renderedEditVersion = edits.current;
  const publicationInputLock = useRef(false);
  const previousLocale = useRef(i18n.locale);
  const eligible = Boolean(TYPE_DRIVERS[type].capabilities?.points);
  const readOnlyReason = authority._tag === 'SourceOnly'
    ? 'sourceOnly' as const
    : draft.preserveSourceXml === true
    ? 'preserved' as const
    : draft.responseMode === 'custom' || Boolean(draft.customResponseProcessingXml)
    ? 'custom' as const
    : null;
  // Show the generated template's actual total instead of asking authors to infer it from blank.
  const inputMaximumScore = authority._tag === 'Generated' && eligible && !readOnlyReason &&
      draft.maximumScore === undefined
    ? type === 'multi_select' && draft.responseMode === 'partial'
      ? Math.max(1, new Set(draft.correctIds).size)
      : 1
    : draft.maximumScore;
  const [text, setText] = useState(() => questionPointsInputText(inputMaximumScore, i18n.locale));
  const parsed = parseQuestionPointsInput(text, i18n.locale);
  const missingSourcePoints = authority._tag === 'SourceEditable' &&
    authority.maximumScore !== undefined && parsed._tag === 'Unset';
  const invalid = eligible && (parsed._tag === 'Invalid' ||
    authority._tag === 'Generated' && parsed._tag === 'Unset' && !readOnlyReason);
  const blocked = eligible && (invalid || missingSourcePoints || authority._tag === 'SourceOnly');
  const message = readOnlyReason
    ? i18n.t(`driver.points.${readOnlyReason}`)
    : missingSourcePoints
    ? i18n.t('driver.points.sourceMaximum', {
      points: questionPointsInputText(authority.maximumScore, i18n.locale),
    })
    : invalid
    ? i18n.t('driver.points.invalid')
    : null;

  useEffect(() => {
    // A queued synchronization from an older render must not replace a newer native input edit.
    if (edits.current !== renderedEditVersion) return;
    setText((current) => {
      const previous = parseQuestionPointsInput(current, previousLocale.current);
      const previousValue = previous._tag === 'Value' ? previous.value : undefined;
      if (previous._tag === 'Invalid') return current;
      if (previousValue === inputMaximumScore && previousLocale.current === i18n.locale) {
        return current;
      }
      return questionPointsInputText(inputMaximumScore, i18n.locale);
    });
    previousLocale.current = i18n.locale;
  }, [inputMaximumScore, i18n.locale]);

  function change(next: string) {
    if (readOnlyReason || publicationLocked || publicationInputLock.current || !eligible) return;
    edits.current++;
    setText(next);
    const value = parseQuestionPointsInput(next, i18n.locale);
    if (value._tag === 'Invalid' || value._tag === 'Unset' && authority._tag === 'Generated') {
      return;
    }
    const maximumScore = value._tag === 'Value' ? value.value : undefined;
    setDraft((current) =>
      current.maximumScore === maximumScore ? current : { ...current, maximumScore }
    );
  }

  return {
    templateHelp: readOnlyReason === null
      ? i18n.t(
        type === 'multi_select' && draft.responseMode === 'partial'
          ? 'driver.points.partial'
          : 'driver.points.matching',
      )
      : null,
    text,
    change,
    blur: () => {
      setTouched(true);
      if (parsed._tag === 'Unset' && authority._tag === 'Generated' && !readOnlyReason) {
        setText(questionPointsInputText(inputMaximumScore, i18n.locale));
      }
    },
    invalid,
    blocked,
    readOnly: readOnlyReason !== null || publicationLocked,
    message,
    visibleIssue: (touched && invalid || missingSourcePoints) ? message : null,
    editVersion: () => edits.current,
    lockPublicationInput: () => {
      publicationInputLock.current = true;
    },
    unlockPublicationInput: () => {
      publicationInputLock.current = false;
    },
  };
}
