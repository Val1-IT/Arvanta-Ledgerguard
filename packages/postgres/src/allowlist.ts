export const WRITABLE_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  product_units: new Set(['conversion_factor']),
  inventory_movements: new Set(['base_quantity', 'reversed_at']),
  inventory_valuation: new Set(['quantity_on_hand', 'average_cost', 'inventory_value']),
  gross_margin_report: new Set(['cost_of_goods_sold', 'gross_profit', 'gross_margin_percentage'])
};

export const TOUCH_TIMESTAMP_COLUMN: Readonly<Record<string, string>> = {
  product_units: 'updated_at',
  inventory_valuation: 'calculated_at',
  gross_margin_report: 'generated_at'
};

export function isWritableColumn(table: string, field: string): boolean {
  return WRITABLE_COLUMNS[table]?.has(field) === true;
}
