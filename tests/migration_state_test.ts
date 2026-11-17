import { expect, test as testCase } from 'vitest';

import {
  parseMigrationApprovalState,
  parseMigrationExecutionState,
  parseMigrationWorkflowState,
} from '../lib/import/migration_state.ts';

const USER_ID = 'cba31460-30a2-4ad8-bd0e-8bc15cd77d70';
const REVIEWER_ID = '9ace95f9-b8e2-4931-a7d6-ae291542a350';

testCase('migration execution parser reconstructs one exact active state', () => {
  expect(parseMigrationExecutionState({
    status: 'analyzing',
    attempts: 1,
    maxAttempts: 3,
    leaseToken: 'a59513a4-9c8b-4ba5-9663-155429b85332',
    lastError: null,
    startedAt: '2026-07-29T12:00:00.000Z',
    completedAt: null,
    destination: 'Assessment',
    collectionId: null,
    assessmentId: null,
    committedAt: null,
  })).toStrictEqual({
    _tag: 'Analyzing',
    attempts: 1,
    maxAttempts: 3,
    startedAt: '2026-07-29T12:00:00.000Z',
  });
});

testCase('migration execution parser rejects contradictory terminal fields', () => {
  expect(() =>
    parseMigrationExecutionState({
      status: 'failed',
      attempts: 1,
      maxAttempts: 3,
      leaseToken: null,
      lastError: 'The selected source is invalid.',
      startedAt: '2026-07-29T12:00:00.000Z',
      completedAt: '2026-07-29T12:01:00.000Z',
      destination: 'Assessment',
      collectionId: null,
      assessmentId: null,
      committedAt: null,
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('cannot retain a start time')
    ),
  );
  expect(() =>
    parseMigrationExecutionState({
      status: 'analyzed',
      attempts: 1,
      maxAttempts: 3,
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: '2026-07-29T12:01:00.000Z',
      destination: 'Assessment',
      collectionId: null,
      assessmentId: '582a7579-5747-48a3-8331-73659773af83',
      committedAt: null,
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('cannot reference an assessment')
    ),
  );
});

testCase('migration approval parser requires complete decision metadata', () => {
  expect(parseMigrationApprovalState({
    approvalStatus: 'approved',
    submittedBy: USER_ID,
    submittedAt: '2026-07-29T12:00:00.000Z',
    decidedBy: REVIEWER_ID,
    decidedAt: '2026-07-29T12:05:00.000Z',
    approvalNote: null,
  })).toStrictEqual({
    _tag: 'Approved',
    submittedBy: USER_ID,
    submittedAt: '2026-07-29T12:00:00.000Z',
    decidedBy: REVIEWER_ID,
    decidedAt: '2026-07-29T12:05:00.000Z',
    note: null,
  });
  expect(() =>
    parseMigrationApprovalState({
      approvalStatus: 'changes_requested',
      submittedBy: USER_ID,
      submittedAt: '2026-07-29T12:00:00.000Z',
      decidedBy: REVIEWER_ID,
      decidedAt: '2026-07-29T12:05:00.000Z',
      approvalNote: null,
    })
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must explain what needs attention')
    ),
  );
});

testCase('migration workflow parser rejects approval on failed and generation runs', () => {
  const failedApproved = {
    status: 'failed',
    attempts: 1,
    maxAttempts: 3,
    leaseToken: null,
    lastError: 'The selected source is invalid.',
    startedAt: null,
    completedAt: '2026-07-29T12:01:00.000Z',
    destination: 'Assessment',
    collectionId: null,
    assessmentId: null,
    committedAt: null,
    approvalStatus: 'approved',
    submittedBy: USER_ID,
    submittedAt: '2026-07-29T12:02:00.000Z',
    decidedBy: REVIEWER_ID,
    decidedAt: '2026-07-29T12:03:00.000Z',
    approvalNote: null,
  };
  expect(() => parseMigrationWorkflowState(failedApproved, 'recover_existing')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must keep draft approval')
    ),
  );
  expect(() => parseMigrationWorkflowState(failedApproved, 'generate_new')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('cannot enter migration approval')
    ),
  );
});

testCase('migration workflow parser requires approval before recovery commit', () => {
  expect(() =>
    parseMigrationWorkflowState({
      status: 'committed',
      attempts: 1,
      maxAttempts: 3,
      leaseToken: null,
      lastError: null,
      startedAt: null,
      completedAt: '2026-07-29T12:01:00.000Z',
      destination: 'Assessment',
      collectionId: null,
      assessmentId: '582a7579-5747-48a3-8331-73659773af83',
      committedAt: '2026-07-29T12:02:00.000Z',
      approvalStatus: 'draft',
      submittedBy: null,
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      approvalNote: null,
    }, 'recover_existing')
  ).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('must retain its approval')
    ),
  );
});
