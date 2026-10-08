'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import styles from '../list/purchase.module.css';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';

export default function LowInventoryPage() {
    const {isBlocked} = usePermissions();
    const [purchases, setPurchases]   = useState([]);
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading]       = useState(true);
    const [toast, setToast]           = useState(null);

    const [page, setPage]                     = useState(1);
    const [sortColumn, setSortColumn]         = useState('remaining');
    const [sortDirection, setSortDirection]   = useState('asc');

    // Restock modal state
    const [restockTarget, setRestockTarget]       = useState(null);
    const [restockLoading, setRestockLoading]     = useState(false);
    const [restockQty, setRestockQty]             = useState('');
    const [restockPurchasedPrice, setRestockPurchasedPrice] = useState('');
    const [restockSoldPrice, setRestockSoldPrice]           = useState('');
    const [restockPurchaseDate, setRestockPurchaseDate]     = useState('');
    const [restockNewExpiry, setRestockNewExpiry]           = useState('');
    const [restockBoxes, setRestockBoxes]                   = useState('1');
    const [restockStripsPerBox, setRestockStripsPerBox]     = useState('1');
    const [restockTabletsPerStrip, setRestockTabletsPerStrip] = useState('1');
    const [restockDeduction, setRestockDeduction]           = useState('0');
    const [restockBoxPrice, setRestockBoxPrice]             = useState('');
    const [restockNetTotal, setRestockNetTotal]             = useState('');
    const [restockPricePerItem, setRestockPricePerItem]     = useState('');
    const [restockSoldPriceErr, setRestockSoldPriceErr]     = useState(false);

    // ── Load data ──────────────────────────────────────
    const loadLowInventory = useCallback(async (pg = 1) => {
        setLoading(true);
        try {
            const res  = await apiFetch(`/api/purchases/low-inventory?page=${pg}&sort_column=${sortColumn}&sort_direction=${sortDirection}`);
            const data = await res.json();
            if (data.success) {
                setPurchases(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load low inventory products', 'error');
            }
        } catch {
            showToast('An error occurred while loading products', 'error');
        } finally {
            setLoading(false);
        }
    }, [sortColumn, sortDirection]);

    useEffect(() => { loadLowInventory(page); }, [sortColumn, sortDirection]);

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

    // ── Helpers ────────────────────────────────────────
    function formatDate(str) {
        if (!str) return 'N/A';
        const parts  = String(str).split('T')[0].split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${parseInt(parts[2])} ${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
    }

    function isExpiredFn(expiry_date) {
        if (!expiry_date) return false;
        const today = new Date(); today.setHours(0,0,0,0);
        const exp   = new Date(expiry_date + 'T00:00:00');
        return exp <= today;
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
        const pp = parseFloat(restockTarget.type === 'medicine' ? restockPricePerItem : restockPurchasedPrice)
                   || parseFloat(restockTarget.purchased_price) || 0;
        setRestockSoldPriceErr(sp > 0 && pp > 0 && sp < pp);
    }, [restockSoldPrice, restockPurchasedPrice, restockPricePerItem, restockTarget]);

    // Alt+R → focus first restock button
    useEffect(() => {
        function handleKeyDown(e) {
            if (!e.altKey || e.ctrlKey || e.shiftKey) return;
            if (e.key.toLowerCase() !== 'r') return;
            e.preventDefault();
            const btns = Array.from(document.querySelectorAll('.restock-btn'))
                .filter(b => b.getClientRects().length > 0 && !b.disabled);
            if (btns.length) btns[0].focus();
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

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
                loadLowInventory(page);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Request failed. Try again.', 'error');
        } finally {
            setRestockLoading(false);
        }
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

            <div className="container">
                <div className="container-child main-text">
                    <h1>Low Inventory Products</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Low inventory alert: products with fewer units</p>
                </div>

                <div className="sub-container">
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Product</span><SortIcons col="product_name" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Category</span><SortIcons col="category_id" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Supplier</span><SortIcons col="supplier_id" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Remaining</span><SortIcons col="remaining" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Purchase Date</span><SortIcons col="purchase_date" />
                                    </div>
                                </th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7}>
                                        <div className="loading-spinner">
                                            <div className="spinner"></div>
                                            <p>Loading low inventory products...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : purchases.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center' }}>
                                        No low inventory products found.
                                    </td>
                                </tr>
                            ) : purchases.map((purchase, index) => {
                                const rowNumber = pagination ? pagination.first_item + index : index + 1;
                                const isDanger  = purchase.remaining <= 0;
                                return (
<tr key={purchase.id} className={isDanger ? styles['danger-row'] : ''}>
                                        <td style={{padding:'10px 0'}}>{rowNumber}</td>
                                        <td>{purchase.product_name}</td>
                                        <td>{purchase.category ? purchase.category.name : 'N/A'}</td>
                                        <td>{purchase.supplier ? purchase.supplier.name : 'N/A'}</td>
                                        <td style={{ color: 'red', fontWeight: 'bold' }}>
                                            {Math.floor(purchase.remaining)}
                                        </td>
                                        <td>{formatDate(purchase.purchase_date)}</td>
                                        <td>
                                        {!isBlocked('purchase.low-inventory.act.restock') &&(
                                            <button
className={styles['restock-btnn']}
                                                onClick={() => openRestock(purchase)}
                                            >
                                                Restock
                                            </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    {pagination && pagination.last_page > 1 && (
                        <Pagination
                            pagination={pagination}
                            onPageChange={p => { setPage(p); loadLowInventory(p); }}
                        />
                    )}
                </div>
            </div>

            {/* ── Restock Modal ────────────────────────── */}
            {restockTarget && (
                <div className={styles.modal} style={{ display: 'flex', marginTop: 20 }}>
<div className={styles['modal-content']}>
                        <h3>Restock {restockTarget.product_name}</h3>
                        <form onSubmit={handleRestockSubmit} style={{ marginTop: 10, width: '100%' }}>

                            {/* Expired warning */}
                            {isExpiredRestock && restockTarget.remaining > 0 && (
                                <div style={{
                                    display: 'block', background: '#fff3cd',
                                    borderLeft: '4px solid #ffc107', padding: '10px 14px',
                                    marginBottom: 12, borderRadius: 4, fontSize: 13,
                                    color: '#856404', textAlign: 'left', width: '100%'
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
                                            value={restockQty} onChange={e => setRestockQty(e.target.value)} />
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
                                        <input type="number" min="1" value={restockBoxes}
                                            onChange={e => setRestockBoxes(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                        <label>Units per Package:</label>
                                        <input type="number" min="1" value={restockStripsPerBox}
                                            onChange={e => setRestockStripsPerBox(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                        <label>Items per Unit:</label>
                                        <input type="number" min="1" value={restockTabletsPerStrip}
                                            onChange={e => setRestockTabletsPerStrip(e.target.value)} />
                                    </div>
                                    <br />
                                    <div className={styles['modal-field']}>
                                        <label>Already Used / Deduct:</label>
                                        <input type="number" min="0" value={restockDeduction}
                                            onChange={e => setRestockDeduction(e.target.value)} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                        <label>Net Total:</label>
                                        <input type="number" value={restockNetTotal} readOnly
                                            style={{ background: '#f0f0f0' }} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                        <label>Package Price (optional):</label>
                                        <input type="number" step="0.01" placeholder="Leave empty to keep current"
                                            value={restockBoxPrice} onChange={e => setRestockBoxPrice(e.target.value)} />
                                    </div>
                                    <div className={styles['modal-field']} style={{ marginTop: 10 }}>
                                        <label>Price Per Item:</label>
                                        <input type="number" value={restockPricePerItem} readOnly
                                            style={{ background: '#f0f0f0' }} />
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
                            <div className={styles['modal-field']}>
                                <label>Expiry Date (Optional):</label>
                                <input type="date" value={restockNewExpiry}
                                    onChange={e => setRestockNewExpiry(e.target.value)} />
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

// ── Pagination ─────────────────────────────────────────
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