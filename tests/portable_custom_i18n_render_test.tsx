import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { PortableCustomSection } from '../islands/drivers/right_rail/sections.tsx';
import type { RightRailControls } from '../islands/drivers/right_rail/types.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const text = (value: string) => ({ value, onChange: noop });
const select = (value: string) => ({
  value,
  options: [
    { value: 'single', label: 'single' },
    { value: 'multiple', label: 'multiple' },
    { value: 'ordered', label: 'ordered' },
    { value: 'record', label: 'record' },
  ],
  onChange: noop,
});

function controls(populated: boolean): RightRailControls {
  return {
    sections: [],
    portableModule: text('pciModule'),
    portableClassName: text('pci-class'),
    portableLabel: text('AUTHORED PCI LABEL'),
    portableBaseType: text('string'),
    portableCardinality: select('multiple'),
    portableModulesPrimaryConfiguration: text('modules/module_resolution.js'),
    portableModulesSecondaryConfiguration: text('modules/fallback_module_resolution.js'),
    portableInteractionModules: {
      value: populated
        ? [{
          id: 'module-1',
          primaryPath: 'modules/example.js',
          fallbackPath: 'modules/example-fallback.js',
        }]
        : [],
      onChange: noop,
    },
  };
}

for (const locale of locales) {
  testCase(`portable custom right rail is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = render(
      <I18nProvider payload={payload}>
        <PortableCustomSection controls={controls(true)} />
      </I18nProvider>,
    );
    for (
      const key of [
        'portableCustom',
        'portableCustomHelp',
        'portableResponseBaseType',
        'portableResponseCardinality',
        'portableModuleName',
        'portableClassName',
        'portableLabel',
        'portablePrimaryModuleConfig',
        'portableSecondaryModuleConfig',
        'portableInteractionModules',
        'portableAddModule',
        'portableModuleId',
        'portablePrimaryPath',
        'portableFallbackPath',
        'portableRemoveModule',
      ]
    ) expect(html).toContain(i18n.t(`driver.rightRail.${key}`));
    for (
      const value of [
        'pciModule',
        'pci-class',
        'AUTHORED PCI LABEL',
        'module-1',
        'modules/example.js',
        'modules/example-fallback.js',
        'single',
        'multiple',
        'ordered',
        'record',
      ]
    ) {
      expect(html).toContain(value);
    }
    if (html.includes('driver.rightRail.')) {
      expect.unreachable("Expected !html.includes('driver.rightRail.')");
    }
    if (locale.startsWith('es')) {
      for (
        const phrase of ['Portable custom', 'Response base type', 'Interaction modules', 'Remove']
      ) {
        if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
      }
    }
  });

  testCase(`portable custom empty and absent controls are safe (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const empty = render(
      <I18nProvider payload={payload}>
        <PortableCustomSection controls={controls(false)} />
      </I18nProvider>,
    );
    const absent = render(
      <I18nProvider payload={payload}>
        <PortableCustomSection controls={{ sections: [] }} />
      </I18nProvider>,
    );
    expect(empty).toContain(
      createI18n(locale, payload.namespaces).t('driver.rightRail.portableModulesEmpty'),
    );
    if (empty.includes('driver.rightRail.')) {
      expect.unreachable("Expected !empty.includes('driver.rightRail.')");
    }
    if (!(absent === '')) expect.unreachable("Expected absent === ''");
  });
}
