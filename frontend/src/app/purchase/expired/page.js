'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './expired.module.css';
import { apiFetch } from '@/lib/api';

export default function ExpiredProductsPage() {

    const [items, setItems]           = useState([]);
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading]       = useState(true);
    const [toast, setToast]           = useState(null);

    const [page, setPage]                   = useState(1);
    const [sortColumn, setSortColumn]       = useState('expiry_date');
    const [sortDirection, setSortDirection] = useState('asc');
    const [daysInput, setDaysInput]         = useState('10');
    const [currentDays, setCurrentDays]     = useState('10');

    const loadData = useCallback(async (pg = 1, days = currentDays, col = sortColumn, dir = sortDirection) => {
        setLoading(true);
        try {
            let url = `/api/purchases/expired?page=${pg}&sort_column=${col}&sort_direction=${dir}`;
            if (days !== null && days !== '') url += `&days_until_expiry=${days}`;

            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setItems(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load data', 'error');
            }
        } catch {
            showToast('An error occurred', 'error');
        } finally {
            setLoading(false);
        }
    }, [currentDays, sortColumn, sortDirection]);

    useEffect(() => { loadData(1); }, []);

    useEffect(() => { loadData(page, currentDays, sortColumn, sortDirection); },
        [sortColumn, sortDirection]);

    function applyDaysFilter() {
        const val = daysInput.trim() !== '' ? daysInput.trim() : null;
        setCurrentDays(val);
        setPage(1);
        loadData(1, val, sortColumn, sortDirection);
    }

    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDirection(dir);
        setPage(1);
    }

    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    function formatDate(str) {
        if (!str) return 'N/A';
        const parts = String(str).split('T')[0].split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(parts[2])}-${months[parseInt(parts[1]) - 1]}-${parts[0]}`;
    }

    function BadgeHtml({ daysLeft }) {
        if (daysLeft === null) return null;
        const isExpired = daysLeft <= 0;
        const isSoon    = daysLeft > 0 && daysLeft <= 30;
        if (isExpired) return (
<span className={`${styles['days-badge']} ${styles['badge-expired']}`}>
{daysLeft === 0 ? 'Expired Today' : `Expired ${Math.abs(daysLeft)} day(s) ago`}
            </span>
        );
        if (isSoon) return (
<span className={`${styles['days-badge']} ${styles['badge-soon']}`}>{daysLeft} day(s) left</span>
        );
        return (
<span className={`${styles['days-badge']} ${styles['badge-ok']}`}>{daysLeft} day(s) left</span>
        );
    }

    function SortIcons({ col }) {
        return (
            <span className="sort-icons">
                <span
                    className={`sort-up${sortColumn === col && sortDirection === 'asc' ? ' active' : ''}`}
                    onClick={() => handleSort(col, 'asc')}>▲</span>
                <span
                    className={`sort-down${sortColumn === col && sortDirection === 'desc' ? ' active' : ''}`}
                    onClick={() => handleSort(col, 'desc')}>▼</span>
            </span>
        );
    }

    return (
        <>
            {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.message}
                </div>
            )}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Expired &amp; Expiring Products</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Track products by expiry date</p>
                </div>

                <div className="sub-container">

                    {/* Search Bar */}
                    <div className={styles['search-bar-container']}>
                        <label style={{ fontWeight: 600 }}>Show expiring within:</label>
                        <input
                            type="number" min="0"
                            placeholder="e.g. 5"
                            value={daysInput}
                            onChange={e => setDaysInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && applyDaysFilter()}
                        />
                        <span style={{ fontSize: 14, color: '#555' }}>
                            days &nbsp;(enter 0 to show already expired only)
                        </span>
                        <button onClick={applyDaysFilter}>Search</button>
                    </div>

                    {/* Table */}
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Name</span><SortIcons col="product_name" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Category</span><SortIcons col="category_id" />
                                    </div>
                                </th>
                                <th>Unit</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Remaining</span><SortIcons col="remaining" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Expiry Date</span><SortIcons col="expiry_date" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Days Left</span><SortIcons col="days_left" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Purchase Date</span><SortIcons col="purchase_date" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8}>
                                    <div className="loading-spinner">
                                        <div className="spinner"></div>
                                        <p>Loading...</p>
                                    </div>
                                </td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan={8} style={{ textAlign: 'center' }}>
                                    No records found.
                                </td></tr>
                            ) : items.map((item, index) => {
                                const rowNumber  = pagination ? pagination.first_item + index : index + 1;
                                const isExpired  = item.days_left !== null && item.days_left <= 0;
                                const isSoon     = item.days_left !== null && item.days_left > 0 && item.days_left <= 30;
                                const rowClass   = isExpired ? styles['expired-row'] : isSoon ? styles['expiring-row'] : '';
                                return (
                                    <tr key={item.id} className={rowClass}>
                                        <td>{rowNumber}</td>
                                        <td>{item.product_name}</td>
                                        <td>{item.category?.name ?? 'N/A'}</td>
                                        <td>{item.unit ?? 'N/A'}</td>
                                        <td>{Math.floor(item.remaining)}</td>
                                        <td>{formatDate(item.expiry_date)}</td>
                                        <td><BadgeHtml daysLeft={item.days_left} /></td>
                                        <td>{formatDate(item.purchase_date)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    {pagination && <Pagination pagination={pagination}
                        onPageChange={p => { setPage(p); loadData(p, currentDays, sortColumn, sortDirection); }} />}
                </div>
            </div>
        </>
    );
}

function Pagination({ pagination, onPageChange }) {
    const { current_page, last_page, on_first_page, has_more_pages } = pagination;
    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);

    if (last_page <= 1) return null;

    return (
        <div className="custom-pagination">
            {on_first_page
                ? <span className="disabled">« First</span>
                : <a href="#" onClick={() => onPageChange(1)}>« First</a>}
            {on_first_page
                ? <span className="disabled">←</span>
                : <a href="#" onClick={() => onPageChange(current_page - 1)}>←</a>}

            {start > 1 && <span className="dots">...</span>}
            {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                p === current_page
                    ? <span key={p} className="active">{p}</span>
                    : <a key={p} href="#" onClick={() => onPageChange(p)}>{p}</a>
            ))}
            {end < last_page && <span className="dots">...</span>}

            {has_more_pages
                ? <a href="#" onClick={() => onPageChange(current_page + 1)}>→</a>
                : <span className="disabled">→</span>}
            {has_more_pages
                ? <a href="#" onClick={() => onPageChange(last_page)}>Last »</a>
                : <span className="disabled">Last »</span>}
        </div>
    );
}