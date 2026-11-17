type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: Option[];
  onChange: (next: string) => void;
  ariaLabel: string;
  class?: string;
};

export default function SegmentedControl(
  { value, options, onChange, ariaLabel, class: cls }: Props,
) {
  return (
    <div
      class={[
        'inline-grid rounded-lg border border-base-300 bg-base-200 p-1',
        cls || '',
      ].filter(Boolean).join(' ')}
      role='group'
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type='button'
            class={[
              'min-h-9 rounded border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary',
              selected
                ? 'border-secondary bg-base-100 text-secondary qf-layer-shadow'
                : 'border-transparent text-base-content/65 hover:bg-base-100 hover:text-base-content',
              option.disabled ? 'cursor-not-allowed opacity-50' : '',
            ].filter(Boolean).join(' ')}
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
