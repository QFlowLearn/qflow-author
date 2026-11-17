import type { ComponentProps } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRetryableModule } from '../useRetryableModule.ts';
import type ImportPicker from './ImportPicker.tsx';

async function loadPicker(_key: 'question-bank-picker') {
  return (await import('./ImportPicker.tsx')).default;
}

/** Load bank search and selection only when the author opens the library tab. */
export default function DeferredImportPicker(props: ComponentProps<typeof ImportPicker>) {
  const i18n = useI18n();
  const { state } = useRetryableModule('question-bank-picker', loadPicker);
  const container = useRef<HTMLDivElement>(null);
  function movePendingFocus() {
    if (document.activeElement === container.current) {
      container.current?.querySelector<HTMLElement>('input, button')?.focus();
    }
  }
  useEffect(movePendingFocus, [state]);
  const Picker = state._tag === 'Ready' ? state.value : null;
  return (
    <div
      ref={container}
      tabIndex={-1}
      data-focus-library-search
      onFocus={movePendingFocus}
    >
      {Picker
        ? <Picker {...props} />
        : state._tag === 'Loading'
        ? <p role='status' aria-busy='true'>{i18n.t('assessments.builder.library.loading')}</p>
        : (
          <div role='alert'>
            <p>{i18n.t('assessments.builder.library.loadFailed')}</p>
            <Button type='button' onClick={() => location.reload()}>
              {i18n.t('assessments.builder.library.reload')}
            </Button>
          </div>
        )}
    </div>
  );
}
