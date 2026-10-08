'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import '../customers/customers.css';

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

export default function AdvanceCustomersPage() {
  const router = useRouter();
  const didInit = useRef(false);
  const searchTimeout = useRef(null);

  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading customers...');

  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('customer');

  const loadCustomers = useCallback(async (page, overrides = {}) => {
    setLoading(true);
    setLoadingMessage(overrides.searching ? 'Searching...' : 'Loading Data. It may take some minutes...');

    const sc = overrides.sortColumn ?? sortColumn;
    const sd = overrides.sortDirection ?? sortDirection;
    const sq = overrides.searchQuery ?? searchQuery;
    const st = overrides.searchType ?? searchType;

    const params = new URLSearchParams();
    params.set('page', page);
    params.set('sort_column', sc);
    params.set('sort_direction', sd);
    if (sq) {
      params.set('search', sq);
      params.set('search_type', st);
    }

    try {
      const res = await apiFetch(`/api/customers/advance/data?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setCustomers(data.data);
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
  }, [sortColumn, sortDirection, searchQuery, searchType]);

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

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this customer?')) return;
    try {
      await apiFetch(`/api/customers/${id}/delete?delete_option=only`, { method: 'DELETE' });
      loadCustomers(currentPage);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const renderSortIcons = (col) => (
    <span className="sort-icons">
      <span className={sortColumn === col && sortDirection === 'asc' ? 'sort-up active' : 'sort-up'} onClick={() => handleSort(col, 'asc')}>▲</span>
      <span className={sortColumn === col && sortDirection === 'desc' ? 'sort-down active' : 'sort-down'} onClick={() => handleSort(col, 'desc')}>▼</span>
    </span>
  );

  return (
    <div className="container">
      <div className="container-child main-text"><h1>Advance Customers</h1></div>
      <div className="container-child sub-text"><p>View all advance customers</p></div>

      <div className="sub-container">
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

        <table id="advanceCustomerTable">
          <thead>
            <tr>
              <th>#</th>
              <th className="sortable" data-column="name"><div className="sortable-header"><span>Customer Name</span>{renderSortIcons('name')}</div></th>
              <th className="sortable" data-column="shop_name"><div className="sortable-header"><span>Business/Shop Name</span>{renderSortIcons('shop_name')}</div></th>
              <th className="sortable" data-column="contact"><div className="sortable-header"><span>Contact</span>{renderSortIcons('contact')}</div></th>
              <th className="sortable" data-column="city"><div className="sortable-header"><span>City</span>{renderSortIcons('city')}</div></th>
              <th className="sortable" data-column="advance_payment"><div className="sortable-header"><span>Advance Balance</span>{renderSortIcons('advance_payment')}</div></th>
              <th className="sortable" data-column="advance_sales_count"><div className="sortable-header"><span>Total Purchases</span>{renderSortIcons('advance_sales_count')}</div></th>
              <th className="sortable" data-column="last_purchase_date"><div className="sortable-header"><span>Last Purchase</span>{renderSortIcons('last_purchase_date')}</div></th>
              <th>View Purchases</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10}><div className="loading-spinner"><div className="spinner" /><p>{loadingMessage}</p></div></td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={10}>No Record found.</td></tr>
            ) : (
              customers.map((customer, index) => {
                const rowNumber = pagination.first_item + index;
                return (
                  <tr key={customer.id}>
                    <td>{rowNumber}</td>
                    <td>{customer.name || 'Walk-in Customer'}</td>
                    <td>{customer.shop_name || 'N/A'}</td>
                    <td>{customer.contact || 'N/A'}</td>
                    <td>{customer.city || 'N/A'}</td>
                    <td>{formatPrice(customer.advance_payment ?? 0)}</td>
                    <td>{customer.advance_sales_count || 0}</td>
                    <td>{formatDateTime(customer.last_purchase_date)}</td>
                    <td>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={() => router.push(`/customers/advance/${customer.id}/advance-purchases`)}>
                        <i style={{ fontSize: 18, color: '#5c6670' }} className="fa fa-eye" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {pagination && pagination.last_page > 1 && (
          <div className="custom-pagination">
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
    </div>
  );
}