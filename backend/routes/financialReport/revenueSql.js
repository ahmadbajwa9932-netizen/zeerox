/**
 * revenueSql.js
 *
 * The single source of truth for how revenue/tax/cost are computed from
 * sale_items, after everything we fixed in dashboard.js:
 *  - Revenue = sale_items.total_after_discount, with the SALE-level
 *    discount proportionally allocated back per item (item-level discount
 *    is already baked into total_after_discount itself).
 *  - Tax follows the same allocation pattern (item tax + allocated share
 *    of sale-level tax).
 *  - Cost is purchased_price * quantity — item-specific, no allocation.
 *  - Nothing here touches sale_returns. Returns already mutate
 *    sale_items/sales directly (full return deletes the sale; partial
 *    return shrinks the row in place), so these sums are automatically
 *    post-return.
 *
 * Any query that joins `sale_items si` + `sales s` and wants an accurate
 * revenue/tax figure should use DISCOUNT_ALLOC_JOIN + these expressions
 * rather than re-deriving the math.
 */

export const DISCOUNT_ALLOC_JOIN = `
  INNER JOIN (
    SELECT sale_id, SUM(total_after_discount) AS items_sum
    FROM sale_items
    GROUP BY sale_id
  ) sis ON sis.sale_id = si.sale_id
`;

// Post-discount, pre-tax revenue (item-level discount already included in
// total_after_discount; this adds the proportional sale-level discount).
export const REVENUE_EXPR = `(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END))`;

// Item tax + proportional share of sale-level tax.
export const TAX_EXPR = `(si.tax_amount + (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.tax_amount ELSE 0 END))`;

// Pre-discount, pre-tax line total (list price * qty) — the "Gross Sales"
// figure before any discount is subtracted.
export const GROSS_EXPR = `si.total`;

// Item-specific cost, no allocation needed.
export const COST_EXPR = `(si.purchased_price * si.quantity)`;