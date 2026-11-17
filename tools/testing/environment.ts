import optional from './optional.json' with { type: 'json' };

const testSettings = new Set([
  ...Object.values(optional).map((lane) => lane.flag),
  'QFLOW_BROWSER_TESTS',
  'QFLOW_BROWSER_APP_MODE',
  'QFLOW_BROWSER_APP_URL',
  'QFLOW_BROWSER_APP_ENV',
  'QFLOW_CI_BROWSER_PORT',
  'QFLOW_A11Y',
  'QFLOW_A11Y_BASE_URL',
  'QFLOW_ORGANIZATION_SCALE',
  'QFLOW_ADAPTIVE_TEST_ORIGIN',
  'QFLOW_ADAPTIVE_HANDOFF',
  'QFLOW_FEEDBACK_TEST_PACKAGE',
  'QFLOW_MEDIA_TEST_PACKAGE',
  'QFLOW_CONTENT_TEST_PACKAGE',
  'QFLOW_SAKAI_EVIDENCE_DIR',
  'QFLOW_LIBREOFFICE_BIN',
  'QFLOW_EVIDENCE_DATABASE_URL',
]);

/** Tests own their application bindings. Preserve orchestration settings, never local app config. */
export function testEnvironment(environment: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const clean = { ...environment };
  for (const name of Object.keys(clean)) {
    if (
      /^(?:QFLOW_|R2_|OPENROUTER_|CLOUDFLARE_HYPERDRIVE_)/.test(name) &&
      !testSettings.has(name) && !name.startsWith('QFLOW_HARBOR_TEST_')
    ) clean[name] = undefined;
  }
  // Explicit undefined values erase ambient settings when runCommand merges the spawn environment.
  // Cloudflare otherwise reloads the developer's file inside the isolated Worker pool.
  clean.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  return clean;
}
