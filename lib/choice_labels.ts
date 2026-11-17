import {
  SHARED_VOCABULARY_LABEL_STYLES,
  SHARED_VOCABULARY_LABEL_SUFFIXES,
} from '@longsightgroup/qti3-core';

export type QtiChoiceLabelStyle = typeof SHARED_VOCABULARY_LABEL_STYLES[number];
export type QtiChoiceLabelSuffix = typeof SHARED_VOCABULARY_LABEL_SUFFIXES[number];

export type ChoiceLabelInput = {
  id?: string;
  label?: string;
};

export type ChoiceLabelOptions = {
  style?: QtiChoiceLabelStyle;
  suffix?: QtiChoiceLabelSuffix;
};

const CJK_ONES = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

export function choiceLabel(
  choice: ChoiceLabelInput,
  index: number,
  options: ChoiceLabelOptions = {},
): string {
  const custom = choice.label?.trim();
  if (custom) return applyLabelSuffix(custom, options.suffix);
  return defaultChoiceLabel(choice, index, options);
}

export function defaultChoiceLabel(
  choice: ChoiceLabelInput,
  index: number,
  options: ChoiceLabelOptions = {},
): string {
  const base = autoLabel(choice, index, options.style);
  return applyLabelSuffix(base, options.suffix);
}

function autoLabel(
  choice: ChoiceLabelInput,
  index: number,
  style?: QtiChoiceLabelStyle,
): string {
  if (!style) {
    const id = choice.id?.trim();
    if (id) return id;
    return alphaLabel(index, 'upper');
  }
  return qtiListMarker(index, style);
}

export function qtiListMarker(index: number, style: QtiChoiceLabelStyle): string {
  switch (style) {
    case 'none':
      return '';
    case 'decimal':
      return String(index + 1);
    case 'lower-alpha':
      return alphaLabel(index, 'lower');
    case 'upper-alpha':
      return alphaLabel(index, 'upper');
    case 'cjk-ideographic':
      return cjkIdeographicLabel(index);
    default:
      return alphaLabel(index, 'upper');
  }
}

/** Returns the first unused QTI alphabetic choice identifier, including AA and beyond. */
export function nextChoiceId(ids: ReadonlySet<string>): string {
  let index = 0;
  let id: string;
  do id = qtiListMarker(index++, 'upper-alpha'); while (ids.has(id));
  return id;
}

export function applyLabelSuffix(
  label: string,
  suffix?: QtiChoiceLabelSuffix,
): string {
  if (!label || !suffix || suffix === 'none') return label;
  if (suffix === 'period') return `${label}.`;
  if (suffix === 'parenthesis') return `(${label})`;
  return label;
}

function alphaLabel(index: number, casing: 'lower' | 'upper'): string {
  let remaining = index + 1;
  let label = '';
  const base = casing === 'lower' ? 97 : 65;
  while (remaining > 0) {
    remaining -= 1;
    label = String.fromCharCode(base + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26);
  }
  return label;
}

function cjkIdeographicLabel(index: number): string {
  const value = index + 1;
  if (value <= 0) return '';
  if (value < 10) return CJK_ONES[value];
  if (value === 10) return '十';
  if (value < 20) return `十${CJK_ONES[value - 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${CJK_ONES[tens]}十${ones ? CJK_ONES[ones] : ''}`;
  }
  return String(value);
}

export function choiceLabelOptionsFromVocabulary(vocabulary?: {
  labelStyle?: QtiChoiceLabelStyle;
  labelSuffix?: QtiChoiceLabelSuffix;
}): ChoiceLabelOptions {
  return {
    style: vocabulary?.labelStyle,
    suffix: vocabulary?.labelSuffix,
  };
}
