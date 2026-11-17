import { useDomId } from '../../../lib/rendering/island_context.tsx';
import type { FunctionalComponent } from 'preact';

import Checkbox from '../../../components/ui/Checkbox.tsx';
import InfoTooltip from '../../../components/ui/InfoTooltip.tsx';
import Input, { FieldIssueMessage } from '../../../components/ui/Input.tsx';
import Select from '../../../components/ui/Select.tsx';
import type {
  MediaPlayerControlsControl,
  NumberControl,
  SelectControl,
  TextControl,
  ToggleControl,
} from './types.ts';

export type {
  MediaPlayerControlsControl,
  NumberControl,
  SelectControl,
  SelectOption,
  TextControl,
  ToggleControl,
} from './types.ts';

export function readNumber(raw: string, min: number): number | undefined {
  if (raw === '') return undefined;
  return Math.max(min, Number(raw) || min);
}

export const TextField: FunctionalComponent<{
  label: string;
  control: TextControl;
  placeholder?: string;
  tooltip?: string;
}> = ({ label, control, placeholder, tooltip }) => {
  if (!control) return null;
  return (
    <label class='flex flex-col gap-1'>
      <span class='inline-flex items-center gap-2'>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <Input
        value={control.value ?? ''}
        placeholder={placeholder}
        onInput={(e) => control.onChange((e.target as HTMLInputElement).value)}
      />
    </label>
  );
};

export const NumberField: FunctionalComponent<{
  label: string;
  control: NumberControl;
  min?: number;
  placeholder?: string;
  tooltip?: string;
  hint?: string;
  field?: 'minChoices' | 'maxChoices';
}> = ({ label, control, min = 0, placeholder, tooltip, hint, field }) => {
  const issueId = useDomId();
  if (!control) return null;
  return (
    <label class='flex flex-col gap-1'>
      <span class='inline-flex items-center gap-2'>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <Input
        data-settings-field={field}
        aria-invalid={control.issue ? true : undefined}
        aria-describedby={control.issue ? issueId : undefined}
        type='number'
        min={min}
        value={control.value ?? ''}
        placeholder={placeholder}
        onInput={(e) => control.onChange(readNumber((e.target as HTMLInputElement).value, min))}
      />
      {hint && <span class='text-xs text-base-content/60'>{hint}</span>}
      {control.issue && <FieldIssueMessage id={issueId} message={control.issue} />}
    </label>
  );
};

export const SelectField: FunctionalComponent<{
  label: string;
  control: SelectControl;
  tooltip?: string;
}> = ({ label, control, tooltip }) => {
  if (!control) return null;
  return (
    <label class='flex flex-col gap-1'>
      <span class='inline-flex items-center gap-2'>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <Select
        value={control.value}
        onInput={(e) => control.onChange((e.target as HTMLSelectElement).value)}
      >
        {control.options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </Select>
    </label>
  );
};

export const MediaPlayerControlsField: FunctionalComponent<{
  label: string;
  control: MediaPlayerControlsControl;
}> = ({ label, control }) => {
  if (!control) return null;
  const selected = new Set(control.value);
  return (
    <fieldset class='flex flex-col gap-1 border-0 p-0'>
      <legend class='text-sm font-medium'>{label}</legend>
      <div class='flex flex-col gap-1'>
        {control.options.map((opt) => (
          <label
            key={opt.value}
            class='flex items-center justify-between gap-3 rounded-lg border border-base-300/80 bg-base-100 px-3 py-2'
          >
            <span class='text-sm'>{opt.label}</span>
            <Checkbox
              checked={selected.has(opt.value)}
              aria-label={opt.label}
              onChange={(e) => control.onChange(opt.value, (e.target as HTMLInputElement).checked)}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export const ToggleField: FunctionalComponent<{
  label: string;
  control: ToggleControl;
  tooltip?: string;
}> = ({ label, control, tooltip }) => {
  if (!control) return null;
  return (
    <label class='flex items-center justify-between gap-3 rounded-lg border border-base-300/80 bg-base-100 px-3 py-2'>
      <span class='inline-flex min-w-0 items-center gap-2 text-sm font-medium'>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <Checkbox
        variant='toggle'
        checked={control.value}
        aria-label={label}
        onChange={(e) => control.onChange((e.target as HTMLInputElement).checked)}
      />
    </label>
  );
};
