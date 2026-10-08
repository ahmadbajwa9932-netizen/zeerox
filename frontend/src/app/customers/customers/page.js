'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API, apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import './customers.css';

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CustomersPage() {
  const router = useRouter();
  const { isBlocked } = usePermissions();
  const didInit = useRef(false);
  const searchTimeout = useRef(null);

  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const [customers, setCustomers] = useState([]);
  const [salesBreakdown, setSalesBreakdown] = useState({});
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading customers...');

  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('customer');
  const [customerType, setCustomerType] = useState('all');
  const [startDate, setStartDate] = useState(formatDate(firstDay));
  const [endDate, setEndDate] = useState(formatDate(lastDay));

  const [openDetails, setOpenDetails] = useState(new Set());
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // full customer object

  const loadCustomers = useCallback(async (page, overrides = {}) => {
    setLoading(true);
    setLoadingMessage(overrides.searching ? 'Searching...' : 'Loading Data. It may take some minutes...');

    const sc = overrides.sortColumn ?? sortColumn;
    const sd = overrides.sortDirection ?? sortDirection;
    const sq = overrides.searchQuery ?? searchQuery;
    const st = overrides.searchType ?? searchType;
    const ct = overrides.customerType ?? customerType;
    const sdate = overrides.startDate ?? startDate;
    const edate = overrides.endDate ?? endDate;

    const params = new URLSearchParams();
    params.set('page', page);
    params.set('sort_column', sc);
    params.set('sort_direction', sd);
    if (sq) {
      params.set('search', sq);
      params.set('search_type', st);
    }
    if (ct && ct !== 'all') params.set('customer_type', ct);
    if (sdate) params.set('start_date', sdate);
    if (edate) params.set('end_date', edate);

    try {
      const res = await apiFetch(`/api/customers/data?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setCustomers(data.data);
        setSalesBreakdown(data.salesBreakdown);
        setPagination(data.pagination);
        setCurrentPage(page);
      } else {
        setCustomers([]);
      }
    } catch (err) {
      console.error('Error:', err);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [sortColumn, sortDirection, searchQuery, searchType, customerType, startDate, endDate]);

  // Guarded against double-invoke on mount
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    loadCustomers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSort = (column, direction) => {
    setSortColumn(column);
    setSortDirection(direction);
    loadCustomers(1, { sortColumn: column, sortDirection: direction });
  };

  const handleSearchInput = (value) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadCustomers(1, { searchQuery: value, searching: !!value });
    }, 100);
  };

  const handleSearchTypeChange = (value) => {
    setSearchType(value);
    if (searchQuery) loadCustomers(1, { searchType: value, searching: true });
  };

  const handleCustomerTypeChange = (value) => {
    setCustomerType(value);
    loadCustomers(1, { customerType: value });
  };

  const handleDateFilter = () => loadCustomers(1);

  const toggleDetails = (id) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleDropdown = (id) => setOpenDropdownId((prev) => (prev === id ? null : id));
  const openDeleteModal = (customer) => { setOpenDropdownId(null); setDeleteTarget(customer); };
  const closeDeleteModal = () => { setDeleteTarget(null); };

  const buildBalanceWarning = (customer) => {
    const lines = [];
    if (Number(customer.current_balance) > 0) {
      lines.push(`This customer has an outstanding credit balance of ${customer.current_balance}.`);
    }
    if (Number(customer.advance_payment) > 0) {
      lines.push(`This customer has an advance payment balance of ${customer.advance_payment}.`);
    }
    return lines.join('\n');
  };

  const handleSoftDelete = async () => {
    if (!deleteTarget) return;
    const warning = buildBalanceWarning(deleteTarget);
    if (warning) {
      const confirmed = window.confirm(`${warning}\n\nAre you sure you want to soft delete this customer?`);
      if (!confirmed) return;
    }
    try {
      await apiFetch(`/api/customers/${deleteTarget.id}/delete`, { method: 'DELETE' });
      closeDeleteModal();
      loadCustomers(currentPage);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    const warning = buildBalanceWarning(deleteTarget);
    const message = warning
      ? `${warning}\n\nPermanently delete this customer? This cannot be undone.`
      : 'Permanently delete this customer? This cannot be undone.';
    const confirmed = window.confirm(message);
    if (!confirmed) return;
    try {
      await apiFetch(`/api/customers/${deleteTarget.id}/delete?permanent=true`, { method: 'DELETE' });
      closeDeleteModal();
      loadCustomers(currentPage);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('.action-dropdown')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('customerSearchInput')?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const renderSalesBreakdown = (customerId) => {
    const breakdown = salesBreakdown[customerId] || {};
    const rows = ['credit', 'cash', 'card', 'advance'].filter((t) => breakdown[t]);
    if (!rows.length) return <tr><td colSpan={2}>No sales found.</td></tr>;
    return rows.map((type) => (
      <tr key={type}>
        <td>{type.charAt(0).toUpperCase() + type.slice(1)}</td>
        <td>{breakdown[type].count}</td>
      </tr>
    ));
  };

  const renderSortIcons = (col) => (
    <span className="sort-icons">
      <span className={sortColumn === col && sortDirection === 'asc' ? 'sort-up active' : 'sort-up'} onClick={() => handleSort(col, 'asc')}>▲</span>
      <span className={sortColumn === col && sortDirection === 'desc' ? 'sort-down active' : 'sort-down'} onClick={() => handleSort(col, 'desc')}>▼</span>
    </span>
  );

  return (
    <div className="container">
      <div className="container-child main-text"><h1>Customer List</h1></div>
      <div className="container-child sub-text"><p>View all customers</p></div>

      <div className="sub-container">
        <div className="date-range-container" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div className="customerTypeDropdown">
            <select id="customerTypeFilter" className="input" style={{ width: 200 }} value={customerType}
              onChange={(e) => handleCustomerTypeChange(e.target.value)}>
              <option value="all">All Customers</option>
              <option value="credit">Credit Customers</option>
              <option value="cash">Cash Customers</option>
              <option value="card">Card Customers</option>
              <option value="advance">Advance Customers</option>
            </select>
          </div>
          <div className="date-range">
            <label>From:</label>
            <input type="date" className="date-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <label>To:</label>
            <input type="date" className="date-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <button type="button" className="date-filter-btn" onClick={handleDateFilter}>Search</button>
          </div>
        </div>

        <div className="report-search-container">
          <div id="customerSearchbar-dropdown">
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5 }}>
              <p style={{ position: 'relative', top: 9 }}>Search by:</p>
              <select id="customerSearchType" className="input" style={{ width: 140 }} value={searchType}
                onChange={(e) => handleSearchTypeChange(e.target.value)}>
                <option value="customer">Customer</option>
                <option value="shop_name">Business/Shop Name</option>
                <option value="contact">Contact</option>
              </select>
            </div>
            <div className="search-container">
              <input type="text" id="customerSearchInput" className="input" placeholder="Search..."
                value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)} />
              <span className="icon1">
                <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 22L20 20" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
        </div>

        <table id="customerSalesTable">
          <thead>
            <tr>
              <th>#</th>
              <th className="sortable" data-column="name"><div className="sortable-header"><span>Customer Name</span>{renderSortIcons('name')}</div></th>
              <th className="sortable" data-column="shop_name"><div className="sortable-header"><span>Business/Shop Name</span>{renderSortIcons('shop_name')}</div></th>
              <th className="sortable" data-column="contact"><div className="sortable-header"><span>Contact</span>{renderSortIcons('contact')}</div></th>
              <th className="sortable" data-column="city"><div className="sortable-header"><span>City</span>{renderSortIcons('city')}</div></th>
              <th className="sortable" data-column="sales_count"><div className="sortable-header"><span>Total Sales</span>{renderSortIcons('sales_count')}</div></th>
              <th>Has Credit Sale</th>
              <th className="sortable" data-column="last_purchase_date"><div className="sortable-header"><span>Last Purchase</span>{renderSortIcons('last_purchase_date')}</div></th>
              <th>View Purchases</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="customerTableBody">
            {loading ? (
              <tr><td colSpan={10}><div className="loading-spinner"><div className="spinner" /><p>{loadingMessage}</p></div></td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={10}>No Record found.</td></tr>
            ) : (
              customers.map((customer, index) => {
                const rowNumber = pagination.first_item + index;
                const breakdown = salesBreakdown[customer.id] || {};
                const hasCreditSales = breakdown.credit && breakdown.credit.count > 0;
                const lastPurchase = customer.sales?.length > 0 ? customer.sales[0].sale_date : null;
                const isOpen = openDetails.has(customer.id);

                return (
                  <React.Fragment key={customer.id}>
                    <tr>
                      <td>{rowNumber}</td>
                      <td style={{ textAlign: 'left' }}>
                        <button className="toggle-details" style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                          onClick={() => toggleDetails(customer.id)}>
                          {isOpen ? '\u25B2' : '\u25BC'}
                        </button>
                        {customer.name || 'Walk-in Customer'}
                      </td>
                      <td>{customer.shop_name || 'N/A'}</td>
                      <td>{customer.contact || 'N/A'}</td>
                      <td>{customer.city || 'N/A'}</td>
                      <td>{customer.sales_count || 0}</td>
                      <td>{hasCreditSales ? 'Yes' : 'No'}</td>
                      <td>{formatDateTime(lastPurchase)}</td>
                      <td>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                          onClick={() => router.push(`/customers/customers/${customer.id}/purchases`)}>
                          <i style={{ fontSize: 18, color: '#5c6670' }} className="fa fa-eye" />
                        </button>
                      </td>
                      <td>
                      <div className="action-dropdown">
  <button className="dropdown-toggle" onClick={(e) => { toggleDropdown(customer.id); }}>⋮</button>
  {openDropdownId === customer.id && (
    <div className="action-dropdown-menu open">
         {!isBlocked('customers.list.act.account-ledger') && (
      <a href={`${API}/api/customers/${customer.id}/ledger/download`}>Account Ledger</a>
      )}
      <button type="button" onClick={() => router.push(`/customers/customers/${customer.id}/account-ledger`)}>
        Customer History
      </button>
      {!isBlocked('customers.list.act.delete') && (
      <button type="button" onClick={() => openDeleteModal(customer)}>Delete</button>
      )}
    </div>
  )}
</div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="details-row" style={{ background: '#f9f9f9' }}>
                        <td colSpan={10}>
                          <table className="table table-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th>Payment Type</th><th>Number of Sales</th></tr></thead>
                            <tbody>{renderSalesBreakdown(customer.id)}</tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>

        {pagination && searchQuery && pagination.total > 0 && (
          <div style={{ marginBottom: 10, textAlign: 'center', color: '#666', fontSize: 14 }}>
            Found <strong>{pagination.total}</strong> result{pagination.total !== 1 ? 's' : ''} for "{searchQuery}"
          </div>
        )}

        {pagination && pagination.last_page > 1 && (
          <div className="custom-pagination" id="paginationContainer">
            {pagination.on_first_page ? (
              <><span className="disabled">« First</span><span className="disabled">←</span></>
            ) : (
              <><a onClick={() => loadCustomers(1)}>« First</a><a onClick={() => loadCustomers(pagination.current_page - 1)}>←</a></>
            )}
            {Math.max(pagination.current_page - 2, 1) > 1 && <span className="dots">...</span>}
            {Array.from(
              { length: Math.min(pagination.current_page + 2, pagination.last_page) - Math.max(pagination.current_page - 2, 1) + 1 },
              (_, i) => Math.max(pagination.current_page - 2, 1) + i
            ).map((p) =>
              p === pagination.current_page
                ? <span key={p} className="active">{p}</span>
                : <a key={p} onClick={() => loadCustomers(p)}>{p}</a>
            )}
            {Math.min(pagination.current_page + 2, pagination.last_page) < pagination.last_page && <span className="dots">...</span>}
            {pagination.has_more_pages ? (
              <><a onClick={() => loadCustomers(pagination.current_page + 1)}>→</a><a onClick={() => loadCustomers(pagination.last_page)}>Last »</a></>
            ) : (
              <><span className="disabled">→</span><span className="disabled">Last »</span></>
            )}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="delete-modal open" role="dialog" aria-modal="true">
          <div className="delete-modal-content delete-confirm-modal-content" role="document">
            <div className="delete-confirm-modal-title">Delete this customer?</div>
            <div className="delete-confirm-modal-text">
              Soft delete can be restored later from Recycle Bin. Permanent delete cannot be undone.
            </div>
            <div className="delete-confirm-modal-actions">
              <button className="delete-confirm-btn delete-confirm-btn-soft" onClick={handleSoftDelete}>
                Soft delete
              </button>
              <button className="delete-confirm-btn delete-confirm-btn-permanent" onClick={handlePermanentDelete}>
                Permanent delete
              </button>
            </div>
            <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={closeDeleteModal}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}