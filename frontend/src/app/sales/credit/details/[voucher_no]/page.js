'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CheckCircle, Clock, DollarSign, CreditCard } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import './credit-sale-detail.css';
import styles from './credit-sale-detail.module.css';

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

export default function CreditSaleDetailPage() {
  const router = useRouter();
  const { voucher_no } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sale, setSale] = useState(null);
  const [totalPaid, setTotalPaid] = useState(0);
  const [remainingBalance, setRemainingBalance] = useState(0);
  const [isFullyPaid, setIsFullyPaid] = useState(false);

  useEffect(() => {
    if (!voucher_no) return;
    apiFetch(`/api/credit-sales/details/${voucher_no}/data`, {
      headers: { 'Accept': 'application/json' }
    })
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setSale(result.data.sale);
          setTotalPaid(result.data.total_paid);
          setRemainingBalance(result.data.remaining_balance);
          setIsFullyPaid(result.data.is_fully_paid);
        } else {
          setError('Failed to load credit sale details.');
        }
      })
      .catch(() => setError('Error loading credit sale details. Please refresh.'))
      .finally(() => setLoading(false));
  }, [voucher_no]);

  if (loading) {
    return (
      <div className="container">
        <div className="loading-spinner"><div className="spinner" /><p>Loading credit sale details...</p></div>
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

  return (
    <div className="container">
      <div className="container-child main-text">
        <h1>Credit Sale Details - {sale.voucher_no}</h1>
        <span className={`${styles.ledgerBadge} ${styles.ledgerBadgeWarning}`} style={{ marginTop: 6 }}>
          <i />
          Credit Sale Transaction
        </span>
      </div>
      <div className="container-child sub-text">
        <p>Complete summary and customer details for credit sale</p>
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
              {sale.saleItems && sale.saleItems.length > 0 ? (
                sale.saleItems.map((item, index) => {
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

        <div className={styles.ledgerGrid}>
          {/* Sale Summary */}
          <div className={styles.ledgerPanel}>
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
            <Row label="Payment Type:" value={sale.payment_type.charAt(0).toUpperCase() + sale.payment_type.slice(1)} />
            <Row label="Sale Date:" value={formatDate(sale.sale_date)} />
            {sale.notes && <Row label="Notes:" value={sale.notes} />}
          </div>

          {/* Customer Info */}
          <div className={styles.ledgerPanel}>
            <h3>Customer Information</h3>
            <Row label="Customer Name:" value={sale.customer?.name || 'N/A'} />
            <Row label="Business/Shop Name:" value={sale.customer?.shop_name || 'N/A'} />
            <Row label="Contact:" value={sale.customer?.contact || 'N/A'} />
            <Row label="City:" value={sale.customer?.city || 'N/A'} />
            <Row label="Customer Type:" value={sale.customer?.customer_type || 'Regular'} />
          </div>
        </div>

        {/* Credit Status */}
        <div className={`${styles.ledgerCard} ${styles.ledgerCardCredit}`}>
          <div className={styles.ledgerCardAccent} />
          <div className={styles.ledgerCardHeader}>
            <span className={styles.ledgerCardIcon}>
              <CreditCard size={18} />
            </span>
            <div>
              <p className={styles.ledgerCardEyebrow}>Credit Account</p>
              <h3 className={styles.ledgerCardTitle}>Credit Status</h3>
            </div>
            <span
              className={`${styles.ledgerBadge} ${
                isFullyPaid ? styles.ledgerBadgeSuccess
                  : totalPaid > 0 ? styles.ledgerBadgeWarning
                  : styles.ledgerBadgeDanger
              }`}
            >
              {isFullyPaid ? <CheckCircle size={12} /> : totalPaid > 0 ? <DollarSign size={12} /> : <Clock size={12} />}
              {isFullyPaid ? 'Fully Paid' : totalPaid > 0 ? 'Partially Paid' : 'Pending'}
            </span>
          </div>

          <div className={styles.ledgerCardBody}>
            <Row label="Total Credit Amount:" value={formatPrice(sale.grand_total)} mono />
            <Row label="Amount Paid:" value={formatPrice(totalPaid)} mono />
          </div>

          <div className={styles.ledgerCardTotal}>
            <span>Remaining Balance</span>
            <strong className={remainingBalance > 0 ? styles.isDue : styles.isClear}>
              {formatPrice(remainingBalance)}
            </strong>
          </div>

          {sale.payments && sale.payments.length > 0 && (
           <div className={styles.ledgerHistory}>
              <p className={styles.ledgerHistoryLabel}>Payment History</p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Payment Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.payments.map((payment, index) => (
                    <tr key={index}>
                      <td>{formatPrice(payment.amount)}</td>
                      <td>{payment.method.charAt(0).toUpperCase() + payment.method.slice(1)}</td>
                      <td>{formatDate(payment.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <div
      className="detail-row"
      style={mono ? { fontFamily: "'IBM Plex Mono','Courier New',monospace" } : undefined}
    >
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}