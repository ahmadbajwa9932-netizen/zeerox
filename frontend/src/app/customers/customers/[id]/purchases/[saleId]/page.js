'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import '../../../customers.css';

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

export default function CustomerSaleDetailPage() {
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
        if (result.success) {
          setData(result.data);
        } else {
          setError(result.message || 'Failed to load sale details.');
        }
      })
      .catch(() => setError('Error loading sale details. Please refresh.'))
      .finally(() => setLoading(false));
  }, [id, saleId]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading-spinner"><div className="spinner" /><p>Loading sale details...</p></div>
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

  const { sale, sale_items: saleItems, payments } = data;

  return (
    <div className="container">
      <div className="container-child main-text">
        <h1>Sale Details - {sale.voucher_no}</h1>
      </div>
      <div className="container-child sub-text">
        <p>Complete summary for {sale.customer?.name || 'this customer'}</p>
        <button type="button" className="boton-elegante" onClick={() => router.back()}>← Back</button>
      </div>

      <div className="sub-container">
        {saleItems.length > 0 && (
          <div className="detail-section" style={{ marginBottom: 10 }}>
            <h3 style={{ marginBottom: 10 }}>Sale Items</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Unit Price</th>
                  <th>Quantity</th>
                  <th>Discount</th>
                  <th>Tax</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {saleItems.map((item, index) => {
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
                      <td>{index + 1}</td>
                      <td>
                        {item.product_name}
                        {item.product_type === 'service' && <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>}
                      </td>
                      <td>{formatPrice(item.price)}</td>
                      <td>{qtyDisplay}</td>
                      <td>{discountDisplay}</td>
                      <td>{taxDisplay}</td>
                      <td><strong>{formatPrice(item.total_after_tax)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
            <Row
              label="Payment Type:"
              value={sale.payment_type.charAt(0).toUpperCase() + sale.payment_type.slice(1)}
            />
            <Row label="Sale Date:" value={formatDate(sale.sale_date)} />
          </div>

          {/* Customer Info */}
          <div className="ledger-panel">
            <h3>Customer Information</h3>
            <Row label="Name:" value={sale.customer?.name || 'Walk-in Customer'} />
            <Row label="Business/Shop Name:" value={sale.customer?.shop_name || 'N/A'} />
            <Row label="Contact:" value={sale.customer?.contact || 'N/A'} />
            <Row label="City:" value={sale.customer?.city || 'N/A'} />
            <Row label="Customer Type:" value={sale.customer?.customer_type || 'Walk-in'} />
          </div>
        </div>

        {/* Payment-type-specific box — special treatment */}
        {data.is_advance_sale && (
          <div className="ledger-card ledger-card--advance">
            <div className="ledger-card__accent" />
            <div className="ledger-card__header">
              <span className="ledger-card__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="2.5" y="6" width="19" height="13" rx="2" />
                  <path d="M2.5 10h19" />
                  <circle cx="17" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <div>
                <p className="ledger-card__eyebrow">Advance Account</p>
                <h3 className="ledger-card__title">Advance Payment Details</h3>
              </div>
            </div>

            <div className="ledger-card__body">
              <Row label="Previous Advance Balance:" value={formatPrice(data.previous_advance)} mono />
              <Row label="Advance Used in This Sale:" value={`− ${formatPrice(data.advance_used)}`} mono muted />
            </div>

            <div className="ledger-card__total">
              <span>Remaining Advance Balance</span>
              <strong>{formatPrice(data.remaining_advance)}</strong>
            </div>
          </div>
        )}

        {data.is_credit_sale && (
          <div className="ledger-card ledger-card--credit">
            <div className="ledger-card__accent" />
            <div className="ledger-card__header">
              <span className="ledger-card__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 12h18" />
                  <path d="M3 6h18v12H3z" />
                  <path d="M7 16h4" />
                </svg>
              </span>
              <div>
                <p className="ledger-card__eyebrow">Credit Account</p>
                <h3 className="ledger-card__title">Credit Status</h3>
              </div>
              <span
                className={`ledger-badge ${
                  data.is_fully_paid ? 'ledger-badge--success'
                    : data.total_paid > 0 ? 'ledger-badge--warning'
                    : 'ledger-badge--danger'
                }`}
              >
                <i />
                {data.is_fully_paid ? 'Fully Paid' : data.total_paid > 0 ? 'Partially Paid' : 'Pending'}
              </span>
            </div>

            <div className="ledger-card__body">
              <Row label="Total Credit Amount:" value={formatPrice(sale.grand_total)} mono />
              <Row label="Amount Paid:" value={formatPrice(data.total_paid)} mono />
            </div>

            <div className="ledger-card__total">
              <span>Remaining Balance</span>
              <strong className={data.remaining_balance > 0 ? 'is-due' : 'is-clear'}>
                {formatPrice(data.remaining_balance)}
              </strong>
            </div>
          </div>
        )}

        {payments.length > 0 && (
          <div className="detail-section" style={{ marginTop: 10 }}>
            <h3 style={{ marginBottom: 10 }}>Payments</h3>
            <table className="table">
              <thead>
                <tr><th>Amount</th><th>Method</th><th>Payment Date</th></tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatPrice(payment.amount)}</td>
                    <td>{payment.method}</td>
                    <td>{formatDate(payment.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        .ledger-card--credit .ledger-card__accent { background: linear-gradient(90deg, #7c5a2c, #c79a5f); }

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
        }
        .ledger-card--advance .ledger-card__icon { color: #33406e; background: #eef0f7; }
        .ledger-card--credit .ledger-card__icon { color: #7c5a2c; background: #f7f0e4; }

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
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .ledger-badge i {
          width: 6px; height: 6px;
          border-radius: 50%;
          display: inline-block;
        }
        .ledger-badge--success { background: #e9f3ec; color: #1f6b45; }
        .ledger-badge--success i { background: #1f6b45; }
        .ledger-badge--warning { background: #f8f0df; color: #8a5c14; }
        .ledger-badge--warning i { background: #8a5c14; }
        .ledger-badge--danger { background: #f6eaea; color: #9a3b34; }
        .ledger-badge--danger i { background: #9a3b34; }

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
        .ledger-card__total strong.is-due { color: #9a3b34; }
        .ledger-card__total strong.is-clear { color: #1f6b45; }
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