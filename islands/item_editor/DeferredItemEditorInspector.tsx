import Button from '../../components/ui/Button.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { ItemEditorInspectorProps } from './ItemEditorInspector.tsx';

const INSPECTOR_MODULE_KEY = 'item-editor-inspector' as const;

async function loadInspector(_key: typeof INSPECTOR_MODULE_KEY) {
  const module = await import('./ItemEditorInspector.tsx');
  return module.default;
}

/** Loads the optional question review only while its inspector rail is open. */
export default function DeferredItemEditorInspector(props: ItemEditorInspectorProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule(INSPECTOR_MODULE_KEY, loadInspector);

  if (state._tag === 'Loading') {
    return (
      <p class='text-sm text-base-content/65' role='status'>{i18n.t('editor.loadingReview')}</p>
    );
  }
  if (state._tag === 'Failed') {
    return (
      <div class='ds-alert ds-alert-error' role='alert'>
        <div>
          <div class='font-medium'>{i18n.t('editor.reviewLoadFailed')}</div>
          <Button class='mt-3' size='sm' type='button' onClick={retry}>
            {i18n.t('editor.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const Inspector = state.value;
  return <Inspector {...props} />;
}
