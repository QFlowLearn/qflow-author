import type { Page } from 'playwright';

/** Measure visible form controls; bounded matching-table scrolling remains intentional. */
export async function measureAuthoringCanvasLayout(page: Page) {
  return await page.locator('[data-authoring-card]').evaluate((card) => {
    const bounds = card.getBoundingClientRect();
    const outside = Array.from(card.querySelectorAll('input, textarea, select, button'))
      .filter((control) => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        if (!box.width || !box.height || style.visibility !== 'visible') return false;
        if (box.left >= bounds.left - 1 && box.right <= bounds.right + 1) return false;
        for (let node = control.parentElement; node && node !== card; node = node.parentElement) {
          const region = node.getBoundingClientRect();
          if (
            ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) &&
            node.scrollWidth > node.clientWidth && region.left >= bounds.left - 1 &&
            region.right <= bounds.right + 1
          ) return false;
        }
        return true;
      }).map((control) =>
        (control.getAttribute('aria-label') ?? control.textContent?.trim()) || control.tagName
      );
    return {
      overflow: document.documentElement.scrollWidth > innerWidth ||
        bounds.left < -1 || bounds.right > innerWidth + 1,
      outside,
    };
  });
}
