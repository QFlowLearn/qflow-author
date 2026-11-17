import { expect, test as testCase } from 'vitest';

import { prepareDriverDraft } from '../lib/qti_build.ts';
import type { QuestionTypeId } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

testCase(
  'draft preparation reports missing and unsupported types through the public failure contract',
  () => {
    for (
      const [type, message] of [
        [undefined, 'Draft is missing required field: type'],
        ['not_a_real_type', 'Unsupported question type: not_a_real_type'],
      ] as const
    ) {
      const result = prepareDriverDraft({
        // SAFETY: Deliberately exercise malformed runtime input at the draft preparation boundary.
        type: type as QuestionTypeId | undefined,
        title: 'Untitled',
        itemLanguage: newAuthoringItemLanguage(),
      });
      expect(result.ok).toStrictEqual(false);
      if (result.ok) throw new Error('expected driver error');
      expect(result.reason).toStrictEqual('driver_error');
      expect(result.issues[0].message).toStrictEqual(message);
    }
  },
);
