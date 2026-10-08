'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import '../../../customers/customers.css';

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

export default function CustomerCreditPurchasesPage() {
  const { id } = useParams();
  const router = useRouter();
  const didInit = useRef(false);
  const searchTimeout = useRef(null);

  const [customer, setCustomer] = useState(null);
  const [sales, setSales] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading sales...');

  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const loadSales = useCallback(async (page, overrides = {}) => {
    setLoading(true);
    setLoadingMessage(overrides.searching ? 'Searching...' : 'Loading sales...');

    const sq = overrides.searchQuery ?? searchQuery;

    const params = new URLSearchParams();
    params.set('page', page);
    params.set('payment_type', 'credit'); // fixed — this page only ever shows credit sales
    if (sq) params.set('search', sq);

    try {
      const res = await apiFetch(`/api/customers/${id}/sales?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setSales(data.data);
        setPagination(data.pagination);
        setCurrentPage(page);
      } else {
        setSales([]);
      }
    } catch (err) {
      console.error('Error:', err);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [id, searchQuery]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    apiFetch(`/api/customers/${id}/info`)
      .then((res) => res.json())
      .then((data) => { if (data.success) setCustomer(data.data); })
      .catch((err) => console.error('Error:', err));

    loadSales(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchInput = (value) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadSales(1, { searchQuery: value, searching: !!value });
    }, 100);
  };

  return (
    <div className="container">
      <div className="container-child main-text">
        <h1>{customer ? `${customer.name}'s Credit Sales` : 'Customer Credit Sales'}</h1>
      </div>
      <div className="container-child sub-text">
        <p>
          {customer
            ? `${customer.shop_name || 'N/A'} • ${customer.contact || 'N/A'} • ${customer.city || 'N/A'} • Balance: ${formatPrice(customer.current_balance)}`
            : 'View all credit sales for this customer'}
        </p>
      </div>

      <div className="sub-container">
        <div className="date-range-container" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="date-filter-btn" onClick={() => router.push('/customers/credit')}>
            ← Back to Credit Customers
          </button>
        </div>

        <div className="report-search-container">
          <div className="search-container">
            <input type="text" className="input" placeholder="Search by invoice no..."
              value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)} />
          </div>
        </div>

        <table id="customerSalesTable">
          <thead>
            <tr>
              <th>#</th>
              <th>Invoice No</th>
              <th>Sale Date</th>
              <th>Seller</th>
              <th>Amount</th>
              <th>Status</th>
              <th>View Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}><div className="loading-spinner"><div className="spinner" /><p>{loadingMessage}</p></div></td></tr>
            ) : sales.length === 0 ? (
              <tr><td colSpan={7}>No Record found.</td></tr>
            ) : (
              sales.map((sale, index) => (
                <tr key={sale.id}>
                  <td>{pagination.first_item + index}</td>
                  <td>{sale.voucher_no}</td>
                  <td>{formatDateTime(sale.sale_date)}</td>
                  <td>{sale.seller_name}</td>
                  <td>{formatPrice(sale.grand_total)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{sale.status}</td>
                  <td>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => router.push(`/customers/credit/${id}/credit-purchases/${sale.id}`)}>
                      <i style={{ fontSize: 18, color: '#5c6670' }} className="fa fa-eye" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {pagination && pagination.last_page > 1 && (
          <div className="custom-pagination">
            {pagination.on_first_page ? (
              <><span className="disabled">« First</span><span className="disabled">←</span></>
            ) : (
              <><a onClick={() => loadSales(1)}>« First</a><a onClick={() => loadSales(pagination.current_page - 1)}>←</a></>
            )}
            {Math.max(pagination.current_page - 2, 1) > 1 && <span className="dots">...</span>}
            {Array.from(
              { length: Math.min(pagination.current_page + 2, pagination.last_page) - Math.max(pagination.current_page - 2, 1) + 1 },
              (_, i) => Math.max(pagination.current_page - 2, 1) + i
            ).map((p) =>
              p === pagination.current_page
                ? <span key={p} className="active">{p}</span>
                : <a key={p} onClick={() => loadSales(p)}>{p}</a>
            )}
            {Math.min(pagination.current_page + 2, pagination.last_page) < pagination.last_page && <span className="dots">...</span>}
            {pagination.has_more_pages ? (
              <><a onClick={() => loadSales(pagination.current_page + 1)}>→</a><a onClick={() => loadSales(pagination.last_page)}>Last »</a></>
            ) : (
              <><span className="disabled">→</span><span className="disabled">Last »</span></>
            )}
          </div>
        )}
      </div>
    </div>
  );
}