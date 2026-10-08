'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";

export default function SupplierDetailPage() {
    const { id }  = useParams();
    const router  = useRouter();

    const [supplier, setSupplier]       = useState(null);
    const [purchases, setPurchases]     = useState([]);
    const [pagination, setPagination]   = useState(null);
    const [loading, setLoading]         = useState(true);
    const [toast, setToast]             = useState(null);
    const [page, setPage]               = useState(1);
    const [sortColumn, setSortColumn]   = useState('purchase_date');
    const [sortDirection, setSortDirection] = useState('desc');
    const [searchQuery, setSearchQuery] = useState('');

    const searchTimeout = useRef(null);
    const isMounted = useRef(false);

    const loadData = useCallback(async (pg = 1) => {
        setLoading(true);
        try {
            let url = `/api/suppliers/${id}/purchases?page=${pg}&sort_column=${sortColumn}&sort_direction=${sortDirection}`;
            if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setSupplier(data.supplier);
                setPurchases(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load data', 'error');
            }
        } catch {
            showToast('An error occurred', 'error');
        } finally {
            setLoading(false);
        }
    }, [id, sortColumn, sortDirection, searchQuery]);

    useEffect(() => { loadData(page); }, [sortColumn, sortDirection]);

    // WITH
useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    clearTimeout(searchTimeout.current);
    if (!searchQuery) { setPage(1); loadData(1); return; }
    searchTimeout.current = setTimeout(() => {
        setPage(1);
        loadData(1);
    }, 350);
    return () => clearTimeout(searchTimeout.current);
}, [searchQuery]);

    // F2 focus search
    useEffect(() => {
        function handler(e) {
            if (e.key === 'F2') {
                e.preventDefault();
                document.querySelector('.search-container .input')?.focus();
            }
        }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDirection(dir);
        setPage(1);
    }

    function formatDate(str) {
        if (!str) return 'N/A';
        const parts = String(str).split('T')[0].split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(parts[2])}-${months[parseInt(parts[1]) - 1]}-${parts[0]}`;
    }


    function SortIcons({ col }) {
        return (
            <span className="sort-icons">
                <span className={`sort-up${sortColumn === col && sortDirection === 'asc' ? ' active' : ''}`}
                    onClick={() => handleSort(col, 'asc')}>▲</span>
                <span className={`sort-down${sortColumn === col && sortDirection === 'desc' ? ' active' : ''}`}
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
                    <h1>Suppliers Directory</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Products supplied by <strong>{supplier?.name ?? '...'}</strong></p>
                    <button type="button" className="boton-elegante" onClick={() => router.back()}>← Back</button>
                </div>

                <div className="sub-container">
                    {/* Search */}
                    <div className="report-search-container">
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
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

                    {/* Table */}
                    <table id="singleSearchTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th className="sortable"><div className="sortable-header"><span>Product Name</span><SortIcons col="product_name" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Category</span><SortIcons col="category_id" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Purchased Price</span><SortIcons col="purchased_price" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Quantity</span><SortIcons col="quantity" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Unit</span><SortIcons col="unit" /></div></th>
                                <th>Total</th>
                                <th className="sortable"><div className="sortable-header"><span>Date</span><SortIcons col="purchase_date" /></div></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8}>
                                    <div className="loading-spinner"><div className="spinner"></div><p>Loading purchases...</p></div>
                                </td></tr>
                            ) : purchases.length === 0 ? (
                                <tr><td colSpan={8}>No purchases found.</td></tr>
                            ) : purchases.map((p, index) => {
                                const rowNumber = pagination ? pagination.first_item + index : index + 1;
                                return (
                                    <tr key={p.id}>
                                        <td style={{padding:'12px 0'}}>{rowNumber}</td>
                                        <td>{p.product_name}</td>
                                        <td>{p.category?.name ?? 'N/A'}</td>
                                        <td>{formatPrice(p.purchased_price)}</td>
                                        <td>{parseFloat(p.quantity)}</td>
                                        <td>{p.unit}</td>
                                        <td>{formatPrice(p.total)}</td>
                                        <td>{formatDate(p.purchase_date)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {pagination && (
                        <Pagination
                            pagination={pagination}
                            onPageChange={p => { setPage(p); loadData(p); }}
                            searchQuery={searchQuery}
                        />
                    )}
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