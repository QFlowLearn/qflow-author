import { expect, test as testCase } from 'vitest';

import {
  parseQuestionBankBulkForm,
  QuestionBankBulkFormError,
} from '../lib/services/question_bank_actions.ts';
import {
  parseQuestionBankPickerQuery,
  parseQuestionBankQuery,
  QuestionBankInputError,
} from '../lib/services/question_bank_query.ts';

function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

function query(raw: string, code: string): void {
  const error = (() => {
    try {
      (() => parseQuestionBankQuery(new URLSearchParams(raw)))();
    } catch (caught: unknown) {
      if (!(caught instanceof QuestionBankInputError)) {
        expect.unreachable('Expected QuestionBankInputError');
      }
      return caught;
    }
    return expect.unreachable('Expected an exception.');
  })();
  expect(error.code).toStrictEqual(code);
}

testCase('question-bank query parser exposes each closed failure code', () => {
  query('compatibility=exact', 'target_required');
  query('unknown=value', 'unsupported_filter');
  query('arrange=true', 'unsupported_filter');
  query('q=a&q=b', 'repeated_filter');
  query('page=bad', 'invalid_pagination');
  query('owner=bad', 'invalid_owner');
  query('tags=a,,b', 'invalid_tags');
  query(`q=${'x'.repeat(201)}`, 'invalid_filter');
  const picker = (() => {
    try {
      (() => parseQuestionBankPickerQuery(new URLSearchParams('page=0')))();
    } catch (caught: unknown) {
      if (!(caught instanceof QuestionBankInputError)) {
        expect.unreachable('Expected QuestionBankInputError');
      }
      return caught;
    }
    return expect.unreachable('Expected an exception.');
  })();
  expect(picker.code).toStrictEqual('invalid_pagination');
});

testCase('question-bank bulk parser exposes each closed form code and preserves commands', () => {
  const failures: Array<[FormData, string]> = [
    [form({ bulkAction: 'archive', questionId: 'bad' }), 'invalid_selection'],
    [
      form({ bulkAction: 'add_tags', questionId: crypto.randomUUID(), bulkTags: 'x'.repeat(81) }),
      'invalid_tags',
    ],
    [
      form({
        bulkAction: 'add_tags',
        questionId: crypto.randomUUID(),
        bulkTags: Array.from({ length: 21 }, (_, index) => `x${index}`).join(','),
      }),
      'invalid_tags',
    ],
    [
      form({ bulkAction: 'archive', questionId: crypto.randomUUID(), bulkTags: 'x' }),
      'tags_action_mismatch',
    ],
    [
      form({
        bulkAction: 'archive',
        questionId: crypto.randomUUID(),
        ownerUserId: crypto.randomUUID(),
      }),
      'owner_action_mismatch',
    ],
    [
      form({ bulkAction: 'transfer', questionId: crypto.randomUUID(), ownerUserId: 'bad' }),
      'invalid_owner',
    ],
    [form({ bulkAction: 'bogus', questionId: crypto.randomUUID() }), 'invalid_action'],
    [
      form({ bulkAction: 'archive', questionId: crypto.randomUUID(), extra: 'x' }),
      'unsupported_fields',
    ],
  ];
  const repeated = form({ bulkAction: 'archive', questionId: crypto.randomUUID() });
  repeated.append('bulkAction', 'archive');
  failures.push([repeated, 'invalid_field_shape']);
  const blob = new FormData();
  blob.set('bulkAction', 'archive');
  blob.set('questionId', crypto.randomUUID());
  blob.set('bulkTags', new Blob(['x']));
  failures.push([blob, 'invalid_field_shape']);
  failures.push([new FormData(), 'missing_field']);
  for (const [input, code] of failures) {
    const error = (() => {
      try {
        (() => parseQuestionBankBulkForm(input))();
      } catch (caught: unknown) {
        if (!(caught instanceof QuestionBankBulkFormError)) {
          expect.unreachable('Expected QuestionBankBulkFormError');
        }
        return caught;
      }
      return expect.unreachable('Expected an exception.');
    })();
    expect(error.code).toStrictEqual(code);
  }
  expect(parseQuestionBankBulkForm(form({ bulkAction: 'archive', questionId: inputId })))
    .toStrictEqual({
      _tag: 'Archive',
      questionIds: [inputId],
    });
  expect(parseQuestionBankBulkForm(form({ bulkAction: 'archive' }))).toStrictEqual({
    _tag: 'Archive',
    questionIds: [],
  });
});

const inputId = crypto.randomUUID();

testCase('collection query is explicit and rejects invalid or repeated destinations', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  expect(parseQuestionBankQuery(new URLSearchParams()).collection).toStrictEqual(undefined);
  expect(parseQuestionBankQuery(new URLSearchParams('collection=unfiled')).collection)
    .toStrictEqual({
      _tag: 'Unfiled',
    });
  expect(parseQuestionBankQuery(new URLSearchParams(`collection=${id}`)).collection).toStrictEqual({
    _tag: 'Collection',
    collectionId: id,
  });
  expect(parseQuestionBankQuery(new URLSearchParams('collection=')).collection).toStrictEqual(
    undefined,
  );
  query('collection=unknown', 'invalid_filter');
  query('collection=unfiled&collection=unfiled', 'repeated_filter');
});

testCase('bank sorting accepts only registered columns and directions', () => {
  for (const field of ['title', 'type', 'origin', 'review', 'owner', 'revision', 'updated']) {
    expect(parseQuestionBankQuery(new URLSearchParams(`sort=${field}&direction=desc`)).sort)
      .toStrictEqual({
        field,
        direction: 'desc',
      });
  }
  expect(parseQuestionBankQuery(new URLSearchParams('sort=title')).sort).toStrictEqual({
    field: 'title',
    direction: 'asc',
  });
  expect(parseQuestionBankQuery(new URLSearchParams()).sort).toStrictEqual(undefined);
  query('sort=unsupported', 'unsupported_filter');
  query('sort=title&direction=sideways', 'unsupported_filter');
  query('direction=asc', 'invalid_filter');
  query('sort=title&sort=updated', 'repeated_filter');
});
