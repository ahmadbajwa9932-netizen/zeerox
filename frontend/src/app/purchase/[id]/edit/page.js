'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePurchaseKeyboard } from '../../hooks/usePurchaseKeyboard';
import styles from '../../add/purchase-add.module.css';
import { apiFetch } from '@/lib/api';

// Local (not UTC) YYYY-MM-DD. toISOString() rolls back a day for any PKT
// time before 5 AM, which would file a purchase under yesterday.
function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


export default function PurchaseEditPage() {
    const { id }  = useParams();
    const router  = useRouter();

    const [categories, setCategories] = useState([]);
    const [units, setUnits]           = useState([]);
    const [purchase, setPurchase]     = useState(null);
    const [loadingData, setLoadingData] = useState(true);
    const [toast, setToast]           = useState(null);
    const [loading, setLoading]       = useState(false);
    const [priceError, setPriceError] = useState(false);

    // Form fields
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
    const [supplierName, setSupplierName]     = useState('');
    const [company, setCompany]               = useState('');
    const [address, setAddress]               = useState('');
    const [contactInfo, setContactInfo]       = useState('');
    const [removeImage, setRemoveImage]       = useState(false);
    const [barcodeStatus, setBarcodeStatus]   = useState('');
    const [qrStatus, setQrStatus]             = useState('');

    const productNameRef = useRef(null);
    const formRef         = useRef(null);
const quantityRef     = useRef(null);
const supplierRef     = useRef(null);
const lowInventoryRef = useRef(null);

    // Load purchase data
    useEffect(() => {
        apiFetch(`/api/purchases/${id}`)
            .then(r => r.json())
            .then(data => {
                if (!data.success) { showToast('Failed to load product', 'error'); return; }
                const p = data.purchase;
                setPurchase(p);
                setCategories(data.categories);
                setUnits(data.units);

                // Populate fields
                setProductName(p.product_name || '');
                setPurchasedPrice(p.purchased_price ?? '');
                setSoldPrice(p.sold_price ?? '');
                setFixSoldPrice(!!p.fix_sold_price);
                setCategoryId(p.category_id ? String(p.category_id) : '');
                setQuantity(p.quantity ?? '');
                setUnit(p.unit || '');
                setPurchaseDate(p.purchase_date || '');
                setExpiryDate(p.expiry_date || '');
                setLowInventory(p.low_inventory ?? '');
                setBarcode(p.barcode || '');
                setQrCode(p.qr_code || '');
                setProductCode(p.product_code || '');
                setTaxType(p.tax_type || 'amount');
                setTaxValue(p.tax ?? '');
                setFixTax(!!p.fix_tax);
                setDiscountType(p.discount_type || 'amount');
                setDiscountValue(p.discount ?? '');
                setFixDiscount(!!p.fix_discount);
                setSupplierName(p.supplier?.name || '');
                setCompany(p.supplier?.company || '');
                setAddress(p.supplier?.address || '');
                setContactInfo(p.supplier?.contact_info || '');
                if (p.barcode) setBarcodeStatus(`✅ Barcode: ${p.barcode}`);
                if (p.qr_code) setQrStatus(`✅ QR Code: ${p.qr_code}`);
            })
            .catch(() => showToast('Failed to load product', 'error'))
            .finally(() => setLoadingData(false));
    }, [id]);

    // Price validation
    useEffect(() => {
        if (!purchase || purchase.type === 'service') { setPriceError(false); return; }
        const pp = parseFloat(purchasedPrice) || 0;
        const sp = parseFloat(soldPrice) || 0;
        if (purchasedPrice && soldPrice) setPriceError(sp < pp);
        else setPriceError(false);
    }, [purchasedPrice, soldPrice, purchase]);

    // Discount / tax cap
    useEffect(() => {
        const sp = parseFloat(soldPrice) || 0;
        const dv = parseFloat(discountValue) || 0;
        const tv = parseFloat(taxValue) || 0;
        if (discountType === 'percentage' && dv > 100) setDiscountValue('100');
        else if (discountType === 'amount' && sp > 0 && dv > sp) setDiscountValue(sp.toFixed(2));
        if (taxType === 'percentage' && tv > 100) setTaxValue('100');
    }, [discountValue, taxValue, discountType, taxType, soldPrice]);

    usePurchaseKeyboard({ formRef, productNameRef, quantityRef, supplierRef, lowInventoryRef });

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


    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (priceError) { document.getElementById('sold_price')?.focus(); return; }

        setLoading(true);
        try {
            const finalPurchaseDate = isService
    ? (purchaseDate || todayLocal())
    : purchaseDate;
            const formData = new FormData();
            formData.append('product_name',   productName);
            formData.append('purchased_price', purchasedPrice || 0);
            formData.append('sold_price',      soldPrice || 0);
            formData.append('fix_sold_price',  fixSoldPrice ? 1 : 0);
            formData.append('quantity',        quantity || 0);
            formData.append('unit',            unit);
            formData.append('purchase_date', finalPurchaseDate);
            formData.append('expiry_date',     expiryDate || '');
            formData.append('low_inventory',   lowInventory || '');
            formData.append('category_id',     categoryId || '');
            formData.append('tax_type',        taxType);
            formData.append('tax',             taxValue || 0);
            formData.append('fix_tax',         fixTax ? 1 : 0);
            formData.append('discount_type',   discountType);
            formData.append('discount',        discountValue || 0);
            formData.append('fix_discount',    fixDiscount ? 1 : 0);
            formData.append('supplier_name',   supplierName || '');
            formData.append('company',         company || '');
            formData.append('address',         address || '');
            formData.append('contact_info',    contactInfo || '');
            formData.append('barcode',         barcode || '');
            formData.append('qr_code',         qrCode || '');
            formData.append('product_code',    productCode || '');
            formData.append('remove_image',    removeImage ? '1' : '0');

            const imageFile = document.querySelector('input[name="image"]')?.files?.[0];
            if (imageFile) formData.append('image', imageFile);

            const res  = await apiFetch(`/api/purchases/${id}`, { method: 'PUT', body: formData });
            const data = await res.json();

            if (data.success) {
                showToast(data.message, 'success');
                setTimeout(() => router.push('/purchase/list'), 1000);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Request failed. Try again.', 'error');
        } finally {
            setLoading(false);
        }
    }

    if (loadingData) {
        return (
            <div className="container">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading product...</p>
                </div>
            </div>
        );
    }

    if (!purchase) return null;

    const isService  = purchase.type === 'service';
    const isMedicine = purchase.type === 'medicine';

    const visibleCategories = categories.filter(c =>
        isService ? c.name === 'Services' : c.name !== 'Services'
    );
    const visibleUnits = units.filter(u =>
        isService ? u.name === 'srv' : u.name !== 'srv'
    );

    const labelName = isService ? 'Service Name' : 'Product Name';
    const qtyLabel  = isMedicine ? 'Total Items' : 'Total Stock';

    return (
        <>
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
                    <p>Update Product: <strong>{purchase.product_name}</strong></p>
                    <Link href="/purchase/list" className="boton-elegante">← Back</Link>
                </div>

                <div className="sub-container">
                    <div className={styles['AddProductsServicesDropdown']}>
                        <select 
                        id="AddProductsServicesTypeFilter"
                        className={styles['AddProductsDropdown']}
                         disabled value={
                            isService ? 'services' : isMedicine ? 'medicines' : 'products'
                        }>
                            <option value="products">Product</option>
                            <option value="services">Service</option>
                            <option value="medicines">Packaged Item</option>
                        </select>
                    </div>

                    <hr />

                    <div className={styles['product-form-wrapper']}>
                    <form id="purchase-form" ref={formRef} onSubmit={handleSubmit}>
                            <div className={styles['form-container']}>

                                {/* ── LEFT COLUMN ─────────────────────── */}
                                <div className={styles['first-form']}>
                                    <div className={styles['section-header']}>Essential Information</div>

                                    <div className={styles['input-group']}>
                                        <span id="product-service-label">{labelName}</span>
                                        <input
                                            ref={productNameRef}
                                            type="text"
                                            placeholder="Enter product name..."
                                            value={productName}
                                            onChange={e => setProductName(e.target.value)}
                                            required
                                        />
                                    </div>

                                    {/* Prices */}
                                    <div className={styles['price-category-container']}>
                                        {!isService && (
                                            <div className={styles['input-group']}>
                                                <span>P. Price</span>
                                                <input
                                                    type="number" step="0.01" id="purchased_price"
                                                    placeholder="0.00" required
                                                    value={purchasedPrice}
                                                    onChange={e => setPurchasedPrice(e.target.value)}
                                                />
                                            </div>
                                        )}
                                        <div className={styles['input-group']}>
                                            <span>S. Price</span>
                                            <input
                                                type="number" step="0.01" id="sold_price"
                                                placeholder="0.00"
                                                value={soldPrice}
                                                onChange={e => setSoldPrice(e.target.value)}
                                            />
                                        </div>
                                    </div>

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
                                        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={isService}>
                                            <option value="">--Select Category--</option>
                                            {visibleCategories.map(c => (
                                                <option key={c.id} value={String(c.id)}>
                                                    {c.name}{c.name === 'Misc' ? ' (Default)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Quantity + Unit */}
                                    {!isService && (
                                        <div className={styles['price-category-container']}>
                                            <div className={styles['input-group']}>
                                                <span>{qtyLabel}</span>
                                                <input
                                                ref={quantityRef}
                                                    type="number" placeholder="0" required
                                                    value={quantity}
                                                    onChange={e => setQuantity(e.target.value)}
                                                />
                                            </div>
                                            <div className={styles['input-group-select']}>
                                                <span>Units</span>
                                                <select value={unit} onChange={e => setUnit(e.target.value)} required disabled={isService}>
                                                    <option value="">--Select--</option>
                                                    {visibleUnits.map(u => (
                                                        <option key={u.name} value={u.name}>{u.display_name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {/* Purchase Date */}
                                    {!isService && (
                                        <div className={styles['input-group']}>
                                            <span>Purchase Date</span>
                                            <input type="date" required
                                                value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Supplier */}
                                    {!isService && (
                                        <>
                                            <div className={styles['section-header']} style={{ marginTop: 25 }}>
                                                Supplier Information (Optional)
                                            </div>
                                            <div className={styles['input-group']}>
                                                <span>Supplier Name</span>
                                                <input ref={supplierRef} type="text" placeholder="Enter supplier name..."
                                                    value={supplierName} onChange={e => setSupplierName(e.target.value)} />
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

                                    {/* Image */}
                                    {!isService && !isMedicine && (
                                        <div className={styles['input-group']}>
                                            <span>Product Image</span>
                                            <input type="file" name="image" accept="image/*" />
                                            {purchase.image && (
                                                <>
                                                    <small style={{ display: 'block', marginTop: 5, color: '#666' }}>
                                                        Current: {purchase.image.split('/').pop()}
                                                    </small>
                                                    <label style={{ display: 'flex', alignItems: 'center', marginTop: 5, cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={removeImage}
                                                            onChange={e => setRemoveImage(e.target.checked)}
                                                            style={{ marginRight: 5 }} />
                                                        Remove Image
                                                    </label>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* Barcode + QR */}
                                    {!isService && (
                                        <>
                                            <small style={{ color: '#999' }}>
                                                (scan or type if product has manufacturer barcode)
                                            </small>
                                            <div className={styles['input-group']} style={{ marginTop: 4 }}>
                                                <span>Existing Barcode</span>
                                                <div className={styles['scan-input-wrapper']}>
                                                <input
                                                        type="text" placeholder="Scan barcode or leave empty"
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
                                                        onClick={() => { setBarcode(''); setBarcodeStatus(''); }}>
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
                                                        onClick={() => { setQrCode(''); setQrStatus(''); }}>
                                                        Clear
                                                    </button>
                                                </div>
                                            </div>
                                            {qrStatus && <small className={styles['scan-status']} style={{ display: 'block' }}>{qrStatus}</small>}
                                        </>
                                    )}

                                    {/* Expiry */}
                                    {!isService && (
                                        <div className={styles['input-group']}>
                                            <span>Expiry Date</span>
                                            <input type="date" value={expiryDate}
                                                onChange={e => setExpiryDate(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Product Code */}
                                    {!isService && !isMedicine && (
                                        <div className={styles['input-group']}>
                                            <span>Product Code / Model</span>
                                            <input type="text" placeholder="Enter product code or model..."
                                                value={productCode} onChange={e => setProductCode(e.target.value)} />
                                        </div>
                                    )}

                                    {/* Low Inventory */}
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

                            <button type="submit" className={styles['boton-elegante']} disabled={loading || priceError}>
                                {loading ? 'Updating...' : 'Update Product'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </>
    );
}