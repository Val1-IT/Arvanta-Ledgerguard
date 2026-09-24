import type { Queryable } from '../queryable';
import { JournalEntryRecordSchema, type JournalEntryRecord } from '@ledgerguard/core';

export async function fetchJournalEntries(pool: Queryable): Promise<JournalEntryRecord[]> {
  const { rows } = await pool.query(
    `select id, source_type as "sourceType", source_id as "sourceId", account_code as "accountCode",
            debit, credit, posted_at as "postedAt"
       from journal_entries
      order by posted_at, id`
  );
  return rows.map((row) => JournalEntryRecordSchema.parse(row));
}
