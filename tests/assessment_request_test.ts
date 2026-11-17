import { expect, test as testCase } from 'vitest';

import {
  parseAssessmentCreateRequest,
  parseAssessmentListLimit,
} from '../lib/http/assessment_requests.ts';
import { listApiRoute as handlerEndpoint } from '../lib/http/routes/assessment_api/list.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';

const handler = handlerEndpoint.handle;

testCase(
  'assessment API rejects malformed boundary input before resolving persistence',
  async () => {
    for (
      const body of [
        '{',
        'null',
        '[]',
        '1',
        '{"title":null}',
        '{"title":4}',
        '{"title":{}}',
        '{"title":"  "}',
        '{"unknown":true}',
      ]
    ) {
      const request = new Request('http://local/api/assessments', {
        ...{ duplex: 'half' },
        method: 'POST',
        body,
      });
      const response = await invokeHttpRoute(handler, makeHttpRequest(request));
      expect(response.status, body).toStrictEqual(400);
    }
    for (const limit of ['', 'NaN', 'abc', 'Infinity', '1.5', '-1', '0', '21']) {
      const request = new Request(`http://local/api/assessments?limit=${limit}`);
      const response = await invokeHttpRoute(handler, makeHttpRequest(request));
      expect(response.status, limit).toStrictEqual(400);
    }
  },
);

testCase(
  'assessment request parsers preserve default draft creation and bounded list input',
  async () => {
    expect(
      await parseAssessmentCreateRequest(
        new Request('http://local', { ...{ duplex: 'half' }, method: 'POST', body: '{}' }),
      ),
    ).toStrictEqual({
      _tag: 'Parsed',
      value: {},
    });
    expect(
      await parseAssessmentCreateRequest(
        new Request('http://local', {
          ...{ duplex: 'half' },
          method: 'POST',
          body: '{"title":" My quiz "}',
        }),
      ),
    ).toStrictEqual({
      _tag: 'Parsed',
      value: { title: 'My quiz' },
    });
    expect(parseAssessmentListLimit(null)).toStrictEqual({ _tag: 'Parsed', value: 6 });
    expect(parseAssessmentListLimit('1')).toStrictEqual({ _tag: 'Parsed', value: 1 });
    expect(parseAssessmentListLimit('20')).toStrictEqual({ _tag: 'Parsed', value: 20 });
  },
);
