import type { InterfaceLocale } from '../../lib/i18n/locale.ts';
import type { Capture, Scenario } from './source_intake_failure_cases.ts';

export const captureCount = (
  captures: Capture[],
  locale: InterfaceLocale,
  scenario: Scenario,
  kind: Capture['kind'],
) =>
  captures.filter((capture) =>
    capture.locale === locale && capture.scenario === scenario && capture.kind === kind
  ).length;

export const capturesFor = (
  captures: Capture[],
  locale: InterfaceLocale,
  scenario: Scenario,
  kind: Capture['kind'],
) =>
  captures.filter((capture) =>
    capture.locale === locale && capture.scenario === scenario && capture.kind === kind
  );

export const expectedCapture = (
  locale: InterfaceLocale,
  scenario: Scenario,
  kind: Capture['kind'],
  name: string,
  content: string,
  key: string | null = null,
): Capture => ({
  locale,
  scenario,
  kind,
  purpose: 'recover_existing',
  files: [{ name, type: 'application/pdf', size: content.length, text: content }],
  adapters: kind === 'execute' ? [{ field: 'adapter-0', value: 'pdf@1' }] : [],
  key,
  text: null,
});
