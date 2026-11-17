import { useDomId } from '../../../lib/rendering/island_context.tsx';
import type { FunctionalComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import Input from '../../../components/ui/Input.tsx';
import { ToggleField } from './fields.tsx';
import type { RightRailControls } from './types.ts';
import { useI18n } from '../../../lib/i18n/context.tsx';

type SectionProps = { controls: RightRailControls };

export const ShuffleSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.shuffle) return null;
  return (
    <>
      <ToggleField
        label={t('driver.rightRail.shuffle')}
        control={controls.shuffle}
        tooltip={t('driver.rightRail.shuffleHelp')}
      />
      {controls.allowPins && controls.shuffle.value && (
        <div class='relative ml-2 pl-4'>
          <span class='absolute left-0 top-1 bottom-1 w-px bg-base-300/60' />
          <span class='absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-base-300/60' />
          <ToggleField label={t('driver.rightRail.allowPins')} control={controls.allowPins} />
        </div>
      )}
    </>
  );
};

export const ItemLanguageSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const control = controls.itemLanguage;
  const [value, setValue] = useState(control?.value ?? '');
  const [error, setError] = useState<'required' | 'invalid' | undefined>();
  const previousValue = useRef(control?.value);
  const instanceId = useDomId();
  useEffect(() => {
    // Initial state already matches the control; do not erase an edit made before mount effects run.
    if (control && previousValue.current !== control.value) {
      setValue(control.value);
      setError(undefined);
    }
    previousValue.current = control?.value;
  }, [control?.value]);
  if (!control) return null;
  const inputId = `item-language-input-${instanceId}`;
  const errorId = `item-language-error-${instanceId}`;
  const helpId = `item-language-help-${instanceId}`;
  const describedBy = error ? `${helpId} ${errorId}` : helpId;
  return (
    <div class='ds-form-control gap-1'>
      <label for={inputId}>{control.messages.label}</label>
      <Input
        id={inputId}
        value={value}
        onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        onBlur={() => {
          const result = control.onCommit(value);
          setError(result.ok ? undefined : result.code);
          if (result.ok) setValue(result.value);
        }}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
      />
      <span id={helpId} class='text-xs text-base-content/60'>{control.messages.help}</span>
      {error && (
        <span id={errorId} role='alert' class='text-xs text-error'>
          {error === 'required' ? control.messages.required : control.messages.invalid}
        </span>
      )}
    </div>
  );
};
