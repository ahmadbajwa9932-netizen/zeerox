'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import styles from './account-ledger.module.css';

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';
  const day = String(date.getDate()).padStart(2, '0');
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'N/A');

// "10% (Rs 50)" for percentage, plain amount for fixed, "-" when nothing applied
function percentOrAmount(type, value, amount) {
  if (!(parseFloat(amount) > 0)) return '-';
  return type === 'percentage'
    ? `${parseFloat(value).toFixed(0)}% (${formatPrice(amount)})`
    : formatPrice(amount);
}

const TYPE_ACCENT = {
  cash: styles.typeCash,
  card: styles.typeCard,
  credit: styles.typeCredit,
  advance: styles.typeAdvance,
};

export default function AccountLedgerPage() {
  const { id } = useParams();
  const router = useRouter();
  const didInit = useRef(false);
  const searchTimeout = useRef(null);
  const requestId = useRef(0);

  const [customer, setCustomer] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sales, setSales] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [paymentType, setPaymentType] = useState('all');

  const loadLedger = useCallback(async (page, overrides = {}) => {
    // Ignore responses from older requests (fast typing / quick filter changes)
    const reqId = ++requestId.current;
    setLoading(true);
    setError(null);

    const sq = overrides.searchQuery ?? searchQuery;
    const pt = overrides.paymentType ?? paymentType;

    const params = new URLSearchParams();
    params.set('page', page);
    if (sq.trim()) params.set('search', sq.trim());
    if (pt && pt !== 'all') params.set('payment_type', pt);

    try {
      const res = await apiFetch(`/api/customers/${id}/ledger-details?${params.toString()}`);
      const data = await res.json();
      if (reqId !== requestId.current) return;

      if (data.success) {
        setCustomer(data.customer);
        setSummary(data.summary);
        setSales(data.data);
        setPagination(data.pagination);
      } else {
        setError(data.message || 'Failed to load account ledger.');
        setSales([]);
      }
    } catch (err) {
      if (reqId !== requestId.current) return;
      console.error('Error:', err);
      setError('Error loading account ledger. Please refresh.');
      setSales([]);
    } finally {
      if (reqId === requestId.current) setLoading(false);
    }
  }, [id, searchQuery, paymentType]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    loadLedger(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('ledgerSearchInput')?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSearchInput = (value) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadLedger(1, { searchQuery: value });
    }, 300);
  };

  const handlePaymentTypeChange = (value) => {
    setPaymentType(value);
    loadLedger(1, { paymentType: value });
  };

  const goToPage = (page) => {
    loadLedger(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isFiltered = paymentType !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="container">
      <div className="container-child main-text">
        <h1>Account Ledger Details</h1>
      </div>
      <div className="container-child sub-text">
        <p>
          {customer
            ? `${customer.name || 'Walk-in Customer'} • ${customer.shop_name || 'N/A'} • ${customer.contact || 'N/A'} • ${customer.city || 'N/A'}`
            : 'All invoices of this customer'}
        </p>
        <button type="button" className="boton-elegante" onClick={() => router.push('/customers/customers')}>
          ← Back
        </button>
      </div>

      {/* Summary */}
      <div className={styles.summaryGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Invoices</span>
          <span className={styles.statValue}>{summary ? summary.total_invoices : '—'}</span>
          <span className={styles.statHint}>{isFiltered ? 'Matching filters' : 'All time'}</span>
        </div>
        <div className={`${styles.statCard} ${styles.statAmount}`}>
          <span className={styles.statLabel}>Total Purchases</span>
          <span className={styles.statValue}>{summary ? formatPrice(summary.total_amount) : '—'}</span>
          <span className={styles.statHint}>{isFiltered ? 'Matching filters' : 'All time'}</span>
        </div>
        <div className={`${styles.statCard} ${styles.statCredit}`}>
          <span className={styles.statLabel}>Credit Balance</span>
          <span className={styles.statValue}>{summary ? formatPrice(summary.credit_balance) : '—'}</span>
          <span className={styles.statHint}>Outstanding</span>
        </div>
        <div className={`${styles.statCard} ${styles.statAdvance}`}>
          <span className={styles.statLabel}>Advance Balance</span>
          <span className={styles.statValue}>{summary ? formatPrice(summary.advance_balance) : '—'}</span>
          <span className={styles.statHint}>Available</span>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={paymentType}
          onChange={(e) => handlePaymentTypeChange(e.target.value)}
        >
          <option value="all">All Payments</option>
          <option value="card">Card</option>
          <option value="credit">Credit</option>
          <option value="cash">Cash</option>
          <option value="advance">Advance</option>
        </select>

        <div className={styles.searchBox}>
          <input
            type="text"
            id="ledgerSearchInput"
            className={styles.searchInput}
            placeholder="Search by invoice no... (F2)"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
          <i className={`fa fa-search ${styles.searchIcon}`} />
        </div>
      </div>

      {pagination && pagination.total > 0 && !loading && (
        <p className={styles.resultInfo}>
          Showing <strong>{pagination.first_item}–{pagination.last_item}</strong> of{' '}
          <strong>{pagination.total}</strong> invoice{pagination.total !== 1 ? 's' : ''}
        </p>
      )}

      {/* Invoices */}
      {loading ? (
        <div className={styles.stateBox}>
          <div className="loading-spinner"><div className="spinner" /><p>Loading invoices...</p></div>
        </div>
      ) : error ? (
        <div className={`${styles.stateBox} ${styles.stateError}`}>{error}</div>
      ) : sales.length === 0 ? (
        <div className={styles.stateBox}>
          <i className="fa fa-file-invoice" />
          <p>{isFiltered ? 'No invoices match your filters.' : 'This customer has no invoices yet.'}</p>
        </div>
      ) : (
        <div className={styles.invoiceList}>
          {sales.map((sale, index) => (
            <InvoiceCard key={sale.id} sale={sale} index={pagination.first_item + index} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.last_page > 1 && !loading && (
        <div className="custom-pagination">
          {pagination.on_first_page ? (
            <><span className="disabled">« First</span><span className="disabled">←</span></>
          ) : (
            <><a onClick={() => goToPage(1)}>« First</a><a onClick={() => goToPage(pagination.current_page - 1)}>←</a></>
          )}
          {Math.max(pagination.current_page - 2, 1) > 1 && <span className="dots">...</span>}
          {Array.from(
            { length: Math.min(pagination.current_page + 2, pagination.last_page) - Math.max(pagination.current_page - 2, 1) + 1 },
            (_, i) => Math.max(pagination.current_page - 2, 1) + i
          ).map((p) =>
            p === pagination.current_page
              ? <span key={p} className="active">{p}</span>
              : <a key={p} onClick={() => goToPage(p)}>{p}</a>
          )}
          {Math.min(pagination.current_page + 2, pagination.last_page) < pagination.last_page && <span className="dots">...</span>}
          {pagination.has_more_pages ? (
            <><a onClick={() => goToPage(pagination.current_page + 1)}>→</a><a onClick={() => goToPage(pagination.last_page)}>Last »</a></>
          ) : (
            <><span className="disabled">→</span><span className="disabled">Last »</span></>
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceCard({ sale, index }) {
  const credit = sale.credit;
  const advance = sale.advance;

  let creditStatus = null;
  if (credit) {
    creditStatus = credit.is_fully_paid
      ? { label: 'Fully Paid', cls: styles.badgeSuccess }
      : credit.total_paid > 0
        ? { label: 'Partially Paid', cls: styles.badgeWarning }
        : { label: 'Pending', cls: styles.badgeDanger };
  }

  return (
    <article className={`${styles.invoice} ${TYPE_ACCENT[sale.payment_type] || ''}`}>
      {/* Head */}
      <header className={styles.invoiceHead}>
        <div className={styles.invoiceId}>
          <span className={styles.invoiceIndex}>#{index}</span>
          <h3 className={styles.invoiceNo}>{sale.voucher_no}</h3>
          <span className={styles.typeBadge}>{capitalize(sale.payment_type)}</span>
          {creditStatus && (
            <span className={`${styles.statusBadge} ${creditStatus.cls}`}><i />{creditStatus.label}</span>
          )}
        </div>
        <div className={styles.invoiceAmount}>
          <span className={styles.invoiceAmountLabel}>Grand Total</span>
          <span className={styles.invoiceAmountValue}>{formatPrice(sale.grand_total)}</span>
        </div>
      </header>

      <div className={styles.metaRow}>
        <span><i className="fa fa-calendar-alt" /> {formatDateTime(sale.sale_date)}</span>
        <span><i className="fa fa-user" /> Seller: <strong>{sale.seller_name || 'N/A'}</strong></span>
        <span><i className="fa fa-info-circle" /> Status: <strong>{capitalize(sale.status)}</strong></span>
      </div>

      <div className={styles.invoiceBody}>
        {/* Items */}
        <h4 className={styles.sectionTitle}>Items ({sale.items.length})</h4>
        {sale.items.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.itemsTable}>
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
                {sale.items.map((item, i) => (
                  <tr key={item.id}>
                    <td>{i + 1}</td>
                    <td className={styles.productCell}>
                      {item.product_name}
                      {item.product_type === 'service' && <span className={styles.serviceTag}> (Service)</span>}
                    </td>
                    <td>{formatPrice(item.price)}</td>
                    <td>{item.product_type === 'service' ? '-' : item.quantity}</td>
                    <td>{percentOrAmount(item.discount_type, item.discount_value, item.discount_amount)}</td>
                    <td>{percentOrAmount(item.tax_type, item.tax_value, item.tax_amount)}</td>
                    <td><strong>{formatPrice(item.total_after_tax)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>No items found for this invoice.</p>
        )}

        {/* Summary + payment-type box + payments */}
        <div className={styles.footGrid}>
          <div className={styles.box}>
            <h4 className={styles.boxTitle}>Invoice Summary</h4>
            <Row label="Subtotal" value={formatPrice(sale.subtotal)} />
            <Row label="Discount" value={percentOrAmount(sale.discount_type, sale.discount, sale.discount_amount)} />
            <Row label="Tax" value={percentOrAmount(sale.tax_type, sale.tax, sale.tax_amount)} />
            <Row label="Received" value={formatPrice(sale.received_amount)} />
            <Row label="Change" value={formatPrice(sale.change_amount)} />
            <Row label="Grand Total" value={formatPrice(sale.grand_total)} total />
          </div>

          {credit && (
            <div className={`${styles.box} ${styles.boxCredit}`}>
              <h4 className={styles.boxTitle}>Credit Status</h4>
              <Row label="Total Credit Amount" value={formatPrice(sale.grand_total)} />
              <Row label="Amount Paid" value={formatPrice(credit.total_paid)} />
              <Row
                label="Remaining Balance"
                value={formatPrice(credit.remaining_balance)}
                total
                valueClass={credit.remaining_balance > 0 ? styles.due : styles.clear}
              />
            </div>
          )}

          {advance && (
            <div className={`${styles.box} ${styles.boxAdvance}`}>
              <h4 className={styles.boxTitle}>Advance Payment</h4>
              <Row label="Previous Advance Balance" value={formatPrice(advance.previous_advance)} />
              <Row label="Advance Used" value={`− ${formatPrice(advance.advance_used)}`} valueClass={styles.muted} />
              <Row label="Remaining Advance" value={formatPrice(advance.remaining_advance)} total />
            </div>
          )}

          {sale.payments.length > 0 && (
            <div className={styles.box}>
              <h4 className={styles.boxTitle}>Payments ({sale.payments.length})</h4>
              <ul className={styles.paymentList}>
                {sale.payments.map((p) => (
                  <li key={p.id}>
                    <div>
                      <span className={styles.paymentMethod}>{capitalize(p.method)}</span>
                      <span className={styles.paymentDate}>{formatDateTime(p.payment_date)}</span>
                    </div>
                    <strong>{formatPrice(p.amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function Row({ label, value, total = false, valueClass = '' }) {
  return (
    <div className={`${styles.row} ${total ? styles.rowTotal : ''}`}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${valueClass}`}>{value}</span>
    </div>
  );
}
