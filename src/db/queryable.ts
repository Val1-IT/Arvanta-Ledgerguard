import type { Pool } from 'pg';

// A Pool and a PoolClient (from pool.connect(), e.g. inside a transaction)
// both satisfy this — repository/fetch functions accept Queryable so the
// same code path works whether it's called standalone or as one statement
// inside a larger transaction (see src/remediation/execute.ts).
export type Queryable = Pick<Pool, 'query'>;
