import { expect, test as testCase } from 'vitest';

import {
  attr,
  findAllDescendantsByLocalName,
  findChildByLocalName,
  findChildrenByLocalName,
  parseXml,
} from '../lib/import/xml_dom.ts';

testCase('XML attribute lookup requires the exact attribute name', () => {
  const root = parseXml(
    '<question TYPE="essay" show-hide="hide" showHide="show" />',
    'attribute lookup test',
  ).documentElement;

  expect(attr(root, 'type')).toStrictEqual(null);
  expect(attr(root, 'TYPE')).toStrictEqual('essay');
  expect(attr(root, 'show-hide')).toStrictEqual('hide');
  expect(attr(root, 'showHide')).toStrictEqual('show');
});

testCase('XML traversal matches namespace-prefixed elements by local name', () => {
  const root = parseXml(
    '<root xmlns:qti="urn:qti"><qti:item><qti:choice /><qti:choice /></qti:item></root>',
    'local-name traversal test',
  ).documentElement;

  const item = findChildByLocalName(root, 'item');
  expect(findChildrenByLocalName(item, 'choice').length).toStrictEqual(2);
  expect(findAllDescendantsByLocalName(root, 'choice').length).toStrictEqual(2);
});
