'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import './daily-sale.css';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";


const SEARCH_TYPES = [
    { value: 'voucher',  label: 'Invoice No' },
    { value: 'product',  label: 'Product Name' },
    { value: 'customer', label: 'Customer' },
];

export default function DailySalesPage() {
    const router = useRouter();
    const [sales, setSales]           = useState([]);
    const [saleItems, setSaleItems]   = useState({});
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading]       = useState(true);

    const [page, setPage]                   = useState(1);
    const [sortColumn, setSortColumn]       = useState('created_at');
    const [sortDirection, setSortDirection] = useState('desc');

    const [search, setSearch]         = useState('');
const [searchType, setSearchType] = useState('voucher');
const [filterPayment, setFilterPayment] = useState('');


// Today's date from the machine's local clock — the same basis as the
// backend's NOW()/created_at, so the filter matches what was actually saved.
function getPKTDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const [filterDate, setFilterDate] = useState(getPKTDate);

    const [openRows, setOpenRows] = useState({}); // sale_id -> bool

    // ── Load data ────────────────────────────────────
    const loadData = useCallback(async (pg, col, dir, q, qType, payType = '', date = '') => {
        setLoading(true);
        try {
            let url = `/api/sales/daily/data?page=${pg}&sort_column=${col}&sort_direction=${dir}`;
            if (q) url += `&search=${encodeURIComponent(q)}&search_type=${qType}`;
            if (payType) url += `&filter_payment=${encodeURIComponent(payType)}`;
            if (date) url += `&filter_date=${encodeURIComponent(date)}`;

            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setSales(data.data);
                setSaleItems(data.saleItems || {});
                setPagination(data.pagination);
            } else {
                setSales([]);
            }
        } catch {
            setSales([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData(1, sortColumn, sortDirection, search, searchType, filterPayment, filterDate);
    }, [filterPayment, filterDate]);

    // Search debounce — only fires when search text changes, NOT on searchType change alone
useEffect(() => {
    if (!search) return; // don't reload if search bar is empty
    const t = setTimeout(() => {
        setPage(1);
        loadData(1, sortColumn, sortDirection, search, searchType, filterPayment, filterDate);
    }, 300);
    return () => clearTimeout(t);
}, [search]);

function handleSort(col, dir) {
    setSortColumn(col);
    setSortDirection(dir);
    setPage(1);
    loadData(1, col, dir, search, searchType, filterPayment, filterDate);
}

function handlePageChange(p) {
    setPage(p);
    loadData(p, sortColumn, sortDirection, search, searchType, filterPayment, filterDate);
}

    function toggleRow(saleId) {
        setOpenRows(prev => ({ ...prev, [saleId]: !prev[saleId] }));
    }

    function SortIcons({ col }) {
        return (
            <span className="sort-icons">
                <span
                    className={sortColumn === col && sortDirection === 'asc' ? 'active' : ''}
                    onClick={() => handleSort(col, 'asc')}>▲</span>
                <span
                    className={sortColumn === col && sortDirection === 'desc' ? 'active' : ''}
                    onClick={() => handleSort(col, 'desc')}>▼</span>
            </span>
        );
    }

    function formatDateTime(str) {
        if (!str) return '-';
        const d = new Date(str);
        return d.toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true,
        });
    }

    function productSummary(productsStr) {
        if (!productsStr) return '-';
        const products = productsStr.split(', ');
        return products.length > 1
            ? `${products[0]} + ${products.length - 1} more`
            : products[0];
    }

    return (
        <div className="container">
            <div className="container-child main-text">
                <h1>Sales Overview</h1>
            </div>
            <div className="container-child sub-text">
                <p>List of sales made during the day</p>
            </div>

            <div className="sub-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        {/* Left: Payment type filter */}
        <select
            className="paymentinput"
            style={{ width: 150}}
            value={filterPayment}
            onChange={e => setFilterPayment(e.target.value)}
        >
            <option value="">All Payments</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="credit">Credit</option>
            <option value="advance">Advance</option>
        </select>

        {/* Right: Date filter */}
        <input
            type="date"
            className="dateinput"
            style={{ width: 160}}
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
        />
    </div>
            <div className="report-search-container">
    
    <div id="searchbar-dropdown">
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 5 }}>
                            <p style={{ position: 'relative', top: 9 }}>Search by:</p>
                            <select
                                id="salesSearchType"
                                className="input"
                                style={{ width: 140 }}
                                value={searchType}
                                onChange={e => setSearchType(e.target.value)}
                            >
                                {SEARCH_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="Search..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
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
                    </div>

                {search && pagination && pagination.total > 0 && (
                    <div style={{ marginBottom: 10, textAlign: 'center', color: '#666', fontSize: 14 }}>
                        Found <strong>{pagination.total}</strong> result{pagination.total !== 1 ? 's' : ''} for "{search}"
                    </div>
                )}

                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Invoice No</span><SortIcons col="voucher_no" />
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Sale Date</span><SortIcons col="sale_date" />
                                </div>
                            </th>
                            <th>Products</th>
                            <th>Total Items</th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Grand Total</span><SortIcons col="grand_total" />
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Payment Type</span><SortIcons col="payment_type" />
                                </div>
                            </th>
                            <th>Seller</th>
                            <th>Customer</th>
                            <th>See Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={10}>
                                <div className="loading-spinner">
                                    <div className="spinner"></div>
                                    <p>Loading sales...</p>
                                </div>
                            </td></tr>
                        ) : sales.length === 0 ? (
                            <tr><td colSpan={10} style={{ textAlign: 'center' }}>No sales found</td></tr>
                        ) : sales.map((sale, index) => {
                            const rowNum = pagination ? pagination.first_item + index : index + 1;
                            const isOpen = !!openRows[sale.sale_id];
                            const items = saleItems[sale.sale_id] || [];
                            const isCredit = sale.payment_type === 'credit';

                            return (
                                <Fragment key={sale.sale_id}>
                                    <tr>
                                        <td style={{padding:'13px'}}>{rowNum}</td>
                                        <td>
                                            <button
                                                className="toggle-details"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                                onClick={() => toggleRow(sale.sale_id)}
                                            >
                                                {isOpen ? '▲' : '▼'}
                                            </button>
                                            {sale.voucher_no}
                                        </td>
                                        <td>{formatDateTime(sale.sale_date)}</td>
                                        <td>{productSummary(sale.products)}</td>
                                        <td>{sale.total_items}</td>
                                        <td>{formatPrice(sale.grand_total)}</td>
                                        <td>{sale.payment_type}</td>
                                        <td>{sale.seller_name || '-'}</td>
                                        <td>{sale.customer_name || 'Walk-in Customer'}</td>
                                        <td>
                                            <button
                                                onClick={() => router.push(isCredit
                                                    ? `/sales/credit/details/${sale.voucher_no}`
                                                    : `/sales/detail/${sale.voucher_no}`)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                            >
                                                <i className="fa fa-eye" style={{ fontSize: 18, color: '#5c6670' }}></i>
                                            </button>
                                            <a
                                                href={`/sales/general?highlight=${sale.sale_id}`}
                                                title="View in General Sales"
                                                style={{ marginLeft: 10 }}
                                            >
                                                <i className="fa fa-external-link" style={{ fontSize: 18, color: '#5c6670' }}></i>
                                            </a>
                                        </td>
                                    </tr>

                                    {isOpen && (
                                        <tr className="details-row" style={{ background: '#f9f9f9' }}>
                                            <td colSpan={10}>
                                                <SaleItemsTable items={items} formatPrice={formatPrice} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>

                {pagination && (
                    <Pagination pagination={pagination} onPageChange={handlePageChange} />
                )}
            </div>
        </div>
    );
}

function SaleItemsTable({ items, formatPrice }) {
    if (!items || items.length === 0) {
        return <p style={{ padding: 10 }}>No items found</p>;
    }

    return (
        <table className="table table-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                {items.map((item, idx) => {
                    const isService = item.type === 'service';

                    const quantityDisplay = isService
                        ? <span style={{ color: '#666' }}>-</span>
                        : item.quantity;

                    const discountDisplay = item.discount_amount > 0
                        ? (item.discount_type === 'percentage'
                            ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.discount_amount)})`
                            : formatPrice(item.discount_amount))
                        : '-';

                    const taxDisplay = item.tax_amount > 0
                        ? (item.tax_type === 'percentage'
                            ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.tax_amount)})`
                            : formatPrice(item.tax_amount))
                        : '-';

                    return (
                        <tr key={idx}>
                            <td>
                                {item.product_name}
                                {isService && <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>}
                            </td>
                            <td>{formatPrice(item.price)}</td>
                            <td>{quantityDisplay}</td>
                            <td>{discountDisplay}</td>
                            <td>{taxDisplay}</td>
                            <td>{formatPrice(item.total_after_tax)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function Pagination({ pagination, onPageChange }) {
    const { current_page, last_page, on_first_page, has_more_pages } = pagination;
    if (last_page <= 1) return null;

    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);
    const pages = [];
    for (let p = start; p <= end; p++) pages.push(p);

    return (
        <div className="custom-pagination">
            {on_first_page
                ? <span className="disabled">« First</span>
                : <a onClick={() => onPageChange(1)}>« First</a>}
            {on_first_page
                ? <span className="disabled">←</span>
                : <a onClick={() => onPageChange(current_page - 1)}>←</a>}
            {start > 1 && <span className="dots">…</span>}
            {pages.map(p => (
                <span
                    key={p}
                    className={p === current_page ? 'active' : ''}
                    style={p !== current_page ? { cursor: 'pointer' } : {}}
                    onClick={() => p !== current_page && onPageChange(p)}
                >{p}</span>
            ))}
            {end < last_page && <span className="dots">…</span>}
            {has_more_pages
                ? <a onClick={() => onPageChange(current_page + 1)}>→</a>
                : <span className="disabled">→</span>}
            {has_more_pages
                ? <a onClick={() => onPageChange(last_page)}>Last »</a>
                : <span className="disabled">Last »</span>}
        </div>
    );
}