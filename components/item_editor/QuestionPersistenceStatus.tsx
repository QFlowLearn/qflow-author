import { useItemEditorState } from '../../islands/item_editor/context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import QuestionPersistenceNotice from '../ui/QuestionPersistenceNotice.tsx';

/** Project the provider's exact persistence state without owning a second saved/dirty state. */
export default function QuestionPersistenceStatus() {
  const { persistence } = useItemEditorState();
  const { t } = useI18n();
  const status = persistence.saveStatus;
  const message = persistence.error || status === 'clean' ? '' : t(
    status === 'dirty'
      ? 'editor.unsavedChanges'
      : status === 'saved'
      ? 'editor.itemSaved'
      : 'editor.saving',
  );
  return (
    <QuestionPersistenceNotice
      message={message}
      tone={!message ? 'neutral' : status === 'saved' ? 'success' : 'neutral'}
    />
  );
}
