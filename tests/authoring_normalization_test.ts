import { expect, test as testCase } from 'vitest';

import {
  normalizeCoordinatePoints,
  normalizeMappedImageTargets,
  normalizeOptionalUnlimitedBound,
  normalizeUnlimitedBound,
  uniqueTrimmedStrings,
} from '../lib/types/authoring_normalization.ts';

testCase('uniqueTrimmedStrings drops blanks and repeats in input order', () => {
  expect(uniqueTrimmedStrings([' A ', 'B', 'A', '', 'B'])).toStrictEqual(['A', 'B']);
});

testCase('normalizeUnlimitedBound treats QTI zero as unlimited', () => {
  expect(normalizeUnlimitedBound(undefined, 0)).toStrictEqual(null);
  expect(normalizeUnlimitedBound(0, 0)).toStrictEqual(null);
  expect(normalizeUnlimitedBound(2, 1)).toStrictEqual(2);
  expect(normalizeUnlimitedBound(-3, 0)).toStrictEqual(0);
  expect(normalizeOptionalUnlimitedBound(0, 0)).toStrictEqual(undefined);
});

testCase('normalizeCoordinatePoints keeps valid x y pairs', () => {
  expect(normalizeCoordinatePoints(['120,120', ' 1  2 ', 'bad', '1 2 3'])).toStrictEqual([
    '120 120',
    '1 2',
  ]);
});

testCase('normalizeMappedImageTargets fills the default shape and drops empty coords', () => {
  expect(normalizeMappedImageTargets(
    [
      { coords: '10,10,5', mappedValue: 1 },
      { shape: 'rect', coords: '1,2,3,4' },
      { shape: 'poly', coords: '  ' },
    ],
    'circle',
  )).toStrictEqual([
    { shape: 'circle', coords: '10,10,5', mappedValue: 1 },
    { shape: 'rect', coords: '1,2,3,4', mappedValue: undefined },
  ]);
});
