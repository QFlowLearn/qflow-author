import Checkbox from '../../components/ui/Checkbox.tsx';
import { standaloneInlineChoice } from '../../lib/types/inline_choice.ts';
import { useItemEditorState } from './context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import SettingsSection from '../../components/ui/SettingsSection.tsx';

/** Slot settings remain canonical while the standalone dropdown hides blank authoring. */
export default function StandaloneDropdownSettings() {
  const { draft, setDraft, qtype } = useItemEditorState().content;
  const i18n = useI18n();
  if (qtype !== 'inline_choice') return null;
  const standalone = standaloneInlineChoice({
    bodyHtml: draft.bodyHtml,
    inlineChoices: draft.inlineChoices ?? [],
  });
  if (!standalone) return null;
  return (
    <SettingsSection group='answer' label={i18n.t('inspector.answerBehavior')} defaultOpen>
      {(['shuffle', 'required'] as const).map((field) => (
        <label key={field} class='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={Boolean(standalone.slot[field])}
            onChange={(event) => {
              const value = event.currentTarget.checked;
              setDraft((current) => ({
                ...current,
                inlineChoices: (current.inlineChoices ?? []).map((slot) =>
                  slot.id === standalone.slot.id ? { ...slot, [field]: value } : slot
                ),
              }));
            }}
          />
          <span>{i18n.t(`editor.presentation.${field}`)}</span>
        </label>
      ))}
    </SettingsSection>
  );
}
