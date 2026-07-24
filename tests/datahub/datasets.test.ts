import { describe, expect, it } from 'vitest';
import { DEMO_TABLES, datasetUrn, gmsGraphql } from './helpers';

// Verifies against the live DataHub instance (independently of the bootstrap's
// own report) that each of the six datasets exists with its schema and metadata.

interface DatasetQuery {
  dataset: {
    urn: string;
    properties: { name: string; description: string | null } | null;
    editableProperties: { description: string | null } | null;
    schemaMetadata: { fields: { fieldPath: string }[] } | null;
    ownership: { owners: { owner: { urn: string } }[] } | null;
    tags: { tags: { tag: { urn: string } }[] } | null;
    glossaryTerms: { terms: { term: { urn: string } }[] } | null;
  } | null;
}

const QUERY = `
  query dataset($urn: String!) {
    dataset(urn: $urn) {
      urn
      properties { name description }
      editableProperties { description }
      schemaMetadata { fields { fieldPath } }
      ownership { owners { owner { ... on CorpGroup { urn } ... on CorpUser { urn } } } }
      tags { tags { tag { urn } } }
      glossaryTerms { terms { term { urn } } }
    }
  }
`;

describe('datahub datasets', () => {
  it.each(DEMO_TABLES)('dataset %s exists with a schema and a description', async (table) => {
    const data = await gmsGraphql<DatasetQuery>(QUERY, { urn: datasetUrn(table) });
    const dataset = data.dataset;

    expect(dataset, `${table} should exist in DataHub`).not.toBeNull();
    expect(dataset!.urn).toBe(datasetUrn(table));
    // The bootstrap SDK writes human-authored descriptions to the editable
    // aspect (shown as the dataset's description in the UI); the raw
    // `properties.description` aspect is reserved for ingestion-sourced,
    // non-editable technical metadata and is intentionally left unset here.
    const description = dataset!.editableProperties?.description ?? dataset!.properties?.description ?? '';
    expect(description).not.toHaveLength(0);
    expect(dataset!.schemaMetadata?.fields.length ?? 0).toBeGreaterThan(0);
    expect(dataset!.ownership?.owners.length ?? 0).toBeGreaterThan(0);
    expect(dataset!.tags?.tags.length ?? 0).toBeGreaterThan(0);
    expect(dataset!.glossaryTerms?.terms.length ?? 0).toBeGreaterThan(0);
  });

  it('product_units carries the conversion_factor field', async () => {
    const data = await gmsGraphql<DatasetQuery>(QUERY, { urn: datasetUrn('product_units') });
    const fields = data.dataset?.schemaMetadata?.fields.map((f) => f.fieldPath) ?? [];
    expect(fields).toContain('conversion_factor');
  });
});
