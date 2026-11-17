import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import {
  DEFAULT_IMPORT_ADAPTER_DESCRIPTORS,
  DEFAULT_IMPORT_ADAPTER_KEYS,
  IMPORT_ADAPTER_DESCRIPTORS,
} from '../lib/import/adapter_descriptors.ts';
import { resolvePinnedImportAdapterRef } from '../lib/import/registry.ts';
import {
  inspectSource,
  selectSourceCandidate,
  SourceSelectionError,
} from '../lib/source_intake/registry.ts';
import { RECOVERY_SOURCE_ACCEPT } from '../lib/source_intake/source_catalog.ts';

const encoder = new TextEncoder();

testCase('configured adapter inventory owns every descriptor exactly once', () => {
  expect(Object.keys(IMPORT_ADAPTER_DESCRIPTORS)).toStrictEqual([...DEFAULT_IMPORT_ADAPTER_KEYS]);
});

testCase('generate source registry resolves supported document formats', async () => {
  const result = await inspectSource('generate_new', {
    _tag: 'file',
    source: {
      filename: 'unit-notes.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: new Uint8Array([0x50, 0x4b]),
    },
  });

  expect(result._tag).toStrictEqual('resolved');
  if (result._tag !== 'resolved') return;
  expect(result.candidate.adapter).toStrictEqual({ id: 'docx', version: '1' });
  expect(result.candidate.confidence).toStrictEqual(1);
});

testCase('recovery file picker covers every configured adapter extension', () => {
  const acceptedExtensions = new Set(RECOVERY_SOURCE_ACCEPT.split(','));
  for (const adapter of DEFAULT_IMPORT_ADAPTER_DESCRIPTORS) {
    for (const extension of adapter.extensions) {
      expect(
        acceptedExtensions.has(extension),
        `${adapter.id} extension ${extension} is missing from the recovery picker`,
      ).toStrictEqual(true);
    }
  }
});

testCase('recover source registry requires confirmation for a probable Moodle match', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'file',
    source: {
      filename: 'quiz.xml',
      mime: 'application/xml',
      bytes: encoder.encode('<quiz><question type="multichoice"></question></quiz>'),
    },
  });

  expect(result._tag).toStrictEqual('confirmation_required');
  if (result._tag !== 'confirmation_required') return;
  expect(result.candidates[0].adapter).toStrictEqual({ id: 'moodle_xml', version: '1' });
  expect(result.candidates[0].confidence).toStrictEqual(0.7);
  const selected = selectSourceCandidate(result, { id: 'moodle_xml', version: '1' });
  expect(selected.adapter.id).toStrictEqual('moodle_xml');
  expect(selected.label).toStrictEqual('Moodle XML');
});

testCase(
  'recovery resolves explicit Respondus Standard Format without AI interpretation',
  async () => {
    const result = await inspectSource('recover_existing', {
      _tag: 'paste',
      text: [
        'Type: MA',
        '1. Select the prime numbers.',
        '*a. 2',
        '*b. 3',
        'c. 4',
      ].join('\n'),
    });

    expect(result._tag).toStrictEqual('resolved');
    if (result._tag !== 'resolved') return;
    expect(result.candidate.adapter).toStrictEqual({ id: 'respondus-standard', version: '1' });
    expect(result.candidate.confidence).toStrictEqual(0.98);
  },
);

testCase('recovery resolves a Respondus-shaped Word document', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'file',
    source: {
      filename: 'word-visible-numbering.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await _fs.readFile(
        new URL('fixtures/import/respondus/word-visible-numbering.docx', import.meta.url),
      ),
    },
  });

  expect(result._tag).toStrictEqual('resolved');
  if (result._tag !== 'resolved') return;
  expect(result.candidate.adapter).toStrictEqual({ id: 'respondus-standard', version: '1' });
  expect(result.candidate.confidence).toStrictEqual(0.98);
});

testCase('recovery does not silently choose an unconfirmed adapter', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'paste',
    text: 'Question?\nA. First\nB. Second\nANSWER: A',
  });

  expect(result._tag).toStrictEqual('confirmation_required');
  const missing = (() => {
    try {
      selectSourceCandidate(result);
      return null;
    } catch (error) {
      return error;
    }
  })();
  expect(missing instanceof Error && missing.message).toStrictEqual(
    'Confirm the source format before continuing.',
  );
  expect(missing instanceof SourceSelectionError && missing.code).toStrictEqual(
    'missing_selection',
  );
});

testCase('recovery does not present a bare numbered quiz as Respondus', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'paste',
    text: [
      '1. Which option is correct?',
      'a. First',
      'b. Second',
    ].join('\n'),
  });

  expect(result._tag).toStrictEqual('unsupported');
});

testCase('document sent to recovery points to generation without changing intent', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'file',
    source: {
      filename: 'reading.pdf',
      mime: 'application/pdf',
      bytes: encoder.encode('%PDF-1.7'),
    },
  });

  expect(result._tag).toStrictEqual('unsupported');
  if (result._tag !== 'unsupported') return;
  expect(result.suggestedPurpose).toStrictEqual('generate_new');
});

testCase(
  'native ExamView files receive an explicit export path without binary guessing',
  async () => {
    for (const filename of ['unit-test.tst', 'publisher-bank.bnk']) {
      const result = await inspectSource('recover_existing', {
        _tag: 'file',
        source: {
          filename,
          mime: 'application/octet-stream',
          bytes: encoder.encode('synthetic native container marker'),
        },
      });

      expect(result._tag).toStrictEqual('unsupported');
      if (result._tag !== 'unsupported') continue;
      expect(result.code).toStrictEqual('examview_native');
      expect(result.message).toStrictEqual(
        'QFlowLearn does not parse native ExamView files or bypass their passwords. In ExamView, export a Canvas, Blackboard, or Moodle package, then add that package here.',
      );
    }
  },
);

testCase('native ExamView advisory takes precedence over content sniffing', async () => {
  const result = await inspectSource('recover_existing', {
    _tag: 'file',
    source: {
      filename: 'misleading.tst',
      mime: 'application/octet-stream',
      bytes: encoder.encode('Which option is correct? {=QTI 3.0 ~A proprietary format}'),
    },
  });

  expect(result._tag).toStrictEqual('unsupported');
  if (result._tag !== 'unsupported') return;
  expect(result.code).toStrictEqual('examview_native');
  expect(result.message).toStrictEqual(
    'QFlowLearn does not parse native ExamView files or bypass their passwords. In ExamView, export a Canvas, Blackboard, or Moodle package, then add that package here.',
  );
});

testCase('selected adapter must match the detected generation format', async () => {
  const result = await inspectSource('generate_new', {
    _tag: 'paste',
    text: 'The water cycle includes evaporation and condensation.',
  });

  expect(result._tag).toStrictEqual('resolved');
  const mismatch = (() => {
    try {
      selectSourceCandidate(result, { id: 'text', version: '1' });
      return null;
    } catch (error) {
      return error;
    }
  })();
  expect(mismatch instanceof Error && mismatch.message).toStrictEqual(
    'The selected source adapter does not match the detected format.',
  );
  expect(mismatch instanceof SourceSelectionError && mismatch.code).toStrictEqual(
    'selection_mismatch',
  );
});

testCase('pinned recovery adapter ref requires an explicit version', () => {
  expect(resolvePinnedImportAdapterRef('moodle_xml', '1')).toStrictEqual({
    id: 'moodle_xml',
    version: '1',
  });
  expect(() => resolvePinnedImportAdapterRef('moodle_xml')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('requires an explicit version')
    ),
  );
  expect(() => resolvePinnedImportAdapterRef('missing-adapter', '1')).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('is not configured')
    ),
  );
});
