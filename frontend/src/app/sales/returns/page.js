'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { formatPrice } from "@/lib/currency-context";
import { useRouter } from 'next/navigation';
import './return.css';

export default function ReturnedSalesPage() {
    // ─── Tabs ──────────────────────────────────────────
    const router = useRouter();
    const [activeTab, setActiveTab] = useState('invoice'); // 'invoice' | 'walkin'

    // ─── Search ────────────────────────────────────────
    const [searchType, setSearchType] = useState('voucher'); // 'voucher' | 'customer'
    const [searchInput, setSearchInput] = useState('');
    const currentSearchQuery = useRef('');
    const currentSearchType = useRef('voucher');
    const searchTimeout = useRef(null);

    // ─── Invoice Returns state ─────────────────────────
    const [sales, setSales] = useState([]);
    const [returnDetails, setReturnDetails] = useState({});
    const [pagination, setPagination] = useState(null);
    const [loadingInvoice, setLoadingInvoice] = useState(true);
    const [openRows, setOpenRows] = useState({});
    const sortColumn = useRef('last_return_date');
    const sortDirection = useRef('desc');
    const [activeSortIcon, setActiveSortIcon] = useState({ column: 'last_return_date', direction: 'desc' });

    // ─── Walk-in Returns state ──────────────────────────
    const [walkInRows, setWalkInRows] = useState([]);
    const [walkInPagination, setWalkInPagination] = useState(null);
    const [loadingWalkIn, setLoadingWalkIn] = useState(false);
    const [openWalkInRows, setOpenWalkInRows] = useState({});
    const walkInLoadedOnce = useRef(false);

    // ─── Delete modal ────────────────────────────────────
    const [deleteTarget, setDeleteTarget] = useState(null); // { type: 'invoice' | 'walkin', id, name }

    // ════════════════════════════════════════════════════
    // INVOICE RETURNS — DATA LOADING
    // ════════════════════════════════════════════════════
    function loadReturnedSales(page, showLoader = true) {
        if (showLoader) setLoadingInvoice(true);

        let url = `/api/sales/returned/data?page=${page}&sort_column=${sortColumn.current}&sort_direction=${sortDirection.current}`;
        if (currentSearchQuery.current) {
            url += `&search=${encodeURIComponent(currentSearchQuery.current)}&search_type=${currentSearchType.current}`;
        }

        apiFetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    setReturnDetails(data.returnDetails || {});
                    setSales(data.data || []);
                    setPagination(data.pagination);
                    setOpenRows({});
                } else {
                    setSales([]);
                }
            })
            .catch((err) => {
                console.error('Error:', err);
                setSales([]);
            })
            .finally(() => setLoadingInvoice(false));
    }

    useEffect(() => {
        loadReturnedSales(1);
    }, []);

    // ─── Sorting ────────────────────────────────────────
    function handleSort(column, direction) {
        sortColumn.current = column;
        sortDirection.current = direction;
        setActiveSortIcon({ column, direction });
        loadReturnedSales(1, false);
    }

    // ─── Search ─────────────────────────────────────────
    function handleSearchInputChange(value) {
        setSearchInput(value);
        currentSearchQuery.current = value.trim();
        currentSearchType.current = searchType;

        clearTimeout(searchTimeout.current);

        if (activeTab === 'walkin') {
            searchTimeout.current = setTimeout(() => {
                loadWalkInReturns(1);
            }, 300);
        } else {
            searchTimeout.current = setTimeout(() => {
                loadReturnedSales(1);
            }, 100);
        }
    }

    function handleSearchTypeChange(value) {
        setSearchType(value);
        currentSearchType.current = value;
        if (currentSearchQuery.current) {
            loadReturnedSales(1);
        }
    }

    // ─── Toggle details row ─────────────────────────────
    function toggleRow(saleId) {
        setOpenRows((prev) => ({ ...prev, [saleId]: !prev[saleId] }));
    }

    // ─── Render pagination helper (Invoice) ─────────────
    function renderPagination(p, onPage) {
        if (!p || p.last_page <= 1) return null;

        const start = Math.max(p.current_page - 2, 1);
        const end = Math.min(p.current_page + 2, p.last_page);
        const pages = [];
        for (let pg = start; pg <= end; pg++) pages.push(pg);

        return (
            <div className="custom-pagination">
                {p.on_first_page ? (
                    <>
                        <span className="disabled">« First</span>
                        <span className="disabled">←</span>
                    </>
                ) : (
                    <>
                        <a onClick={() => onPage(1)}>« First</a>
                        <a onClick={() => onPage(p.current_page - 1)}>←</a>
                    </>
                )}

                {start > 1 && <span className="dots">...</span>}

                {pages.map((pg) =>
                    pg === p.current_page ? (
                        <span className="active" key={pg}>{pg}</span>
                    ) : (
                        <a key={pg} onClick={() => onPage(pg)}>{pg}</a>
                    )
                )}

                {end < p.last_page && <span className="dots">...</span>}

                {p.has_more_pages ? (
                    <>
                        <a onClick={() => onPage(p.current_page + 1)}>→</a>
                        <a onClick={() => onPage(p.last_page)}>Last »</a>
                    </>
                ) : (
                    <>
                        <span className="disabled">→</span>
                        <span className="disabled">Last »</span>
                    </>
                )}
            </div>
        );
    }

    // ════════════════════════════════════════════════════
    // WALK-IN RETURNS — DATA LOADING
    // ════════════════════════════════════════════════════
    function loadWalkInReturns(page) {
        setLoadingWalkIn(true);

        let url = `/api/walk-in-returns/list?page=${page}`;
        if (currentSearchQuery.current && currentSearchType.current === 'customer') {
            url += `&search=${encodeURIComponent(currentSearchQuery.current)}&search_type=customer`;
        }

        apiFetch(url, {
            headers: { 'Content-Type': 'application/json' },
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    setWalkInRows([]);
                    return;
                }
                walkInLoadedOnce.current = true;
                setWalkInRows(data.data || []);
                setWalkInPagination(data.pagination);
                setOpenWalkInRows({});
            })
            .catch((err) => {
                console.error('Error:', err);
                setWalkInRows([]);
            })
            .finally(() => setLoadingWalkIn(false));
    }

    function toggleWalkInRow(id) {
        setOpenWalkInRows((prev) => ({ ...prev, [id]: !prev[id] }));
    }

    // ─── Delete (invoice / walk-in) ──────────────────────
    function deleteUrlFor(target, permanent) {
        const base = target.type === 'invoice'
            ? `/api/sales/returned/${target.id}`
            : `/api/walk-in-returns/${target.id}`;
        return permanent ? `${base}?permanent=true` : base;
    }

    async function handleSoftDelete() {
        if (!deleteTarget) return;
        try {
            const res  = await apiFetch(deleteUrlFor(deleteTarget, false), { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setDeleteTarget(null);
                deleteTarget.type === 'invoice' ? loadReturnedSales(1) : loadWalkInReturns(1);
            }
        } catch (err) {
            console.error('Error:', err);
        }
    }

    async function handlePermanentDelete() {
        if (!deleteTarget) return;
        const confirmed = window.confirm(`Permanently delete "${deleteTarget.name}"? This cannot be undone.`);
        if (!confirmed) return;
        try {
            const res  = await apiFetch(deleteUrlFor(deleteTarget, true), { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                setDeleteTarget(null);
                deleteTarget.type === 'invoice' ? loadReturnedSales(1) : loadWalkInReturns(1);
            }
        } catch (err) {
            console.error('Error:', err);
        }
    }

    // ─── Tab switching ──────────────────────────────────
    function switchTab(tab) {
        setActiveTab(tab);

        if (tab === 'invoice') {
            if (searchType !== 'voucher' && !currentSearchQuery.current) {
                // leave as-is; mirrors original which only forces customer on walk-in
            }
        } else {
            if (searchType === 'voucher') {
                setSearchType('customer');
                currentSearchType.current = 'customer';
            }
            loadWalkInReturns(1);
        }
    }

    // ════════════════════════════════════════════════════
    // FORMAT HELPERS
    // ════════════════════════════════════════════════════
    function formatDate(dateInput) {
        if (!dateInput) return '—';
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return '—';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
    }

    function formatDiscountOrTax(type, value, amount) {
        if (!type || parseFloat(amount || 0) === 0) return formatPrice(amount || 0);
        if (type === 'percentage') return `${parseFloat(value)}% (${formatPrice(amount)})`;
        return formatPrice(amount);
    }

    // ════════════════════════════════════════════════════
    // RENDER: Invoice return details (expandable section)
    // ════════════════════════════════════════════════════
    function renderReturnDetails(saleId, voucherNo, returnCount, totalItems, totalRefunded) {
        const returns = returnDetails[saleId] || [];

        if (returns.length === 0) {
            return <p style={{ padding: '15px' }}>No return details found</p>;
        }

        return (
            <div style={{ padding: '15px' }}>
                <h4>Return History for {voucherNo}</h4>
                {returns.map((returnItem, index) => (
                    <div
                        key={returnItem.id}
                        style={{ marginBottom: '20px', border: '1px solid #ddd', borderRadius: '5px', padding: '10px' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <strong>Return #{index + 1} - RET-{String(returnItem.id).padStart(4, '0')}</strong>
                            <small style={{ color: '#666' }}>
                                {new Date(returnItem.return_date).toLocaleDateString('en-GB', {
                                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
                                })}{' '}
                                | {formatPrice(returnItem.total_return_amount)}
                            </small>
                        </div>

                        <table style={{ width: '100%', fontSize: '14px' }}>
                            <thead>
                                <tr style={{ background: '#f8f9fa' }}>
                                    <th>Product</th>
                                    <th>Qty Returned</th>
                                    <th>Unit Price</th>
                                    <th>Refund</th>
                                </tr>
                            </thead>
                            <tbody>
                                {returnItem.items.map((item) => (
                                    <tr key={item.id}>
                                        <td>{item.product_name}</td>
                                        <td>{item.quantity_returned}</td>
                                        <td>{formatPrice(item.unit_net_after_discount)}</td>
                                        <td>{formatPrice(item.amount_refunded)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {returnItem.notes && (
                            <p style={{ marginTop: '5px', fontStyle: 'italic', color: '#666' }}>
                                <small>Notes: {returnItem.notes}</small>
                            </p>
                        )}
                    </div>
                ))}

                <div style={{ background: '#e9ecef', padding: '10px', borderRadius: '5px', fontWeight: 'bold' }}>
                    Total Returns: {returnCount} transactions | Total Items: {totalItems} | Total Refunded: {formatPrice(totalRefunded)}
                </div>
            </div>
        );
    }

    // ════════════════════════════════════════════════════
    // RENDER: Walk-in return details (expandable section)
    // ════════════════════════════════════════════════════
    function renderWalkInDetails(row) {
        const items = row.items || [];
        if (!items.length) return <p style={{ padding: '15px' }}>No items found</p>;

        return (
            <div style={{ padding: '15px' }}>
                <h4>Items for {row.batch_no}</h4>
                <table style={{ width: '100%', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ background: '#f8f9fa' }}>
                            <th>Product</th>
                            <th>Qty Returned</th>
                            <th>Unit Price</th>
                            <th>Discount</th>
                            <th>Tax</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.id}>
                                <td>{item.purchase ? item.purchase.product_name : '—'}</td>
                                <td>{item.quantity_returned}</td>
                                <td>{formatPrice(item.unit_price)}</td>
                                <td>
                                    {formatDiscountOrTax(item.discount_type, item.discount_value, item.discount_amount)}
                                </td>
                                <td>
                                    {formatDiscountOrTax(item.tax_type, item.tax_value, item.tax_amount)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ background: '#e9ecef', padding: '10px', borderRadius: '5px', fontWeight: 'bold', marginTop: '10px' }}>
                    Total Items: {items.length} &nbsp;|&nbsp;
                    Total Refund: <span>{formatPrice(row.total_refund_amount)}</span>
                </div>
            </div>
        );
    }

    // ════════════════════════════════════════════════════
    // KEYBOARD SHORTCUTS (F2 search focus, Alt+V eye nav)
    // ════════════════════════════════════════════════════
    const searchInputRef = useRef(null);

    useEffect(() => {
        function getVisibleEyeLinks() {
            return Array.from(document.querySelectorAll('a i.fa-eye'))
                .map((icon) => icon.closest('a'))
                .filter((link) => link && link.getClientRects().length > 0);
        }

        function onKeyDown(e) {
            if (e.key === 'F2') {
                e.preventDefault();
                searchInputRef.current?.focus();
                return;
            }

            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                const eyes = getVisibleEyeLinks();
                if (eyes.length) eyes[0].focus();
                return;
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const eyes = getVisibleEyeLinks();
                if (!eyes.length) return;
                const currentIndex = eyes.indexOf(document.activeElement);
                if (currentIndex === -1) return;
                e.preventDefault();
                if (e.key === 'ArrowDown' && currentIndex < eyes.length - 1) eyes[currentIndex + 1].focus();
                if (e.key === 'ArrowUp' && currentIndex > 0) eyes[currentIndex - 1].focus();
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    // ════════════════════════════════════════════════════
    // SORT ICON HELPER
    // ════════════════════════════════════════════════════
    function SortableHeader({ column, label }) {
        return (
            <th>
                <div className="sortable-header">
                    <span>{label}</span>
                    <span className="sort-icons">
                        <span
                            className={`sort-up ${activeSortIcon.column === column && activeSortIcon.direction === 'asc' ? 'active' : ''}`}
                            onClick={() => handleSort(column, 'asc')}
                        >
                            ▲
                        </span>
                        <span
                            className={`sort-down ${activeSortIcon.column === column && activeSortIcon.direction === 'desc' ? 'active' : ''}`}
                            onClick={() => handleSort(column, 'desc')}
                        >
                            ▼
                        </span>
                    </span>
                </div>
            </th>
        );
    }

    // ════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════
    return (
        <div className="container">
            <div className="container-child main-text">
                <h1>Returned Sales</h1>
            </div>
            <div className="container-child sub-text">
                <p>List of sales that have been returned</p>
            </div>

            <div className="sub-container">
                {/* Tab buttons */}
                <div style={{ display: 'flex', gap: 0, marginBottom: '16px' }}>
                    <button
                        id="tabInvoice"
                        onClick={() => switchTab('invoice')}
                        style={{
                            padding: '9px 22px', border: 'none',
                            background: activeTab === 'invoice' ? '#007bff' : '#e9ecef',
                            color: activeTab === 'invoice' ? '#fff' : '#555',
                            fontSize: '14px', fontWeight: 600, borderRadius: '4px 4px 0 0', cursor: 'pointer'
                        }}
                    >
                        Invoice Returns
                    </button>
                    <button
                        id="tabWalkIn"
                        onClick={() => switchTab('walkin')}
                        style={{
                            padding: '9px 22px', border: 'none',
                            background: activeTab === 'walkin' ? '#007bff' : '#e9ecef',
                            color: activeTab === 'walkin' ? '#fff' : '#555',
                            fontSize: '14px', fontWeight: 600, borderRadius: '4px 4px 0 0', cursor: 'pointer', marginLeft: '4px'
                        }}
                    >
                        Without Invoice Returns
                    </button>
                </div>

                <div className="report-search-container">
                    <div className="report-format">
                    </div>

                    <div id="searchbar-dropdown">
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px' }}>
                            <p style={{ position: 'relative', top: '9px' }}>Search by:</p>
                            <select
                                id="salesSearchType"
                                className="input"
                                style={{ width: '140px' }}
                                value={searchType}
                                onChange={(e) => handleSearchTypeChange(e.target.value)}
                            >
                                <option value="voucher" style={{ display: activeTab === 'walkin' ? 'none' : '' }}>
                                    Invoice No
                                </option>
                                <option value="customer">Customer</option>
                            </select>
                        </div>
                        <div className="search-container">
                            <input
                                ref={searchInputRef}
                                type="text"
                                name="text"
                                id="salesSearchInput"
                                className="input"
                                placeholder="Search..."
                                value={searchInput}
                                onChange={(e) => handleSearchInputChange(e.target.value)}
                            />
                            <span className="icon1">
                                <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path opacity="1" d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                                    <path opacity="1" d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                                    <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></path>
                                    <path opacity="1" d="M22 22L20 20" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"></path>
                                </svg>
                            </span>
                        </div>
                    </div>
                </div>

                {/* ─── PANEL: Invoice Returns ─────────────────── */}
                {activeTab === 'invoice' && (
                    <div id="panelInvoice">
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <SortableHeader column="sales.voucher_no" label="Invoice No" />
                                    <SortableHeader column="sales.created_at" label="Sale Date" />
                                    <SortableHeader column="customers.name" label="Customer" />
                                    <th>Seller</th>
                                    <th>Return Transactions</th>
                                    <th>Items Returned</th>
                                    <SortableHeader column="total_refunded" label="Total Refunded" />
                                    <SortableHeader column="last_return_date" label="Last Return" />
                                    <th>Details</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="returnedSalesTableBody">
                                {loadingInvoice ? (
                                                                        <tr>
                                                                        <td colSpan="11">
                                                                            <div style={{ textAlign: 'center', padding: '20px' }}>
                                                                                <div className="spinner"></div>
                                                                                <p>Loading returned sales...</p>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                ) : sales.length === 0 ? (
                                                                    <tr>
                                                                        <td colSpan="11" style={{ textAlign: 'center', padding: '20px' }}>
                                                                            No returned sales found.
                                                                        </td>
                                                                    </tr>
                                ) : (
                                    sales.map((sale, index) => {
                                        const rowNumber = (pagination?.first_item || 1) + index;
                                        const isOpen = !!openRows[sale.voucher_no];
                                        return (
                                            <FragmentRow key={sale.voucher_no}>
                                                <tr>
                                                    <td>{rowNumber}</td>
                                                    <td>
                                                        <button
                                                            className="toggle-details"
                                                            onClick={() => toggleRow(sale.voucher_no)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                                        >
                                                            {isOpen ? '\u25B2' : '\u25BC'}
                                                        </button>
                                                        {sale.voucher_no}
                                                    </td>
                                                    <td>{formatDate(sale.sale_date)}</td>
                                                    <td>{sale.customer_name || 'Walk-in Customer'}</td>
                                                    <td>{sale.seller_name || '—'}</td>
                                                    <td>{sale.return_count}</td>
                                                    <td>{sale.total_items_returned}</td>
                                                    <td>{formatPrice(sale.total_refunded)}</td>
                                                    <td>{formatDate(sale.last_return_date)}</td>
                                                    <td>
                                                            <button type="button"
                                                onClick={() => router.push(`/sales/returns/details/${sale.voucher_no}`)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                                <i className="fa fa-eye" style={{ fontSize: 18, color: '#5c6670' }} />
                                            </button>

                                                        </td>
                                                        <td>
                                                            <ActionDropdown
                                                                onDelete={() => setDeleteTarget({ type: 'invoice', id: sale.voucher_no, name: sale.voucher_no })}
                                                            />
                                                        </td>
                                                </tr>
                                                <tr
                                                    className="details-row"
                                                    style={{ display: isOpen ? 'table-row' : 'none', background: '#f9f9f9' }}
                                                >
                                                    <td colSpan="11">
                                                        {isOpen &&
                                                            renderReturnDetails(
                                                                sale.voucher_no,
                                                                sale.voucher_no,
                                                                sale.return_count,
                                                                sale.total_items_returned,
                                                                sale.total_refunded
                                                            )}
                                                    </td>
                                                </tr>
                                            </FragmentRow>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>

                        <div className="custom-pagination" id="returnedPaginationContainer">
                            {pagination && currentSearchQuery.current && pagination.total > 0 && (
                                <div style={{ width: '100%', textAlign: 'center', color: '#666', fontSize: '14px', marginBottom: '10px' }}>
                                    Found <strong>{pagination.total}</strong> result{pagination.total !== 1 ? 's' : ''} for &quot;{currentSearchQuery.current}&quot;
                                </div>
                            )}
                            {renderPagination(pagination, (p) => loadReturnedSales(p))}
                        </div>
                    </div>
                )}

                {/* ─── PANEL: Without Invoice (Walk-in) Returns ─── */}
                {activeTab === 'walkin' && (
                    <div id="panelWalkIn">
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Batch No</th>
                                    <th>Date</th>
                                    <th>Customer</th>
                                    <th>Seller</th>
                                    <th>Contact</th>
                                    <th>Items</th>
                                    <th>Discount</th>
                                    <th>Tax</th>
                                    <th>Total Refund</th>
                                    <th>Notes</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="walkInReturnTableBody">
                                {loadingWalkIn ? (
                                    <tr>
                                        <td colSpan="13" style={{ textAlign: 'center', padding: '20px' }}>
                                            Loading...
                                        </td>
                                    </tr>
                                ) : walkInRows.length === 0 ? (
                                    <tr>
                                        <td colSpan="13" style={{ textAlign: 'center', padding: '20px' }}>
                                            No walk-in returns found.
                                        </td>
                                    </tr>
                                ) : (
                                    walkInRows.map((row, i) => {
                                        const rowNum = ((walkInPagination?.current_page || 1) - 1) * 10 + i + 1;
                                        const isOpen = !!openWalkInRows[row.id];
                                        return (
                                            <FragmentRow key={row.id}>
                                                <tr>
                                                    <td>{rowNum}</td>
                                                    <td>
                                                        <button
                                                            className="wir-toggle-details"
                                                            onClick={() => toggleWalkInRow(row.id)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                                        >
                                                            {isOpen ? '\u25B2' : '\u25BC'}
                                                        </button>
                                                        {row.batch_no}
                                                    </td>
                                                    <td>{formatDate(row.created_at)}</td>
                                                    <td>{row.customer_name || '—'}</td>
                                                    <td>{row.seller_name || '—'}</td>
                                                    <td>{row.contact_no || '—'}</td>
                                                    <td>{row.item_count}</td>
                                                    <td>
                                                        {formatDiscountOrTax(row.discount_type, row.discount_value, row.sale_discount_amount)}
                                                    </td>
                                                    <td>
                                                        {formatDiscountOrTax(row.tax_type, row.tax_value, row.sale_tax_amount)}
                                                    </td>
                                                    <td style={{ fontWeight: 600 }}>
                                                        {formatPrice(row.total_refund_amount)}
                                                    </td>
                                                    <td>{row.notes || '—'}</td>
                                                    <td>
                                                        <ActionDropdown
                                                            onDelete={() => setDeleteTarget({ type: 'walkin', id: row.id, name: row.batch_no })}
                                                        />
                                                    </td>
                                                </tr>
                                                <tr
                                                    className="wir-details-row"
                                                    style={{ display: isOpen ? 'table-row' : 'none', background: '#f9f9f9' }}
                                                >
                                                    <td colSpan="13">{isOpen && renderWalkInDetails(row)}</td>
                                                </tr>
                                            </FragmentRow>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                        <div className="custom-pagination" id="walkInPaginationContainer">
                            {renderPagination(walkInPagination, (p) => loadWalkInReturns(p))}
                        </div>
                    </div>
                )}
                        </div>

{/* ── Delete Modal ─────────────────────────── */}
{deleteTarget && (
    <div className="delete-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
        <div className="delete-modal-content delete-confirm-modal-content">
            <div className="delete-confirm-modal-title">Delete "{deleteTarget.name}"?</div>
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
            <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => setDeleteTarget(null)}>
                Cancel
            </button>
        </div>
    </div>
)}
</div>
);
}

// Small helper so we can return two <tr> siblings under .map() without an extra wrapping DOM node
function FragmentRow({ children }) {
return <>{children}</>;
}

// ── Action Dropdown ────────────────────────────────────
function ActionDropdown({ onDelete }) {
const [open, setOpen] = useState(false);
const { isBlocked } = usePermissions();
const ref = useRef(null);

useEffect(() => {
function handler(e) {
if (ref.current && !ref.current.contains(e.target)) setOpen(false);
}
document.addEventListener('mousedown', handler);
return () => document.removeEventListener('mousedown', handler);
}, []);

return (
<div className="dropdown" ref={ref}>
<button className="dropdown-toggle" onClick={() => setOpen(o => !o)}>⋮</button>
{open && !isBlocked('sales.returns.act.delete') && (
    <div className="action-dropdown-menu" style={{ display: 'block' }}>
        <button type="button" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
    </div>
)}
</div>
);
}