/** Explicit, non-secret capabilities for an isolated local Worker browser fixture. */
export const builtWorkerBrowserEnvironment = {
  QFLOW_CREDENTIAL_ENCRYPTION_KEY_V1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  QFLOW_APP_ORIGIN: 'https://app.example.test',
  QFLOW_EMAIL_FROM: 'QFlowLearn <hello@qflowlearn.com>',
  QFLOW_SECURE_COOKIES: 'false',
  QFLOW_COOKIE_DOMAIN: '',
  QFLOW_ROOT_DOMAIN: '',
  QFLOW_STORAGE_BACKEND: 'r2-binding',
  QFLOW_UPLOAD_BASE: '/uploads',
  QFLOW_DELIVERY_PUBLISH_URL: '',
  QFLOW_DELIVERY_SIGNING_SECRET: '',
  QFLOW_DELIVERY_CAPABILITY_URL: '',
  QFLOW_DELIVERY_STATE_URL: '',
} as const;
