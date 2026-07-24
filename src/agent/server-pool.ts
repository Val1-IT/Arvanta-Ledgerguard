import { Pool } from 'pg';
import { makePool } from '../db/client';

// ---------------------------------------------------------------------------
// One pooled connection shared by the Next.js server (app/agent/*) instead of
// opening a fresh Pool per request/module-reload — the same reason
// src/db/client.ts's makePool() is a factory rather than a module-level
// singleton everywhere else (scripts and tests each want their own,
// short-lived pool). Cached on globalThis so Next dev's module hot-reload
// does not leak a new pool on every edit.
// ---------------------------------------------------------------------------

const globalForPool = globalThis as unknown as { __ledgerguardAgentPool?: Pool };

export function getServerPool(): Pool {
  if (!globalForPool.__ledgerguardAgentPool) {
    globalForPool.__ledgerguardAgentPool = makePool();
  }
  return globalForPool.__ledgerguardAgentPool;
}
