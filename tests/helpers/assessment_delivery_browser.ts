import { expect } from 'vitest';
import type { Page } from 'playwright';

/** Exercise the real builder publication action while retaining an unsaved question draft. */
export async function assertPublishedDeliveryState(page: Page, origin: string): Promise<void> {
  const address = `${origin}/?tool=assessment-export&fixture=populated&delivery=1`;
  await page.goto(address);
  const publish = page.getByRole('button', { name: 'Publish assessment', exact: true });
  await publish.waitFor();
  await page.getByRole('button', { name: 'Edit question 1.1: Capital of France', exact: true })
    .click();
  const choice = page.getByPlaceholder('Choice A');
  await choice.fill('Unsaved choice retained after publishing');
  expect(await page.getByText('Draft · Not published', { exact: true }).count()).toBe(1);
  page.on('dialog', (dialog) => dialog.accept());
  const launch = page.getByRole('link', { name: 'Preview published test', exact: true });
  const manage = page.getByRole('link', { name: 'Manage Delivery', exact: true });
  for (const version of ['version-1', 'version-2']) {
    await publish.click();
    await page.locator(`a[href="/published/${version}"]`).waitFor();
    expect(await launch.getAttribute('href')).toBe(`/published/${version}`);
    expect(await manage.getAttribute('href')).toBe(`/manage/${version}`);
    expect(await page.getByText('Draft · Not published', { exact: true }).count()).toBe(0);
    expect(page.url()).toBe(address);
    expect(await choice.inputValue()).toBe('Unsaved choice retained after publishing');
  }
}
