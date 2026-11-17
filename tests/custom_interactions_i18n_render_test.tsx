import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { CustomInteractionContent } from '../islands/drivers/custom_interaction.tsx';
import { PortableCustomContent } from '../islands/drivers/portable_custom.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const i18nFor = (locale: InterfaceLocale) =>
  createI18n(locale, createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces);
const enUS = i18nFor('en-US');
const t = (locale: InterfaceLocale, key: string, values?: Record<string, string | number>) =>
  i18nFor(locale).t(`driver.${key}`, values);

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inputs = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]);
const textareas = (html: string) =>
  [...html.matchAll(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/g)].map((match) => match[0]);
const options = (html: string) =>
  [...html.matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => ({
    value: m[1],
    text: m[2],
    tag: m[0],
  }));
const buttons = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1],
    body: m[2],
  }));
const inputWithValue = (html: string, value: string) =>
  inputs(html).find((tag) => tag.includes(`value="${escapeHtml(value)}"`));
const labeledInput = (html: string, label: string) => {
  const match = html.match(
    new RegExp(
      `<label\\b[^>]*>[\\s\\S]*?<span[^>]*>${escapeRegex(label)}</span>([\\s\\S]*?)<\\/label>`,
    ),
  );
  return match?.[1] ? inputs(match[1])[0] : undefined;
};
const textareaValue = (html: string, value: string) =>
  textareas(html).find((tag) => tag.endsWith(`${escapeHtml(value)}</textarea>`));
const exactButtonBodyCount = (html: string, body: string) =>
  buttons(html).filter((button) => button.body === body).length;
const ariaCount = (html: string, label: string) =>
  buttons(html).filter((button) => button.attrs.includes(`aria-label="${escapeHtml(label)}"`))
    .length;
const exactOption = (html: string, value: string, label: string) =>
  options(html).find((option) => option.value === value && option.text === label);

function custom(locale: InterfaceLocale, empty: boolean) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <CustomInteractionContent
        responseIdentifier='RESPONSE-Ω'
        customBaseType='string'
        customCardinality='multiple'
        customClassName='qti-custom-interaction'
        customDefinition='https://example.test/def'
        customAttributes={empty
          ? []
          : [{ name: 'data-foo', value: 'bar-Ω' }, { name: 'ext-mode', value: 'enabled' }]}
        customInteractionMarkup={empty ? '' : '<custom-node>XML-Ω</custom-node>'}
        setResponseIdentifier={noop}
        setCustomBaseType={noop}
        setCustomCardinality={noop}
        setCustomClassName={noop}
        setCustomDefinition={noop}
        setCustomInteractionMarkup={noop}
        addCustomAttribute={noop}
        updateCustomAttributeName={noop}
        updateCustomAttributeValue={noop}
        removeCustomAttribute={noop}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );
}

function portable(locale: InterfaceLocale, empty: boolean) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <PortableCustomContent
        responseIdentifier='RESPONSE-Π'
        portableCustomTypeIdentifier='urn:example:pci:type'
        portableDataAttributes={empty
          ? []
          : [{ name: 'data-mode', value: 'test-Ω' }, { name: 'data-foo', value: 'bar' }]}
        portableInteractionMarkup={empty ? '' : '<pci-root>HTML-Ω</pci-root>'}
        setResponseIdentifier={noop}
        setPortableCustomTypeIdentifier={noop}
        setPortableInteractionMarkup={noop}
        addPortableDataAttribute={noop}
        updatePortableDataAttributeName={noop}
        updatePortableDataAttributeValue={noop}
        removePortableDataAttribute={noop}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );
}

const customKeys = [
  'customInteractionPrompt',
  'customInteractionBaseType',
  'customInteractionCardinality',
  'customInteractionClass',
  'customInteractionDefinition',
  'customInteractionAttributes',
  'attributeAdd',
  'customInteractionAttributesEmpty',
  'attributeName',
  'attributeValue',
  'attributeValuePlaceholder',
  'attributeRemove',
  'customInteractionMarkup',
  'customInteractionMarkupExample',
  'customInteractionMarkupHelp',
  'customInteractionSingle',
  'customInteractionMultiple',
  'customInteractionOrdered',
  'customInteractionRecord',
  'remove',
];
const portableKeys = [
  'portableCustomPrompt',
  'portableCustomType',
  'portableCustomAttributes',
  'portableCustomAttributesEmpty',
  'portableCustomMarkup',
  'portableCustomMarkupExample',
  'portableCustomMarkupHelp',
  'attributeAdd',
  'attributeName',
  'attributeValue',
  'attributeValuePlaceholder',
  'attributeRemove',
  'remove',
];
const cardinalities: Record<string, string> = {
  single: 'customInteractionSingle',
  multiple: 'customInteractionMultiple',
  ordered: 'customInteractionOrdered',
  record: 'customInteractionRecord',
};

function assertNoRawKeys(html: string) {
  if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
  if (/\{(?:count|plural|select)(?:[,}])/.test(html)) {
    expect.unreachable('Expected !/\\{(?:count|plural|select)(?:[,}])/.test(html)');
  }
}
function assertSpanishDoesNotLeakEnglish(html: string, locale: InterfaceLocale, keys: string[]) {
  if (!locale.startsWith('es-')) return;
  for (const key of keys) {
    const variants = key === 'attributeName' || key === 'attributeValue' ||
        key === 'attributeRemove'
      ? [{ number: 1 }, { number: 2 }]
      : [undefined];
    for (const values of variants) {
      const english = enUS.t(`driver.${key}`, values);
      const localized = t(locale, key, values);
      if (english !== localized) {
        const forms = key === 'attributeValuePlaceholder'
          ? [`placeholder="${escapeHtml(english)}"`]
          : key === 'attributeRemove'
          ? [`aria-label="${escapeHtml(english)}"`]
          : [`>${escapeHtml(english)}<`, `>${escapeHtml(english)}</span>`];
        if (!(forms.every((form) => !html.includes(form)))) {
          expect.unreachable(`${locale} leaked ${english}`);
        }
        if (key === 'customInteractionPrompt' || key === 'portableCustomPrompt') {
          if (html.includes(`placeholder="${escapeHtml(english)}"`)) {
            expect.unreachable('Expected !html.includes(`placeholder="${escapeHtml(english)}"`)');
          }
        }
      }
    }
  }
}

for (const locale of locales) {
  for (const empty of [false, true]) {
    testCase(`custom and portable complete i18n ${locale} ${empty ? 'empty' : 'populated'}`, () => {
      const customHtml = custom(locale, empty);
      const portableHtml = portable(locale, empty);
      assertNoRawKeys(customHtml);
      assertNoRawKeys(portableHtml);
      assertSpanishDoesNotLeakEnglish(customHtml, locale, customKeys);
      assertSpanishDoesNotLeakEnglish(portableHtml, locale, portableKeys);
      const customSurface = empty
        ? customKeys.filter((key) =>
          ![
            'attributeName',
            'attributeValue',
            'attributeRemove',
            'attributeValuePlaceholder',
            'remove',
          ]
            .includes(key)
        )
        : customKeys.filter((key) => key !== 'customInteractionAttributesEmpty');
      const portableSurface = empty
        ? portableKeys.filter((key) =>
          ![
            'attributeName',
            'attributeValue',
            'attributeRemove',
            'attributeValuePlaceholder',
            'remove',
          ]
            .includes(key)
        )
        : portableKeys.filter((key) => key !== 'portableCustomAttributesEmpty');
      for (const key of customSurface) {
        expect(customHtml).toContain(
          t(locale, key, key.includes('attribute') ? { number: 1 } : undefined),
        );
      }
      for (const key of portableSurface) {
        expect(portableHtml).toContain(
          t(locale, key, key.includes('attribute') ? { number: 1 } : undefined),
        );
      }
      for (const [value, key] of Object.entries(cardinalities)) {
        if (!(exactOption(customHtml, value, t(locale, key)))) {
          expect.unreachable('Expected exactOption(customHtml, value, t(locale, key))');
        }
      }
      const selectedMultiple = options(customHtml).find((option) => option.value === 'multiple');
      if (!(selectedMultiple?.tag.includes('selected'))) {
        expect.unreachable("Expected selectedMultiple?.tag.includes('selected')");
      }
      const customPlaceholder = `<div class="custom-interaction">${
        t(locale, 'customInteractionMarkupExample')
      }</div>`;
      const portablePlaceholder = `<div class="pci-root">${
        t(locale, 'portableCustomMarkupExample')
      }</div>`;
      expect(customHtml).toContain(`placeholder="${escapeHtml(customPlaceholder)}"`);
      expect(portableHtml).toContain(`placeholder="${escapeHtml(portablePlaceholder)}"`);
      if (locale.startsWith('es-')) {
        const englishCustomPlaceholder = `<div class="custom-interaction">${
          enUS.t('driver.customInteractionMarkupExample')
        }</div>`;
        const englishPortablePlaceholder = `<div class="pci-root">${
          enUS.t('driver.portableCustomMarkupExample')
        }</div>`;
        if (englishCustomPlaceholder !== customPlaceholder) {
          if (customHtml.includes(`placeholder="${escapeHtml(englishCustomPlaceholder)}"`)) {
            expect.unreachable(
              'Expected !customHtml.includes(`placeholder="${escapeHtml(englishCustomPlaceholder)}"`)',
            );
          }
        }
        if (englishPortablePlaceholder !== portablePlaceholder) {
          if (
            portableHtml.includes(`placeholder="${escapeHtml(englishPortablePlaceholder)}"`)
          ) {
            expect.unreachable(
              'Expected !portableHtml.includes(`placeholder="${escapeHtml(englishPortablePlaceholder)}"`)',
            );
          }
        }
      }
      if (empty) {
        expect(customHtml).toContain(t(locale, 'customInteractionAttributesEmpty'));
        expect(portableHtml).toContain(t(locale, 'portableCustomAttributesEmpty'));
      }
      if (!(inputWithValue(customHtml, 'string'))) {
        expect.unreachable("Expected inputWithValue(customHtml, 'string')");
      }
      if (!(inputWithValue(customHtml, 'qti-custom-interaction'))) {
        expect.unreachable("Expected inputWithValue(customHtml, 'qti-custom-interaction')");
      }
      if (!(inputWithValue(customHtml, 'https://example.test/def'))) {
        expect.unreachable("Expected inputWithValue(customHtml, 'https://example.test/def')");
      }
      if (!(inputWithValue(portableHtml, 'urn:example:pci:type'))) {
        expect.unreachable("Expected inputWithValue(portableHtml, 'urn:example:pci:type')");
      }
      // ResponseIdentifierDisclosure intentionally renders null; these response IDs remain
      // fixture invariants and cannot be asserted from this component's SSR DOM.
      if (empty) {
        for (const html of [customHtml, portableHtml]) {
          if (
            !((html.match(
              new RegExp(
                `placeholder="${escapeRegex(t(locale, 'attributeValuePlaceholder'))}"`,
                'g',
              ),
            ) ?? []).length === 0)
          ) {
            expect.unreachable(
              "Expected (html.match( new RegExp( `placeholder=\"${escapeRegex(t(locale, 'attributeValuePlaceholder'",
            );
          }
          for (const number of [1, 2]) {
            if (html.includes(`>${t(locale, 'attributeName', { number })}<`)) {
              expect.unreachable(
                "Expected !html.includes(`>${t(locale, 'attributeName', { number })}<`)",
              );
            }
            if (html.includes(`>${t(locale, 'attributeValue', { number })}<`)) {
              expect.unreachable(
                "Expected !html.includes(`>${t(locale, 'attributeValue', { number })}<`)",
              );
            }
            if (!(ariaCount(html, t(locale, 'attributeRemove', { number })) === 0)) {
              expect.unreachable(
                "Expected ariaCount(html, t(locale, 'attributeRemove', { number })) === 0",
              );
            }
          }
        }
        if (!(textareas(customHtml).some((tag) => tag.endsWith('</textarea>')))) {
          expect.unreachable(
            "Expected textareas(customHtml).some((tag) => tag.endsWith('</textarea>'))",
          );
        }
        if (!(textareas(portableHtml).some((tag) => tag.endsWith('</textarea>')))) {
          expect.unreachable(
            "Expected textareas(portableHtml).some((tag) => tag.endsWith('</textarea>'))",
          );
        }
      } else {
        if (!(textareaValue(customHtml, '<custom-node>XML-Ω</custom-node>'))) {
          expect.unreachable(
            "Expected textareaValue(customHtml, '<custom-node>XML-Ω</custom-node>')",
          );
        }
        if (!(textareaValue(portableHtml, '<pci-root>HTML-Ω</pci-root>'))) {
          expect.unreachable("Expected textareaValue(portableHtml, '<pci-root>HTML-Ω</pci-root>')");
        }
        for (
          const [html, names, values] of [
            [customHtml, ['data-foo', 'ext-mode'], ['bar-Ω', 'enabled']],
            [portableHtml, ['data-mode', 'data-foo'], ['test-Ω', 'bar']],
          ] as const
        ) {
          for (let index = 0; index < 2; index++) {
            const number = index + 1;
            if (
              !(labeledInput(html, t(locale, 'attributeName', { number }))?.includes(
                `value="${escapeHtml(names[index])}"`,
              ))
            ) {
              expect.unreachable(
                "Expected labeledInput(html, t(locale, 'attributeName', { number }))?.includes( `value=\"${escapeHtml",
              );
            }
            if (
              !(labeledInput(html, t(locale, 'attributeValue', { number }))?.includes(
                `value="${escapeHtml(values[index])}"`,
              ))
            ) {
              expect.unreachable(
                "Expected labeledInput(html, t(locale, 'attributeValue', { number }))?.includes( `value=\"${escapeHtm",
              );
            }
            if (!(html.includes(`>${t(locale, 'attributeName', { number })}</span>`))) {
              expect.unreachable(
                "Expected html.includes(`>${t(locale, 'attributeName', { number })}</span>`)",
              );
            }
            if (!(html.includes(`>${t(locale, 'attributeValue', { number })}</span>`))) {
              expect.unreachable(
                "Expected html.includes(`>${t(locale, 'attributeValue', { number })}</span>`)",
              );
            }
            expect(html).toContain(
              `placeholder="${escapeHtml(t(locale, 'attributeValuePlaceholder'))}"`,
            );
            if (!(ariaCount(html, t(locale, 'attributeRemove', { number })) === 1)) {
              expect.unreachable(
                "Expected ariaCount(html, t(locale, 'attributeRemove', { number })) === 1",
              );
            }
          }
          if (
            !((html.match(
              new RegExp(
                `placeholder="${escapeRegex(t(locale, 'attributeValuePlaceholder'))}"`,
                'g',
              ),
            ) ?? []).length === 2)
          ) {
            expect.unreachable(
              "Expected (html.match( new RegExp( `placeholder=\"${escapeRegex(t(locale, 'attributeValuePlaceholder'",
            );
          }
          if (!(exactButtonBodyCount(html, t(locale, 'remove')) === 2)) {
            expect.unreachable("Expected exactButtonBodyCount(html, t(locale, 'remove')) === 2");
          }
        }
      }
    });
  }
}
