import { expect, it } from 'vitest';
import { httpRoutes } from '../../lib/http/routes.ts';

it('keeps each route reachable before any matching parameter route', () => {
  for (const [index, earlier] of httpRoutes.entries()) {
    const pattern = new RegExp(`^${earlier.path.replace(/:[^/]+/g, '[^/]+')}$`);
    for (const later of httpRoutes.slice(index + 1)) {
      expect(pattern.test(later.path), `${earlier.path} shadows ${later.path}`).toBe(false);
    }
  }
});
