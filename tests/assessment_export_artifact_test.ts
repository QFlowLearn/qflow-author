import { expect, test as testCase } from 'vitest';

import {
  assessmentExportArtifactStorageKey,
  materializeAssessmentExportArtifact,
  readMaterializedAssessmentExportArtifact,
  streamMaterializedAssessmentExportArtifact,
} from '../lib/export/assessment_export_artifact.ts';
import { sha256Hex } from '../lib/sha256.ts';
import type { ObjectStreamReader, ObjectWriter } from '../lib/storage_contract.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';

testCase(
  'materialized export artifacts preserve their receipt-bound content identity',
  async () => {
    const storage = createMemoryObjectStorage();
    const bytes = new TextEncoder().encode('one approved package');
    const expectedSha256 = await sha256Hex(bytes);
    const materialized = await materializeAssessmentExportArtifact(storage, {
      tenantId: 'a6a3014d-d7b1-4b0f-8152-f62f9d1a08c6',
      assessmentId: '1d52b43a-ef0f-4f22-aaf0-b3f2f8f5d462',
      filename: 'assessment.zip',
      mediaType: 'application/zip',
      bytes,
      expectedSha256,
    });
    if (!(materialized.ok)) expect.unreachable('Expected materialized.ok');
    expect(materialized.value.storageKey).toStrictEqual(assessmentExportArtifactStorageKey({
      tenantId: 'a6a3014d-d7b1-4b0f-8152-f62f9d1a08c6',
      assessmentId: '1d52b43a-ef0f-4f22-aaf0-b3f2f8f5d462',
      artifactSha256: expectedSha256,
    }));

    const recovered = await readMaterializedAssessmentExportArtifact(
      storage,
      materialized.value,
    );
    if (!(recovered.ok)) expect.unreachable('Expected recovered.ok');
    expect(recovered.value).toStrictEqual(bytes);

    const streamed = await streamMaterializedAssessmentExportArtifact(
      storage,
      materialized.value,
    );
    if (!(streamed.ok)) expect.unreachable('Expected streamed.ok');
    expect(new Uint8Array(await new Response(streamed.value.body).arrayBuffer())).toStrictEqual(
      bytes,
    );
  },
);

testCase('artifact materialization rejects bytes that do not match the approved hash', async () => {
  let writes = 0;
  const storage: ObjectWriter = {
    putObject() {
      writes += 1;
      return Promise.resolve();
    },
  };
  const materialized = await materializeAssessmentExportArtifact(storage, {
    tenantId: crypto.randomUUID(),
    assessmentId: crypto.randomUUID(),
    filename: 'assessment.zip',
    mediaType: 'application/zip',
    bytes: new TextEncoder().encode('changed package'),
    expectedSha256: await sha256Hex(new TextEncoder().encode('approved package')),
  });
  expect(materialized.ok).toStrictEqual(false);
  expect(writes).toStrictEqual(0);
});

testCase(
  'artifact streaming cancels objects whose checksum disagrees with the receipt',
  async () => {
    let cancelled = false;
    const storage: ObjectStreamReader = {
      readObjectStream() {
        return Promise.resolve({
          body: new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
          contentLength: 10,
          contentType: 'application/zip',
          contentSha256: '1'.repeat(64),
        });
      },
    };
    const streamed = await streamMaterializedAssessmentExportArtifact(storage, {
      storageKey: 'assessment-export-artifacts/tenant/assessment/hash.package',
      filename: 'assessment.zip',
      mediaType: 'application/zip',
      sha256: '0'.repeat(64),
      byteLength: 10,
    });
    expect(streamed.ok).toStrictEqual(false);
    expect(cancelled).toStrictEqual(true);
  },
);
