'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Swal from 'sweetalert2';
import { apiFetch } from '@/lib/api';
import { useCurrency } from '@/lib/currency-context';
import styles from './walk-in-return.module.css';
import './walk-in-return2.css';

// ─── Calc helpers (mirror JS in blade) ───────────────
function calcLineTotal(row) {
    const subtotal = row.price * row.qty;

    let discountAmount = 0;
    if (row.discType === 'percentage') discountAmount = subtotal * (row.discVal / 100);
    else if (row.discType === 'amount') discountAmount = Math.min(row.discVal, subtotal);

    const afterDiscount = subtotal - discountAmount;

    let taxAmount = 0;
    if (row.taxType === 'percentage') taxAmount = afterDiscount * (row.taxVal / 100);
    else if (row.taxType === 'amount') taxAmount = row.taxVal;

    return { subtotal, discountAmount, taxAmount, refund: afterDiscount + taxAmount };
}

function calcSummary(rows, saleDiscType, saleDiscValue, saleTaxType, saleTaxValue) {
    let totalSubtotal = 0, totalDiscount = 0, totalTax = 0, totalRefund = 0;

    rows.forEach(row => {
        const t = calcLineTotal(row);
        totalSubtotal += t.subtotal;
        totalDiscount += t.discountAmount;
        totalTax      += t.taxAmount;
        totalRefund   += t.refund;
    });

    // Sale-level discount
    let saleDiscAmount = 0;
    if (saleDiscType === 'percentage') saleDiscAmount = totalRefund * (saleDiscValue / 100);
    else if (saleDiscType === 'amount') saleDiscAmount = Math.min(saleDiscValue, totalRefund);
    totalRefund   -= saleDiscAmount;
    totalDiscount += saleDiscAmount;

    // Sale-level tax
    let saleTaxAmount = 0;
    if (saleTaxType === 'percentage') saleTaxAmount = totalRefund * (saleTaxValue / 100);
    else if (saleTaxType === 'amount') saleTaxAmount = saleTaxValue;
    totalRefund += saleTaxAmount;
    totalTax    += saleTaxAmount;

    return { totalSubtotal, totalDiscount, totalTax, totalRefund, saleDiscAmount, saleTaxAmount };
}

// ─── Main page ────────────────────────────────────────
export default function WalkInReturnPage() {
    const { formatPrice } = useCurrency();
    // rows state
    const [rows, setRows]       = useState([]);
    const rowIdRef              = useRef(0);

      // search
      const [searchQ, setSearchQ]         = useState('');
      const [dropdown, setDropdown]       = useState([]);
      const [dropOpen, setDropOpen]       = useState(false);
      const [activeIdx, setActiveIdx]     = useState(0); // keyboard-highlighted item
      const searchRef                     = useRef(null);
      const searchTimer                   = useRef(null);
      const addProductRef                 = useRef(null); // latest addProduct for the scanner
  

    // customer info
    const [custName, setCustName]   = useState('');
    const [custCity, setCustCity]   = useState('');
    const [shopName, setShopName]   = useState('');
    const [contactNo, setContactNo] = useState('');
    const [notes, setNotes]         = useState('');

    // sale-level adj
    const [saleDiscType,  setSaleDiscType]  = useState('');
    const [saleDiscValue, setSaleDiscValue] = useState(0);
    const [saleTaxType,   setSaleTaxType]   = useState('');
    const [saleTaxValue,  setSaleTaxValue]  = useState(0);

    // submit state
    const [submitting, setSubmitting] = useState(false);
    const [alert, setAlert]           = useState(null); // {type:'success'|'error', msg}

    // ── Summary ─────────────────────────────────────────
    const summary = calcSummary(rows, saleDiscType, saleDiscValue, saleTaxType, saleTaxValue);

      // ── Search products ──────────────────────────────────
      const fetchProducts = useCallback((q) => {
        apiFetch(`/api/walk-in-return/search-products?q=${encodeURIComponent(q)}`)
            .then(r => r.json())
            .then(data => {
                setDropdown(Array.isArray(data) ? data : []);
                setActiveIdx(0);
                setDropOpen(true);
            })
            .catch(() => {});
    }, []);

    const handleSearchInput = (e) => {
        const q = e.target.value;
        setSearchQ(q);
        clearTimeout(searchTimer.current);
        if (q.trim().length < 2) { setDropOpen(false); return; } // same rule as sales/create
        searchTimer.current = setTimeout(() => fetchProducts(q.trim()), 200);
    };


    // ── Barcode / QR scanner global handler (works wherever focus is) ──
    useEffect(() => {
        const SCAN_GAP_MS = 50; // scanner keys arrive < 50ms apart, humans are slower
        const MIN_LEN = 4;
        let buffer = '';
        let lastKeyTime = 0;
        let startTarget = null; // element that was focused when the scan started
        let startValue = null;  // its value before the first scanned chars leaked in

        const reset = () => { buffer = ''; startTarget = null; startValue = null; };

        // Undo the first chars that leaked into a controlled React input
        const restoreInput = () => {
            const el = startTarget;
            if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
            if (el.value === startValue) return;
            const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, startValue);
            el.dispatchEvent(new Event('input', { bubbles: true })); // fires React onChange
        };

        // No local product list on this page → ask backend, then require an EXACT code match
        const handleScannedCode = async (code) => {
            const c = code.trim().toLowerCase();
            try {
                const res = await apiFetch(`/api/walk-in-return/search-products?q=${encodeURIComponent(code.trim())}`);
                const products = await res.json();
                const found = Array.isArray(products)
                    ? products.find(p => [p.barcode, p.qr_code, p.product_code]
                        .some(v => v && String(v).toLowerCase() === c))
                    : null;
                if (!found) {
                    Swal.fire({ icon: 'warning', title: 'Product not found', text: `No product with code "${code}"`, timer: 1500, showConfirmButton: false });
                    return;
                }
                addProductRef.current(found);
            } catch {
                Swal.fire({ icon: 'error', title: 'Scan failed', text: 'Could not reach server.', timer: 1500, showConfirmButton: false });
            }
        };

        const onKeyDown = (e) => {
            // F2 focuses search
            if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); return; }

            if (e.ctrlKey || e.altKey || e.metaKey) return;
            const now = Date.now();
            const fast = now - lastKeyTime < SCAN_GAP_MS;
            lastKeyTime = now;

            if (e.key === 'Enter') {
                if (fast && buffer.length >= MIN_LEN) {
                    e.preventDefault();
                    e.stopImmediatePropagation(); // don't let search Enter pick a dropdown item
                    const code = buffer;
                    restoreInput();
                    reset();
                    handleScannedCode(code);
                } else {
                    reset();
                }
                return;
            }

            if (e.key.length !== 1) return; // Shift (for uppercase), Tab, arrows…

            if (!fast) {
                reset();
                startTarget = document.activeElement;
                startValue = startTarget?.value ?? null;
            }
            buffer += e.key;

            // From the 3rd fast key on, it's clearly a scanner: keep chars out of inputs
            if (buffer.length > 2) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };

        // capture phase on window → runs before React handlers
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []); // everything is read through refs

    // Close dropdown on outside click (list now lives in the table area)
    useEffect(() => {
        const onClick = (e) => {
            if (!e.target.closest('#searchWrap') && !e.target.closest('#productDropdown')) setDropOpen(false);
        };
        document.addEventListener('click', onClick);
        return () => document.removeEventListener('click', onClick);
    }, []);

    // Keep the keyboard-highlighted item visible while using ↑ / ↓
    useEffect(() => {
        document.querySelector(`#productDropdown [data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIdx]);


    // ── Add product ──────────────────────────────────────
    const addProduct = (p) => {
        setDropOpen(false);
        setSearchQ('');
        searchRef.current?.focus();

        setRows(prev => {
            const existing = prev.find(r => r.purchase_id == p.id);
            if (existing) {
                return prev.map(r => r.purchase_id == p.id ? { ...r, qty: r.qty + 1 } : r);
            }
            const id = ++rowIdRef.current;
            return [...prev, {
                rowId:        id,
                purchase_id:  p.id,
                product_name: p.product_name,
                unit:         p.unit || '',
                qty:          1,
                price:        parseFloat(p.sold_price)  || 0,
                discType:     p.discount_type || '',
                discVal:      parseFloat(p.discount)    || 0,
                taxType:      p.tax_type  || '',
                taxVal:       parseFloat(p.tax)          || 0,
            }];
        });
    };
    addProductRef.current = addProduct;

    // ── Search bar keyboard: ↑ / ↓ highlight, Enter adds, Esc closes ──
    const handleSearchKeyDown = (e) => {
        if (e.key === 'Escape') { setDropOpen(false); return; }
        if (!dropOpen || dropdown.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => (i + 1) % dropdown.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => (i - 1 + dropdown.length) % dropdown.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const p = dropdown[activeIdx];
            if (p) addProduct(p);
        }
    };


    // ── Update row field ─────────────────────────────────
    const updateRow = (rId, field, value) => {
        setRows(prev => prev.map(r => {
            if (r.rowId !== rId) return r;
            const updated = { ...r };
            if (field === 'qty')      updated.qty      = Math.max(1, parseInt(value)   || 1);
            if (field === 'price')    updated.price    = Math.max(0, parseFloat(value) || 0);
            if (field === 'discType') updated.discType = value;
            if (field === 'discVal')  updated.discVal  = Math.max(0, parseFloat(value) || 0);
            if (field === 'taxType')  updated.taxType  = value;
            if (field === 'taxVal')   updated.taxVal   = Math.max(0, parseFloat(value) || 0);
            return updated;
        }));
    };

    // ── Remove row ───────────────────────────────────────
    const removeRow = (rId) => {
        setRows(prev => prev.filter(r => r.rowId !== rId));
    };

    // ── Clear all ────────────────────────────────────────
    const clearAll = () => {
        if (rows.length === 0) return;
        if (!confirm('Clear all items?')) return;
        setRows([]);
        rowIdRef.current = 0;
    };

    // ── Submit ───────────────────────────────────────────
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (rows.length === 0 || submitting) return;
        setSubmitting(true);
        setAlert(null);

        const payload = {
            items: rows.map(r => ({
                purchase_id:       r.purchase_id,
                quantity_returned: r.qty,
                unit_price:        r.price,
                discount_type:     r.discType || null,
                discount_value:    r.discVal,
                tax_type:          r.taxType  || null,
                tax_value:         r.taxVal,
            })),
            sale_discount_type:  saleDiscType  || null,
            sale_discount_value: saleDiscValue || 0,
            sale_tax_type:       saleTaxType   || null,
            sale_tax_value:      saleTaxValue  || 0,
            notes:         notes     || null,
            customer_name: custName  || null,
            customer_city: custCity  || null,
            shop_name:     shopName  || null,
            contact_no:    contactNo || null,
        };

        try {
            const res = await apiFetch('/api/walk-in-return', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');

            setAlert({ type: 'success', msg: 'Walk-in return processed successfully.' });
            setRows([]);
            rowIdRef.current = 0;
            setCustName(''); setCustCity(''); setShopName(''); setContactNo('');
            setNotes('');
            setSaleDiscType(''); setSaleDiscValue(0);
            setSaleTaxType('');  setSaleTaxValue(0);
        } catch (err) {
            setAlert({ type: 'error', msg: err.message || 'Something went wrong.' });
        } finally {
            setSubmitting(false);
        }
    };

    // ── Render ───────────────────────────────────────────
    return (
<div className={styles['wir-wrap']}>

            {/* PAGE HEADING */}
            <div className={styles['wir-page-head']}>
            <div className={styles['wir-icon']}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
                    </svg>
                </div>
                <div>
                    <h1>Return Without Invoice</h1>
                    <p>Scan or search products, fill customer info, then process the refund</p>
                </div>
            </div>

            {/* ALERTS */}
            {alert && (
                <div className={`${styles['wir-alert']} ${styles[alert.type]}`}>
                    {alert.type === 'success'
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    }
                    {alert.msg}
                </div>
            )}

            {/* MAIN GRID */}
            <div className={styles['wir-grid']}>

                {/* ── LEFT PANEL ── */}
                <div className={styles['wir-left']}>

                    {/* Customer Info */}
                    <div className={styles['wir-card']}>
                        <div className={styles['wir-card-head']}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            <span>Customer Info</span>
                            <span className={styles['wir-badge']}>Optional</span>
                        </div>
                        <div className={styles['wir-card-body']}>
                            <div className={styles['wir-field']}>
                                <label>Customer Name</label>
                                <input type="text" maxLength={255} placeholder="e.g. Ahmed Khan" value={custName} onChange={e => setCustName(e.target.value)} />
                            </div>
                            <div className={styles['wir-field']}>
                                <label>City</label>
                                <input type="text" maxLength={255} placeholder="e.g. Lahore" value={custCity} onChange={e => setCustCity(e.target.value)} />
                            </div>
                            <div className={styles['wir-field']}>
                                <label>Shop Name</label>
                                <input type="text" maxLength={255} placeholder="e.g. Al-Noor Store" value={shopName} onChange={e => setShopName(e.target.value)} />
                            </div>
                            <div className={styles['wir-field']}>
                                <label>Contact No</label>
                                <input type="text" maxLength={50} placeholder="e.g. 0300-1234567" value={contactNo} onChange={e => setContactNo(e.target.value)} />
                            </div>
                        </div>
                    </div>

                    {/* Search / Scan */}
                    <div className={styles['wir-card']}>
                        <div className={styles['wir-card-head']}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-2.5-2.5"/></svg>
                            <span>Search / Scan Product</span>
                        </div>
                        <div className={styles['wir-card-body']}>
                        <div className={styles['wir-search-wrap']} id="searchWrap">
                                <input
                                    ref={searchRef}
                                    type="text"
                                    value={searchQ}
                                    onChange={handleSearchInput}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder="Barcode / QR  or  product name / code…"
                                    autoComplete="off"
                                />
 <span className={styles['wir-search-icon']}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-2.5-2.5"/></svg>
                                </span>
                            </div>

                            <p className={styles['wir-scan-hint']}>
                            </p>
                        </div>
                    </div>

                </div>{/* /.wir-left */}

                {/* ── RIGHT PANEL ── */}
                <div className={styles['wir-right']}>

                    {/* Items Table */}
                    <div className={styles['wir-card']}>
                        
                        <div className={styles['wir-card-body']} style={{ padding: 0 }}>
                        <div className={styles['wir-table-wrap']}>
                            {dropOpen && searchQ.trim().length >= 2 ? (
                                <div id="productDropdown">
                                    {dropdown.length === 0
                                        ? <div className={styles['dd-empty']}>No products found</div>
                                        : dropdown.map((p, idx) => (
                                            <div
                                                key={p.id}
                                                data-idx={idx}
                                                className={`${styles['dd-item']} ${idx === activeIdx ? styles['dd-active'] : ''}`}
                                                onMouseEnter={() => setActiveIdx(idx)}
                                                onClick={() => addProduct(p)}
                                            >
                                                <div style={{ minWidth: 0 }}>
                                                    <div className={styles['dd-name']}>{p.product_name}</div>
                                                    <div className={styles['dd-meta']}>
                                                        Code: {p.product_code || '—'} &nbsp;|&nbsp;
                                                        {p.unit || ''} &nbsp;|&nbsp;
                                                        Barcode: {p.barcode || '—'}
                                                    </div>
                                                </div>
                                                <div className={styles['dd-price']}>{formatPrice(p.sold_price)}</div>
                                            </div>
                                        ))
                                    }
                                </div>
                            ) : (
                                <table id="returnItemsTable">

                                    <thead>
                                        <tr>
                                            <th style={{ width: '22%', paddingLeft: 16 }}>Product</th>
                                            <th style={{ width: '7%' }}>Qty</th>
                                            <th style={{ width: '7%' }}>Unit</th>
                                            <th style={{ width: '9%' }}>Price</th>
                                            <th style={{ width: '9%' }}>Disc. Type</th>
                                            <th style={{ width: '7%' }}>Disc.</th>
                                            <th style={{ width: '9%' }}>Tax Type</th>
                                            <th style={{ width: '7%' }}>Tax</th>
                                            <th style={{ width: '10%' }}>Line Total</th>
                                            <th style={{ width: '4%' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.length === 0 ? (
                                            <tr className={styles['empty-state-row']}>
                                                <td colSpan={10}>
                                                <svg className={styles['empty-state-icon']} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                                    Search or scan a product to add it here
                                                </td>
                                            </tr>
                                        ) : rows.map(row => {
                                            const t = calcLineTotal(row);
                                            return (
                                                <tr key={row.rowId}>
                                                    <td style={{ paddingLeft: 16 }}>
                                                        <strong style={{ fontSize: 13, color: 'var(--wir-text)' }}>{row.product_name}</strong>
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="number" min="1" value={row.qty}
                                                            onChange={e => updateRow(row.rowId, 'qty', e.target.value)}
                                                        />
                                                    </td>
                                                    <td><span style={{ color: 'var(--wir-muted)', fontSize: 12 }}>{row.unit}</span></td>
                                                    <td>
                                                        <input
                                                            type="number" min="0" step="0.01" value={row.price}
                                                            onChange={e => updateRow(row.rowId, 'price', e.target.value)}
                                                        />
                                                    </td>
                                                    <td>
                                                        <select value={row.discType} onChange={e => updateRow(row.rowId, 'discType', e.target.value)}>
                                                            <option value="">None</option>
                                                            <option value="percentage">%</option>
                                                            <option value="amount">Amt</option>
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="number" min="0" step="0.01" value={row.discVal}
                                                            onChange={e => updateRow(row.rowId, 'discVal', e.target.value)}
                                                        />
                                                         {row.discType === 'percentage' && row.discVal > 0 && (
                                                            <small style={{ color: '#dc2626', fontSize: 11 }}>({formatPrice(t.discountAmount)})</small>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <select value={row.taxType} onChange={e => updateRow(row.rowId, 'taxType', e.target.value)}>
                                                            <option value="">None</option>
                                                            <option value="percentage">%</option>
                                                            <option value="amount">Amt</option>
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="number" min="0" step="0.01" value={row.taxVal}
                                                            onChange={e => updateRow(row.rowId, 'taxVal', e.target.value)}
                                                        />
                                                                                         {row.taxType === 'percentage' && row.taxVal > 0 && (
                                                            <small style={{ color: '#d97706', fontSize: 11 }}>({formatPrice(t.taxAmount)})</small>
                                                        )}
                                                    </td>
                                                    <td style={{ fontWeight: 700, color: 'var(--wir-success)', whiteSpace: 'nowrap' }}>
                                                        {formatPrice(t.refund)}
                                                    </td>
                                                    <td>
                                                    <button type="button" className={styles['btn-remove-row']} onClick={() => removeRow(row.rowId)} title="Remove">✕</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                            </div>
                        </div>
                    </div>

                    {/* Sale-Level Adjustment */}
                    <div className={styles['wir-card']}>
                        <div className={styles['wir-card-head']}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            <span>Sale-Level Adjustment</span>
                            <span className={styles['wir-badge']}>Optional</span>
                        </div>
                        <div className={styles['wir-card-body']}>
                        <div className={styles['sale-adj-grid']}>
                                <div className={styles['sa-field']}>
                                    <label>Discount Type</label>
                                    <select value={saleDiscType} onChange={e => setSaleDiscType(e.target.value)}>
                                    <option value="">None</option>
                                        <option value="percentage">Percentage (%)</option>
                                        <option value="amount">Fixed Amount</option>
                                    </select>
                                </div>
                                <div className={styles['sa-field']}>
                                    <label>Discount Value</label>
                                    <input type="number" min="0" step="0.01" value={saleDiscValue} onChange={e => setSaleDiscValue(parseFloat(e.target.value) || 0)} />
                                    {saleDiscType === 'percentage' && saleDiscValue > 0 && (
                                        <small style={{ color: '#dc2626', fontSize: 11 }}>({formatPrice(summary.saleDiscAmount)})</small>
                                    )}
                                </div>
                                <div className={styles['sa-field']}>
                                    <label>Tax Type</label>
                                    <select value={saleTaxType} onChange={e => setSaleTaxType(e.target.value)}>
                                    <option value="">None</option>
                                        <option value="percentage">Percentage (%)</option>
                                        <option value="amount">Fixed Amount</option>
                                    </select>
                                </div>
                                <div className={styles['sa-field']}>
                                    <label>Tax Value</label>
                                    <input type="number" min="0" step="0.01" value={saleTaxValue} onChange={e => setSaleTaxValue(parseFloat(e.target.value) || 0)} />
                                    {saleTaxType === 'percentage' && saleTaxValue > 0 && (
                                        <small style={{ color: '#d97706', fontSize: 11 }}>({formatPrice(summary.saleTaxAmount)})</small>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Summary */}
                    <div className={styles['wir-summary']}>
                    <div className={styles['wir-summary-row']}>
                            <span className={styles['lbl']}>Subtotal</span>
                            <span className={styles['val']}>{formatPrice(summary.totalSubtotal)}</span>
                        </div>
                        <div className={`${styles['wir-summary-row']} ${styles['disc']}`}>
                            <span className={styles['lbl']}>Total Discount</span>
                            <span className={styles['val']}>- {formatPrice(summary.totalDiscount)}</span>
                        </div>
                        <div className={`${styles['wir-summary-row']} ${styles['tax']}`}>
                            <span className={styles['lbl']}>Total Tax</span>
                            <span className={styles['val']}>+ {formatPrice(summary.totalTax)}</span>
                        </div>
                        <div className={`${styles['wir-summary-row']} ${styles['total']}`}>
                            <span className={styles['lbl']}>Total Refund</span>
                            <span className={styles['val']}>{formatPrice(summary.totalRefund)}</span>
                        </div>
                    </div>

                    {/* Notes + Actions */}
                    <form onSubmit={handleSubmit}>
                        <div className={styles['wir-card']}>
                            <div className={styles['wir-card-body']}>
                            <div className={styles['wir-bottom']}>
                            <div className={styles['wir-notes']}>
                                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--wir-label)', marginBottom: 6 }}>Notes (optional)</label>
                                        <textarea
                                            rows={3}
                                            placeholder="Add any notes about this return…"
                                            value={notes}
                                            onChange={e => setNotes(e.target.value)}
                                        />
                                    </div>
                                    <div className={styles['wir-actions']}>
                                        <button
                                            type="submit"
                                            className={styles['btn-submit']}
                                            disabled={rows.length === 0 || submitting}
                                        >
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ verticalAlign: 'middle', marginRight: 5 }}><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                                            {submitting ? 'Processing…' : 'Process Return'}
                                        </button>
                                        <button type="button" className={styles['btn-clear']} onClick={clearAll}>Clear All</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>

                </div>{/* /.wir-right */}

            </div>{/* /.wir-grid */}

        </div>
    );
}