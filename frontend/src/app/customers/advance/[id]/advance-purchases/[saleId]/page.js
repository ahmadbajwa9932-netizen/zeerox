'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import '../../../../customers/customers.css';


function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
}

export default function CustomerAdvanceSaleDetailPage() {
  const router = useRouter();
  const { id, saleId } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!saleId) return;
    apiFetch(`/api/customers/${id}/sales/${saleId}/data`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          setError(result.message || 'Failed to load advance sale details.');
          return;
        }
        if (result.data.sale.payment_type !== 'advance') {
          setError('This sale is not an advance sale.');
          return;
        }
        setData(result.data);
      })
      .catch(() => setError('Error loading advance sale details. Please refresh.'))
      .finally(() => setLoading(false));
  }, [id, saleId]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading-spinner"><div className="spinner" /><p>Loading advance sale details...</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <p style={{ color: 'red' }}>{error}</p>
      </div>
    );
  }

  const { sale, sale_items: saleItems, payments, previous_advance: previousAdvance, advance_used: advanceUsed, remaining_advance: remainingAdvance } = data;

  return (
    <div className="container">
      <div className="container-child main-text">
        <h1>Advance Sale Details - {sale.voucher_no}</h1>
        <span className="ledger-badge ledger-badge--advance" style={{ marginTop: 6 }}>
          <Wallet size={12} />
          Advance Sale Transaction
        </span>
      </div>
      <div className="container-child sub-text">
        <p>Complete summary for {sale.customer?.name || 'this customer'}</p>
        <button onClick={() => router.back()} className="boton-elegante">← Back</button>
      </div>

      <div className="sub-container">
        {/* Sale Items */}
        <div className="detail-section" style={{ marginBottom: 10 }}>
          <h3>Sale Items</h3>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Unit Price</th>
                <th>Quantity</th>
                <th>Discount</th>
                <th>Tax</th>
                <th>Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {saleItems.length > 0 ? (
                saleItems.map((item, index) => {
                  const qtyDisplay = item.product_type === 'service' ? '-' : item.quantity;

                  let discountDisplay = '-';
                  if (parseFloat(item.discount_amount) > 0) {
                    discountDisplay = item.discount_type === 'percentage'
                      ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.discount_amount)})`
                      : formatPrice(item.discount_amount);
                  }

                  let taxDisplay = '-';
                  if (parseFloat(item.tax_amount) > 0) {
                    taxDisplay = item.tax_type === 'percentage'
                      ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.tax_amount)})`
                      : formatPrice(item.tax_amount);
                  }

                  return (
                    <tr key={item.id}>
                      <td style={{ padding: 10 }}>{index + 1}</td>
                      <td>
                        {item.product_name}
                        {item.product_type === 'service' && <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>}
                      </td>
                      <td>{formatPrice(item.price)}</td>
                      <td>{qtyDisplay}</td>
                      <td>{discountDisplay}</td>
                      <td>{taxDisplay}</td>
                      <td>{formatPrice(item.total_after_tax)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={7}>No items found.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="ledger-grid">
          {/* Sale Summary */}
          <div className="ledger-panel">
            <h3>Sale Summary</h3>
            <Row label="Subtotal:" value={formatPrice(sale.subtotal)} />
            <Row
              label="Discount:"
              value={
                sale.discount_type === 'percentage'
                  ? `${parseFloat(sale.discount).toFixed(0)}% (${formatPrice(sale.discount_amount)})`
                  : formatPrice(sale.discount_amount)
              }
            />
            <Row
              label="Tax:"
              value={
                sale.tax_type === 'percentage'
                  ? `${parseFloat(sale.tax).toFixed(0)}% (${formatPrice(sale.tax_amount)})`
                  : formatPrice(sale.tax_amount)
              }
            />
            <Row label="Grand Total:" value={<strong>{formatPrice(sale.grand_total)}</strong>} />
            <Row label="Received Amount:" value={formatPrice(sale.received_amount)} />
            <Row label="Change:" value={formatPrice(sale.change_amount)} />
            <Row label="Payment Type:" value={sale.payment_type.charAt(0).toUpperCase() + sale.payment_type.slice(1)} />
            <Row label="Sale Date:" value={formatDate(sale.sale_date)} />
            {sale.notes && <Row label="Notes:" value={sale.notes} />}
          </div>

          {/* Customer Info */}
          <div className="ledger-panel">
            <h3>Customer Information</h3>
            <Row label="Customer Name:" value={sale.customer?.name || 'N/A'} />
            <Row label="Business/Shop Name:" value={sale.customer?.shop_name || 'N/A'} />
            <Row label="Contact:" value={sale.customer?.contact || 'N/A'} />
            <Row label="City:" value={sale.customer?.city || 'N/A'} />
            <Row label="Customer Type:" value={sale.customer?.customer_type || 'Regular'} />
          </div>
        </div>

        {/* Advance Payment Details — special treatment */}
        <div className="ledger-card ledger-card--advance">
          <div className="ledger-card__accent" />
          <div className="ledger-card__header">
            <span className="ledger-card__icon">
              <Wallet size={18} />
            </span>
            <div>
              <p className="ledger-card__eyebrow">Advance Account</p>
              <h3 className="ledger-card__title">Advance Payment Details</h3>
            </div>
          </div>

          <div className="ledger-card__body">
            <Row label="Previous Advance Balance:" value={formatPrice(previousAdvance)} mono />
            <Row label="Advance Used in This Sale:" value={`− ${formatPrice(advanceUsed)}`} mono muted />
          </div>

          <div className="ledger-card__total">
            <span>Remaining Advance Balance</span>
            <strong className="is-clear">{formatPrice(remainingAdvance)}</strong>
          </div>

          {payments.length > 0 && (
            <div className="ledger-history">
              <p className="ledger-history__label">Payment History</p>
              {payments.map((payment) => (
                <div key={payment.id} className="ledger-history__row">
                  <span>{formatDate(payment.payment_date)}</span>
                  <span className="ledger-history__amount">
                    {formatPrice(payment.amount)}
                    <em>{payment.method.charAt(0).toUpperCase() + payment.method.slice(1)}</em>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .ledger-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (max-width: 780px) {
          .ledger-grid { grid-template-columns: 1fr; }
        }

        .ledger-panel {
          background: #ffffff;
          border: 1px solid #e5e0d8;
          border-radius: 10px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04);
        }
        .ledger-panel h3 {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 600;
          color: #23201c;
          padding-bottom: 8px;
          border-bottom: 1px solid #f0ece3;
        }
        .ledger-panel :global(.detail-row) {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          padding: 5px 0;
          font-size: 13px;
        }
        .ledger-panel :global(.detail-label) {
          color: #6b665c;
          flex-shrink: 0;
        }
        .ledger-panel :global(.detail-value) {
          color: #23201c;
          text-align: right;
        }

        .ledger-card {
          position: relative;
          background: #ffffff;
          border: 1px solid #e5e0d8;
          border-radius: 10px;
          overflow: hidden;
          margin-top: 14px;
          box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04);
        }

        .ledger-card__accent {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
        }
        .ledger-card--advance .ledger-card__accent { background: linear-gradient(90deg, #33406e, #6b7db8); }

        .ledger-card__header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 18px 12px;
          border-bottom: 1px solid #eee6d8;
        }

        .ledger-card__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          flex-shrink: 0;
          color: #33406e;
          background: #eef0f7;
        }

        .ledger-card__eyebrow {
          margin: 0 0 2px;
          font-size: 10.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8a8478;
          font-weight: 600;
        }
        .ledger-card__title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          color: #23201c;
        }

        .ledger-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .ledger-badge--advance { background: #eef0f7; color: #33406e; }

        .ledger-card__body {
          padding: 12px 18px 4px;
        }
        .ledger-card__body :global(.detail-row) {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
          padding: 7px 0;
        }
        .ledger-card__body :global(.detail-label) {
          font-size: 13.5px;
          font-weight: 700;
          color: #45403a;
        }
        .ledger-card__body :global(.detail-value) {
          font-size: 15px;
          font-weight: 700;
          color: #23201c;
        }

        .ledger-card__total {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin: 6px 18px 16px;
          padding-top: 10px;
          border-top: 2px double #d8d0c2;
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
        }
        .ledger-card__total span {
          font-size: 12px;
          color: #6b665c;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ledger-card__total strong {
          font-size: 19px;
          font-weight: 700;
          color: #23201c;
        }
        .ledger-card__total strong.is-clear { color: #1f6b45; }

        .ledger-history {
          padding: 14px 18px 18px;
          border-top: 1px solid #eee6d8;
        }
        .ledger-history__label {
          margin: 0 0 8px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #8a8478;
        }
        .ledger-history__row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          padding: 6px 0;
          border-bottom: 1px dashed #f0ece3;
        }
        .ledger-history__row:last-child { border-bottom: none; }
        .ledger-history__amount {
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
          font-weight: 600;
          color: #1f6b45;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ledger-history__amount em {
          font-style: normal;
          font-size: 10.5px;
          font-weight: 500;
          color: #8a8478;
          background: #f4f1ea;
          padding: 2px 6px;
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}

function Row({ label, value, mono = false, muted = false }) {
  return (
    <div
      className="detail-row"
      style={mono ? { fontFamily: "'IBM Plex Mono','Courier New',monospace" } : undefined}
    >
      <span className="detail-label" style={muted ? { color: '#9a938a' } : undefined}>{label}</span>
      <span className="detail-value" style={muted ? { color: '#9a938a' } : undefined}>{value}</span>
    </div>
  );
}