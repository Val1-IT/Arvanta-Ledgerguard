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
  '@ledgerguard/postgres',
  'pg',
  'drizzle-orm',
  '@anthropic-ai/sdk',
  'openai'
] as const;

describe('@ledgerguard/datahub isolation', () => {
  it('does not depend on postgres, Next, or LLM SDKs', () => {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of FORBIDDEN) {
      expect(declared[name], name).toBeUndefined();
    }
  });

  it('does not import application source', () => {
    const files = listTsFiles(join(packageRoot, 'src'));
    const applicationImport = /from ['"](?:\.\.\/)+src\//;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(applicationImport), file).toBeNull();
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
