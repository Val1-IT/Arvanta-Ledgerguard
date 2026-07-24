import { describe, expect, it } from 'vitest';
import { datasetUrn, gmsGraphql } from './helpers';

// The incident's whole argument is that a wrong conversion_factor propagates all
// the way to the gross margin report. These tests assert that DataHub actually
// carries that chain, hop by hop, plus the column-level edge that names
// conversion_factor as an upstream of base_quantity.

interface LineageQuery {
  dataset: {
    lineage: {
      relationships: { entity: { urn: string } }[];
    } | null;
  } | null;
}

const DOWNSTREAM = `
  query lineage($urn: String!) {
    dataset(urn: $urn) {
      lineage(input: { direction: DOWNSTREAM, start: 0, count: 100 }) {
        relationships { entity { urn } }
      }
    }
  }
`;

interface FineGrainedQuery {
  dataset: {
    fineGrainedLineages: {
      upstreams: { urn: string; path: string }[];
      downstreams: { urn: string; path: string }[];
    }[];
  } | null;
}

// `fineGrainedLineages` is a top-level field on `Dataset` (populated from the
// `upstreamLineage` aspect) — it is not nested under the `lineage(...)`
// relationship-traversal field, which only returns coarse entity-to-entity
// edges (confirmed via GraphQL introspection against the live GMS schema).
const FINE_GRAINED = `
  query fineGrained($urn: String!) {
    dataset(urn: $urn) {
      fineGrainedLineages {
        upstreams { urn path }
        downstreams { urn path }
      }
    }
  }
`;

async function downstreamsOf(table: string): Promise<string[]> {
  const data = await gmsGraphql<LineageQuery>(DOWNSTREAM, { urn: datasetUrn(table) });
  return data.dataset?.lineage?.relationships.map((r) => r.entity.urn) ?? [];
}

const CHAIN: [string, string][] = [
  ['product_units', 'inventory_movements'],
  ['inventory_movements', 'inventory_valuation'],
  ['inventory_valuation', 'journal_entries'],
  ['journal_entries', 'gross_margin_report']
];

describe('datahub lineage', () => {
  it.each(CHAIN)('%s has %s as a direct downstream', async (upstream, downstream) => {
    const urns = await downstreamsOf(upstream);
    expect(urns).toContain(datasetUrn(downstream));
  });

  it('product_units reaches gross_margin_report by walking downstream', async () => {
    const visited = new Set<string>();
    const queue = ['product_units'];
    const target = datasetUrn('gross_margin_report');

    while (queue.length > 0) {
      const table = queue.shift()!;
      if (visited.has(table)) continue;
      visited.add(table);

      for (const urn of await downstreamsOf(table)) {
        if (urn === target) return; // reached it
        const match = /ledgerguard\.public\.([a-z_]+),PROD\)$/.exec(urn);
        if (match && !visited.has(match[1])) {
          queue.push(match[1]);
        }
      }
    }

    throw new Error('gross_margin_report is not reachable downstream of product_units');
  });

  it('conversion_factor is a column-level upstream of base_quantity', async () => {
    const data = await gmsGraphql<FineGrainedQuery>(FINE_GRAINED, {
      urn: datasetUrn('inventory_movements')
    });
    const fine = data.dataset?.fineGrainedLineages ?? [];

    const edge = fine.find((entry) =>
      entry.downstreams.some((d) => d.path === 'base_quantity') &&
      entry.upstreams.some(
        (u) => u.path === 'conversion_factor' && u.urn === datasetUrn('product_units')
      )
    );

    expect(edge, 'expected column lineage conversion_factor -> base_quantity').toBeDefined();
  });
});
