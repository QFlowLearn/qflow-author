import { expect, test } from 'vitest';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { DELIVERY_CAPABILITY_FAILURE_CODES } from '../lib/delivery_publish_failure.ts';
import { formatDeliveryPublishError } from '../islands/assessment_builder/assessment_delivery.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;

test('known publication failures explain the required recovery action', () => {
  const i18n = createI18n('en-US', catalogForLocale('en-US'));
  for (
    const [error, expected] of [
      [
        'delivery_publish_tenant_not_linked',
        'This workspace is not linked to hosted delivery. Ask a workspace administrator to connect it.',
      ],
      [
        'delivery_publish_not_entitled',
        'This workspace does not have delivery access. Ask a workspace administrator to enable it.',
      ],
      [
        'delivery_publish_in_progress',
        'This assessment is being published. Wait for publication to finish before trying again.',
      ],
      [
        'delivery_export_preflight_stale',
        'The assessment changed after review. Review the current export before publishing again.',
      ],
      [
        'delivery_export_preflight_blocked',
        'This assessment cannot be published yet. Open Download / export and resolve the reported issues.',
      ],
      [
        'delivery_export_preflight_failed',
        'This assessment cannot be published yet. Open Download / export and resolve the reported issues.',
      ],
      [
        'delivery_export_approval_invalid',
        'Review and accept the current export warnings before publishing again.',
      ],
      [
        'delivery_publish_package_fetch_failed',
        'The delivery service could not retrieve the assessment package. Ask a workspace administrator to check the connection.',
      ],
    ]
  ) {
    expect(formatDeliveryPublishError(i18n, { error }, 'publishFailed')).toBe(expected);
  }
  expect(formatDeliveryPublishError(i18n, {}, 'requestFailed')).toBe(
    'QFlow could not connect to publish this assessment. Check your connection and try again.',
  );
});

test('known errors stay localized and unknown responses never expose server prose', () => {
  for (const locale of locales) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const generic = i18n.t('list.actions.publish.failure');
    const messages = [
      ...Object.values(DELIVERY_CAPABILITY_FAILURE_CODES),
      'delivery_publish_in_progress',
      'delivery_export_preflight_stale',
      'delivery_export_preflight_blocked',
      'delivery_export_warnings_not_acknowledged',
      'delivery_publish_package_fetch_failed',
      'not_found',
    ].map((error) =>
      formatDeliveryPublishError(i18n, {
        error,
        message: 'HOSTILE_MESSAGE',
        setupHint: 'HOSTILE_SETUP',
      }, 'publishFailed')
    );
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) {
      expect(message).not.toBe(generic);
      expect(message).not.toMatch(/HOSTILE_|list\.actions\./);
    }
    for (const error of ['HOSTILE_ERROR', { message: 'HOSTILE_ERROR' }, null]) {
      expect(formatDeliveryPublishError(i18n, {
        error,
        message: 'HOSTILE_MESSAGE',
        setupHint: 'HOSTILE_SETUP',
      }, 'publishFailed')).toBe(generic);
    }
  }
});
