import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(resolve(process.cwd(), name), 'utf8');
describe('private evaluation configuration defaults', () => {
  it('does not enable mutations or external providers when the example is copied', () => {
    const env = parse(read('.env.example'));
    expect(env.DEMO_MODE).toBe('false');
    expect(env.DATAHUB_GMS_URL).toBe('');
    expect(env.LLM_PROVIDER).toBe('deterministic');
    expect(env.OPENAI_API_KEY).toBe('');
    expect(env.ANTHROPIC_API_KEY).toBe('');
  });
  it('binds every published demo service port to loopback', () => {
    for (const file of ['docker-compose.yml', 'docker-compose.demo.yml', 'docker-compose.odoo.yml']) {
      const published = [...read(file).matchAll(/-\s*['"]([^'"\n]+:\d+)['"]/g)].map((match) => match[1]);
      expect(published.length).toBeGreaterThan(0);
      expect(published.every((port) => port.startsWith('127.0.0.1:'))).toBe(true);
    }
  });
  it('uses database readiness rather than a fallback UI page for compose health', () => {
    expect(read('docker-compose.demo.yml')).toContain('/api/health/ready');
  });
  it('excludes all environment-file flavors from Docker except the empty example', () => {
    const rules = read('.dockerignore').split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
    expect(rules).toContain('.env*');
    expect(rules).toContain('!.env.example');
    expect(rules.filter((line) => line.startsWith('!.env'))).toEqual(['!.env.example']);
  });
});
