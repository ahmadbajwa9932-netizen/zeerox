'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { formatPrice } from "@/lib/currency-context";
import { useRouter } from 'next/navigation';
import './general-sale.css';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(raw) {
  if (!raw) return '-';
  const d = new Date(raw);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function lastOfMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function paymentBadge(type) {
  const cls = ['cash', 'card', 'credit', 'advance'].includes(type) ? type : 'cash';
  return <span className={`payment-badge ${cls}`}>{type}</span>;
}

const SEARCH_TYPES = [
  { value: 'voucher',  label: 'Invoice No' },
  { value: 'product',  label: 'Product Name' },
  { value: 'customer', label: 'Customer' },
];

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteModal({ deleteUrl, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);

  async function softDelete() {
    setLoading(true);
    try {
      const res = await apiFetch(`${deleteUrl}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { onSuccess(data.message || 'Sale deleted.'); onClose(); }
      else throw new Error(data.message || 'Delete failed');
    } catch (e) {
      alert(e.message);
    } finally { setLoading(false); }
  }

  async function permanentDelete() {
    if (!confirm('Permanently delete this sale? This cannot be undone.')) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${deleteUrl}?permanent=true`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { onSuccess(data.message || 'Sale deleted.'); onClose(); }
      else throw new Error(data.message || 'Delete failed');
    } catch (e) {
      alert(e.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="delete-modal open" onClick={onClose}>
      <div className="delete-modal-content delete-confirm-modal-content" onClick={e => e.stopPropagation()}>
        <div className="delete-confirm-modal-title">Delete this sale?</div>
        <div className="delete-confirm-modal-text">
          Soft delete can be restored later from Recycle Bin. Permanent delete cannot be undone.
        </div>
        <div className="delete-confirm-modal-actions">
          <button className="delete-confirm-btn delete-confirm-btn-soft" onClick={softDelete} disabled={loading}>
            {loading ? 'Processing…' : 'Soft delete'}
          </button>
          <button className="delete-confirm-btn delete-confirm-btn-permanent" onClick={permanentDelete} disabled={loading}>
            {loading ? 'Processing…' : 'Permanent delete'}
          </button>
        </div>
        <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Restock Delete Modal ─────────────────────────────────────────────────────
function RestockModal({ deleteUrl, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    if (submitted) return;
    setSubmitted(true);
    setLoading(true);
    try {
      const res = await apiFetch(deleteUrl, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { onSuccess(data.message || 'Sale undone.'); onClose(); }
      else throw new Error(data.message || 'Undo failed');
    } catch (e) {
      alert(e.message);
      setSubmitted(false);
    } finally { setLoading(false); }
  }

  return (
    <div className="delete-modal open" onClick={onClose}>
      <div className="delete-modal-content restock-modal-content" onClick={e => e.stopPropagation()}>
        <div className="restock-modal-header">
          <span className="restock-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 0 0 3.54 21H20.46A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <h3>Permanently Undo Sale</h3>
        </div>

        <p className="restock-modal-lead">This action is permanent and cannot be undone.</p>
        <p className="restock-modal-sub">This will:</p>
        <ul className="restock-modal-list">
          <li>Permanently delete this sale record</li>
          <li>Restore product quantities to stock</li>
          <li>Restore any used advance payment</li>
          <li>Reverse any credit balance changes</li>
          <li>Reverse any old balance payments made</li>
          <li>Remove all associated payments</li>
        </ul>
        <p className="restock-warning">Use this only for incorrect sales.</p>

        <div className="restock-modal-actions">
          <button className="btn btn-neutral" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={submit} disabled={loading}>
            {loading ? 'Processing…' : 'Undo This Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sale Items (expandable) ──────────────────────────────────────────────────
function SaleItemsRow({ saleId, items, colSpan }) {
  if (!items || items.length === 0) {
    return (
      <tr className="details-row">
        <td colSpan={colSpan}>
          <div className="details-inner"><p>No items found</p></div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="details-row">
      <td colSpan={colSpan}>
        <div className="details-inner">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Price (per unit)</th>
                <th>Quantity</th>
                <th>Discount</th>
                <th>Tax</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const qtyDisplay = item.type === 'service'
                ? <span style={{ color: '#666' }}>—</span>
                : item.original_quantity;

              let discountDisplay = '—';
              if (parseFloat(item.original_discount_amount) > 0) {
                discountDisplay = item.discount_type === 'percentage'
                  ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.original_discount_amount)})`
                  : formatPrice(item.original_discount_amount);
              }

              let taxDisplay = '—';
              if (parseFloat(item.original_tax_amount) > 0) {
                taxDisplay = item.tax_type === 'percentage'
                  ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.original_tax_amount)})`
                  : formatPrice(item.original_tax_amount);
              }

                return (
                  <tr key={i}>
                    <td style={{padding:10}}>
                      {item.product_name}
                      {item.type === 'service' && (
                        <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>
                      )}
                    </td>
                    <td>{formatPrice(item.price)}</td>
                    <td>{qtyDisplay}</td>
                    <td>{discountDisplay}</td>
                    <td>{taxDisplay}</td>
                    <td>{formatPrice(item.total_after_tax)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function GeneralSalePage() {
  const router = useRouter();
  const { isBlocked } = usePermissions();
  const [sales, setSales] = useState([]);
  const [saleItems, setSaleItems] = useState({});
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);

  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate]     = useState(lastOfMonth());
  const [pendingStart, setPendingStart] = useState(firstOfMonth());
  const [pendingEnd, setPendingEnd]     = useState(lastOfMonth());

  const [searchQuery, setSearchQuery]   = useState('');
  const [searchType, setSearchType]     = useState('voucher');
  const [currentPage, setCurrentPage]   = useState(1);

  const [sortColumn, setSortColumn]       = useState('sales.created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  const [expandedRows, setExpandedRows] = useState({});
  const [highlight, setHighlight]       = useState(null);

  const [deleteModal, setDeleteModal]     = useState(null); // { url }
  const [restockModal, setRestockModal]   = useState(null); // { url }
  const [openDropdown, setOpenDropdown]   = useState(null);
  const [toast, setToast]                 = useState(null); // { msg, type }
  const [paymentType, setPaymentType] = useState('');

  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  // ── read highlight from URL ──────────────────────────
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const h = p.get('highlight');
    if (h) setHighlight(parseInt(h));
  }, []);

  // ── fetch ────────────────────────────────────────────
  const fetchSales = useCallback(async (page, opts = {}) => {
    setLoading(true);
    try {
      const col  = opts.sortColumn    ?? sortColumn;
      const dir  = opts.sortDirection ?? sortDirection;
      const sq   = opts.searchQuery   !== undefined ? opts.searchQuery : searchQuery;
      const st   = opts.searchType    !== undefined ? opts.searchType  : searchType;
      const sd   = opts.startDate     ?? startDate;
      const ed   = opts.endDate       ?? endDate;
      const hl   = page === 1 && !sq ? highlight : null;
      const pt   = opts.paymentType !== undefined ? opts.paymentType : paymentType;

      let url = `/api/sales/general/data?page=${page}&sort_column=${col}&sort_direction=${dir}`;
      if (pt) url += `&filter_payment=${encodeURIComponent(pt)}`;
      if (sd) url += `&start_date=${sd}`;
      if (ed) url += `&end_date=${ed}`;
      if (sq) url += `&search=${encodeURIComponent(sq)}&search_type=${st}`;
      if (hl) url += `&highlight=${hl}`;

      const res  = await apiFetch(url);
      const data = await res.json();
      if (data.success) {
        setSales(data.data);
        setSaleItems(data.saleItems || {});
        setPagination(data.pagination);
        setCurrentPage(data.pagination.current_page);
        if (data.highlightSaleId) {
          setTimeout(() => {
            const row = document.querySelector(`tr[data-sale-id="${data.highlightSaleId}"]`);
            if (row) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => row.classList.remove('highlighted-row'), 4000);
            }
          }, 100);
          setHighlight(null);
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sortColumn, sortDirection, searchQuery, searchType, startDate, endDate, highlight, paymentType]);

  useEffect(() => { fetchSales(1); }, []); // initial load
  

  // ── sort ─────────────────────────────────────────────
  function handleSort(col, dir) {
    setSortColumn(col);
    setSortDirection(dir);
    fetchSales(1, { sortColumn: col, sortDirection: dir });
  }

  // ── date filter ──────────────────────────────────────
  function applyDateFilter() {
    setStartDate(pendingStart);
    setEndDate(pendingEnd);
    fetchSales(1, { startDate: pendingStart, endDate: pendingEnd });
  }

  // ── search ───────────────────────────────────────────
  function handleSearchInput(val) {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchSales(1, { searchQuery: val });
    }, 350);
  }

  function handleSearchTypeChange(val) {
    setSearchType(val);
    if (searchQuery) fetchSales(1, { searchType: val });
  }

  // ── expand row ───────────────────────────────────────
  function toggleRow(id) {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // ── toast ────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

// ── close dropdown on outside click ─────────────────
useEffect(() => {
  function handler(e) {
    if (!e.target.closest('.action-dropdown')) {
      setOpenDropdown(null);
    }
  }
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, []);

  // ── keyboard shortcuts ───────────────────────────────
  useEffect(() => {
    function handler(e) {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ─── sort icon helper ────────────────────────────────
  function SortIcons({ col }) {
    return (
      <span className="sort-icons">
        <span
          className={`sort-up ${sortColumn === col && sortDirection === 'asc' ? 'active' : ''}`}
          onClick={e => { e.stopPropagation(); handleSort(col, 'asc'); }}
        >▲</span>
        <span
          className={`sort-down ${sortColumn === col && sortDirection === 'desc' ? 'active' : ''}`}
          onClick={e => { e.stopPropagation(); handleSort(col, 'desc'); }}
        >▼</span>
      </span>
    );
  }

  // ─── pagination ──────────────────────────────────────
  function Pagination() {
    if (!pagination || pagination.last_page <= 1) return null;
    const { current_page, last_page, on_first_page, has_more_pages } = pagination;

    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);
    const pages = [];
    for (let p = start; p <= end; p++) pages.push(p);

    return (
      <div className="custom-pagination">
        {on_first_page
          ? <span className="disabled">« First</span>
          : <a onClick={() => fetchSales(1)}>« First</a>}
        {on_first_page
          ? <span className="disabled">←</span>
          : <a onClick={() => fetchSales(current_page - 1)}>←</a>}
        {start > 1 && <span className="dots">…</span>}
        {pages.map(p => (
          <span
            key={p}
            className={p === current_page ? 'active' : ''}
            style={p !== current_page ? { cursor: 'pointer' } : {}}
            onClick={() => p !== current_page && fetchSales(p)}
          >{p}</span>
        ))}
        {end < last_page && <span className="dots">…</span>}
        {has_more_pages
          ? <a onClick={() => fetchSales(current_page + 1)}>→</a>
          : <span className="disabled">→</span>}
        {has_more_pages
          ? <a onClick={() => fetchSales(last_page)}>Last »</a>
          : <span className="disabled">Last »</span>}
      </div>
    );
  }

  const colSpan = 10;

  // ─── render ───────────────────────────────────────────
  return (
        <div className="container">

          {/* Header */}
          <div className="main-text"><h1>General Sales</h1></div>
          <div className="sub-text"><p>All-time sales records and history</p></div>

          <div className="sub-container">

            {/* Date Range */}
              {/* Left: Payment type filter */}
              <div className="date-range-container">
              <select
            className="search-type-select"
            style={{ width: 150}}
            value={paymentType}
            onChange={e => {
                setPaymentType(e.target.value);
                fetchSales(1, { paymentType: e.target.value });
            }}
        >
            <option value="">All Payments</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
            <option value="advance">Advance</option>
        </select>
              <div className="date-range">
                <label>From:</label>
                <input
                  type="date"
                  className="date-input"
                  value={pendingStart}
                  onChange={e => setPendingStart(e.target.value)}
                />
                <label>To:</label>
                <input
                  type="date"
                  className="date-input"
                  value={pendingEnd}
                  onChange={e => setPendingEnd(e.target.value)}
                />
                <button className="date-filter-btn" onClick={applyDateFilter}>Search</button>
              </div>
            </div>

            {/* Toolbar */}
              <div className="report-search-container">
                <div className="search-type-wrapper">
                  <span>Search by:</span>
                  <select
                    className="search-type-select"
                    value={searchType}
                    style={{ width: 140, marginRight:'5px' }}
                    onChange={e => handleSearchTypeChange(e.target.value)}
                  >
                    {SEARCH_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="search-container">
                  <input
                    ref={searchRef}
                    type="text"
                    className="input"
                    placeholder="Search… "
                    value={searchQuery}
                    onChange={e => handleSearchInput(e.target.value)}
                  />
                  <span className="icon1">
                  <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none">
                                    <path d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M22 22L20 20" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                  </span>
                </div>
              </div>

            {/* Search results count */}
            {searchQuery && pagination && (
              <div className="search-results-info">
                Found <strong>{pagination.total}</strong> result{pagination.total !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
              </div>
            )}

            {/* Table */}
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="sortable">
                    <div className="sortable-header">
                      <span>Invoice No</span>
                      <SortIcons col="voucher_no" />
                    </div>
                  </th>
                  <th className="sortable">
                    <div className="sortable-header">
                      <span>Sale Date</span>
                      <SortIcons col="sales.sale_date" />
                    </div>
                  </th>
                  <th>Products</th>
                  <th>Total Items</th>
                  <th className="sortable">
                    <div className="sortable-header">
                      <span>Grand Total</span>
                      <SortIcons col="grand_total" />
                    </div>
                  </th>
                  <th className="sortable">
                    <div className="sortable-header">
                      <span>Payment Type</span>
                      <SortIcons col="payment_type" />
                    </div>
                  </th>
                  <th>Seller</th>
                  <th>Customer</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={colSpan}>
                      <div className="loading-spinner">
                        <div className="spinner" />
                        <p>Loading sales…</p>
                      </div>
                    </td>
                  </tr>
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} style={{ textAlign: 'center', padding: 24, color: '#888' }}>
                      No sales found
                    </td>
                  </tr>
                ) : (
                  sales.map((sale, index) => {
                    const rowNum = pagination ? pagination.first_item + index : index + 1;
                    const isExpanded = !!expandedRows[sale.sale_id];
                    const isHighlighted = highlight && highlight === sale.sale_id;
                    const items = saleItems[sale.sale_id] || [];
                    const hasProduct = items.some(i => i.type === 'product');
                    const isCredit = sale.payment_type === 'credit';
                    const canDelete = !(isCredit && ['partial', 'unpaid'].includes(sale.status));
                    return [
                      <tr
                        key={`row-${sale.sale_id}`}
                        data-sale-id={sale.sale_id}
                        className={isHighlighted ? 'highlighted-row' : ''}
                      >
                        <td>{rowNum}</td>
                        <td>
                          <button
                            className="toggle-btn"
                            onClick={() => toggleRow(sale.sale_id)}
                            title={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? '▲' : '▼'}
                          </button>
                          {sale.voucher_no}
                        </td>
                        <td>{formatDate(sale.sale_date)}</td>
                        <td>{sale.products || '—'}</td>
                        <td>{sale.total_items}</td>
                        <td>{formatPrice(sale.grand_total)}</td>
                        <td>{paymentBadge(sale.payment_type)}</td>
                        <td>{sale.seller_name || '—'}</td>
                        <td>{sale.customer_name || 'Walk-in Customer'}</td>
                        <td>
                        <div
                            className="action-dropdown"
                          >
                            <button
                              className="dropdown-toggle"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDropdown(prev => prev === sale.sale_id ? null : sale.sale_id);
                              }}
                            >⋮</button>
                             <div className={`action-dropdown-menu ${openDropdown === sale.sale_id ? 'open' : ''}`}>
                              {/* View Details */}
                              <button onClick={() => {
  setOpenDropdown(null);
  router.push(isCredit
    ? `/sales/credit/details/${sale.voucher_no}`
    : `/sales/detail/${sale.voucher_no}`);
}}>
  View Details
</button>

                              {/* Returns (only if has product and not credit) */}
                              {hasProduct && !isCredit && (
                                <>
                                  {!isBlocked('sales.general.act.full-return') && (
                                    <button onClick={() => {
                                      if (confirm(`Process full return for ${sale.voucher_no}?`)) {
                                        apiFetch(`/api/sales/${sale.sale_id}/full-return`, { method: 'POST' })
                                          .then(r => r.json())
                                          .then(d => {
                                            if (d.success) { showToast(d.message || 'Return processed.'); fetchSales(currentPage); }
                                            else showToast(d.message || 'Failed', 'error');
                                          });
                                      }
                                      setOpenDropdown(null);
                                    }}>Full Return</button>
                                  )}
                                  {!isBlocked('sales.general.act.partial-return') && (
                                    <button onClick={() => {
  setOpenDropdown(null);
  router.push(`/sales/returns/partial-screen/${sale.sale_id}`);
}}>
  Partial Return
</button>
                                  )}
                                </>
                              )}

                              {/* Edit */}
                              {!isBlocked('sales.general.act.edit') && (
                                <button onClick={() => {
                                  setOpenDropdown(null);
                                  if (confirm('Editing will permanently delete the original sale and reload it for editing. Continue?')) {
                                    apiFetch(`/api/sales/${sale.sale_id}/go-to-edit`)
                                      .then(r => r.json())
                                      .then(d => {
                                        if (d.success) {
                                          sessionStorage.setItem('editSaleData', JSON.stringify(d.saleData));
                                          window.location.href = '/sales/create';
                                        } else showToast(d.message || 'Failed to load sale', 'error');
                                      });
                                  }
                                }}>Edit</button>
                              )}

                                                            {/* Print Receipt */}
                                                            {!isBlocked('sales.general.act.print-receipt') && (
                                <button onClick={async () => {
                                  setOpenDropdown(null);
                                  try {
                                    const res = await apiFetch(`/api/sales/${sale.sale_id}/receipt-data`);
                                    const data = await res.json();
                                    if (data.success) {
                                      localStorage.setItem(`receipt:${sale.voucher_no}`, JSON.stringify(data.receipt));
                                      window.open(
                                        `/sales/receipt/printReceipt?voucher=${encodeURIComponent(sale.voucher_no)}`,
                                        'receiptPreview',
                                        'width=800,height=600,menubar=no,toolbar=no,location=no,status=no'
                                      );
                                    } else {
                                      showToast(data.message || 'Receipt not found for this sale.', 'error');
                                    }
                                  } catch (e) {
                                    showToast('Failed to connect to server.', 'error');
                                  }
                                }}>Print Receipt</button>
                              )}

                              {/* Delete */}
                              {canDelete && !isBlocked('sales.general.act.delete') && (
                                <button onClick={() => {
                                  setOpenDropdown(null);
                                  setDeleteModal({ url: `/api/sales/general/${sale.sale_id}/delete` });
                                }}>Delete</button>
                              )}

                              {/* Undo Sale */}
                              {!isBlocked('sales.general.act.undo-sale') && (
                                <button style={{ color: '#dc3545' }} onClick={() => {
                                  setOpenDropdown(null);
                                  setRestockModal({ url: `/api/sales/general/${sale.sale_id}/undo-sale` });
                                }}>Undo Sale</button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>,

                      isExpanded && (
                        <SaleItemsRow
                          key={`details-${sale.sale_id}`}
                          saleId={sale.sale_id}
                          items={items}
                          colSpan={colSpan}
                        />
                      ),
                    ];
                  })
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <Pagination />

          </div>{/* /sub-container */}
      {/* Modals */}
      {deleteModal && (
        <DeleteModal
          deleteUrl={deleteModal.url}
          onClose={() => setDeleteModal(null)}
          onSuccess={msg => { showToast(msg); fetchSales(currentPage); }}
        />
      )}
      {restockModal && (
        <RestockModal
          deleteUrl={restockModal.url}
          onClose={() => setRestockModal(null)}
          onSuccess={msg => { showToast(msg); fetchSales(currentPage); }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`popup ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}