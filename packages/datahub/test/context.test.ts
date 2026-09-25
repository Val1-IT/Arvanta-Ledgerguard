import { describe, expect, it } from 'vitest';
import { CatalogContextSchema, EMPTY_CATALOG_CONTEXT, isDataHubConfigured } from '@ledgerguard/datahub';

describe('DataHub catalog context', () => {
  it('empty context is explicit and schema-valid, not fabricated demo URNs', () => {
    expect(CatalogContextSchema.parse(EMPTY_CATALOG_CONTEXT)).toEqual({
      assetsRead: [],
      owners: [],
      glossaryTerms: [],
      tags: [],
      lineagePath: []
    });
  });

  it('treats missing DATAHUB_GMS_URL as not configured', () => {
    expect(isDataHubConfigured({})).toBe(false);
    expect(isDataHubConfigured({ DATAHUB_GMS_URL: '   ' })).toBe(false);
    expect(isDataHubConfigured({ DATAHUB_GMS_URL: 'http://localhost:8080' })).toBe(true);
  });
});
