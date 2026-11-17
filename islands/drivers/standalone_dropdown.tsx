import { ChoiceListEditor } from './choice_list_editor.tsx';
import { useChoiceList } from './use_choice_list.ts';
import { commonContentProps, setDraftListFieldValue } from './editor_shell.tsx';
import Radio from '../../components/ui/Radio.tsx';
import type { InlineChoiceSlot } from '../../lib/types/inline_choice.ts';
import type { DriverUiContext } from './view_registry.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

/** Reuse the ordinary answer editor for a standalone dropdown, without blank setup. */
export default function StandaloneDropdown({ ctx, slot }: {
  readonly ctx: DriverUiContext<'inline_choice'>;
  readonly slot: InlineChoiceSlot;
}) {
  const { draft, update, editor } = ctx;
  const i18n = useI18n();
  const setSlots = (
    value: InlineChoiceSlot[] | ((previous: InlineChoiceSlot[]) => InlineChoiceSlot[]),
  ) => setDraftListFieldValue(editor, draft, update, 'inlineChoices', value);
  const list = useChoiceList({
    draft: { choices: slot.options, correctId: slot.correctId, shuffle: slot.shuffle },
    mode: 'single',
    historyKey: editor.choiceHistoryKey,
    updateFields: (patch) =>
      setSlots((slots) =>
        slots.map((current) =>
          current.id === slot.id
            ? {
              ...current,
              options: patch.choices ?? current.options,
              correctId: Object.hasOwn(patch, 'correctId') ? patch.correctId : current.correctId,
            }
            : current
        )
      ),
    setChoices: (value) =>
      setSlots((slots) =>
        slots.map((current) =>
          current.id === slot.id
            ? { ...current, options: typeof value === 'function' ? value(current.options) : value }
            : current
        )
      ),
  });
  return (
    <ChoiceListEditor
      {...commonContentProps(editor)}
      list={list}
      editableLabels={false}
      useRteForChoices={false}
      plainTextValue={(text) => text ?? ''}
      promptPlaceholder={i18n.t('driver.singlePrompt')}
      isChoiceCorrect={(id) => list.correctId === id}
      renderCorrectControl={(choice, _index, correct, issueId) => (
        <Radio
          name='correct'
          aria-invalid={issueId ? true : undefined}
          aria-describedby={issueId}
          checked={correct}
          title={i18n.t('driver.markCorrect')}
          onChange={() => list.setCorrectId(choice.id)}
        />
      )}
    />
  );
}
