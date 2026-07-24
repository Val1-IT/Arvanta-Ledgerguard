import type { Pool } from 'pg';
import type { InvestigationInput } from '../../engine/types';
import { fetchProducts, fetchProductUnits } from './products';
import { fetchInventoryMovements, fetchInventoryValuations } from './inventory';
import { fetchJournalEntries } from './journals';
import { fetchGrossMarginReports, fetchBaselineSnapshot } from './reports';

/**
 * Assembles InvestigationInput from the live database. Read-only: issues
 * only `select` statements (see the individual fetch* functions), so calling
 * this repeatedly never mutates state and never produces duplicate
 * incident-side data. Any future persistence of investigation runs must be
 * a separate, explicitly-invoked function — not folded into this one.
 */
export async function loadInvestigationInput(pool: Pool): Promise<InvestigationInput> {
  const [products, productUnits, movements, valuations, journalEntries, marginReports, baseline] = await Promise.all([
    fetchProducts(pool),
    fetchProductUnits(pool),
    fetchInventoryMovements(pool),
    fetchInventoryValuations(pool),
    fetchJournalEntries(pool),
    fetchGrossMarginReports(pool),
    fetchBaselineSnapshot(pool)
  ]);

  return { products, productUnits, movements, valuations, journalEntries, marginReports, baseline };
}
