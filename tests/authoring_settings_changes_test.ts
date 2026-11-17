import { expect, test as testCase } from 'vitest';

import { AuthoringSettingsChanges } from '../lib/authoring_settings_changes.ts';

testCase('successful save or reset consumes only captured edits, not subsequent changes', () => {
  const changes = new AuthoringSettingsChanges();
  changes.record({ shuffle: true });
  const captured = changes.capture();
  changes.record({ labelStyle: 'decimal' });
  changes.acknowledge(captured);
  expect(changes.capture().patch).toStrictEqual({ labelStyle: 'decimal' });
});

testCase(
  'reset retains a deliberate later edit even when its value matches the captured value',
  () => {
    const changes = new AuthoringSettingsChanges();
    changes.record({ shuffle: true });
    const captured = changes.capture();
    changes.record({ shuffle: false });
    changes.record({ shuffle: true });
    changes.acknowledge(captured);
    expect(changes.capture().patch).toStrictEqual({ shuffle: true });
  },
);

testCase('a previous question completing cannot consume changes in a new question', () => {
  const changes = new AuthoringSettingsChanges();
  changes.record({ shuffle: true });
  const captured = changes.capture();
  changes.clear();
  changes.record({ shuffle: true });
  changes.acknowledge(captured);
  expect(changes.capture().patch).toStrictEqual({ shuffle: true });
  changes.acknowledge(changes.capture());
  expect(changes.capture().patch).toStrictEqual({});
});
