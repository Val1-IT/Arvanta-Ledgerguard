import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const FORBIDDEN = [
  'next',
  'react',
  'react-dom',
  '@anthropic-ai/sdk',
  'openai',
  'drizzle-orm',
  'lucide-react',
  'pg',
  'mcp',
  '@modelcontextprotocol/sdk',
  'acryl-datahub',
  '@ledgerguard/postgres'
] as const;

describe('@ledgerguard/core isolation', () => {
  it('runtime dependencies are only decimal.js and zod', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['decimal.js', 'zod']);
  });

  it('does not depend on UI, DataHub, MCP, LLM, or database adapters', () => {
    const declared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };
    for (const name of FORBIDDEN) {
      expect(declared[name], name).toBeUndefined();
    }
  });

  it('source does not import forbidden packages', () => {
    const files = listTsFiles(join(packageRoot, 'src'));
    const pattern = new RegExp(`from ['"](?:${FORBIDDEN.map(escapeRegex).join('|')})['"]`);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(pattern), file).toBeNull();
    }
  });

  it('source and tests do not import application modules', () => {
    const files = [...listTsFiles(join(packageRoot, 'src')), ...listTsFiles(join(packageRoot, 'test'))];
    const applicationImport = /from ['"](?:\.\.\/)+src\//;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(applicationImport), file).toBeNull();
    }
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}
