import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../../islands/useRetryableModule.ts';
import type { AssessmentContentEditorProps } from './AssessmentContentEditor.tsx';
import Alert from '../ui/Alert.tsx';
import Button from '../ui/Button.tsx';
import QuestionPersistenceNotice from '../ui/QuestionPersistenceNotice.tsx';

const KEY = 'assessment-content-editor' as const;
async function load(_key: typeof KEY) {
  const module = await import('./AssessmentContentEditor.tsx');
  return module.default;
}

/** Load content editing on selection; failed downloads recover through guarded reload. */
export default function DeferredAssessmentContentEditor(props: AssessmentContentEditorProps) {
  const i18n = useI18n(), { state } = useRetryableModule(KEY, load);
  if (state._tag === 'Loading') {
    return <QuestionPersistenceNotice tone='neutral' message={i18n.t('editor.loadingControls')} />;
  }
  if (state._tag === 'Failed') {
    return (
      <Alert tone='warning' role='alert'>
        <p>{i18n.t('editor.controlsFailed')}</p>
        <Button type='button' onClick={props.onReload}>{i18n.t('editor.reloadControls')}</Button>
      </Alert>
    );
  }
  const Editor = state.value;
  return <Editor {...props} />;
}
