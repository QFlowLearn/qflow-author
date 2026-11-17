import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import HostedDeliveryPanel from '../islands/assessment_builder/HostedDeliveryPanel.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'];
const noOp = () => {};

function renderPanel(
  locale: InterfaceLocale,
  capability: Parameters<typeof HostedDeliveryPanel>[0]['capability'],
  busy: boolean,
): string {
  return renderToString(
    <I18nProvider
      payload={createI18nPayload(locale, catalogForLocale(locale), ['delivery', 'assessments'])}
    >
      <HostedDeliveryPanel capability={capability} busy={busy} onPublish={noOp} />
    </I18nProvider>,
  );
}

function assertSafe(locale: InterfaceLocale, html: string): void {
  if (html.includes('delivery.hosted.') || html.includes('list.actions.publish.')) {
    expect.unreachable("Expected !html.includes('delivery.hosted.')");
  }
  if (html.includes('Harbor')) expect.unreachable("Expected !html.includes('Harbor')");
  if (html.includes('PROVIDER_SECRET')) {
    expect.unreachable("Expected !html.includes('PROVIDER_SECRET')");
  }
  if (/\{[^}]*\b(?:plural|select|number|date|time)\b/.test(html)) {
    expect.unreachable('Expected !/\\{[^}]*\\b(?:plural|select|number|date|time)\\b/.test(html)');
  }
  if (locale.startsWith('es-')) {
    for (
      const phrase of [
        'Hosted delivery',
        'Publish the canonical QTI 3 assessment to your workspace',
        'Publish assessment',
        'Publishing…',
        'Hosted delivery is temporarily unavailable. Try again later.',
        'Hosted delivery is not available for this workspace.',
        'Ask a workspace administrator to review delivery access before publishing.',
      ]
    ) {
      if (html.includes(phrase)) {
        expect.unreachable(locale + ' leaked English hosted copy: ' + phrase);
      }
    }
  }
}

testCase('hosted delivery setup states are localized and suppress provider prose', () => {
  const setupStatuses = [
    ['not_configured', 'list.actions.publish.notConfigured'],
    ['invalid_config', 'list.actions.publish.invalidConfiguration'],
    ['not_linked', 'list.actions.publish.notLinked'],
    ['not_entitled', 'list.actions.publish.notEntitled'],
  ] as const;
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const [status, messageKey] of setupStatuses) {
      const html = renderPanel(locale, {
        enabled: false,
        status,
        message: 'Harbor delivery status: PROVIDER_SECRET',
      }, false);
      expect(html).toContain(i18n.t('delivery.hosted.title'));
      expect(html).toContain(i18n.t('delivery.hosted.description'));
      expect(html).toContain(i18n.t(messageKey));
      if (html.includes(i18n.t('delivery.hosted.publish'))) {
        expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.publish'))");
      }
      if (html.includes(i18n.t('delivery.hosted.publishing'))) {
        expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.publishing'))");
      }
      if (html.includes(i18n.t('delivery.hosted.unavailable'))) {
        expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.unavailable'))");
      }
      assertSafe(locale, html);
    }
  }
});

testCase('temporarily unavailable hosted delivery is localized', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = renderPanel(locale, {
      enabled: false,
      status: 'unavailable',
      message: 'Harbor delivery status could not be verified.',
    }, false);
    expect(html).toContain(i18n.t('delivery.hosted.title'));
    expect(html).toContain(i18n.t('delivery.hosted.description'));
    expect(html).toContain(i18n.t('list.actions.publish.unavailable'));
    if (html.includes(i18n.t('delivery.hosted.notAvailable'))) {
      expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.notAvailable'))");
    }
    if (html.includes(i18n.t('delivery.hosted.publish'))) {
      expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.publish'))");
    }
    if (html.includes(i18n.t('delivery.hosted.publishing'))) {
      expect.unreachable("Expected !html.includes(i18n.t('delivery.hosted.publishing'))");
    }
    assertSafe(locale, html);
  }
});

testCase('configured hosted delivery localizes idle and busy publish states', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const idle = renderPanel(locale, {
      enabled: true,
      status: 'configured',
      message: 'Harbor delivery is configured.',
    }, false);
    expect(idle).toContain(i18n.t('delivery.hosted.title'));
    expect(idle).toContain(i18n.t('delivery.hosted.description'));
    expect(idle).toContain('>' + i18n.t('delivery.hosted.publish') + '</button>');
    expect(idle).toContain('aria-busy="false"');
    if (idle.includes(i18n.t('delivery.hosted.publishing'))) {
      expect.unreachable("Expected !idle.includes(i18n.t('delivery.hosted.publishing'))");
    }
    if (idle.includes(i18n.t('delivery.hosted.unavailable'))) {
      expect.unreachable("Expected !idle.includes(i18n.t('delivery.hosted.unavailable'))");
    }
    if (idle.includes(i18n.t('delivery.hosted.notAvailable'))) {
      expect.unreachable("Expected !idle.includes(i18n.t('delivery.hosted.notAvailable'))");
    }
    assertSafe(locale, idle);

    const busy = renderPanel(locale, {
      enabled: true,
      status: 'configured',
      message: 'Harbor delivery is configured.',
    }, true);
    expect(busy).toContain('>' + i18n.t('delivery.hosted.publishing') + '</button>');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('disabled');
    if (busy.includes('>' + i18n.t('delivery.hosted.publish') + '</button>')) {
      expect.unreachable(
        "Expected !busy.includes('>' + i18n.t('delivery.hosted.publish') + '</button>')",
      );
    }
    if (busy.includes(i18n.t('delivery.hosted.unavailable'))) {
      expect.unreachable("Expected !busy.includes(i18n.t('delivery.hosted.unavailable'))");
    }
    if (busy.includes(i18n.t('delivery.hosted.notAvailable'))) {
      expect.unreachable("Expected !busy.includes(i18n.t('delivery.hosted.notAvailable'))");
    }
    assertSafe(locale, busy);
  }
});
