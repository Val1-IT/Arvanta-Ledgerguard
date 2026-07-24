import { describe, expect, it } from 'vitest';
import { ARTIFACTS, DEMO_TABLES, datasetUrn, readJson } from './helpers';

interface BootstrapReport {
  owner_groups: string[];
  tags: string[];
  terms: string[];
  datasets: string[];
  lineage_edges: string[];
  column_lineage_edges: number;
  assertions: string[];
}

const run1 = readJson<BootstrapReport>(ARTIFACTS.bootstrapRun1);
const run2 = readJson<BootstrapReport>(ARTIFACTS.bootstrapRun2);

describe('datahub bootstrap', () => {
  it('is idempotent: a second run writes exactly the same URNs', () => {
    expect(run2).toEqual(run1);
  });

  it('provisions the six ERP datasets', () => {
    const expected = DEMO_TABLES.map(datasetUrn).sort();
    expect([...run2.datasets].sort()).toEqual(expected);
  });

  it('provisions owners, glossary terms and tags', () => {
    expect(run2.owner_groups).toHaveLength(3);
    expect(run2.terms).toHaveLength(5);
    expect(run2.tags).toContain('urn:li:tag:At Risk');
    expect(run2.tags.length).toBeGreaterThanOrEqual(6);
  });

  it('provisions the full lineage chain with column-level mappings', () => {
    expect(run2.lineage_edges).toContain('product_units -> inventory_movements');
    expect(run2.lineage_edges).toContain('inventory_movements -> inventory_valuation');
    expect(run2.lineage_edges).toContain('inventory_valuation -> journal_entries');
    expect(run2.lineage_edges).toContain('journal_entries -> gross_margin_report');
    expect(run2.column_lineage_edges).toBeGreaterThan(0);
  });

  it('publishes the five integrity assertions as DataHub quality metadata', () => {
    expect(run2.assertions).toHaveLength(5);
  });
});
