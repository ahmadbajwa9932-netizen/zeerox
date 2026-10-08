'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";
import styles from './partial-return.module.css';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(raw) {
  if (!raw) return '-';
  const d = new Date(raw);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function PartialReturnPage() {
  const router = useRouter();
  const params = useParams();
  const saleId = params.saleId;

  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState(null);
  const [saleItems, setSaleItems] = useState([]);
  const [quantities, setQuantities] = useState({}); // { [itemId]: qty }
  const [errors, setErrors] = useState({});         // { [itemId]: 'Max: x' }
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ─── fetch partial-return data ─────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/sales/${saleId}/partial-return-data`);
        const data = await res.json();
        if (data.success) {
          setSale(data.sale);
          setSaleItems(data.saleItems);
        } else {
          alert(data.message || 'Failed to load sale.');
          router.push('/sales/general');
        }
      } catch (e) {
        console.error(e);
        alert('Failed to load sale.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [saleId]);

  // ─── per-item unit calculations (mirrors blade @php block) ─────
  const itemCalcs = useMemo(() => {
    return saleItems.map((item) => {
      const originalQty = item.original_quantity || 0;

      const unitAfterItemDiscount = originalQty > 0 ? (item.total_after_discount / originalQty) : 0;
      const unitItemDiscount = originalQty > 0 ? (item.discount_amount / originalQty) : 0;
      const unitItemTax = originalQty > 0 ? (item.tax_amount / originalQty) : 0;
      const unitFinalPrice = originalQty > 0 ? (item.total_after_tax / originalQty) : 0;

      return {
        ...item,
        unitAfterItemDiscount,
        unitItemDiscount,
        unitItemTax,
        unitFinalPrice,
      };
    });
  }, [saleItems]);

  // ─── validate + set quantity (mirrors validateAndCalculate()) ──
  function handleQtyChange(itemId, rawValue, maxQty) {
    let value = rawValue;

    if (value === '') {
      setQuantities((prev) => ({ ...prev, [itemId]: '' }));
      setErrors((prev) => ({ ...prev, [itemId]: null }));
      return;
    }

    let qty = parseInt(value, 10);

    if (isNaN(qty)) {
      setQuantities((prev) => ({ ...prev, [itemId]: '' }));
      setErrors((prev) => ({ ...prev, [itemId]: null }));
      return;
    }

    if (qty > maxQty) {
      alert(`Maximum returnable quantity is ${maxQty}. Value has been adjusted.`);
      qty = maxQty;
      setErrors((prev) => ({ ...prev, [itemId]: `Max: ${maxQty}` }));
    } else if (qty < 0) {
      alert('Return quantity cannot be negative.');
      qty = 0;
      setErrors((prev) => ({ ...prev, [itemId]: null }));
    } else {
      setErrors((prev) => ({ ...prev, [itemId]: null }));
    }

    setQuantities((prev) => ({ ...prev, [itemId]: qty }));
  }

  // ─── per-row + summary calculation (mirrors calculateRefund()) ──
  const calc = useMemo(() => {
    const saleSubtotal = parseFloat(sale?.subtotal) || 0;
    const saleGrandTotal = parseFloat(sale?.grand_total) || 0;
    const saleTaxAmount = parseFloat(sale?.tax_amount) || 0;

    // ✅ FIXED: Calculate payment ratio based on AFTER item tax, not subtotal
    const actualPaymentRatio = (saleSubtotal > 0 && saleGrandTotal > 0)
      ? (saleGrandTotal / saleSubtotal)
      : 1;

    let totalItemsSubtotal = 0;
    let totalItemsDiscount = 0;
    let totalAfterItemsDiscount = 0;
    let totalItemsTax = 0;
    let totalAfterItemsTax = 0;
    let totalFinalRefund = 0;

    const rows = {};

    itemCalcs.forEach((item) => {
      const qty = parseInt(quantities[item.id], 10) || 0;

      if (qty > 0) {
        const itemSubtotal = qty * parseFloat(item.price);
        const itemDiscount = qty * item.unitItemDiscount;
        const afterItemDiscount = qty * item.unitAfterItemDiscount;
        const itemTax = qty * item.unitItemTax;
        const afterItemTax = qty * item.unitFinalPrice;

        // ✅ FIXED: Apply sale-level adjustments to afterItemTax (not afterItemDiscount)
        const finalRefundForItem = afterItemTax * actualPaymentRatio;

        rows[item.id] = {
          itemSubtotal,
          itemDiscount,
          afterItemDiscount,
          itemTax,
          afterItemTax,
          finalRefundForItem,
        };

        totalItemsSubtotal += itemSubtotal;
        totalItemsDiscount += itemDiscount;
        totalAfterItemsDiscount += afterItemDiscount;
        totalItemsTax += itemTax;
        totalAfterItemsTax += afterItemTax;
        totalFinalRefund += finalRefundForItem;
      } else {
        rows[item.id] = {
          itemSubtotal: 0, itemDiscount: 0, afterItemDiscount: 0,
          itemTax: 0, afterItemTax: 0, finalRefundForItem: 0,
        };
      }
    });

    // ✅ FIXED: Calculate sale-level adjustments based on afterItemsTax
// Calculate sale-level discount adjustment proportional to discount_amount specifically
    // (not the combined discount+tax ratio, which was double-counting tax's effect here)
    const saleDiscountAmount = parseFloat(sale?.discount_amount) || 0;
    const saleLevelDiscountAdjustment = (saleDiscountAmount > 0 && saleSubtotal > 0)
      ? (totalAfterItemsTax * (saleDiscountAmount / saleSubtotal))
      : 0;

    // ✅ FIXED: Tax adjustment based on proportion of afterItemsTax to sale subtotal
    const saleLevelTaxAdjustment = (saleTaxAmount > 0 && saleSubtotal > 0)
      ? (totalAfterItemsTax * (saleTaxAmount / saleSubtotal))
      : 0;

    return {
      rows,
      totalItemsSubtotal,
      totalItemsDiscount,
      totalAfterItemsDiscount,
      totalItemsTax,
      totalAfterItemsTax,
      saleLevelDiscountAdjustment,
      saleLevelTaxAdjustment,
      totalFinalRefund,
    };
  }, [itemCalcs, quantities, sale]);

  // ─── tax adjustment label (percentage vs amount, mirrors blade) ─
  const taxAdjustmentLabel = useMemo(() => {
    if (!sale) return null;
    if (sale.tax_type === 'percentage') {
      const pct = (sale.subtotal > 0 ? (sale.tax_amount / sale.subtotal) * 100 : 0).toFixed(1);
      return `${pct}%`;
    }
    return null;
  }, [sale]);

  // ─── submit (mirrors form submit + validation) ─────────────────
  async function handleSubmit(e) {
    e.preventDefault();

    const items = {};
    let hasValidReturns = false;
    Object.entries(quantities).forEach(([itemId, qty]) => {
      const q = parseInt(qty, 10) || 0;
      if (q > 0) {
        items[itemId] = q;
        hasValidReturns = true;
      }
    });

    if (!hasValidReturns) {
      alert('Please select at least one item to return.');
      return;
    }

    if (!confirm('Are you sure you want to process this return?')) return;

    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/${saleId}/partial-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, notes }),
      });
      const data = await res.json();
      if (data.success) {
        router.push('/sales/general');
      } else {
        alert(data.message || 'Failed to process return.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to process return.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className={styles['partial-return-container']}>
      <div style={{ textAlign: 'center', padding: 40 }}>Loading…</div>
    </div>
    );
  }

  if (!sale) return null;

  return (
    <div className={styles['partial-return-container']}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Partial Return</h2>
        <div>
          <a
            href="/sales/general"
            id="back-buttons"
            className={styles['boton-elegante']}
            onClick={(e) => { e.preventDefault(); router.push('/sales/general'); }}
          >
            ← Back
          </a>
        </div>
      </div>

      <div className={styles['sale-info']}>
        <p><strong>Invoice No:</strong> {sale.voucher_no}</p>
        <p><strong>Sale Date:</strong> {formatDate(sale.sale_date)}</p>
        <p><strong>Customer:</strong> {sale.customer_name || 'Walk-in Customer'}</p>
      </div>

      <form id="partialReturnForm" onSubmit={handleSubmit}>
      <table className={styles['return-items-table']}>
          <thead>
            <tr style={{color:'#000'}}>
              <th>Product</th>
              <th>Available Qty</th>
              <th>Unit Price</th>
              <th>Return Qty</th>
              <th>Item Subtotal</th>
              <th>Item Discount</th>
              <th>After Item Discount</th>
              <th>Item Tax</th>
              <th>After Item Tax</th>
              <th>Final Refund</th>
            </tr>
          </thead>
          <tbody>
            {itemCalcs.map((item) => {
              const row = calc.rows[item.id] || {
                itemSubtotal: 0, itemDiscount: 0, afterItemDiscount: 0,
                itemTax: 0, afterItemTax: 0, finalRefundForItem: 0,
              };
              const qtyValue = quantities[item.id] ?? '';
              const error = errors[item.id];

              return (
                <tr key={item.id}>
                  <td>
                    {item.purchase?.product_name}
                    {item.returned_quantity > 0 && (
                      <>
                        <br />
                        <small style={{ color: '#888' }}>({item.returned_quantity} already returned)</small>
                      </>
                    )}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{formatPrice(item.price)}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max={item.quantity}
                      placeholder="0"
                      value={qtyValue}
                      style={error ? { borderColor: '#dc3545', backgroundColor: '#ffe6e6' } : {}}
                      onChange={(e) => handleQtyChange(item.id, e.target.value, item.quantity)}
                    />
                    {error && (
                      <div className="qty-error" style={{ color: '#dc3545', fontSize: 11, fontWeight: 'bold', marginTop: 2 }}>
                        {error}
                      </div>
                    )}
                  </td>
                  <td className="item-subtotal">{formatPrice(row.itemSubtotal)}</td>
                  <td className="item-discount">{formatPrice(row.itemDiscount)}</td>
                  <td className="after-item-discount">{formatPrice(row.afterItemDiscount)}</td>
                  <td className="item-tax">{formatPrice(row.itemTax)}</td>
                  <td className="after-item-tax">{formatPrice(row.afterItemTax)}</td>
                  <td className="final-refund">{formatPrice(row.finalRefundForItem)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 20 }}>
          <label htmlFor="return-notes">Notes (Optional):</label>
          <textarea
            id="return-notes"
            name="notes"
            rows={3}
            placeholder="Enter any notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={styles['return-notes-textarea']}
          />
        </div>

        <div className={styles['refund-summary']}>
          <p><strong>Items Subtotal:</strong> <span id="items-subtotal">{formatPrice(calc.totalItemsSubtotal)}</span></p>
          <p><strong>Items Discount:</strong> <span id="items-discount">{formatPrice(calc.totalItemsDiscount)}</span></p>
          <p><strong>After Items Discount:</strong> <span id="after-items-discount">{formatPrice(calc.totalAfterItemsDiscount)}</span></p>
          <p><strong>Items Tax:</strong> <span id="items-tax">{formatPrice(calc.totalItemsTax)}</span></p>
          <p><strong>After Items Tax:</strong> <span id="after-items-tax">{formatPrice(calc.totalAfterItemsTax)}</span></p>
          <p><strong>Sale-Level Discount:</strong> <span id="sale-discount">{formatPrice(Math.abs(calc.saleLevelDiscountAdjustment))}</span></p>
          <p><strong>Sale-Level Tax:</strong> <span id="sale-tax">{formatPrice(Math.abs(calc.saleLevelTaxAdjustment))}</span></p>
          <p style={{marginBottom:'8px'}}>
            <strong>Tax Adjustment:</strong>{' '}
            {sale.tax_type === 'percentage' ? (
              <>{taxAdjustmentLabel} (<span id="tax-adjustment">{formatPrice(Math.abs(calc.saleLevelTaxAdjustment))}</span>)</>
            ) : (
              <span id="tax-adjustment">{formatPrice(Math.abs(calc.saleLevelTaxAdjustment))}</span>
            )}
          </p>
          <hr />
          <div className={styles['refund-total']}>
            <h3>Total Refund Amount: <span id="total-refund">{formatPrice(calc.totalFinalRefund)}</span></h3>
          </div>
        </div>

        <div className={styles['form-actions']}>
          <a
            href="/sales/general"
            className={styles['btn-secondary']}
            onClick={(e) => { e.preventDefault(); router.push('/sales/general'); }}
          >
            Cancel
          </a>
          <button type="submit" className={styles['btn-success']} disabled={submitting}>
            {submitting ? 'Processing…' : 'Process Return'}
          </button>
        </div>
      </form>
    </div>
  );
}