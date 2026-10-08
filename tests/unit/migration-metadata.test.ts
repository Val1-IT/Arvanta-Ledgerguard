import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';

// The CommonJS API also works with older Drizzle Kit ESM bundles whose
// transitive dependencies still use dynamic require.
const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)(
  'drizzle-kit/api'
) as typeof import('drizzle-kit/api');

const metadataDirectory = fileURLToPath(new URL('../../drizzle/meta/', import.meta.url));
const snapshotFiles = readdirSync(metadataDirectory)
  .filter((name) => /^\d+_snapshot\.json$/.test(name))
  .sort();
const snapshots: DrizzleSnapshotJSON[] = snapshotFiles.map((name) =>
  JSON.parse(readFileSync(`${metadataDirectory}/${name}`, 'utf8'))
);
const journal: { entries: { idx: number }[] } = JSON.parse(
  readFileSync(`${metadataDirectory}/_journal.json`, 'utf8')
);
const latestSnapshot = snapshots[snapshots.length - 1];

describe('Drizzle migration metadata', () => {
  it('keeps a connected snapshot for every committed migration', () => {
    expect(snapshotFiles).toEqual(
      journal.entries.map(({ idx }) => `${String(idx).padStart(4, '0')}_snapshot.json`)
    );
    let previousId = '00000000-0000-0000-0000-000000000000';
    const ids = new Set<string>();
    for (const snapshot of snapshots) {
      expect(snapshot.prevId).toBe(previousId);
      expect(ids.has(snapshot.id)).toBe(false);
      ids.add(snapshot.id);
      previousId = snapshot.id;
    }
  });

  it('generates no SQL when the committed schema has not changed', async () => {
    const currentSnapshot = generateDrizzleJson(schema, latestSnapshot.id);
    expect(await generateMigration(latestSnapshot, currentSnapshot)).toEqual([]);
  });

  it('generates only the intentional change for the next migration', async () => {
    const changedSnapshot = generateDrizzleJson({
      ...schema,
      metadataRegressionProbe: pgTable('metadata_regression_probe', {
        id: text('id').primaryKey()
      })
    }, latestSnapshot.id);
    const statements = await generateMigration(latestSnapshot, changedSnapshot);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^CREATE TABLE(?: IF NOT EXISTS)? "metadata_regression_probe" \(\n\t"id" text PRIMARY KEY NOT NULL\n\);\n$/
    );
  });

  it('tracks the execution journal index already created by migration 0005', () => {
    const currentSnapshot = generateDrizzleJson(schema);
    expect(currentSnapshot.tables['public.ledgerguard_execution_journal'].indexes)
      .toHaveProperty('ledgerguard_execution_journal_key_idx');
  });
});
