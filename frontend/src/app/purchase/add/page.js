'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePurchaseKeyboard } from '../hooks/usePurchaseKeyboard';
import styles from './purchase-add.module.css';
import { apiFetch } from '@/lib/api';

// Local (not UTC) YYYY-MM-DD. toISOString() rolls back a day for any PKT
// time before 5 AM, which would file a purchase under yesterday.
function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


export default function PurchaseAddPage() {
    // ── Form data from server ──────────────────────────
    const [categories, setCategories] = useState([]);
    const [units, setUnits]           = useState([]);

    // ── Type filter ────────────────────────────────────
    const [typeFilter, setTypeFilter] = useState('products'); // products | services | medicines
    const type = typeFilter === 'services' ? 'service' : typeFilter === 'medicines' ? 'medicine' : 'product';

    // ── Form fields ────────────────────────────────────
    const [productName, setProductName]       = useState('');
    const [purchasedPrice, setPurchasedPrice] = useState('');
    const [soldPrice, setSoldPrice]           = useState('');
    const [fixSoldPrice, setFixSoldPrice]     = useState(false);
    const [categoryId, setCategoryId]         = useState('');
    const [quantity, setQuantity]             = useState('');
    const [unit, setUnit]                     = useState('');
    const [purchaseDate, setPurchaseDate]     = useState('');
    const [expiryDate, setExpiryDate]         = useState('');
    const [lowInventory, setLowInventory]     = useState('');
    const [barcode, setBarcode]               = useState('');
    const [qrCode, setQrCode]                 = useState('');
    const [productCode, setProductCode]       = useState('');
    const [taxType, setTaxType]               = useState('amount');
    const [taxValue, setTaxValue]             = useState('');
    const [fixTax, setFixTax]                 = useState(false);
    const [discountType, setDiscountType]     = useState('amount');
    const [discountValue, setDiscountValue]   = useState('');
    const [fixDiscount, setFixDiscount]       = useState(false);
       // Supplier
       const [supplierName, setSupplierName]     = useState('');
       const [company, setCompany]               = useState('');
       const [address, setAddress]               = useState('');
       const [contactInfo, setContactInfo]       = useState('');
           const [supplierSuggestions, setSupplierSuggestions]     = useState([]);
    const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const suggestionRefs = useRef([]);
    
    useEffect(() => {
        if (activeSuggestionIndex >= 0 && suggestionRefs.current[activeSuggestionIndex]) {
            suggestionRefs.current[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
        }
    }, [activeSuggestionIndex]);
    const supplierDebounceRef = useRef(null);
    const supplierDropdownOpenRef = useRef(false);

    // Keep state (for render) and ref (for the keyboard hook, no lag) in sync
    function setSupplierDropdownVisible(visible) {
        supplierDropdownOpenRef.current = visible;
        setShowSupplierSuggestions(visible);
    }
    // Medicine fields (stored only)
    const [boxes, setBoxes]                           = useState('1');
    const [stripsPerBox, setStripsPerBox]             = useState('1');
    const [tabletsPerStrip, setTabletsPerStrip]       = useState('1');
    const [boxPurchasedPrice, setBoxPurchasedPrice]   = useState('');
    const [openingStockDeduction, setOpeningStockDeduction] = useState('0');

    // ── UI state ───────────────────────────────────────
    const [priceError, setPriceError]         = useState(false);
    const [barcodeStatus, setBarcodeStatus]   = useState('');
    const [qrStatus, setQrStatus]             = useState('');
    const [loading, setLoading]               = useState(false);
    const [toast, setToast]                   = useState(null);

    const productNameRef = useRef(null);
const formRef         = useRef(null);
const quantityRef     = useRef(null);
const supplierRef     = useRef(null);
const lowInventoryRef = useRef(null);
const lastBarcodeScanRef = useRef({ value: '', time: 0 });
const lastQrScanRef      = useRef({ value: '', time: 0 });

    // ── Load form data ─────────────────────────────────
    useEffect(() => {
        apiFetch('/api/purchases/form-data')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setCategories(data.categories);
                    setUnits(data.units);
                }
            })
            .catch(() => showToast('Failed to load form data', 'error'));
    }, []);

    // ── Medicine live calculation ──────────────────────
    useEffect(() => {
        if (type !== 'medicine') return;
        const b   = parseFloat(boxes) || 0;
        const spb = parseFloat(stripsPerBox) || 0;
        const tps = parseFloat(tabletsPerStrip) || 0;
        const bp  = parseFloat(boxPurchasedPrice) || 0;
        const ded = parseFloat(openingStockDeduction) || 0;

        const tabletsPerBox = spb * tps;
        const totalTablets  = b * tabletsPerBox;
        const net           = Math.max(0, totalTablets - ded);
        const pricePerTablet = tabletsPerBox > 0 ? (bp / tabletsPerBox) : 0;

        setQuantity(net > 0 ? String(net) : '');
        setPurchasedPrice(pricePerTablet > 0 ? pricePerTablet.toFixed(2) : '');
    }, [boxes, stripsPerBox, tabletsPerStrip, boxPurchasedPrice, openingStockDeduction, type]);

    // ── Price validation ───────────────────────────────
    useEffect(() => {
        if (type === 'service') { setPriceError(false); return; }
        const pp = parseFloat(purchasedPrice) || 0;
        const sp = parseFloat(soldPrice) || 0;
        if (purchasedPrice && soldPrice) {
            setPriceError(sp < pp);
        } else {
            setPriceError(false);
        }
    }, [purchasedPrice, soldPrice, type]);

    // ── Type switch side-effects ───────────────────────
    useEffect(() => {
        // Reset form when type changes
        setProductName('');
        setPurchasedPrice(''); setSoldPrice(''); setFixSoldPrice(false);
        setCategoryId(''); setQuantity(''); setUnit('');
        setPurchaseDate(''); setExpiryDate(''); setLowInventory('');
        setBarcode(''); setQrCode(''); setProductCode('');
        setTaxType('amount'); setTaxValue(''); setFixTax(false);
        setDiscountType('amount'); setDiscountValue(''); setFixDiscount(false);
        setSupplierName(''); setCompany(''); setAddress(''); setContactInfo('');
        setSupplierSuggestions([]); setSupplierDropdownVisible(false); setActiveSuggestionIndex(-1);
        setBoxes('1'); setStripsPerBox('1'); setTabletsPerStrip('1');
        setBoxPurchasedPrice(''); setOpeningStockDeduction('0');
        setBarcodeStatus(''); setQrStatus('');
        lastBarcodeScanRef.current = { value: '', time: 0 };
lastQrScanRef.current      = { value: '', time: 0 };
        setPriceError(false);

        if (type === 'service') {
            // Set today's date and service unit
            const today = todayLocal();
            setPurchaseDate(today);
            setUnit('srv');
            // Auto-select Services category
            const svcCat = categories.find(c => c.name === 'Services');
            if (svcCat) setCategoryId(String(svcCat.id));
        } else {
            // Restore last product unit
            const lastUnit = localStorage.getItem('lastSelectedProductUnit');
            if (lastUnit) setUnit(lastUnit);
        }

        setTimeout(() => productNameRef.current?.focus(), 100);
    }, [typeFilter, categories, units]);
    usePurchaseKeyboard({ formRef, productNameRef, quantityRef, supplierRef, lowInventoryRef, supplierDropdownOpenRef });
    useEffect(() => {
        const sp = parseFloat(soldPrice) || 0;
        const dv = parseFloat(discountValue) || 0;
        const tv = parseFloat(taxValue) || 0;
    
        if (discountType === 'percentage' && dv > 100) setDiscountValue('100');
        else if (discountType === 'amount' && sp > 0 && dv > sp) setDiscountValue(sp.toFixed(2));
    
        if (taxType === 'percentage' && tv > 100) setTaxValue('100');
    }, [discountValue, taxValue, discountType, taxType, soldPrice]);

// Once a code is captured the field is locked (read-only) until Clear is pressed,
// so a second/double scan can never add extra digits to the saved code.
function finalizeBarcodeScan(e) {
    if (barcodeStatus) return; // already captured → locked
    const value = e.target.value.trim();
    setBarcode(value);
    setBarcodeStatus(value ? `✅ Barcode captured: ${value}` : '');
}

function finalizeQrScan(e) {
    if (qrStatus) return; // already captured → locked
    const value = e.target.value.trim();
    setQrCode(value);
    setQrStatus(value ? `✅ QR Code captured: ${value}` : '');
}


    // ── Unit save to localStorage ──────────────────────
    function handleUnitChange(val) {
        setUnit(val);
        if (type !== 'service') {
            localStorage.setItem('lastSelectedProductUnit', val);
        }
    }

        // ── Supplier autocomplete ───────────────────────────
        function handleSupplierNameChange(e) {
            const val = e.target.value;
            setSupplierName(val);
            setActiveSuggestionIndex(-1);
    
            clearTimeout(supplierDebounceRef.current);
    
            if (!val.trim()) {
                setSupplierSuggestions([]);
                setSupplierDropdownVisible(false);
                return;
            }
    
            supplierDebounceRef.current = setTimeout(async () => {
                try {
                    const res = await apiFetch(`/api/suppliers?search=${encodeURIComponent(val)}&page=1`);
                    const data = await res.json();
                    if (data.success && data.data.length > 0) {
                        suggestionRefs.current = [];
                        setSupplierSuggestions(data.data);
                        setSupplierDropdownVisible(true);
                    } else {
                        suggestionRefs.current = [];
                        setSupplierSuggestions([]);
                        setSupplierDropdownVisible(false);
                    }
                } catch {
                    setSupplierSuggestions([]);
                    setSupplierDropdownVisible(false);
                }
            }, 300);
        }
    
        function selectSupplier(supplier) {
            setSupplierName(supplier.name || '');
            setCompany(supplier.company || '');
            setAddress(supplier.address || '');
            setContactInfo(supplier.contact_info || '');
            setSupplierSuggestions([]);
            setSupplierDropdownVisible(false);
            setActiveSuggestionIndex(-1);
        }
    
        function handleSupplierKeyDown(e) {
            if (!showSupplierSuggestions || supplierSuggestions.length === 0) return;
    
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                setActiveSuggestionIndex(prev => (prev + 1) % supplierSuggestions.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                setActiveSuggestionIndex(prev => (prev - 1 + supplierSuggestions.length) % supplierSuggestions.length);
            } else if (e.key === 'Enter') {
                if (activeSuggestionIndex >= 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    selectSupplier(supplierSuggestions[activeSuggestionIndex]);
                }
            } else if (e.key === 'Escape') {
                setSupplierDropdownVisible(false);
                setActiveSuggestionIndex(-1);
            }
        }

    // ── Toast ──────────────────────────────────────────
    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    function resetForm() {
        setProductName('');
        setPurchasedPrice(''); setSoldPrice(''); setFixSoldPrice(false);
        setCategoryId(''); setQuantity(''); setUnit('');
        setPurchaseDate(''); setExpiryDate(''); setLowInventory('');
        setBarcode(''); setQrCode(''); setProductCode('');
        setTaxType('amount'); setTaxValue(''); setFixTax(false);
        setDiscountType('amount'); setDiscountValue(''); setFixDiscount(false);
        setSupplierName(''); setCompany(''); setAddress(''); setContactInfo('');
        setSupplierSuggestions([]); setSupplierDropdownVisible(false); setActiveSuggestionIndex(-1);
        setBoxes('1'); setStripsPerBox('1'); setTabletsPerStrip('1');
        setBoxPurchasedPrice(''); setOpeningStockDeduction('0');
        setBarcodeStatus(''); setQrStatus('');
        setPriceError(false);
    
        if (type === 'service') {
            const today = todayLocal();
            setPurchaseDate(today);
            setUnit('srv');
            const svcCat = categories.find(c => c.name === 'Services');
            if (svcCat) setCategoryId(String(svcCat.id));
        } else {
            const lastUnit = localStorage.getItem('lastSelectedProductUnit');
            if (lastUnit) setUnit(lastUnit);
        }
    
        setTimeout(() => productNameRef.current?.focus(), 100);
    }
    // ── Submit ─────────────────────────────────────────
    async function handleSubmit(e) {
        e.preventDefault();

        if (priceError) {
            document.getElementById('sold_price')?.focus();
            return;
        }

        setLoading(true);
        try {
            // Build payload — omit tax/discount if empty (like Laravel JS)
            const payload = {
                type,
                product_name: productName,
                barcode:       barcode || null,
                qr_code:       qrCode || null,
                product_code:  productCode || null,
                purchased_price: type === 'service' ? 0 : (parseFloat(purchasedPrice) || 0),
                sold_price:    parseFloat(soldPrice) || 0,
                fix_sold_price: fixSoldPrice ? 1 : 0,
                quantity:      type === 'service' ? 99999999 : (parseFloat(quantity) || 0),
                unit:          type === 'service' ? 'srv' : unit,
                purchase_date: purchaseDate,
                expiry_date:   expiryDate || null,
                low_inventory: lowInventory || null,
                category_id:   categoryId || null,
                fix_tax:       fixTax ? 1 : 0,
                fix_discount:  fixDiscount ? 1 : 0,
                // Supplier
                supplier_name: supplierName || null,
                company:       company || null,
                address:       address || null,
                contact_info:  contactInfo || null,
                // Medicine stored fields
                boxes:                   boxes || null,
                strips_per_box:          stripsPerBox || null,
                tablets_per_strip:       tabletsPerStrip || null,
                opening_stock_deduction: openingStockDeduction || 0,
                box_purchased_price:     boxPurchasedPrice || null,
            };

            // Only send tax/discount if values exist (like Laravel JS)
            if (taxValue && parseFloat(taxValue) !== 0) {
                payload.tax_type = taxType;
                payload.tax      = parseFloat(taxValue);
            }
            if (discountValue && parseFloat(discountValue) !== 0) {
                payload.discount_type = discountType;
                payload.discount      = parseFloat(discountValue);
            }

            const formData = new FormData();
Object.entries(payload).forEach(([key, val]) => {
    if (val !== null && val !== undefined) formData.append(key, val);
});
const imageFile = document.querySelector('input[name="image"]')?.files?.[0];
if (imageFile) formData.append('image', imageFile);

const res = await apiFetch(`/api/purchases`, {
    method: 'POST',
    body: formData,
});
            const data = await res.json();

            if (data.success) {
                showToast(data.message, 'success');
                resetForm();
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Request failed. Try again.', 'error');
        } finally {
            setLoading(false);
        }
    }

    // ── Helpers ────────────────────────────────────────
    const isService  = type === 'service';
    const isMedicine = type === 'medicine';
    const isProduct  = type === 'product';

    const visibleCategories = categories.filter(c => {
        if (isService) return c.name === 'Services';
        return c.name !== 'Services';
    });

    const visibleUnits = units.filter(u => {
        if (isService) return u.name === 'srv';
        return u.name !== 'srv';
    });

    const labelName  = isService ? 'Service Name' : 'Product Name';
    const btnLabel   = isMedicine ? 'Add Product' : isService ? 'Add Service' : 'Add Product';
    const qtyLabel   = isMedicine ? 'Total Items' : 'Total Stock';
    const placeholder = isService ? 'Enter service name...' : 'Enter product name...';

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
                    <h1>Products in the Store</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Add Product</p>
                    <Link href="/purchase/list" className="boton-elegante">← Back</Link>
                </div>

                <div className="sub-container">
                    {/* Type Selector */}
                    <div className={styles['AddProductsServicesDropdown']}>
                        <select
                            id="AddProductsServicesTypeFilter"
                            className={styles['AddProductsDropdown']}
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                        >
                            <option value="products">Add Products</option>
                            <option value="services">Add Services</option>
                            <option value="medicines">Add Packaged Item</option>
                        </select>
                    </div>

                    <hr />

                    <div className={styles['product-form-wrapper']}>
                        <form id="purchase-form" ref={formRef} onSubmit={handleSubmit}>
                            <input type="hidden" name="type" value={type} />

                            <div className={styles['form-container']}>
                                {/* ── LEFT COLUMN ─────────────────────── */}
                                <div className={styles['first-form']}>
                                <div className={styles['section-header']}>Essential Information</div>

                                    {/* Product Name */}
                                    <div className={styles['input-group']}>
                                    <span>{labelName}</span>
                                        <input
                                            ref={productNameRef}
                                            type="text"
                                            placeholder={placeholder}
                                            value={productName}
                                            onChange={e => setProductName(e.target.value)}
                                            required
                                        />
                                    </div>

                                    {/* ── Medicine Packaging ─────────── */}
                                    {isMedicine && (
                                        <>
                                            <div className={styles['section-header']} style={{ marginTop: 25 }}>Item Packaging</div>

<div className={styles['price-category-container']}>
    <div className={styles['input-group']}>
        <span>Packages</span>
                                                    <input type="number" placeholder="e.g. 15" min="1"
                                                        value={boxes} onChange={e => setBoxes(e.target.value)} />
                                                </div>
                                                <div className={styles['input-group']}>
                                                <span>Units per Package</span>
                                                    <input type="number" placeholder="e.g. 2" min="1"
                                                        value={stripsPerBox} onChange={e => setStripsPerBox(e.target.value)} />
                                                </div>
                                            </div>

                                            <div className={styles['price-category-container']}>
                                                <div className={styles['input-group']}>
                                                    <span>Items per Unit</span>
                                                    <input type="number" placeholder="e.g. 10" min="1"
                                                        value={tabletsPerStrip} onChange={e => setTabletsPerStrip(e.target.value)} />
                                                </div>
                                                <div className={styles['input-group']}>
                                                    <span>Package Price</span>
                                                    <input type="number" step="0.01" placeholder="Price per box"
                                                        value={boxPurchasedPrice} onChange={e => setBoxPurchasedPrice(e.target.value)} />
                                                </div>
                                            </div>

                                            <div className={styles['input-group']}>
                                                <span>Already Used / Deduct</span>
                                                <input type="number" placeholder="0" min="0"
                                                    value={openingStockDeduction} onChange={e => setOpeningStockDeduction(e.target.value)} />
                                            </div>
                                        </>
                                    )}

                                    {/* Price */}
                                    <div className={styles['price-category-container']}>
                                        {!isService && (
                                            <div className={styles['input-group']}>
                                                <span>P. Price</span>
                                                <input
                                                    type="number" step="0.01" id="purchased_price"
                                                    placeholder="0.00" required={!isService}
                                                    value={purchasedPrice}
                                                    onChange={e => setPurchasedPrice(e.target.value)}
                                                    readOnly={isMedicine}
                                                />
                                            </div>
                                        )}
                                        <div className={styles['input-group']}>
                                            <span>S. Price</span>
                                            <input
                                                type="number" step="0.01" id="sold_price"
                                                placeholder="0.00" required
                                                value={soldPrice}
                                                onChange={e => setSoldPrice(e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    {/* Fix Sold Price */}
                                    <div className={styles['checkbox-container']} style={{ justifyContent: 'flex-end', marginRight: 75 }}>
                                        <label htmlFor="fix_sold_price">Fix Sold Price</label>
                                        <input type="checkbox" id="fix_sold_price"
                                            checked={fixSoldPrice} onChange={e => setFixSoldPrice(e.target.checked)} />
                                    </div>

                                    {priceError && (
                                        <small className={styles['error-message']} style={{ display: 'block' }}>
                                            ⚠️ Sold price cannot be less than purchased price.
                                        </small>
                                    )}

                                    {/* Category */}
                                    <div className={styles['input-group-select']}>
                                        <span>Category</span>
                                        <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                                            <option value="">--Select Category--</option>
                                            {visibleCategories.map(c => (
                                                <option key={c.id} value={c.id}
                                                    data-category-type={c.name === 'Services' ? 'service' : 'product'}>
                                                    {c.name}{c.name === 'Misc' ? ' (Default)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Quantity + Unit */}
                                    <div className={styles['price-category-container']}>
                                        {!isService && (
                                            <div className={styles['input-group']}>
                                                <span>{qtyLabel}</span>
                                                <input
                                                ref={quantityRef}
                                                    type="number" placeholder="0"
                                                    required={!isService}
                                                    value={quantity}
                                                    onChange={e => setQuantity(e.target.value)}
                                                    readOnly={isMedicine}
                                                />
                                            </div>
                                        )}
                                        <div className={styles['input-group-select']}>
                                            <span>Units</span>
                                            <select value={unit} onChange={e => handleUnitChange(e.target.value)} required>
                                                <option value="">--Select--</option>
                                                {visibleUnits.map(u => (
                                                    <option key={u.name} value={u.name}
                                                        data-unit-type={u.name === 'srv' ? 'service' : 'product'}>
                                                        {u.display_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Purchase Date */}
                                    {!isService && (
                                        <div className={styles['input-group']}>
                                            <span>Purchase Date</span>
                                            <input type="date" required={!isService}
                                                value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Supplier (product only) */}
                                    {!isService && (
                                        <>
                                            <div className={styles['section-header']} style={{ marginTop: 25 }}>
                                                Supplier Information (Optional)
                                            </div>
                                            <div className={styles['supplier-autocomplete-wrapper']}>
                                                <div className={styles['input-group']}>
                                                    <span>Supplier Name</span>
                                                    <input
                                                        ref={supplierRef}
                                                        type="text"
                                                        placeholder="Enter supplier name..."
                                                        autoComplete="off"
                                                        value={supplierName}
                                                        onChange={handleSupplierNameChange}
                                                        onKeyDown={handleSupplierKeyDown}
                                                        onFocus={() => { if (supplierSuggestions.length > 0) setSupplierDropdownVisible(true); }}
                                                        onBlur={() => setTimeout(() => setSupplierDropdownVisible(false), 150)}
                                                    />
                                                </div>
                                                {showSupplierSuggestions && supplierSuggestions.length > 0 && (
                                                    <ul className={styles['supplier-suggestions']}>
                                                        {supplierSuggestions.map((s, idx) => (
    <li
        key={s.id}
        ref={el => (suggestionRefs.current[idx] = el)}
        className={idx === activeSuggestionIndex ? styles['active'] : ''}
        onMouseDown={(e) => { e.preventDefault(); selectSupplier(s); }}
        onMouseEnter={() => setActiveSuggestionIndex(idx)}
    >
                                                                <strong>{s.name}</strong>
                                                                {s.company && <span> — {s.company}</span>}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                            <div className={styles['input-group']}>
                                                <span>Company</span>
                                                <input type="text" placeholder="Enter company name..."
                                                    value={company} onChange={e => setCompany(e.target.value)} />
                                            </div>
                                            <div className={styles['input-group']}>
                                                <span>Address</span>
                                                <input type="text" placeholder="Enter company address..."
                                                    value={address} onChange={e => setAddress(e.target.value)} />
                                            </div>
                                            <div className={styles['input-group']}>
                                                <span>Contact Info</span>
                                                <input type="text" placeholder="Enter contact number..."
                                                    value={contactInfo} onChange={e => setContactInfo(e.target.value)} />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* ── RIGHT COLUMN ────────────────────── */}
                                <div className={styles['second-form']}>
                                <div className={styles['section-header']}>Advanced Options (Optional)</div>

                                    {/* Image (product + not medicine) */}
                                    {!isService && !isMedicine && (
                                        <div className={styles['input-group']}>
                                            <span>Product Image</span>
                                            <input type="file" name="image" accept="image/*" />
                                        </div>
                                    )}

                                    {/* Barcode (product only) */}
                                    {!isService && (
                                        <>
                                            <small style={{ color: '#999' }}>
                                                (scan or type if product has manufacturer barcode or QR code)
                                            </small>
                                            <div className={styles['input-group']} style={{ marginTop: 4 }}>
                                                <span>Existing Barcode</span>
                                                <div className={styles['scan-input-wrapper']}>
                                                <input
  type="text" placeholder="Scan barcode or leave empty to auto-generate"
  maxLength={255} autoComplete="off"
  value={barcode}
  readOnly={!!barcodeStatus}
  onChange={e => setBarcode(e.target.value)}
  onKeyDown={(e) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur(); // scanner sends Enter → capture the code
          return;
      }
      if (barcodeStatus && e.key.length === 1) {
          setBarcodeStatus(`⚠️ Already captured: ${barcode} — press Clear to scan again`);
      }
  }}
  onBlur={finalizeBarcodeScan}
/>

<button type="button" className={styles['clear-btn']}
    onClick={() => { setBarcode(''); setBarcodeStatus(''); lastBarcodeScanRef.current = { value: '', time: 0 }; }}>
    Clear
</button>
                                                </div>
                                            </div>
                                            {barcodeStatus && <small className={styles['scan-status']} style={{ display: 'block' }}>{barcodeStatus}</small>}

                                            <div className={styles['input-group']}>
                                                <span>Existing QR Code</span>
                                                <div className={styles['scan-input-wrapper']}>
                                                <input
   type="text" placeholder="Scan QR code or leave empty"
   maxLength={500} autoComplete="off"
   value={qrCode}
   readOnly={!!qrStatus}
   onChange={e => setQrCode(e.target.value)}
   onKeyDown={(e) => {
       if (e.key === 'Enter') {
           e.preventDefault();
           e.currentTarget.blur(); // scanner sends Enter → capture the code
           return;
       }
       if (qrStatus && e.key.length === 1) {
           setQrStatus(`⚠️ Already captured: ${qrCode} — press Clear to scan again`);
       }
   }}
   onBlur={finalizeQrScan}
/>

<button type="button" className={styles['clear-btn']}
    onClick={() => { setQrCode(''); setQrStatus(''); lastQrScanRef.current = { value: '', time: 0 }; }}>
    Clear
</button>
                                                </div>
                                            </div>
                                            {qrStatus && <small className={styles['scan-status']} style={{ display: 'block' }}>{qrStatus}</small>}
                                        </>
                                    )}

                                    {/* Expiry Date (not service) */}
                                    {!isService && (
                                        <div className={styles['input-group']}>
                                            <span>Expiry Date</span>
                                            <input type="date" value={expiryDate}
                                                onChange={e => setExpiryDate(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Product Code (product + not medicine) */}
                                    {!isService && !isMedicine && (
                                        <div className={styles['input-group']}>
                                            <span>Product Code / Model</span>
                                            <input type="text" placeholder="Enter product code..."
                                                value={productCode} onChange={e => setProductCode(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Low Inventory (product only) */}
                                    {!isService && (
                                        <div className={styles['input-group']}>
                                            <span>Low Inventory</span>
                                            <input ref={lowInventoryRef} type="number" placeholder="Enter alert threshold..."
                                                value={lowInventory} onChange={e => setLowInventory(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Tax */}
                                    <div className={styles['section-header']} style={{ marginTop: 25 }}>Tax Configuration</div>
                                    <div className={styles['price-category-container']}>
                                        <div className={styles['input-group-select']}>
                                            <span>Tax Type</span>
                                            <select value={taxType} onChange={e => setTaxType(e.target.value)}>
                                                <option value="amount">Select</option>
                                                <option value="amount">Amount</option>
                                                <option value="percentage">Percentage</option>
                                            </select>
                                        </div>
                                        <div className={styles['input-group']}>
                                            <span>Tax Value</span>
                                            <input type="number" step="0.01" placeholder="0.00"
                                                value={taxValue} onChange={e => setTaxValue(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className={styles['checkbox-container']}>
                                        <label htmlFor="fix_tax">Fix Tax Amount</label>
                                        <input type="checkbox" id="fix_tax"
                                            checked={fixTax} onChange={e => setFixTax(e.target.checked)} />
                                    </div>

                                    {/* Discount */}
                                    <div className={styles['section-header']} style={{ marginTop: 25 }}>Discount Configuration</div>
                                    <div className={styles['price-category-container']}>
                                        <div className={styles['input-group-select']}>
                                            <span>Discount Type</span>
                                            <select value={discountType} onChange={e => setDiscountType(e.target.value)}>
                                                <option value="amount">Select</option>
                                                <option value="amount">Amount</option>
                                                <option value="percentage">Percentage</option>
                                            </select>
                                        </div>
                                        <div className={styles['input-group']}>
                                            <span>Discount Value</span>
                                            <input type="number" step="0.01" placeholder="0.00"
                                                value={discountValue} onChange={e => setDiscountValue(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className={styles['checkbox-container']}>
                                        <label htmlFor="fix_discount">Fix Discount Amount</label>
                                        <input type="checkbox" id="fix_discount"
                                            checked={fixDiscount} onChange={e => setFixDiscount(e.target.checked)} />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className={styles['boton-elegante']} disabled={loading}>
                                {loading ? 'Processing...' : btnLabel}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </>
    );
}