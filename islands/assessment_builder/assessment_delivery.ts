import type { DeliveryPublishFailureReason } from '../../lib/client/delivery_publish.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

/** Format the assessment-plan label with locale-aware coverage counts when available. */
export function formatAssessmentPlanLabel(
  i18n: I18n,
  coverage?: { readonly assigned: number; readonly expected: number },
): string {
  return coverage
    ? i18n.t('list.builder.header.planCoverage', {
      assigned: i18n.formatNumber(coverage.assigned),
      expected: i18n.formatNumber(coverage.expected),
    })
    : i18n.t('list.builder.header.plan');
}

/** Format exact delivery warning codes for a localized approval prompt. */
export function formatDeliveryWarningConfirmation(
  i18n: I18n,
  warningCodes: readonly string[],
): string {
  return [
    i18n.t('list.actions.warning.intro'),
    '',
    ...warningCodes.map((code) =>
      code === 'qti3_conformance.not_run'
        ? i18n.t('list.actions.warning.automatedQti')
        : i18n.t('list.actions.warning.genericExport', { code })
    ),
    '',
    i18n.t('list.actions.warning.finalConfirmation'),
  ].join('\n');
}

export function formatDeliveryPublishError(
  i18n: I18n,
  data: {
    readonly message?: string;
    readonly setupHint?: string;
    readonly error?: unknown;
    readonly issues?: readonly unknown[];
    readonly exception?: unknown;
    readonly qflowTenantId?: string;
  },
  fallback: DeliveryPublishFailureReason,
): string {
  const reason = fallback === 'invalidApproval'
    ? i18n.t('list.actions.warning.invalidApproval')
    : fallback === 'invalidResponse'
    ? i18n.t('list.actions.publish.invalidResponse')
    : publishFailureMessage(i18n, data.error, fallback);
  return data.qflowTenantId
    ? `${reason}\n\n${i18n.t('list.actions.warning.workspaceId', { id: data.qflowTenantId })}`
    : reason;
}

function publishFailureMessage(
  i18n: I18n,
  code: unknown,
  fallback: DeliveryPublishFailureReason,
): string {
  switch (code) {
    case 'delivery_publish_not_configured':
      return i18n.t('list.actions.publish.notConfigured');
    case 'delivery_publish_invalid_config':
      return i18n.t('list.actions.publish.invalidConfiguration');
    case 'delivery_publish_tenant_not_linked':
      return i18n.t('list.actions.publish.notLinked');
    case 'delivery_publish_not_entitled':
      return i18n.t('list.actions.publish.notEntitled');
    case 'delivery_publish_unavailable':
      return i18n.t('list.actions.publish.unavailable');
    case 'delivery_publish_in_progress':
      return i18n.t('list.actions.publish.inProgress');
    case 'delivery_export_preflight_stale':
      return i18n.t('list.actions.publish.reviewChanged');
    case 'delivery_export_preflight_blocked':
    case 'delivery_export_preflight_failed':
      return i18n.t('list.actions.publish.repairAssessment');
    case 'delivery_export_warnings_not_acknowledged':
    case 'delivery_export_approval_invalid':
      return i18n.t('list.actions.publish.reviewWarnings');
    case 'delivery_publish_package_fetch_failed':
      return i18n.t('list.actions.publish.packageUnavailable');
    case 'not_found':
      return i18n.t('list.actions.publish.notFound');
    default:
      return i18n.t(
        fallback === 'requestFailed'
          ? 'list.actions.publish.connectionFailed'
          : 'list.actions.publish.failure',
      );
  }
}

/** Format a localized publication success while preserving the version identity. */
export function formatDeliveryPublishSuccess(i18n: I18n, version?: string): string {
  return version
    ? i18n.t('list.actions.publish.successVersion', { version })
    : i18n.t('list.actions.publish.success');
}
