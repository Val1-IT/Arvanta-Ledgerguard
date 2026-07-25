import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('accessibility smoke (source)', () => {
  it('app shell exposes skip link and primary nav landmark', () => {
    const shell = read('src/ui/components/app-shell.tsx');
    expect(shell).toContain('Skip to content');
    expect(shell).toContain('aria-label="Primary"');
    expect(shell).toContain('id="main-content"');
  });

  it('incident tabs expose tablist/tab/tabpanel roles', () => {
    const tabs = read('app/incidents/[id]/incident-tabs.tsx');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain('role="tabpanel"');
    expect(tabs).toContain('aria-selected');
  });

  it('copy button and status badges expose accessible names', () => {
    expect(read('src/ui/components/copy-id-button.tsx')).toContain('aria-label');
    expect(read('src/ui/components/status-badge.tsx')).toContain('aria-label={`Status: ${label}`}');
  });

  it('mobile impact graph has a vertical stacked fallback', () => {
    const graph = read('src/ui/components/impact-graph.tsx');
    expect(graph).toContain('sm:hidden');
    expect(graph).toContain('↓');
  });
});
