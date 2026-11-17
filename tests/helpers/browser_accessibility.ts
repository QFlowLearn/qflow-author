import type { Page } from 'playwright';
import axe from 'axe-core';
import { expect } from 'vitest';
import { mkdir } from 'node:fs/promises';

declare global {
  var axe: typeof import('axe-core');
}

export async function assertNoBlockingA11y(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Settle finite presentation animations even when the browser has suspended an offscreen one.
    // Infinite indicators and zero-rate animations have no finish point and are already stable.
    const finite = document.getAnimations().filter((animation) =>
      animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime) &&
      animation.playbackRate !== 0
    );
    for (const animation of finite) animation.finish();
    await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
  });
  // This owned browser page receives exactly the pinned axe runtime before its typed API is used.
  await page.addScriptTag({ content: axe.source });
  const blocking = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'],
      },
    });
    return result.violations.filter((violation) =>
      violation.impact === 'serious' || violation.impact === 'critical'
    )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
        detail: violation.nodes[0]?.failureSummary,
      }));
  });
  if (blocking.length) {
    await mkdir('output/ci', { recursive: true });
    await page.screenshot({ path: 'output/ci/a11y-failure.png', fullPage: true });
  }
  expect(blocking).toEqual([]);
}
