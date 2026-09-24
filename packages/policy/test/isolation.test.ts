import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const FORBIDDEN = [
  'next',
  'react',
  'react-dom',
  'pg',
  'drizzle-orm',
  '@ledgerguard/postgres',
  '@ledgerguard/datahub',
  '@anthropic-ai/sdk',
  'openai'
] as const;

describe('@ledgerguard/policy isolation', () => {
  it('depends only on core and zod at runtime', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@ledgerguard/core', 'zod']);
  });

  it('does not depend on postgres, DataHub, Next, or LLM SDKs', () => {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of FORBIDDEN) {
      expect(declared[name], name).toBeUndefined();
    }
  });

  it('source does not import application modules', () => {
    const files = listTsFiles(join(packageRoot, 'src'));
    const applicationImport = /from ['"](?:\.\.\/)+src\//;
    for (const file of files) {
      expect(readFileSync(file, 'utf8').match(applicationImport), file).toBeNull();
    }
  });
});

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}
