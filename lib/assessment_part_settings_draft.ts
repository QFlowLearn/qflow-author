import { parseAssessmentPartOptions } from './assessment_arrangement.ts';
import type { PartOptions } from './test_export.ts';

/** Editable text is retained until it can be parsed into canonical part settings. */
export type PartSettingsDraft = Omit<PartOptions, 'timeLimits'> & {
  readonly timeLimits?: { readonly minTime: string; readonly maxTime: string };
};
export type PartSettingsDraftResult =
  | { readonly ok: true; readonly options: PartOptions }
  | { readonly ok: false; readonly issue: 'timeNumber' | 'timeRange' | 'options' };

/** Preserve optional settings and every feedback block when opening the shared form. */
export function createPartSettingsDraft(options: PartOptions): PartSettingsDraft {
  const { timeLimits, ...rest } = structuredClone(options);
  return {
    ...rest,
    ...(timeLimits === undefined ? {} : {
      timeLimits: {
        minTime: timeLimits.minTime === undefined ? '' : String(timeLimits.minTime),
        maxTime: timeLimits.maxTime === undefined ? '' : String(timeLimits.maxTime),
      },
    }),
  };
}

/** Parse raw seconds without clamping, substituting zero, or discarding other settings. */
export function parsePartSettingsDraft(draft: PartSettingsDraft): PartSettingsDraftResult {
  const { timeLimits, ...rest } = draft;
  const options: PartOptions = { ...rest };
  if (timeLimits !== undefined) {
    const parsedTimes: NonNullable<PartOptions['timeLimits']> = {};
    for (const field of ['minTime', 'maxTime'] as const) {
      const text = timeLimits[field];
      if (text === '') continue;
      if (!/^\d+$/.test(text)) return { ok: false, issue: 'timeNumber' };
      const value = Number(text);
      // The canonical parser owns the numeric bounds, including safe integers and maximum seconds.
      if (!parseAssessmentPartOptions({ timeLimits: { [field]: value } }).ok) {
        return { ok: false, issue: 'timeNumber' };
      }
      parsedTimes[field] = value;
    }
    if (
      parsedTimes.minTime !== undefined && parsedTimes.maxTime !== undefined &&
      parsedTimes.minTime > parsedTimes.maxTime
    ) return { ok: false, issue: 'timeRange' };
    options.timeLimits = parsedTimes;
  }
  const parsed = parseAssessmentPartOptions(options);
  return parsed.ok ? parsed : { ok: false, issue: 'options' };
}
