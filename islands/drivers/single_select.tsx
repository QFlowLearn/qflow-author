import { ChoiceListEditor } from './choice_list_editor.tsx';
import Radio from '../../components/ui/Radio.tsx';
import type { DriverUiContext } from './view_registry.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { useChoiceList } from './use_choice_list.ts';
import { commonContentProps, setDraftListFieldValue } from './editor_shell.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

function SingleSelectEditor(ctx: DriverUiContext<'single_select'>) {
  const { editor, draft, update } = ctx;
  const i18n = useI18n();
  const list = useChoiceList({
    draft,
    updateFields: (patch) => update({ ...draft, ...patch }),
    setChoices: (value) => setDraftListFieldValue(editor, draft, update, 'choices', value),
    mode: 'single',
    settings: editor.settings,
    historyKey: editor.choiceHistoryKey,
  });

  return (
    <ChoiceListEditor
      points={editor.pointsField}
      {...commonContentProps(editor)}
      list={list}
      promptPlaceholder={i18n.t('driver.singlePrompt')}
      useRteForChoices={Boolean(editor.useRteForChoices)}
      plainTextValue={editor.plainTextValue ?? ((text) => text ?? '')}
      isChoiceCorrect={(choiceId) => list.correctId === choiceId}
      renderCorrectControl={(choice, _index, isCorrect, issueId) => (
        <Radio
          name='correct'
          aria-invalid={issueId ? true : undefined}
          aria-describedby={issueId}
          checked={isCorrect}
          onChange={() => list.setCorrectId(choice.id)}
          title={i18n.t('driver.markCorrect')}
        />
      )}
    />
  );
}

attachStandardDriverViews('single_select', SingleSelectEditor);
