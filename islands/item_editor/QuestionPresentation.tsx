import QuestionPresentationControl from '../../components/ui/QuestionPresentationControl.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useItemEditorState } from './context.ts';
import { standaloneInlineChoice } from '../../lib/types/inline_choice.ts';

/** Change the current draft's presentation through its existing persistence owner. */
export default function QuestionPresentation() {
  const { qtype, draft, presentation } = useItemEditorState().content;
  const i18n = useI18n();
  if (qtype !== 'single_select' && qtype !== 'inline_choice') return null;
  const standalone = qtype === 'inline_choice' &&
    standaloneInlineChoice({ bodyHtml: draft.bodyHtml, inlineChoices: draft.inlineChoices ?? [] });
  const typeLabel = qtype === 'inline_choice' && !standalone
    ? i18n.t('editor.presentation.inlineChoice')
    : i18n.t('editor.presentation.dropdown');
  return (
    <QuestionPresentationControl
      value={qtype}
      label={i18n.t('editor.presentation.label')}
      choiceLabel={i18n.t('editor.presentation.multipleChoice')}
      dropdownLabel={typeLabel}
      canChange={presentation.available.ok}
      canUndo={presentation.undo?.ok === true}
      reason={presentation.available.ok
        ? undefined
        : i18n.t(`editor.presentation.block.${presentation.available.reason}`)}
      changedMessage={presentation.changed ? i18n.t('editor.presentation.changed') : undefined}
      undoLabel={i18n.t('editor.presentation.undo')}
      undoReason={presentation.undo && !presentation.undo.ok
        ? i18n.t(`editor.presentation.block.${presentation.undo.reason}`)
        : undefined}
      busy={presentation.busy}
      onChange={presentation.change}
      onUndo={presentation.undoChange}
    />
  );
}
