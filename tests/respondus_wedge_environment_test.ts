import { expect, test as testCase } from 'vitest';

import { parseEvidenceDatabaseBaseUrl } from '../tools/respondus_wedge_environment.ts';

testCase('Respondus evidence database accepts one explicitly dedicated database', () => {
  const parsed = parseEvidenceDatabaseBaseUrl(
    'postgres://qflow:secret@127.0.0.1:5432/qflow_evidence',
  );

  expect(parsed.ok).toStrictEqual(true);
});

testCase('Respondus evidence database rejects an ordinary application database', () => {
  const parsed = parseEvidenceDatabaseBaseUrl(
    'postgres://qflow:secret@127.0.0.1:5432/qflow_dev',
  );

  expect(parsed).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidEvidenceDatabaseUrl',
      message: 'QFLOW_EVIDENCE_DATABASE_URL database name must contain "evidence" or "test".',
    },
  });
});

testCase('Respondus evidence database owns its isolated search path', () => {
  const parsed = parseEvidenceDatabaseBaseUrl(
    'postgres://qflow:secret@127.0.0.1:5432/qflow_test?options=-c%20search_path%3Dpublic',
  );

  expect(parsed).toStrictEqual({
    ok: false,
    error: {
      _tag: 'InvalidEvidenceDatabaseUrl',
      message: 'QFLOW_EVIDENCE_DATABASE_URL must not define PostgreSQL options.',
    },
  });
});
