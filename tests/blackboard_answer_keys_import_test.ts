import { expect, test } from 'vitest';
import { blackboardPool, importBlackboardPool } from './helpers/blackboard_import.ts';
test('missing and dangling Blackboard answer keys retain choices without inventing a correct response', async () => {
  for (const klass of ['QUESTION_MULTIPLECHOICE', 'QUESTION_MULTIPLEANSWER']) {
    for (const key of [null, 'missing']) {
      const { imported, analysis } = await importBlackboardPool(blackboardPool({ klass, key }));
      expect(imported.items[0].draft.choices).toHaveLength(2);
      expect(imported.items[0].draft.correctId ?? '').toBe('');
      expect(imported.items[0].draft.correctIds ?? []).toEqual([]);
      expect(analysis.items[0].readiness).toBe('blocked');
      expect(
        analysis.items[0].warnings.some((warning) =>
          warning.code === 'MISSING_CORRECT' && warning.path === imported.items[0].href
        ),
      ).toBe(true);
    }
  }
});
