import { describe, expect, it } from 'vitest';
import { urnDisplayLabel, urnShortDatasetName } from '../../../src/ui/lib/urn';

describe('urnDisplayLabel', () => {
  it('renders dataset URN as short table name', () => {
    expect(
      urnDisplayLabel(
        'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.product_units,PROD)'
      )
    ).toBe('product_units');
  });

  it('renders corp group URN as friendly label', () => {
    expect(urnDisplayLabel('urn:li:corpGroup:finance-controller')).toBe('finance controller');
  });

  it('renders glossary and tag URNs', () => {
    expect(urnDisplayLabel('urn:li:glossaryTerm:InventoryValuation')).toBe('Inventory Valuation');
    expect(urnDisplayLabel('urn:li:tag:At Risk')).toBe('At Risk');
  });

  it('keeps raw non-URN text', () => {
    expect(urnDisplayLabel('inventory_valuation')).toBe('inventory_valuation');
  });

  it('urnShortDatasetName matches table segment', () => {
    expect(
      urnShortDatasetName(
        'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.gross_margin_report,PROD)'
      )
    ).toBe('gross_margin_report');
  });
});
