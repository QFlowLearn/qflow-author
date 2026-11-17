import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { applyOidcClientSecretMigration } from '../tools/migrations/encrypt_oidc_client_secrets.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';

testCase(
  'publisher bank migrations preserve a populated pre-0048 workspace and all existing references',
  { skip: process.env['QFLOW_UPGRADE_TESTS'] !== '1' },
  async function () {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) expect.unreachable('Expected databaseUrl');
    const url = new URL(databaseUrl);
    if (!(['127.0.0.1', 'localhost'].includes(url.hostname))) {
      expect.unreachable('Upgrade test requires local PostgreSQL.');
    }
    const admin = postgres(databaseUrl, { max: 1 });
    const databaseName = `qflow_upgrade_test_${crypto.randomUUID().replaceAll('-', '')}`;
    let client: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE ${databaseName}`);
      url.pathname = `/${databaseName}`;
      client = postgres(url.toString(), { max: 1 });
      const connection = client;
      await connection`CREATE TABLE schema_migrations (filename text PRIMARY KEY)`;
      const files: string[] = [];
      for await (const file of await _fs.opendir('db/migrations')) {
        if (file.name.endsWith('.sql')) files.push(file.name);
      }
      for (const file of files.sort().filter((name) => name < '0048')) {
        await connection.unsafe(await _fs.readFile(`db/migrations/${file}`, 'utf8'));
        if (file.startsWith('0042')) await applyOidcClientSecretMigration(connection);
      }
      const tenantId = crypto.randomUUID();
      const emptyTenantId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const questionId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const assessmentId = crypto.randomUUID();
      const partId = crypto.randomUUID();
      await connection`INSERT INTO tenants(id, slug, name) VALUES (${tenantId}, ${tenantId}, 'Publisher')`;
      await connection`INSERT INTO tenants(id, slug, name) VALUES (${emptyTenantId}, ${emptyTenantId}, 'Empty workspace')`;
      await connection`INSERT INTO users(id, email, email_normalized) VALUES (${userId}, ${
        userId + '@example.test'
      }, ${userId + '@example.test'})`;
      await connection`INSERT INTO organization_memberships(id,tenant_id,user_id,role) VALUES (${crypto.randomUUID()},${tenantId},${userId},'owner')`;
      await connection`INSERT INTO questions(id,tenant_id,stable_key,title,owner_user_id,lifecycle_state) VALUES (${questionId},${tenantId},'source-question-17','Existing question',${userId},'active')`;
      await connection`INSERT INTO question_revisions(id,question_id,tenant_id,revision,body,provenance,qti_xml,content_hash,search_text,compatibility,review_suggestions)
        VALUES (${revisionId},${questionId},${tenantId},1,${
        connection.json({ promptHtml: '<img src="diagram.png" alt="Cell diagram">' })
      }, '{"sourceIdentifier":"source-question-17"}', '<qti-assessment-item identifier="source-question-17"/>', ${
        'a'.repeat(64)
      }, 'Existing question', '[]', '[]')`;
      await connection`UPDATE questions SET latest_revision_id=${revisionId} WHERE id=${questionId}`;
      await connection`INSERT INTO question_assets(id,question_revision_id,asset_key,mime_type,r2_url) VALUES (${crypto.randomUUID()},${revisionId},'diagram.png','image/png','https://assets.example.test/diagram.png')`;
      await connection`INSERT INTO assessments(id,tenant_id,slug,title,created_by,blueprint) VALUES (${assessmentId},${tenantId},${assessmentId},'Existing assessment',${userId},'{"_tag":"Unspecified"}')`;
      await connection`INSERT INTO assessment_parts(id,assessment_id,title,position) VALUES (${partId},${assessmentId},'Part 1',0)`;
      await connection`INSERT INTO assessment_placements(id,assessment_part_id,question_id,position) VALUES (${crypto.randomUUID()},${partId},${questionId},0)`;
      const snapshot = async () => ({
        questions: [...await connection`SELECT * FROM questions`],
        revisions: [...await connection`SELECT * FROM question_revisions`],
        assets: [...await connection`SELECT * FROM question_assets`],
        assessments: [...await connection`SELECT * FROM assessments`],
        parts: [...await connection`SELECT * FROM assessment_parts`],
        placements: [...await connection`SELECT * FROM assessment_placements`],
      });
      const before = await snapshot();
      for (const name of ['0048_bank_collections.sql', '0049_bank_display_name.sql']) {
        await connection.unsafe(await _fs.readFile(`db/migrations/${name}`, 'utf8'));
      }
      expect(await snapshot()).toStrictEqual(before);
      expect([...await connection`SELECT bank_display_name FROM tenants ORDER BY id`])
        .toStrictEqual([
          { bank_display_name: null },
          { bank_display_name: null },
        ]);
      expect([...await connection`SELECT * FROM questions WHERE tenant_id=${emptyTenantId}`])
        .toStrictEqual([]);
      expect([...await connection`SELECT * FROM bank_collections`]).toStrictEqual([]);
      // Current services require the complete schema; the historical 0048/0049 preservation
      // assertions above remain scoped to those two migrations.
      for (const file of files.sort().filter((name) => name > '0049_bank_display_name.sql')) {
        await connection.unsafe(await _fs.readFile(`db/migrations/${file}`, 'utf8'));
      }
      const upgraded = await snapshot();
      const collectionId = crypto.randomUUID();
      const ctx = { tenantId, userId, role: 'owner' as const };
      const dependencies = { database: drizzle(connection), now: () => new Date(0) };
      if (
        !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
          _tag: 'Create',
          collectionId,
          name: 'Existing title',
          description: '',
          position: 0,
        }, dependencies)).ok)
      ) {
        expect.unreachable(
          "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'Create', collectionId",
        );
      }
      if (
        !((await applyBankCollectionCommand(ctx, crypto.randomUUID(), {
          _tag: 'AddItems',
          collectionId,
          questionIds: [questionId],
        }, dependencies)).ok)
      ) {
        expect.unreachable(
          "Expected (await applyBankCollectionCommand(ctx, crypto.randomUUID(), { _tag: 'AddItems', collection",
        );
      }
      expect(await snapshot()).toStrictEqual(upgraded);
    } finally {
      await client?.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await admin.end();
    }
  },
);
