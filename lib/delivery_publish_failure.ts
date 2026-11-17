/** Stable publication errors for each unavailable workspace capability. */
export const DELIVERY_CAPABILITY_FAILURE_CODES = {
  not_configured: 'delivery_publish_not_configured',
  invalid_config: 'delivery_publish_invalid_config',
  not_linked: 'delivery_publish_tenant_not_linked',
  not_entitled: 'delivery_publish_not_entitled',
  unavailable: 'delivery_publish_unavailable',
} as const;

/** Closed unavailable states shared by capability checks, HTTP and localized presentation. */
export type DeliveryPublishUnavailableStatus = keyof typeof DELIVERY_CAPABILITY_FAILURE_CODES;
