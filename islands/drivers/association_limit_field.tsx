import Input from '../../components/ui/Input.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

type AssociationLimitFieldProps = {
  value?: number;
  onChange: (value: number | undefined) => void;
  ariaLabel: string;
  label?: string;
  hint?: string | null;
  placeholder?: string;
  class?: string;
  widthClass?: string;
  layout?: 'stacked' | 'inline';
};

function normalize(value: string): number | undefined {
  if (value === '') return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : Math.max(0, num);
}

export function AssociationLimitField(props: AssociationLimitFieldProps) {
  const i18n = useI18n();
  const inline = props.layout === 'inline';
  const wrapperClasses = [
    inline
      ? 'flex w-full items-center gap-2'
      : 'w-full rounded-lg border border-base-300 bg-base-100 p-2',
    props.widthClass ?? 'sm:w-44',
    props.class ?? '',
  ].filter(Boolean).join(' ');
  const hint = props.hint === undefined ? i18n.t('driver.maxAssociationsHint') : props.hint;

  return (
    <label class={wrapperClasses}>
      <span
        class={inline
          ? 'shrink-0 text-xs font-medium text-base-content/70'
          : 'text-xs font-medium uppercase tracking-wide text-base-content/75'}
      >
        {props.label ?? i18n.t('driver.maxAssociations')}
      </span>
      <Input
        size='sm'
        class={inline ? 'min-w-0 flex-1' : 'mt-1'}
        type='number'
        min={0}
        value={props.value ?? ''}
        onInput={(e) => props.onChange(normalize((e.target as HTMLInputElement).value))}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder ?? i18n.t('driver.unlimitedPlaceholder')}
      />
      {hint !== null && (
        <span class='mt-1 block text-xs leading-tight text-base-content/60'>
          {hint}
        </span>
      )}
    </label>
  );
}
