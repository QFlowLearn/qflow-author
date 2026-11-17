import type { Draft } from '../../../../lib/types/draft.ts';
import type { RailDraft } from '../rail_draft.ts';
import type { ControlPatch, RailBuildContext, SettingsAssign } from './context.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';

const EXTENDED_HEIGHT_VALUES = [
  'qti-height-lines-3',
  'qti-height-lines-6',
  'qti-height-lines-15',
] as const;
const HEIGHT_MESSAGES = {
  'qti-height-lines-3': 'driver.rightRail.extendedHeight3',
  'qti-height-lines-6': 'driver.rightRail.extendedHeight6',
  'qti-height-lines-15': 'driver.rightRail.extendedHeight15',
} as const satisfies Record<(typeof EXTENDED_HEIGHT_VALUES)[number], string>;

export function extendedTextControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'extended_text') return {};
  const { draft, setDraft, t } = ctx;
  return {
    extendedFormat: {
      value: draft.format ?? 'plain',
      options: [
        { value: 'plain', label: t('driver.rightRail.extendedFormatPlain') },
        { value: 'preformatted', label: t('driver.rightRail.extendedFormatPreformatted') },
        { value: 'xhtml', label: t('driver.rightRail.extendedFormatXhtml') },
      ],
      onChange: (next) => setDraft({ format: next as Draft['format'] }),
    },
    extendedExpectedLength: {
      value: draft.expectedLength,
      onChange: (next) => setDraft({ expectedLength: next }),
    },
    extendedExpectedLines: {
      value: draft.expectedLines,
      onChange: (next) => setDraft({ expectedLines: next }),
    },
    extendedPlaceholderText: {
      value: draft.placeholderText ?? '',
      onChange: (next) => setDraft({ placeholderText: next }),
    },
    extendedHeightClass: {
      value: draft.heightClass ?? 'qti-height-lines-6',
      options: EXTENDED_HEIGHT_VALUES.map((value) => ({
        value,
        label: t(HEIGHT_MESSAGES[value]),
      })),
      onChange: (next) => setDraft({ heightClass: next }),
    },
    extendedCounterType: {
      value: draft.counterType ?? 'none',
      options: [
        { value: 'none', label: t('driver.rightRail.extendedCounterNone') },
        { value: 'down', label: t('driver.rightRail.extendedCounterDown') },
        { value: 'up', label: t('driver.rightRail.extendedCounterUp') },
      ],
      onChange: (next) => setDraft({ counterType: next as Draft['counterType'] }),
    },
    extendedMinStrings: {
      value: draft.minStrings,
      onChange: (next) => setDraft({ minStrings: next }),
    },
    extendedMaxStrings: {
      value: draft.maxStrings,
      onChange: (next) => setDraft({ maxStrings: next }),
    },
    extendedPatternMask: {
      value: draft.patternMask ?? '',
      onChange: (next) => setDraft({ patternMask: next }),
    },
    extendedPatternMessage: {
      value: draft.patternMessage ?? '',
      onChange: (next) => setDraft({ patternMessage: next }),
    },
    extendedStringIdentifier: {
      value: draft.stringIdentifier ?? '',
      onChange: (next) => setDraft({ stringIdentifier: next.toUpperCase() }),
    },
  };
}

export function extendedTextSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    extendedExpectedLength: draft.expectedLength,
    extendedExpectedLines: draft.expectedLines,
    extendedPlaceholderText: draft.placeholderText ?? '',
    extendedFormat: draft.format ?? 'plain',
    extendedHeightClass: draft.heightClass ?? 'qti-height-lines-6',
    extendedCounterType: draft.counterType ?? 'none',
    extendedMinStrings: draft.minStrings,
    extendedMaxStrings: draft.maxStrings,
    extendedPatternMask: draft.patternMask ?? '',
    extendedPatternMessage: draft.patternMessage ?? '',
    extendedStringIdentifier: draft.stringIdentifier ?? '',
  };
}

export function applyExtendedTextSettings(
  typeId: string,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (typeId !== 'extended_text') return;
  if ('extendedExpectedLength' in settings) {
    assign('expectedLength', settings.extendedExpectedLength);
  }
  if ('extendedExpectedLines' in settings) {
    assign('expectedLines', settings.extendedExpectedLines);
  }
  if ('extendedPlaceholderText' in settings) {
    assign('placeholderText', settings.extendedPlaceholderText ?? '');
  }
  if (
    'extendedFormat' in settings &&
    (settings.extendedFormat === 'plain' ||
      settings.extendedFormat === 'preformatted' ||
      settings.extendedFormat === 'xhtml')
  ) {
    assign('format', settings.extendedFormat);
  }
  if (
    'extendedCounterType' in settings &&
    (settings.extendedCounterType === 'none' ||
      settings.extendedCounterType === 'up' ||
      settings.extendedCounterType === 'down')
  ) {
    assign('counterType', settings.extendedCounterType);
  }
  if ('extendedHeightClass' in settings && typeof settings.extendedHeightClass === 'string') {
    assign('heightClass', settings.extendedHeightClass);
  }
  if ('extendedMinStrings' in settings) {
    assign('minStrings', settings.extendedMinStrings);
  }
  if ('extendedMaxStrings' in settings) {
    assign('maxStrings', settings.extendedMaxStrings);
  }
  if ('extendedPatternMask' in settings) {
    assign('patternMask', settings.extendedPatternMask ?? '');
  }
  if ('extendedPatternMessage' in settings) {
    assign('patternMessage', settings.extendedPatternMessage ?? '');
  }
  if ('extendedStringIdentifier' in settings) {
    assign('stringIdentifier', (settings.extendedStringIdentifier ?? '').toUpperCase());
  }
}
