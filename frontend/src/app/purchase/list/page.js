'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './purchase.module.css';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';


export default function PurchasePage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();

    // ── State ──────────────────────────────────────────
    const [purchases, setPurchases]     = useState([]);
    const [pagination, setPagination]   = useState(null);
    const [loading, setLoading]         = useState(true);
    const [toast, setToast]             = useState(null);

    // Filters / sort
    const [page, setPage]               = useState(1);
    const [typeFilter, setTypeFilter]   = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType]   = useState('product');
    const [sortColumn, setSortColumn]   = useState('purchase_date');
    const [sortDirection, setSortDirection] = useState('desc');

    // Modals
    const [exporting, setExporting]         = useState(false);
    const [importing, setImporting]         = useState(false);
    const [deleteTarget, setDeleteTarget]   = useState(null); // { id, name }
    const [restockTarget, setRestockTarget] = useState(null); // full purchase row
    const [restockLoading, setRestockLoading] = useState(false);

    // Restock form
    const [restockQty, setRestockQty]             = useState('');
    const [restockPurchasedPrice, setRestockPurchasedPrice] = useState('');
    const [restockSoldPrice, setRestockSoldPrice] = useState('');
    const [restockPurchaseDate, setRestockPurchaseDate]     = useState('');
    const [restockNewExpiry, setRestockNewExpiry]           = useState('');
    // Medicine restock
    const [restockBoxes, setRestockBoxes]                   = useState('1');
    const [restockStripsPerBox, setRestockStripsPerBox]     = useState('1');
    const [restockTabletsPerStrip, setRestockTabletsPerStrip] = useState('1');
    const [restockDeduction, setRestockDeduction]           = useState('0');
    const [restockBoxPrice, setRestockBoxPrice]             = useState('');
    const [restockNetTotal, setRestockNetTotal]             = useState('');
    const [restockPricePerItem, setRestockPricePerItem]     = useState('');
    const [restockSoldPriceErr, setRestockSoldPriceErr]     = useState(false);

    const searchTimeout = useRef(null);
    const isMounted = useRef(false);

    // ── Load purchases ─────────────────────────────────
    const loadPurchases = useCallback(async (pg = 1) => {
        setLoading(true);
        try {
            let url = `/api/purchases?page=${pg}&sort_column=${sortColumn}&sort_direction=${sortDirection}&type_filter=${typeFilter}`;
            if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}&search_type=${searchType}`;

            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setPurchases(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load purchases', 'error');
            }
        } catch {
            showToast('An error occurred while loading purchases', 'error');
        } finally {
            setLoading(false);
        }
    }, [sortColumn, sortDirection, typeFilter, searchQuery, searchType]);

    useEffect(() => { loadPurchases(page); }, [sortColumn, sortDirection, typeFilter]);

  // WITH
useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (!searchQuery) return;
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
        setPage(1);
        loadPurchases(1);
    }, 350);
    return () => clearTimeout(searchTimeout.current);
}, [searchQuery, searchType]);

// ADD this new useEffect after the existing search debounce one
useEffect(() => {
    if (!isMounted.current) return;
    if (searchQuery) return;
    setPage(1);
    loadPurchases(1);
}, [searchQuery]);

    // ── Toast ──────────────────────────────────────────
    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    // ── Sort ───────────────────────────────────────────
    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDirection(dir);
        setPage(1);
    }

        // ── Delete ─────────────────────────────────────────
        async function handleSoftDelete() {
            if (!deleteTarget) return;
            try {
                const res  = await apiFetch(`/api/purchases/${deleteTarget.id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    setDeleteTarget(null);
                    loadPurchases(page);
                } else {
                    showToast(data.message, 'error');
                }
            } catch {
                showToast('An error occurred while deleting', 'error');
            }
        }
    
        async function handlePermanentDelete() {
            if (!deleteTarget) return;
            const confirmed = window.confirm(
                `Permanently delete "${deleteTarget.name}"? This cannot be undone.`
            );
            if (!confirmed) return;
    
            try {
                const res  = await apiFetch(`/api/purchases/${deleteTarget.id}?permanent=true`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    setDeleteTarget(null);
                    loadPurchases(page);
                } else {
                    showToast(data.message, 'error');
                }
            } catch {
                showToast('An error occurred while deleting', 'error');
            }
        }

    // ── Restock open ───────────────────────────────────
    function openRestock(purchase) {
        setRestockTarget(purchase);
        setRestockQty('');
        setRestockPurchasedPrice(purchase.purchased_price > 0 ? String(purchase.purchased_price) : '');
        setRestockSoldPrice(purchase.sold_price > 0 ? String(purchase.sold_price) : '');
        setRestockPurchaseDate(purchase.purchase_date?.split('T')[0] || '');
        setRestockNewExpiry('');
        setRestockBoxes('1');
        setRestockStripsPerBox('1');
        setRestockTabletsPerStrip('1');
        setRestockDeduction('0');
        setRestockBoxPrice('');
        setRestockNetTotal('');
        setRestockPricePerItem('');
        setRestockSoldPriceErr(false);
    }

    // Medicine live calc
    useEffect(() => {
        if (!restockTarget || restockTarget.type !== 'medicine') return;
        const b   = parseFloat(restockBoxes) || 0;
        const spb = parseFloat(restockStripsPerBox) || 0;
        const tps = parseFloat(restockTabletsPerStrip) || 0;
        const ded = parseFloat(restockDeduction) || 0;
        const bp  = parseFloat(restockBoxPrice) || 0;
        const tabletsPerBox  = spb * tps;
        const totalTablets   = b * tabletsPerBox;
        const net            = Math.max(0, totalTablets - ded);
        const pricePerTablet = tabletsPerBox > 0 ? bp / tabletsPerBox : 0;
        setRestockNetTotal(net > 0 ? String(net) : '');
        setRestockPricePerItem(pricePerTablet > 0 ? pricePerTablet.toFixed(2) : '');
    }, [restockBoxes, restockStripsPerBox, restockTabletsPerStrip, restockDeduction, restockBoxPrice, restockTarget]);

    // Sold price validation
    useEffect(() => {
        if (!restockTarget) return;
        const sp = parseFloat(restockSoldPrice) || 0;
        const pp = parseFloat(restockTarget.type === 'medicine' ? restockPricePerItem : restockPurchasedPrice) || parseFloat(restockTarget.purchased_price) || 0;
        setRestockSoldPriceErr(sp > 0 && pp > 0 && sp < pp);
    }, [restockSoldPrice, restockPurchasedPrice, restockPricePerItem, restockTarget]);

    useEffect(() => {
        function handleKeyDown(e) {
            // F2 → focus search
            if (e.key === 'F2') {
                e.preventDefault();
                document.querySelector('.search-container .input')?.focus();
            }
    
            // Alt+A → click Add button
            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                router.push('/purchase/add');
            }
    
            // Alt+M → focus first ⋮ button
            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
                e.preventDefault();
                const buttons = Array.from(document.querySelectorAll('.dropdown-toggle'))
                    .filter(b => b.getClientRects().length > 0 && !b.disabled);
                if (buttons.length) buttons[0].focus();
            }
    
            // ArrowUp/Down → navigate between ⋮ buttons
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const buttons = Array.from(document.querySelectorAll('.dropdown-toggle'))
                    .filter(b => b.getClientRects().length > 0 && !b.disabled);
                if (!buttons.length) return;
                const currentIndex = buttons.indexOf(document.activeElement);
                if (currentIndex === -1) return;
                e.preventDefault();
                if (e.key === 'ArrowDown' && currentIndex < buttons.length - 1) {
                    buttons[currentIndex + 1].focus();
                }
                if (e.key === 'ArrowUp' && currentIndex > 0) {
                    buttons[currentIndex - 1].focus();
                }
            }
        }
    
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [router]);

    // ── Restock submit ─────────────────────────────────
    async function handleRestockSubmit(e) {
        e.preventDefault();
        if (restockSoldPriceErr) { showToast('Sold price cannot be less than purchased price.', 'error'); return; }
        setRestockLoading(true);
        try {
            const isMedicine = restockTarget.type === 'medicine';
            const body = {
                purchase_date: restockPurchaseDate,
                new_expiry_date: restockNewExpiry || null,
            };
            if (isMedicine) {
                body.medicine_quantity = restockNetTotal;
                body.restock_medicine_purchased_price = restockPricePerItem;
                body.restock_medicine_sold_price = restockSoldPrice;
            } else {
                body.quantity = restockQty;
                body.restock_purchased_price = restockPurchasedPrice;
                body.restock_sold_price = restockSoldPrice;
            }

            const res  = await apiFetch(`/api/purchases/${restockTarget.id}/restock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                setRestockTarget(null);
            
                // Silently patch local state
                setPurchases(prev => prev.map(p => {
                    if (p.id !== restockTarget.id) return p;
                    const isMedicine = restockTarget.type === 'medicine';
                    const addedQty = isMedicine
                        ? parseInt(restockNetTotal) || 0
                        : parseInt(restockQty) || 0;
                    const isExpired = restockTarget.expiry_date && isExpiredFn(restockTarget.expiry_date);
                    const newQty = isExpired ? addedQty : Math.round(parseFloat(p.quantity)) + addedQty;
                    return {
                        ...p,
                        quantity: newQty,
                        remaining: newQty - (p.sold_quantity ?? 0),
                        purchased_price: isMedicine
                            ? (parseFloat(restockPricePerItem) || p.purchased_price)
                            : (parseFloat(restockPurchasedPrice) || p.purchased_price),
                        sold_price: parseFloat(restockSoldPrice) || p.sold_price,
                        expiry_date: restockNewExpiry || p.expiry_date,
                        purchase_date: restockPurchaseDate || p.purchase_date,
                    };
                }));
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Request failed. Try again.', 'error');
        } finally {
            setRestockLoading(false);
        }
    }

    // ── Helpers ────────────────────────────────────────
    function formatDate(str) {
        if (!str) return '-';
        const parts = String(str).split('T')[0].split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(parts[2])}-${months[parseInt(parts[1]) - 1]}-${parts[0]}`;
    }

    function isExpiredFn(expiry_date) {
        if (!expiry_date) return false;
        const today = new Date(); today.setHours(0,0,0,0);
        const exp   = new Date(expiry_date + 'T00:00:00');
        return exp <= today;
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

    async function handleExport() {
        setExporting(true);
        try {
            const res = await apiFetch('/api/purchases/export');
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url  = window.URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url;
            a.download = `purchases-backup-${new Date().toISOString().slice(0, 10)}.sql`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('Purchases exported successfully', 'success');
        } catch (err) {
            showToast(err.message || 'Export failed', 'error');
        } finally {
            setExporting(false);
        }
    }
    
    async function handleImport(file) {
        if (!file || !file.name.endsWith('.sql')) {
            showToast('Please select a valid .sql file', 'error');
            return;
        }
        if (!confirm('⚠️ WARNING: This will replace your Purchase table!\n\nContinue?')) return;
    
        setImporting(true);
        const formData = new FormData();
        formData.append('sql_file', file);
        try {
            const res  = await apiFetch(`/api/purchases/import`, { method: 'POST', body: formData });
            const data = await res.json();
            showToast(data.message, data.success ? 'success' : 'error');
            if (data.success) setTimeout(() => loadPurchases(page), 2000);
        } catch {
            showToast('Import failed', 'error');
        } finally {
            setImporting(false);
        }
        document.getElementById('importFileInput').value = '';
    }

    const isExpiredRestock = restockTarget?.expiry_date && isExpiredFn(restockTarget.expiry_date);

    return (
        <>
                 {/* Toast */}
                 {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.message}
                </div>
            )}

            {/* Export/Import overlay */}
            {(exporting || importing) && (
                <div className={styles.overlay}>
                    <div className={styles.overlayBox}>
                        <div className={styles.overlaySpinner}></div>
                        <p className={styles.overlayText}>
                            {exporting ? 'Exporting purchases…' : 'Importing purchases…'}
                        </p>
                        <p className={styles.overlayHint}>Please don&apos;t close this window.</p>
                    </div>
                </div>
            )}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Products in the Store</h1>
                </div>
                <div className="container-child sub-text">
                    <p>View Purchase Products</p>
                </div>

                <div className="sub-container">
                    {/* Top bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        {/* Type filter */}
                        <div className="productsServicesDropdown">
                            <select
                                id="productsServicesTypeFilter"
                                value={typeFilter}
                                onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                                style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', fontSize: 15 }}
                            >
                                <option value="all">All</option>
                                <option value="products">Products</option>
                                <option value="services">Services</option>
                            </select>
                        </div>

                        {/* Add button */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
    {/* Export / Import */}
    <div style={{ display: 'flex', gap: 8 }}>
        {!isBlocked('purchase.list.act.export') && (
            <button
                onClick={handleExport}
                style={{ background: 'rgb(27,42,65)', color: 'white', padding: '8px 12px', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Export Purchase
            </button>
        )}
        {!isBlocked('purchase.list.act.import') && (
            <button
                onClick={() => document.getElementById('importFileInput').click()}
                style={{ background: 'rgb(45,60,85)', color: 'white', padding: '8px 12px', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Import Purchase
            </button>
        )}
        <input type="file" id="importFileInput" accept=".sql" style={{ display: 'none' }}
            onChange={e => handleImport(e.target.files[0])} />
    </div>
    {/* Add button */}
    <div className="add-button">
        <button onClick={() => router.push('/purchase/add')}>
            <span>Add</span>
        </button>
    </div>
</div>
                    </div>

                    {/* Search bar */}
                    <div className="report-search-container">
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 5 }}>
                            <p style={{ position: 'relative', top: 9, fontSize: 14 }}>Search by:</p>
                            <select
                                value={searchType}
                                onChange={e => setSearchType(e.target.value)}
                                style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', fontSize: 15 }}
                            >
                                <option value="product">Product Name</option>
                                <option value="service">Service Name</option>
                                <option value="product_code">Code / Model</option>
                                <option value="category">Category</option>
                                <option value="unit">Unit</option>
                            </select>
                        </div>
                        <div className="search-container" style={{ marginLeft: 5 }}>
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
                    <table id="purchaseTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Name</span><SortIcons col="product_name" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Code / Model</span><SortIcons col="product_code" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Category</span><SortIcons col="category_id" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Unit</span><SortIcons col="unit" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Remaining Qty</span><SortIcons col="remaining" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Date</span><SortIcons col="purchase_date" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Expiry Date</span><SortIcons col="expiry_date" />
                                    </div>
                                </th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="purchaseTableBody">
                            {loading ? (
                                <tr>
                                    <td colSpan={9}>
                                        <div className="loading-spinner">
                                            <div className="spinner"></div>
                                            <p>Loading...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : purchases.length === 0 ? (
                                <tr><td colSpan={9}>No purchases found</td></tr>
                            ) : purchases.map((purchase, index) => {
                                const rowNumber = pagination ? pagination.first_item + index : index + 1;
                                const expired   = isExpiredFn(purchase.expiry_date);
                                return (
<tr key={purchase.id} className={expired ? styles['danger-row'] : ''}>
                                        <td>{rowNumber}</td>
                                        <td>
                                            {purchase.product_name}
                                            {purchase.type === 'service' && (
                                                <span style={{ color: '#666', fontSize: 12 }}> (Service)</span>
                                            )}
                                        </td>
                                        <td>{purchase.product_code ?? 'N/A'}</td>
                                        <td>{purchase.category ? purchase.category.name : 'N/A'}</td>
                                        <td>{purchase.unit}</td>
                                        <td>{purchase.type === 'service' ? '-' : purchase.remaining}</td>
                                        <td>{formatDate(purchase.purchase_date)}</td>
                                        <td>
                                            {purchase.type !== 'service' && purchase.expiry_date
                                                ? <>
                                                    {formatDate(purchase.expiry_date)}
                                                    {expired && (
                                                        <span style={{
                                                            background: '#c0392b', color: '#fff',
                                                            fontSize: 11, padding: '1px 6px',
                                                            borderRadius: 10, fontWeight: 'bold', marginLeft: 4
                                                        }}>Expired</span>
                                                    )}
                                                </>
                                                : '-'
                                            }
                                        </td>
                                        <td>
                                            <ActionDropdown
                                                purchase={purchase}
                                                onEdit={() => router.push(`/purchase/${purchase.id}/edit`)}
                                                onDelete={() => setDeleteTarget({ id: purchase.id, name: purchase.product_name })}
                                                onView={() => router.push(`/purchase/list/${purchase.id}`)}
                                                onRestock={() => openRestock(purchase)}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    {pagination && <Pagination pagination={pagination} onPageChange={p => { setPage(p); loadPurchases(p); }} searchQuery={searchQuery} />}
                </div>
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

            {/* ── Restock Modal ────────────────────────── */}
            {restockTarget && (
        <div className={styles.modal} style={{ display: 'flex', marginTop: 20 }}>
                    <div className={styles['modal-content']}>
                        <h3 id="restockProductName">Restock {restockTarget.product_name}</h3>
                        <form onSubmit={handleRestockSubmit} style={{ marginTop: 10, width: '100%' }}>

                            {/* Expired warning */}
                            {isExpiredRestock && restockTarget.remaining > 0 && (
                                <div style={{
                                    background: '#fff3cd', borderLeft: '4px solid #ffc107',
                                    padding: '10px 14px', marginBottom: 12, borderRadius: 4,
                                    fontSize: 13, color: '#856404', textAlign: 'left', width: '100%'
                                }}>
                                    ⚠️ <strong>This product is expired</strong> with <strong>{restockTarget.remaining}</strong> units remaining.<br />
                                    On restock, the expired stock will be written off and replaced with new stock.
                                </div>
                            )}

                            {/* Product fields */}
                            {restockTarget.type !== 'medicine' && (
                                <>
<div className={styles['modal-field']}>
<label>Quantity:</label>
                                        <input type="number" placeholder="Enter quantity to add"
                                            value={restockQty} onChange={e => setRestockQty(e.target.value)} required />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                    <label>Purchased Price (optional):</label>
                                        <input type="number" step="0.01" placeholder="Leave empty to keep current"
                                            value={restockPurchasedPrice} onChange={e => setRestockPurchasedPrice(e.target.value)} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                        <label>Sold Price (optional):</label>
                                        <input type="number" step="0.01" placeholder="Leave empty to keep current"
                                            value={restockSoldPrice} onChange={e => setRestockSoldPrice(e.target.value)} />
                                    </div>
                                    {restockSoldPriceErr && (
                                        <small style={{ color: '#dc3545', display: 'block', textAlign: 'left', width: '100%', marginTop: 4 }}>
                                            ⚠️ Sold price cannot be less than purchased price.
                                        </small>
                                    )}
                                </>
                            )}

                            {/* Medicine fields */}
                            {restockTarget.type === 'medicine' && (
                                <>
<div className={styles['modal-field']}>
<label>Packages:</label>
                                        <input type="number" min="1" value={restockBoxes} onChange={e => setRestockBoxes(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                    <label>Units per Package:</label>
                                        <input type="number" min="1" value={restockStripsPerBox} onChange={e => setRestockStripsPerBox(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                    <label>Items per Unit:</label>
                                        <input type="number" min="1" value={restockTabletsPerStrip} onChange={e => setRestockTabletsPerStrip(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                    <label>Already Used / Deduct:</label>
                                        <input type="number" min="0" value={restockDeduction} onChange={e => setRestockDeduction(e.target.value)} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                    <label>Net Total:</label>
                                        <input type="number" value={restockNetTotal} readOnly style={{ background: '#f0f0f0' }} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                    <label>Package Price (optional):</label>
                                        <input type="number" step="0.01" placeholder="Leave empty to keep current"
                                            value={restockBoxPrice} onChange={e => setRestockBoxPrice(e.target.value)} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                    <label>Price Per Item:</label>
                                        <input type="number" value={restockPricePerItem} readOnly style={{ background: '#f0f0f0' }} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                        <label>Sold Price (optional):</label>
                                        <input type="number" step="0.01" placeholder="Leave empty to keep current"
                                            value={restockSoldPrice} onChange={e => setRestockSoldPrice(e.target.value)} />
                                    </div>
                                    {restockSoldPriceErr && (
                                        <small style={{ color: '#dc3545', display: 'block', textAlign: 'left', width: '100%', marginTop: 4 }}>
                                            ⚠️ Sold price cannot be less than purchased price.
                                        </small>
                                    )}
                                </>
                            )}

                            <br />
                            {/* New expiry date */}
                            <div className={styles['modal-field']}>
                                <label>Expiry Date (Optional):</label>
                                <input type="date" value={restockNewExpiry} onChange={e => setRestockNewExpiry(e.target.value)} />
                            </div>
                            <br />
                            <div className={styles['modal-field']}>
                            <label>Purchase Date:</label>
                                <input type="date" value={restockPurchaseDate}
                                    onChange={e => setRestockPurchaseDate(e.target.value)} required />
                            </div>
                            <br />
                            <button type="submit" className={styles['restock-btn']} disabled={restockLoading}>
                                {restockLoading ? 'Processing...' : 'Update Stock'}
                            </button>
                            <button type="button" className={styles['close-btn']} onClick={() => setRestockTarget(null)}>
                                Cancel
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

// ── Action Dropdown ────────────────────────────────────
function ActionDropdown({ purchase, onEdit, onDelete, onView, onRestock }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const { isBlocked } = usePermissions();

    useEffect(() => {
        function handler(e) {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const canRestock = (purchase.type === 'product' || purchase.type === 'medicine')
        && !isBlocked('purchase.list.act.restock');

    return (
        <div className="dropdown" ref={ref}>
            <button className="dropdown-toggle" onClick={() => setOpen(o => !o)}>⋮</button>
            {open && (
                <div className={styles['purchase-dropdown-menu']} style={{ display: 'block' }}>
                    {!isBlocked('purchase.list.act.edit') && (
                        <a href="#" onClick={() => { setOpen(false); onEdit(); }}>Edit</a>
                    )}
                    {!isBlocked('purchase.list.act.delete') && (
                        <button type="button" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
                    )}
                    <a href="#" onClick={() => { setOpen(false); onView(); }}>View Detail</a>
                    {canRestock && (
                        <button type="button" onClick={() => { setOpen(false); onRestock(); }}>Restock</button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Pagination ─────────────────────────────────────────
function Pagination({ pagination, onPageChange, searchQuery }) {
    const { current_page, last_page, on_first_page, has_more_pages, total } = pagination;

    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);

    if (last_page <= 1) return null;

    return (
        <>
        {searchQuery && total > 0 && (
            <div style={{ textAlign: 'center', color: '#666', fontSize: 14, marginBottom: 10 }}>
                Found <strong>{total}</strong> result{total !== 1 ? 's' : ''} for "{searchQuery}"
            </div>
        )}
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
        </>
    );
}