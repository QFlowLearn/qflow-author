import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { HottextContent } from '../islands/drivers/hottext.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n, type I18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const DISABLED_ATTRIBUTE = /\s(?:disabled[\s=>]|aria-disabled="true")/;
function view(locale: InterfaceLocale, empty = false, maxChoices?: number, one = false) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <HottextContent
        bodyHtml={empty
          ? '<p>BODY-AUTHORED</p>'
          : '<p><span data-qti-hottext="A">FIRST-AUTHORED</span></p>'}
        hottexts={empty
          ? []
          : one
          ? [{ id: 'A', text: 'FIRST-AUTHORED' }]
          : [{ id: 'A', text: 'FIRST-AUTHORED' }, { id: 'B', text: 'SECOND-AUTHORED' }]}
        correctIds={empty ? [] : ['B']}
        responseIdentifier='RESPONSE_Ω'
        maxChoices={maxChoices}
        insertHottext={noop}
        insertHottextMarker={noop}
        removeHottext={noop}
        updateHottextText={noop}
        setCorrectIds={noop}
        setResponseIdentifier={noop}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );
}
const t = (i18n: I18n, key: string, values?: Record<string, string | number>) =>
  i18n.t(`driver.${key}`, values);
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labeledInput = (html: string, label: string) =>
  html.match(new RegExp(`<label[^>]*><span[^>]*>${esc(label)}</span>([\\s\\S]*?)</label>`))?.[1] ??
    '';
for (const locale of locales) {
  for (const variant of ['radio', 'checkbox', 'single', 'empty'] as const) {
    testCase(`hot text localized (${locale}, ${variant})`, () => {
      const i18n = createI18n(
        locale,
        createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
      );
      const empty = variant === 'empty';
      const html = view(
        locale,
        empty,
        variant === 'radio' || variant === 'single' ? 1 : undefined,
        variant === 'single',
      );
      for (
        const key of [
          'hottextPrompt',
          'hottextSpans',
          'hottextAddSpan',
        ] as const
      ) expect(html).toContain(t(i18n, key));
      expect(html).toContain(
        empty ? t(i18n, 'hottextEmpty') : t(i18n, 'hottextSpan', { number: 1 }),
      );
      if (!empty) {
        if (variant !== 'single') expect(html).toContain(t(i18n, 'hottextSpan', { number: 2 }));
        expect(html).toContain(t(i18n, 'hottextPlaced'));
        if (variant !== 'single') expect(html).toContain(t(i18n, 'hottextNotPlaced'));
        expect(html).toContain(t(i18n, 'hottextSelectablePlaceholder'));
        if (variant !== 'single') {
          expect(html).toContain(t(i18n, 'hottextInsert', { number: 2 }));
        }
        if (variant !== 'single') expect(html).toContain(t(i18n, 'hottextInsertAction'));
        expect(html).toContain(t(i18n, 'hottextRemove', { number: 1 }));
        expect(html).toContain('FIRST-AUTHORED');
        if (variant !== 'single') expect(html).toContain('SECOND-AUTHORED');
        if (
          !(labeledInput(html, t(i18n, 'hottextSpan', { number: 1 })).includes(
            'value="FIRST-AUTHORED"',
          ))
        ) {
          expect.unreachable(
            "Expected labeledInput(html, t(i18n, 'hottextSpan', { number: 1 })).includes( 'value=\"FIRST-AUTHORED",
          );
        }
        if (variant !== 'single') {
          if (
            !(labeledInput(html, t(i18n, 'hottextSpan', { number: 2 })).includes(
              'value="SECOND-AUTHORED"',
            ))
          ) {
            expect.unreachable(
              "Expected labeledInput(html, t(i18n, 'hottextSpan', { number: 2 })).includes( 'value=\"SECOND-AUTHORE",
            );
          }
        }
        expect(html).toContain(
          variant === 'radio' || variant === 'single' ? 'type="radio"' : 'type="checkbox"',
        );
        const correctTwo = variant === 'single' ? null : html.match(
          new RegExp(`<input[^>]*aria-label="${t(i18n, 'hottextCorrect', { number: 2 })}"[^>]*>`),
        );
        if (variant !== 'single') {
          if (!(correctTwo?.[0].includes('checked'))) {
            expect.unreachable("Expected correctTwo?.[0].includes('checked')");
          }
        }
        const correctOne = html.match(
          new RegExp(`<input[^>]*aria-label="${t(i18n, 'hottextCorrect', { number: 1 })}"[^>]*>`),
        );
        if (variant !== 'single') {
          if (correctOne?.[0].includes('checked')) {
            expect.unreachable("Expected !correctOne?.[0].includes('checked')");
          }
        }
        expect(html).toContain('aria-label="' + t(i18n, 'hottextCorrect', { number: 1 }) + '"');
        if (
          !((html.match(new RegExp(`>${esc(t(i18n, 'correct'))}</span>`, 'g')) ?? []).length ===
            (variant === 'single' ? 1 : 2))
        ) {
          expect.unreachable(
            "Expected (html.match(new RegExp(`>${esc(t(i18n, 'correct'))}</span>`, 'g')) ?? []).length === (vari",
          );
        }
        if (
          !((html.match(new RegExp(`<button[^>]*>${esc(t(i18n, 'remove'))}</button>`, 'g')) ?? [])
            .length === (variant === 'single' ? 1 : 2))
        ) {
          expect.unreachable(
            "Expected (html.match(new RegExp(`<button[^>]*>${esc(t(i18n, 'remove'))}</button>`, 'g')) ?? []) .le",
          );
        }
        if (variant !== 'single') {
          if (
            !((html.match(
              new RegExp(
                `<button[^>]*aria-label="${esc(t(i18n, 'hottextInsert', { number: 2 }))}"[^>]*>${
                  esc(t(i18n, 'hottextInsertAction'))
                }</button>`,
                'g',
              ),
            ) ?? []).length === 1)
          ) {
            expect.unreachable(
              "Expected (html.match( new RegExp( `<button[^>]*aria-label=\"${esc(t(i18n, 'hottextInsert', { number:",
            );
          }
        }
        if (variant !== 'single') {
          expect(html).toContain('aria-label="' + t(i18n, 'hottextRemove', { number: 2 }) + '"');
          const remove1 = html.match(
            new RegExp(`<button[^>]*aria-label="${t(i18n, 'hottextRemove', { number: 1 })}"[^>]*>`),
          );
          const remove2 = html.match(
            new RegExp(`<button[^>]*aria-label="${t(i18n, 'hottextRemove', { number: 2 })}"[^>]*>`),
          );
          if (!(remove1 && remove2)) expect.unreachable('Expected remove1 && remove2');
          if (!(!DISABLED_ATTRIBUTE.test(remove1[0]) && !DISABLED_ATTRIBUTE.test(remove2[0]))) {
            expect.unreachable(
              'Expected !DISABLED_ATTRIBUTE.test(remove1[0]) && !DISABLED_ATTRIBUTE.test(remove2[0])',
            );
          }
          if (
            !((html.match(
              new RegExp(`aria-label="${t(i18n, 'hottextInsert', { number: 1 })}"`, 'g'),
            ) ?? []).length === 0)
          ) {
            expect.unreachable(
              "Expected (html.match( new RegExp(`aria-label=\"${t(i18n, 'hottextInsert', { number: 1 })}\"`, 'g'), )",
            );
          }
          if (
            !((html.match(
              new RegExp(`aria-label="${t(i18n, 'hottextInsert', { number: 2 })}"`, 'g'),
            ) ?? []).length === 1)
          ) {
            expect.unreachable(
              "Expected (html.match( new RegExp(`aria-label=\"${t(i18n, 'hottextInsert', { number: 2 })}\"`, 'g'), )",
            );
          }
        } else {
          const remove1 = html.match(
            new RegExp(`<button[^>]*aria-label="${t(i18n, 'hottextRemove', { number: 1 })}"[^>]*>`),
          );
          if (!remove1) expect.unreachable('Expected remove1');
          if (!(DISABLED_ATTRIBUTE.test(remove1[0]))) {
            expect.unreachable('Expected DISABLED_ATTRIBUTE.test(remove1[0])');
          }
        }
      }
      if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
        expect.unreachable(
          "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
        );
      }
      if (locale === 'es-ES' || locale === 'es-419') {
        for (
          const old of [
            'Hot text spans',
            'Add span',
            'Selectable text',
            'Placed in body',
            'Not placed',
            'Insert into body',
            '>Correct<',
            '>Span 1<',
            '>Span 2<',
            'Use “Add span”',
            '>Remove<',
          ]
        ) if (html.includes(old)) expect.unreachable('Expected !html.includes(old)');
      }
    });
  }
}
