#!/usr/bin/env -S node --import tsx
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _url from 'node:url';

import { safeErrorSummary } from '../lib/error_summary.ts';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import axe from 'axe-core';
import { type BrowserContext, type Page } from 'playwright';
import { db, shutdownDb } from '../lib/db.ts';
import {
  authSessions,
  organizationMemberships,
  tenants,
  users,
  userSettingsTable,
} from '../lib/db/schema.ts';
import { ensureDemoPresidents } from '../lib/demo_presidents_seed.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { type LocalAppBrowser, openLocalAppBrowser } from './local_app_browser.ts';

const TEST_TENANT_ID = '10000000-0000-4000-8000-000000000a11';
const TEST_USER_ID = '10000000-0000-4000-8000-000000000a12';
const TEST_MEMBERSHIP_ID = '10000000-0000-4000-8000-000000000a13';
const TEST_EMAIL = 'a11y@qflow.local';

type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

type AxeNode = {
  target: string[];
  failureSummary?: string;
};

type AxeViolation = {
  id: string;
  impact?: Impact;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
};

type AxeResults = {
  violations: AxeViolation[];
};

type A11yTarget = {
  name: string;
  path: string;
  authenticated?: boolean;
};

type PageReport = {
  name: string;
  path: string;
  url: string;
  status: number | null;
  violationCount: number;
  blockingCount: number;
  violations: AxeViolation[];
};

const axeOptions = {
  resultTypes: ['violations'],
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
  },
};

function failImpacts(): Set<Impact> {
  const raw = process.env['QFLOW_A11Y_FAIL_IMPACTS'] ?? 'serious,critical';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean) as Impact[];
  return new Set(values.length ? values : ['serious', 'critical']);
}

async function main() {
  const configuredBaseUrl = process.env['QFLOW_A11Y_BASE_URL']?.trim();
  const shouldSeed = process.env['QFLOW_A11Y_SKIP_SEED'] !== '1';

  let appBrowser: LocalAppBrowser | null = null;

  try {
    const fixture = shouldSeed ? await seedFixtures() : await createSessionForExistingFixture();
    const assessmentId = process.env['QFLOW_A11Y_ASSESSMENT_ID'] ?? fixture.assessmentId;

    appBrowser = await openLocalAppBrowser({
      endpoint: configuredBaseUrl ? { _tag: 'ExistingApp', baseUrl: configuredBaseUrl } : {
        _tag: 'ManagedLocalApp',
        portRange: a11yPortRange(process.env['QFLOW_A11Y_PORT']),
        environment: { QFLOW_A11Y: '1' },
      },
      headless: process.env['QFLOW_A11Y_HEADLESS'] !== '0',
    });
    const baseUrl = appBrowser.baseUrl;

    const anonymousContext = await appBrowser.newContext({
      browser: { bypassCSP: true },
    });
    const authenticatedContext = await appBrowser.newContext({
      browser: { bypassCSP: true },
      authSession: fixture.session,
    });

    const targets = buildTargets(assessmentId);
    const reports: PageReport[] = [];
    for (const target of targets) {
      const context = target.authenticated ? authenticatedContext : anonymousContext;
      const page = await context.newPage();
      try {
        reports.push(await checkPage(page, baseUrl, target));
      } finally {
        await page.close();
      }
    }
    await checkPartSettingsDialogFocus(authenticatedContext, baseUrl, assessmentId);
    await checkInsertionPickerKeyboardBehavior(authenticatedContext, baseUrl, assessmentId);

    await anonymousContext.close();
    await authenticatedContext.close();

    const blocking = reports.flatMap((report) =>
      report.violations
        .filter((violation) => isBlockingViolation(violation, failImpacts()))
        .map((violation) => ({ report, violation }))
    );

    await writeReport(baseUrl, reports);
    printSummary(reports, failImpacts());

    if (blocking.length > 0) {
      console.error(
        `\nAccessibility checks failed: ${blocking.length} serious/critical violation(s).`,
      );
      process.exit(1);
    }
  } finally {
    try {
      if (appBrowser) await appBrowser.close();
    } finally {
      await shutdownDb().catch(() => {});
    }
  }
}

function a11yPortRange(configuredPort: string | undefined): {
  readonly first: number;
  readonly lastExclusive: number;
} {
  if (configuredPort === undefined) return { first: 5187, lastExclusive: 5287 };
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port <= 0 || port >= 65_535) {
    throw new Error('QFLOW_A11Y_PORT must be an integer from 1 through 65534.');
  }
  return { first: port, lastExclusive: port + 1 };
}

async function seedFixtures(): Promise<{
  assessmentId: string;
  session: { token: string; expiresAt: Date };
}> {
  await db.insert(tenants).values({
    id: TEST_TENANT_ID,
    slug: 'a11y',
    name: 'A11y Test Workspace',
  }).onConflictDoUpdate({
    target: tenants.id,
    set: {
      slug: 'a11y',
      name: 'A11y Test Workspace',
    },
  });

  await db.insert(users).values({
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    emailNormalized: TEST_EMAIL,
    displayName: 'A11y Test User',
    mustChangePassword: false,
    authProvider: 'local',
    authProviderId: TEST_EMAIL,
  }).onConflictDoUpdate({
    target: users.id,
    set: {
      email: TEST_EMAIL,
      emailNormalized: TEST_EMAIL,
      displayName: 'A11y Test User',
      mustChangePassword: false,
      authProvider: 'local',
      authProviderId: TEST_EMAIL,
      updatedAt: new Date(),
    },
  });

  await db.insert(userSettingsTable).values({
    userId: TEST_USER_ID,
    settings: createInitialUserSettings('en-US'),
  }).onConflictDoUpdate({
    target: userSettingsTable.userId,
    set: {
      settings: createInitialUserSettings('en-US'),
      updatedAt: new Date(),
    },
  });

  await db.insert(organizationMemberships).values({
    id: TEST_MEMBERSHIP_ID,
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_ID,
    role: 'owner',
  }).onConflictDoUpdate({
    target: organizationMemberships.id,
    set: {
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      role: 'owner',
    },
  });

  await db.delete(authSessions).where(eq(authSessions.userId, TEST_USER_ID));

  const ctx: RequestContext = {
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_ID,
    role: 'owner',
  };
  const assessmentId = await ensureDemoPresidents(ctx);
  const session = await createSession({
    userId: TEST_USER_ID,
    tenantId: TEST_TENANT_ID,
    userAgent: 'qflow-a11y-playwright',
  });
  return { assessmentId, session };
}

async function createSessionForExistingFixture(): Promise<{
  assessmentId: string;
  session: { token: string; expiresAt: Date };
}> {
  const assessmentId = process.env['QFLOW_A11Y_ASSESSMENT_ID'];
  if (!assessmentId) {
    throw new Error('QFLOW_A11Y_ASSESSMENT_ID is required when QFLOW_A11Y_SKIP_SEED=1.');
  }
  const session = await createSession({
    userId: TEST_USER_ID,
    tenantId: TEST_TENANT_ID,
    userAgent: 'qflow-a11y-playwright',
  });
  return { assessmentId, session };
}

function buildTargets(assessmentId: string): A11yTarget[] {
  return [
    { name: 'Public home', path: '/' },
    { name: 'Sign in', path: '/login' },
    { name: 'QTI import help', path: '/help/qti3-import' },
    { name: 'Assessments dashboard', path: '/assessments', authenticated: true },
    { name: 'Assessment builder', path: `/assessments/${assessmentId}`, authenticated: true },
    {
      name: 'Assessment arrange',
      path: `/assessments/${assessmentId}/arrange`,
      authenticated: true,
    },
    { name: 'Source intake', path: '/assessments/new', authenticated: true },
    { name: 'Account settings', path: '/settings', authenticated: true },
    { name: 'Editor settings', path: '/settings/editor', authenticated: true },
  ];
}

async function checkPage(page: Page, baseUrl: string, target: A11yTarget): Promise<PageReport> {
  const url = new URL(target.path, baseUrl).toString();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(250);

  const status = response?.status() ?? null;
  if (status && status >= 400) {
    throw new Error(`${target.name} returned HTTP ${status} at ${url}`);
  }
  if (target.authenticated && new URL(page.url()).pathname === '/login') {
    throw new Error(`${target.name} redirected to /login; authenticated fixture is not active.`);
  }

  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate((options) => {
    return (globalThis as unknown as { axe: { run: (root: Document, opts: unknown) => unknown } })
      .axe
      .run(document, options);
  }, axeOptions) as AxeResults;

  const blockingCount =
    results.violations.filter((violation) => isBlockingViolation(violation, failImpacts())).length;

  return {
    name: target.name,
    path: target.path,
    url: page.url(),
    status,
    violationCount: results.violations.length,
    blockingCount,
    violations: results.violations,
  };
}

async function checkPartSettingsDialogFocus(
  context: BrowserContext,
  baseUrl: string,
  assessmentId: string,
) {
  const page = await context.newPage();
  try {
    const url = new URL(`/assessments/${assessmentId}/arrange`, baseUrl).toString();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(250);

    const status = response?.status() ?? null;
    if (status && status >= 400) {
      throw new Error(`Part settings dialog keyboard check returned HTTP ${status} at ${url}`);
    }

    await page.getByRole('button', { name: 'Part settings' }).first().click();
    await page.getByRole('dialog', { name: /Part \d+ settings/ }).waitFor({
      state: 'visible',
      timeout: 5_000,
    });
    await waitForPageCondition(
      page,
      () => document.activeElement?.getAttribute('data-modal-initial-focus') === 'part-settings',
      'Part settings dialog did not move initial focus to the navigation mode field.',
    );

    await pressTabWithinOpenDialog(
      page,
      'Shift+Tab',
      'Shift+Tab moved focus outside the Part settings dialog.',
    );

    for (let i = 0; i < 8; i += 1) {
      await pressTabWithinOpenDialog(
        page,
        'Tab',
        'Tab moved focus outside the Part settings dialog.',
      );
    }

    await page.keyboard.press('Escape');
    await waitForPageCondition(
      page,
      () => {
        const dialog = document.querySelector<HTMLDialogElement>('dialog.ds-modal');
        return !dialog?.open;
      },
      'Escape did not close the Part settings dialog.',
    );
    await waitForPageCondition(
      page,
      () => {
        const active = document.activeElement as HTMLElement | null;
        return active?.getAttribute('aria-label') === 'Part settings';
      },
      'Part settings dialog did not restore focus to the opener.',
    );
    console.log('PASS Part settings dialog keyboard behavior');
  } finally {
    await page.close();
  }
}

async function checkInsertionPickerKeyboardBehavior(
  context: BrowserContext,
  baseUrl: string,
  assessmentId: string,
) {
  const page = await context.newPage();
  try {
    const url = new URL(`/assessments/${assessmentId}`, baseUrl).toString();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(250);

    const status = response?.status() ?? null;
    if (status && status >= 400) {
      throw new Error(`Tabs keyboard check returned HTTP ${status} at ${url}`);
    }

    const trigger = page.getByRole('button', { name: '+ Add Question', exact: true });
    await trigger.click();
    const picker = page.getByRole('region', { name: 'Insert question', exact: true });
    await picker.waitFor({ state: 'visible', timeout: 5_000 });
    await picker.getByRole('heading', { name: 'Add to assessment', exact: true }).waitFor({
      state: 'visible',
      timeout: 5_000,
    });

    const part = picker.locator('#assessment-insert-part');
    if (await part.count()) {
      const firstPartId = await part.locator('option:not([disabled])').first().getAttribute(
        'value',
      );
      if (!firstPartId) throw new Error('The insertion picker has no destination part.');
      await part.selectOption(firstPartId);
    }

    const tablist = picker.getByRole('tablist', { name: 'Add question method' });
    const createTab = tablist.getByRole('tab', { name: 'Create new' });
    await createTab.focus();
    await assertSelectedTab(page, tablist, 'Create new');

    await page.keyboard.press('ArrowRight');
    await assertSelectedTab(page, tablist, 'From library');

    await page.keyboard.press('ArrowLeft');
    await assertSelectedTab(page, tablist, 'Create new');

    await page.keyboard.press('End');
    await assertSelectedTab(page, tablist, 'From library');

    await page.keyboard.press('Home');
    await assertSelectedTab(page, tablist, 'Create new');

    await tablist.getByRole('tab', { name: 'From library' }).click();
    const librarySearch = picker.locator('input[data-focus-library-search]');
    await librarySearch.waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForFunction(
      (selector) => document.activeElement?.matches(selector) === true,
      'input[data-focus-library-search]',
    );

    // The persistent picker is nonmodal: keyboard users can reach the rest of the page.
    await picker.locator(
      'button:not([disabled]):visible, [href]:visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
    ).evaluateAll((elements) => {
      const tabbable = elements.filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element.tabIndex >= 0,
      );
      const last = tabbable.at(-1);
      if (!last) throw new Error('The insertion picker has no keyboard controls.');
      last.focus();
    });
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement === document.body)) {
      await page.keyboard.press('Tab');
    }
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-floating-picker]');
      return panel && document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body && !panel.contains(document.activeElement);
    });

    await librarySearch.focus();
    await page.keyboard.press('Escape');
    await picker.waitFor({ state: 'hidden', timeout: 5_000 });
    await page.waitForFunction(
      (button) => button !== null && document.activeElement === button,
      await trigger.elementHandle(),
    );
    console.log('PASS Insertion picker tabs, nonmodal navigation and Escape focus return');
  } finally {
    await page.close();
  }
}

async function assertSelectedTab(page: Page, tablist: ReturnType<Page['getByRole']>, name: string) {
  const selectedTabs = tablist.locator('[role="tab"][aria-selected="true"][tabindex="0"]');
  if (await selectedTabs.count() !== 1) {
    throw new Error(`Expected exactly one selected, tabbable tab in "${name}" state.`);
  }

  const selectedName = (await selectedTabs.textContent())?.trim();
  if (selectedName !== name) {
    throw new Error(`Expected selected tab "${name}", received "${selectedName ?? 'none'}".`);
  }

  const focusIsOnSelectedTab = await page.evaluate((expectedName) => {
    const active = document.activeElement;
    return active?.getAttribute('role') === 'tab' && active.textContent?.trim() === expectedName;
  }, name);
  if (!focusIsOnSelectedTab) {
    throw new Error(`Keyboard activation did not retain focus on the "${name}" tab.`);
  }
}

async function assertActiveElementInOpenDialog(page: Page, message: string) {
  const focusIsContained = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog.ds-modal[open]');
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
  });
  if (!focusIsContained) throw new Error(message);
}

async function pressTabWithinOpenDialog(
  page: Page,
  key: 'Tab' | 'Shift+Tab',
  message: string,
) {
  await page.keyboard.press(key);

  // Chromium can expose <body> as a sequential focus waypoint when native modal
  // dialog focus wraps. Outside controls remain inert; the next Tab completes the wrap.
  const focusIsOnDocumentBody = await page.evaluate(() => document.activeElement === document.body);
  if (focusIsOnDocumentBody) await page.keyboard.press(key);

  await assertActiveElementInOpenDialog(page, message);
}

async function waitForPageCondition(
  page: Page,
  condition: () => boolean,
  message: string,
) {
  try {
    await page.waitForFunction(condition, undefined, { timeout: 5_000 });
  } catch (_err) {
    const debug = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      const before = describeElement(element);
      const trigger = document.querySelector<HTMLElement>('button[aria-label="Part settings"]');
      trigger?.focus();
      const after = describeElement(document.activeElement as HTMLElement | null);
      const dialog = document.querySelector<HTMLDialogElement>('dialog.ds-modal');
      return {
        before,
        afterManualTriggerFocus: after,
        triggerCount: document.querySelectorAll('button[aria-label="Part settings"]').length,
        dialogOpen: dialog?.open ?? null,
      };

      function describeElement(target: HTMLElement | null) {
        if (!target) return 'none';
        return [
          target.tagName.toLowerCase(),
          target.id ? `#${target.id}` : '',
          target.getAttribute('aria-label')
            ? `[aria-label="${target.getAttribute('aria-label')}"]`
            : '',
          target.getAttribute('data-modal-initial-focus')
            ? `[data-modal-initial-focus="${target.getAttribute('data-modal-initial-focus')}"]`
            : '',
        ].join('');
      }
    });
    throw new Error(`${message} ${JSON.stringify(debug)}`);
  }
}

function isBlockingViolation(violation: AxeViolation, impacts: Set<Impact>): boolean {
  return Boolean(violation.impact && impacts.has(violation.impact));
}

async function writeReport(baseUrl: string, reports: PageReport[]) {
  const reportPath = process.env['QFLOW_A11Y_REPORT'] ?? 'output/playwright/a11y/latest.json';
  await _fs.mkdir(dirname(reportPath), { recursive: true });
  await _fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        axeVersion: axe.version,
        failImpacts: Array.from(failImpacts()),
        reports,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nA11y report: ${reportPath}`);
}

function printSummary(reports: PageReport[], impacts: Set<Impact>) {
  console.log('\nAccessibility summary');
  for (const report of reports) {
    const marker = report.blockingCount > 0 ? 'FAIL' : 'PASS';
    console.log(
      `${marker} ${report.name}: ${report.violationCount} violation(s), ${report.blockingCount} blocking`,
    );
    for (
      const violation of report.violations.filter((item) => isBlockingViolation(item, impacts))
    ) {
      const firstNode = violation.nodes[0];
      const target = firstNode?.target?.join(' ') ?? 'unknown target';
      console.log(`  - ${violation.id} [${violation.impact}]: ${violation.help}`);
      console.log(`    ${target}`);
      if (firstNode?.failureSummary) {
        console.log(`    ${firstNode.failureSummary.replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  main().catch(async (err) => {
    console.error(`Accessibility check failed: ${safeErrorSummary(err)}`);
    await shutdownDb().catch(() => {});
    process.exit(1);
  });
}
