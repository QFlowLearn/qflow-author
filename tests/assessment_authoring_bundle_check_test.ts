import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';

import { join } from 'node:path';

import {
  AssessmentAuthoringBundleError,
  measureAssessmentAuthoringBundle,
  validateAssessmentAuthoringBundle,
} from '../tools/check_assessment_authoring_bundle.ts';

const ENTRY = 'islands/AssessmentBuilder.tsx';

testCase(
  'bundle measurement traverses unique static imports and excludes dynamic imports',
  async () => {
    await withClientBuild(async ({ clientRoot, manifestPath }) => {
      await writeManifest(manifestPath, {
        [ENTRY]: {
          file: 'assets/entry.js',
          imports: ['shared', 'feature'],
          dynamicImports: ['optional'],
        },
        shared: { file: 'assets/shared.js', imports: ['common'] },
        feature: { file: 'assets/feature.js', imports: ['common'] },
        common: { file: 'assets/common.js' },
        optional: { file: 'assets/optional.js' },
      });
      await writeAsset(clientRoot, 'assets/entry.js', 'entry');
      await writeAsset(clientRoot, 'assets/shared.js', 'shared');
      await writeAsset(clientRoot, 'assets/feature.js', 'feature');
      await writeAsset(clientRoot, 'assets/common.js', 'common');

      const measurement = await measureAssessmentAuthoringBundle({ manifestPath, clientRoot });

      expect(measurement.chunks).toStrictEqual(4);
      expect(measurement.rawBytes).toStrictEqual('entrysharedfeaturecommon'.length);
      if (!(measurement.gzipBytes > 0)) expect.unreachable('Expected measurement.gzipBytes > 0');
      expect(measurement.assets).toStrictEqual([
        'assets/common.js',
        'assets/entry.js',
        'assets/feature.js',
        'assets/shared.js',
      ]);
    });
  },
);

testCase('bundle measurement counts aliased manifest keys by emitted file', async () => {
  await withClientBuild(async ({ clientRoot, manifestPath }) => {
    await writeManifest(manifestPath, {
      [ENTRY]: {
        file: 'assets/entry.js',
        imports: ['shared-alias-a', 'shared-alias-b'],
      },
      'shared-alias-a': { file: 'assets/shared.js' },
      'shared-alias-b': { file: 'assets/shared.js' },
    });
    await writeAsset(clientRoot, 'assets/entry.js', 'entry');
    await writeAsset(clientRoot, 'assets/shared.js', 'shared');

    const measurement = await measureAssessmentAuthoringBundle({ manifestPath, clientRoot });

    expect(measurement.chunks).toStrictEqual(2);
    expect(measurement.rawBytes).toStrictEqual('entryshared'.length);
    expect(measurement.assets).toStrictEqual(['assets/entry.js', 'assets/shared.js']);
  });
});

testCase('bundle measurement rejects malformed consumed manifest fields', async () => {
  await withClientBuild(async ({ clientRoot, manifestPath }) => {
    await writeManifest(manifestPath, {
      [ENTRY]: { file: 'assets/entry.js', imports: 'not-an-array' },
    });

    const error = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        measureAssessmentAuthoringBundle({ manifestPath, clientRoot })
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof AssessmentAuthoringBundleError)) {
        expect.unreachable('Expected AssessmentAuthoringBundleError');
      }
      return caught;
    })();
    expect(error.message).toContain('invalid static imports list');
  });
});

testCase('bundle measurement rejects missing manifest entries and assets', async () => {
  await withClientBuild(async ({ clientRoot, manifestPath }) => {
    await writeManifest(manifestPath, {
      [ENTRY]: { file: 'assets/entry.js', imports: ['missing-chunk'] },
    });
    await writeAsset(clientRoot, 'assets/entry.js', 'entry');

    const missingChunk = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        measureAssessmentAuthoringBundle({ manifestPath, clientRoot })
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof AssessmentAuthoringBundleError)) {
        expect.unreachable('Expected AssessmentAuthoringBundleError');
      }
      return caught;
    })();
    expect(missingChunk.message).toContain('missing-chunk');

    await writeManifest(manifestPath, {
      [ENTRY]: { file: 'assets/missing.js' },
    });
    const missingAsset = await (async () => {
      const caught: unknown = await Promise.resolve().then(() =>
        measureAssessmentAuthoringBundle({ manifestPath, clientRoot })
      ).then(() => expect.unreachable('Expected a rejection.'), (cause: unknown) => cause);
      if (!(caught instanceof AssessmentAuthoringBundleError)) {
        expect.unreachable('Expected AssessmentAuthoringBundleError');
      }
      return caught;
    })();
    expect(missingAsset.message).toContain('assets/missing.js');
  });
});

testCase('bundle validation reports every exceeded limit', () => {
  const validation = validateAssessmentAuthoringBundle(
    {
      entry: 'assets/entry.js',
      chunks: 5,
      rawBytes: 20,
      gzipBytes: 10,
      assets: ['assets/entry.js'],
    },
    { chunks: 4, rawBytes: 19, gzipBytes: 9 },
  );

  if (validation.ok) expect.unreachable('Expected !validation.ok');
  expect(validation.violations.length).toStrictEqual(3);
  expect(validation.violations[0]).toContain('5 static chunks');
  expect(validation.violations[1]).toContain('20 raw bytes');
  expect(validation.violations[2]).toContain('10 gzip bytes');
});

async function withClientBuild(
  run: (paths: { readonly clientRoot: string; readonly manifestPath: string }) => Promise<void>,
): Promise<void> {
  const clientRoot = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-assessment-bundle-'));
  const manifestPath = join(clientRoot, 'manifest.json');
  try {
    await _fs.mkdir(join(clientRoot, 'assets'));
    await run({ clientRoot, manifestPath });
  } finally {
    await _fs.rm(clientRoot, { recursive: true });
  }
}

async function writeManifest(path: string, manifest: unknown): Promise<void> {
  await _fs.writeFile(path, JSON.stringify(manifest), 'utf8');
}

async function writeAsset(root: string, path: string, content: string): Promise<void> {
  await _fs.writeFile(join(root, path), content, 'utf8');
}
