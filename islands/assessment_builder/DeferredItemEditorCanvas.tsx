import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import type { ItemEditorCanvasProps } from '../item_editor/ItemEditorCanvas.tsx';

const MODULE_KEY = 'assessment-item-editor' as const;
type ItemEditorCanvasComponent = typeof import('../item_editor/ItemEditorCanvas.tsx').default;

async function loadItemEditor(_key: typeof MODULE_KEY): Promise<ItemEditorCanvasComponent> {
  const module = await import('../item_editor/ItemEditorCanvas.tsx');
  return module.default;
}

/** Loads the heavyweight question editor only after an item is opened. */
export default function DeferredItemEditorCanvas(props: ItemEditorCanvasProps) {
  const i18n = useI18n();
  const { state, retry } = useRetryableModule(MODULE_KEY, loadItemEditor);
  if (state._tag === 'Loading') {
    return (
      <p
        class='min-h-[240px] py-5 text-sm text-base-content/65'
        role='status'
        aria-live='polite'
        aria-busy='true'
      >
        {i18n.t('editor.loadingControls')}
      </p>
    );
  }
  if (state._tag === 'Failed') {
    return (
      <div class='ds-alert ds-alert-error' role='alert'>
        <div>
          <div class='font-medium'>{i18n.t('editor.controlsFailed')}</div>
          <Button type='button' size='sm' class='mt-3' onClick={retry}>
            {i18n.t('editor.retryControls')}
          </Button>
        </div>
      </div>
    );
  }
  const Canvas = state.value;
  return <Canvas {...props} />;
}
