import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Disclosure from '../../components/ui/Disclosure.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../../islands/useRetryableModule.ts';
import { useItemEditorState } from '../../islands/item_editor/context.ts';

async function loadFeedback(_key: string) {
  return (await import('./AnswerFeedbackEditor.tsx')).default;
}
function FeedbackFields() {
  const i18n = useI18n(), { state, retry } = useRetryableModule('answer-feedback', loadFeedback);
  if (state._tag === 'Loading') return <p role='status'>{i18n.t('editor.loadingControls')}</p>;
  if (state._tag === 'Failed') {
    return (
      <div role='alert'>
        <p>{i18n.t('editor.controlsFailed')}</p>
        <Button type='button' onClick={retry}>{i18n.t('editor.retryControls')}</Button>
      </div>
    );
  }
  const Editor = state.value;
  return <Editor />;
}
/** Optional feedback controls load only when the author opens the disclosure. */
export default function DeferredAnswerFeedbackEditor() {
  const state = useItemEditorState(), i18n = useI18n(), [opened, setOpened] = useState(false);
  if (!['single_select', 'multi_select', 'inline_choice'].includes(state.content.qtype)) {
    return null;
  }
  return (
    <Disclosure
      appearance='quiet'
      summary={i18n.t('editor.answerFeedback.title')}
      data-answer-feedback
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      {opened && <FeedbackFields />}
    </Disclosure>
  );
}
