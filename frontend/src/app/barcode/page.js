'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import styles from './barcode.module.css';
import { usePermissions } from '@/lib/permissions';

// ── Helpers ────────────────────────────────────────────

// ── Default toggle state ───────────────────────────────
const DEFAULT_TOGGLES = {
    price:         false,
    expiry:        false,
    manufacturing: false,
    company:       false,
    productname:   true,
    other:         false,
    description:   false,
};

const DEFAULT_ORIGINAL = {
    rate:          0,
    discount:      0,
    discount_type: 'amount',
    tax:           0,
    tax_type:      'amount',
};

export default function BarcodePage() {
    // ── Search state ───────────────────────────────────
    const [searchQuery,   setSearchQuery]   = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [focusIndex,    setFocusIndex]    = useState(-1);
    const searchTimeout = useRef(null);
    const skipSearchRef = useRef(false);
    const { isBlocked } = usePermissions();

    // ── Selected product ───────────────────────────────
    const [selectedProduct, setSelectedProduct] = useState(null);

    // ── Toggle states ──────────────────────────────────
    const [toggles, setToggles] = useState({ ...DEFAULT_TOGGLES });

    // ── Extra input values ─────────────────────────────
    const [company,       setCompany]       = useState('');
    const [expiry,        setExpiry]        = useState('');
    const [manufacturing, setManufacturing] = useState('');
    const [other,         setOther]         = useState('');
    const [description,   setDescription]   = useState('');

    // ── Editable product fields ────────────────────────
    const [editRate,         setEditRate]         = useState('');
    const [editDiscountType, setEditDiscountType] = useState('amount');
    const [editDiscount,     setEditDiscount]     = useState('');
    const [editTaxType,      setEditTaxType]      = useState('amount');
    const [editTax,          setEditTax]          = useState('');
    const [displayTotal,     setDisplayTotal]     = useState(() => formatPrice(0));

    // ── Change tracking ────────────────────────────────
    const [hasChanges,     setHasChanges]     = useState(false);
    const [originalValues, setOriginalValues] = useState({ ...DEFAULT_ORIGINAL });

    // ── Preview / format ───────────────────────────────
    const [printFormat, setPrintFormat] = useState('thermal');
    const [codeType,    setCodeType]    = useState('barcode');
    const [numCopies,   setNumCopies]   = useState(1);

    // ── Button states ──────────────────────────────────
    const [generating,  setGenerating]  = useState(false);
    const [printing,    setPrinting]    = useState(false);
    const [updating,    setUpdating]    = useState(false);

    // ── Toast ──────────────────────────────────────────
    const [toast, setToast] = useState(null);

    function showToast(msg, kind = 'success') {
        setToast({ msg, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    // ── Price below cost warning ───────────────────────
    const [priceWarning, setPriceWarning] = useState(false);

    // ── F2 focus ───────────────────────────────────────
    useEffect(() => {
        function handler(e) {
            if (e.key === 'F2') {
                e.preventDefault();
                document.getElementById('productSearch')?.focus();
            }
        }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // ── Search ─────────────────────────────────────────
    useEffect(() => {
        if (skipSearchRef.current) {
            skipSearchRef.current = false;
            return;
        }
        clearTimeout(searchTimeout.current);
        if (searchQuery.length < 2) {
            setSearchResults([]);
            setFocusIndex(-1);
            if (searchQuery.length === 0) resetPage(false);
            return;
        }
        searchTimeout.current = setTimeout(async () => {
            try {
                const res  = await apiFetch(`/api/barcode/search?query=${encodeURIComponent(searchQuery)}`);
                const data = await res.json();
                setSearchResults(Array.isArray(data) ? data : []);
                setFocusIndex(-1);
            } catch {
                setSearchResults([]);
            }
        }, 0);
    }, [searchQuery]);

    // ── Keyboard navigation in search results ──────────
    function handleSearchKeyDown(e) {
        if (searchResults.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusIndex(i => (i + 1) % searchResults.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusIndex(i => (i <= 0 ? searchResults.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusIndex >= 0 && focusIndex < searchResults.length) {
                selectProduct(searchResults[focusIndex]);
            }
        } else if (e.key === 'Escape') {
            setSearchResults([]);
            setFocusIndex(-1);
        }
    }

    // ── Select product ─────────────────────────────────
    function selectProduct(product) {
        skipSearchRef.current = true;
        setSelectedProduct(product);
        setSearchQuery(product.name);
        setSearchResults([]);
        setFocusIndex(-1);

        const rate     = parseFloat(product.price) || 0;
        const discount = parseFloat(product.discount) || 0;
        const tax      = parseFloat(product.tax) || 0;
        const dtype    = product.discount_type || 'amount';
        const ttype    = product.tax_type || 'amount';

        setEditRate(rate);
        setEditDiscountType(dtype);
        setEditDiscount(discount);
        setEditTaxType(ttype);
        setEditTax(tax);

        const discAmt  = dtype === 'percentage' ? rate * discount / 100 : discount;
        const afterDis = rate - discAmt;
        const taxAmt   = ttype === 'percentage' ? afterDis * tax / 100 : tax;
        setDisplayTotal(formatPrice(afterDis + taxAmt));

        setOriginalValues({ rate, discount, discount_type: dtype, tax, tax_type: ttype });
        setHasChanges(false);
        setPriceWarning(false);
    }

    // ── Recalculate total ──────────────────────────────
    useEffect(() => {
        if (!selectedProduct) return;
        const rate     = parseFloat(editRate) || 0;
        const discount = parseFloat(editDiscount) || 0;
        const tax      = parseFloat(editTax) || 0;
        const discAmt  = editDiscountType === 'percentage' ? rate * discount / 100 : discount;
        const afterDis = rate - discAmt;
        const taxAmt   = editTaxType === 'percentage' ? afterDis * tax / 100 : tax;
        setDisplayTotal(formatPrice(afterDis + taxAmt));

        // Price warning
        const purchased = parseFloat(selectedProduct.purchased_price || selectedProduct.price) || 0;
        setPriceWarning(rate > 0 && purchased > 0 && rate < purchased);

        // Change tracking
        const changed =
            rate     !== originalValues.rate     ||
            discount !== originalValues.discount ||
            editDiscountType !== originalValues.discount_type ||
            tax      !== originalValues.tax      ||
            editTaxType !== originalValues.tax_type;
        setHasChanges(changed);
    }, [editRate, editDiscount, editDiscountType, editTax, editTaxType]);

    // ── Validate discount ──────────────────────────────
    function validateDiscount(val, type) {
        const rate = parseFloat(editRate) || 0;
        let v = parseFloat(val) || 0;
        if (type === 'percentage' && v > 100) v = 100;
        if (type === 'amount' && v > rate) v = rate;
        if (v < 0) v = 0;
        return v;
    }

    function validateTax(val, type) {
        let v = parseFloat(val) || 0;
        if (type === 'percentage' && v > 100) v = 100;
        if (v < 0) v = 0;
        return v;
    }

    // ── Reset ──────────────────────────────────────────
    function resetPage(clearSearch = true) {
        if (clearSearch) setSearchQuery('');
        setSearchResults([]);
        setFocusIndex(-1);
        setSelectedProduct(null);
        setToggles({ ...DEFAULT_TOGGLES });
        setCompany(''); setExpiry(''); setManufacturing(''); setOther(''); setDescription('');
        setEditRate(''); setEditDiscountType('amount'); setEditDiscount('');
        setEditTaxType('amount'); setEditTax('');
        setDisplayTotal(formatPrice(0));
        setHasChanges(false);
        setOriginalValues({ ...DEFAULT_ORIGINAL });
        setPrintFormat('thermal');
        setCodeType('barcode');
        setNumCopies(1);
        setPriceWarning(false);
    }

    // ── Collect form data for API ──────────────────────
    function buildFormData() {
        return {
            product_id:      selectedProduct.id,
            format:          printFormat,
            code_type:       codeType,
            copies:          parseInt(numCopies) || 1,
            display_options: toggles,
            product_data: {
                rate:          parseFloat(editRate) || 0,
                discount:      parseFloat(editDiscount) || 0,
                discount_type: editDiscountType,
                tax:           parseFloat(editTax) || 0,
                tax_type:      editTaxType,
                qty:           1,
            },
            extra_data: {
                company,
                expiry,
                manufacturing,
                other,
                description,
            },
        };
    }

    // ── Generate PDF ───────────────────────────────────
    async function handleGenerate() {
        if (!selectedProduct) return;
        setGenerating(true);
        try {
            const res = await apiFetch('/api/barcode/generate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(buildFormData()),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `Server error ${res.status}`);
            }
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `${codeType}-${selectedProduct.name}-${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showToast(`${codeType === 'qrcode' ? 'QR Code' : 'Barcode'} PDF generated successfully!`);
            resetPage();
        } catch (err) {
            showToast('Failed to generate: ' + err.message, 'error');
        } finally {
            setGenerating(false);
        }
    }

    // ── Print ──────────────────────────────────────────
    async function handlePrint() {
        if (!selectedProduct) return;
        setPrinting(true);
        try {
            const res = await apiFetch('/api/barcode/print', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(buildFormData()),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const html = await res.text();
            const win  = window.open('', '_blank', 'width=800,height=600');
            if (!win) { showToast('Allow pop-ups to enable printing', 'error'); return; }
            win.document.write(html);
            win.document.close();
            win.onload = () => setTimeout(() => { win.focus(); win.print(); }, 250);
            resetPage();
        } catch (err) {
            showToast('Failed to print: ' + err.message, 'error');
        } finally {
            setPrinting(false);
        }
    }

    // ── Update DB ──────────────────────────────────────
    async function handleUpdateDb() {
        if (!selectedProduct || !hasChanges) return;

        const currentRate     = parseFloat(editRate) || 0;
        const currentDiscount = parseFloat(editDiscount) || 0;
        const currentTax      = parseFloat(editTax) || 0;

        const confirmed = window.confirm(
            `⚠️ Update Database Confirmation\n\n` +
            `Product: ${selectedProduct.name}\n\n` +
            `Current Database Values:\n` +
            `• Price: ${formatPrice(originalValues.rate)}\n` +
            `• Discount: ${originalValues.discount} (${originalValues.discount_type})\n` +
            `• Tax: ${originalValues.tax} (${originalValues.tax_type})\n\n` +
            `New Values:\n` +
            `• Price: ${formatPrice(currentRate)}\n` +
            `• Discount: ${currentDiscount} (${editDiscountType})\n` +
            `• Tax: ${currentTax} (${editTaxType})\n\n` +
            `Are you sure you want to UPDATE the database?`
        );
        if (!confirmed) return;

        setUpdating(true);
        try {
            const res  = await apiFetch('/api/barcode/update-product', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    product_id:    selectedProduct.id,
                    rate:          currentRate,
                    discount:      currentDiscount,
                    discount_type: editDiscountType,
                    tax:           currentTax,
                    tax_type:      editTaxType,
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast('✅ Database updated successfully!');
                setOriginalValues({
                    rate:          currentRate,
                    discount:      currentDiscount,
                    discount_type: editDiscountType,
                    tax:           currentTax,
                    tax_type:      editTaxType,
                });
                setHasChanges(false);
            } else {
                showToast('❌ ' + (data.message || 'Update failed'), 'error');
            }
        } catch (err) {
            showToast('❌ ' + err.message, 'error');
        } finally {
            setUpdating(false);
        }
    }

    // ── Preview labels ─────────────────────────────────
    function renderPreviewLabels() {
        if (!selectedProduct) return null;
        const labels = [];
        for (let i = 0; i < Math.min(numCopies, 12); i++) {
            const extras = [];
            if (toggles.price) extras.push(formatPrice(parseFloat(editRate) || 0));
            if (toggles.company && company) extras.push(company);
            if (toggles.expiry && expiry) extras.push(`Exp: ${expiry}`);
            if (toggles.manufacturing && manufacturing) extras.push(`Mfg: ${manufacturing}`);
            if (toggles.other && other) extras.push(other);
            if (toggles.description && description) extras.push(description);

            labels.push(
                <div className={styles['barcode-preview']} key={i}>
                    {toggles.productname && (
                        <div className={styles['product-name']}>{selectedProduct.name}</div>
                    )}
                    {codeType === 'qrcode'
                        ? <div className={styles['qr-placeholder']} />
                        : <div className={styles['barcode-image']} />
                    }
                    <div className={styles['barcode-number']}>{selectedProduct.id}</div>
                    {extras.length > 0 && (
                        <div className={styles['extra-info']}>{extras.join(' | ')}</div>
                    )}
                </div>
            );
        }
        return labels;
    }

    // ── Toggle helper ──────────────────────────────────
    function toggle(key) {
        setToggles(prev => ({ ...prev, [key]: !prev[key] }));
    }

    const showTable   = !!selectedProduct;
    const showPreview = !!selectedProduct;

    return (
        <>
            {/* Toast */}
            {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.msg}
                </div>
            )}

            <div className="container">
                {/* Header */}
                <div className="container-child main-text">
                    <h1>Generate Barcode</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Search product and generate barcode stickers</p>
                </div>

                {/* ── Search Section ── */}
                <div className={styles['barcode-search-section']}>
                    <h3>Search Product</h3>
                    <div style={{ position: 'relative' }}>
                        <input
                            id="productSearch"
                            type="text"
                            className={styles['barcode-search-input']}
                            placeholder="Search by product name, price (e.g., >500, 100-200)..."
                            autoComplete="off"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                        {searchResults.length > 0 && (
                            <div className={styles['barcode-search-results']}>
                                {searchResults.map((product, idx) => (
                                    <div
                                        key={product.id}
                                        className={`${styles['search-result-item']}${focusIndex === idx ? ' ' + styles['keyboard-active'] : ''}`}
                                        onClick={() => selectProduct(product)}
                                        onMouseEnter={() => setFocusIndex(idx)}
                                    >
                                        <strong>{product.name}</strong> —{' '}
                                        {formatPrice(product.price)}{' '}
                                        (Stock: {product.available_stock} {product.unit})
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Toggle Section ── */}
                <div className={styles['barcode-toggle-section']}>
                    <h3>Barcode Display Options</h3>
                    <div className={styles['toggle-items']}>
                        {/* Left column */}
                        <div className={styles['toggle-sections']}>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Show Price</label>
                                    <div
className={`${styles['toggle-switch']}${toggles.price ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('price')}
                                    />
                                </div>
                            </div>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Show Expiry Date</label>
                                    <div
className={`${styles['toggle-switch']}${toggles.expiry ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('expiry')}
                                    />
                                </div>
                                <input
                                    type="date"
                                    className={`${styles['toggle-input']}${toggles.expiry ? ' ' + styles.show : ''}`}
                                    value={expiry}
                                    onChange={e => setExpiry(e.target.value)}
                                />
                            </div>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Show Manufacturing Date</label>
                                    <div
                                        className={`${styles['toggle-switch']}${toggles.manufacturing ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('manufacturing')}
                                    />
                                </div>
                                <input
                                    type="date"
                                    className={`${styles['toggle-input']}${toggles.manufacturing ? ' ' + styles.show : ''}`}
                                    value={manufacturing}
                                    onChange={e => setManufacturing(e.target.value)}
                                />
                            </div>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Show Company Name</label>
                                    <div
                                        className={`${styles['toggle-switch']}${toggles.company ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('company')}
                                    />
                                </div>
                                <input
                                    type="text"
                                    className={`${styles['toggle-input']}${toggles.company ? ' ' + styles.show : ''}`}
                                    placeholder="Enter company name"
                                    value={company}
                                    onChange={e => setCompany(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Right column */}
                        <div className={styles['toggle-sections']}>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Show Product Name</label>
                                    <div
                                        className={`${styles['toggle-switch']}${toggles.productname ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('productname')}
                                    />
                                </div>
                            </div>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Other Information</label>
                                    <div
                                        className={`${styles['toggle-switch']}${toggles.other ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('other')}
                                    />
                                </div>
                                <input
                                    type="text"
                                    className={`${styles['toggle-input']}${toggles.other ? ' ' + styles.show : ''}`}
                                    placeholder="Enter other information"
                                    value={other}
                                    onChange={e => setOther(e.target.value)}
                                />
                            </div>
                            <div className={styles['toggle-item-row']}>
                                <div className={styles['toggle-item']}>
                                    <label>Description</label>
                                    <div
                                        className={`${styles['toggle-switch']}${toggles.description ? ' ' + styles.active : ''}`}
                                        onClick={() => toggle('description')}
                                    />
                                </div>
                                <input
                                    type="text"
                                    className={`${styles['toggle-input']}${toggles.description ? ' ' + styles.show : ''}`}
                                    placeholder="Enter product description"
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Product Details Table ── */}
                <div className={`${styles['barcode-product-table-section']}${showTable ? ' ' + styles.show : ''}`}>
                    <h3>Product Details</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table className={styles['barcode-product-table']}>
                            <thead>
                                <tr>
                                    <th>Item Description</th>
                                    <th>Qty</th>
                                    <th>Unit</th>
                                    <th>Rate</th>
                                    <th>Discount Type</th>
                                    <th>Discount</th>
                                    <th>Tax Type</th>
                                    <th>Tax</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedProduct ? (
                                    <tr>
                                        <td><strong>{selectedProduct.name}</strong></td>
                                        <td>
                                            <input
                                                type="number"
                                                value={1}
                                                readOnly
                                                style={{ cursor: 'not-allowed', width: 60 }}
                                            />
                                        </td>
                                        <td>{selectedProduct.unit}</td>
                                        <td>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    type="number"
                                                    value={editRate}
                                                    readOnly={selectedProduct.fix_sold_price}
                                                    style={{
                                                        width: 90,
                                                        borderColor: priceWarning ? '#dc3545' : '',
                                                        color:       priceWarning ? '#dc3545' : '',
                                                    }}
                                                    onChange={e => setEditRate(e.target.value)}
                                                    step="0.01"
                                                />
                                                {priceWarning && (
                                                    <div className={styles['price-warning']}>
                                                        ⚠️ Price is less than purchased price
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <select
                                                value={editDiscountType}
                                                disabled={selectedProduct.fix_discount}
                                                onChange={e => {
                                                    setEditDiscountType(e.target.value);
                                                    setEditDiscount(validateDiscount(editDiscount, e.target.value));
                                                }}
                                                style={{ width: 110 }}
                                            >
                                                <option value="amount">Amount</option>
                                                <option value="percentage">Percentage</option>
                                            </select>
                                        </td>
                                        <td>
    <div style={{ position: 'relative', display: 'inline-block' }}>
        <input
            type="number"
            value={editDiscount === 0 ? '' : editDiscount}
            readOnly={selectedProduct.fix_discount}
            placeholder="0"
            style={{ width: 80, paddingRight: 30 }}
            step="0.01"
            onChange={e => setEditDiscount(validateDiscount(e.target.value, editDiscountType))}
        />
        {editDiscountType === 'percentage' && parseFloat(editDiscount) > 0 && (
            <span style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                color: '#28a745', fontSize: 10, pointerEvents: 'none',
            }}>
                ({'- '+Math.round((parseFloat(editRate) || 0) * (parseFloat(editDiscount) || 0) / 100)})
            </span>
        )}
    </div>
</td>
                                        <td>
                                            <select
                                                value={editTaxType}
                                                disabled={selectedProduct.fix_tax}
                                                onChange={e => {
                                                    setEditTaxType(e.target.value);
                                                    setEditTax(validateTax(editTax, e.target.value));
                                                }}
                                                style={{ width: 110 }}
                                            >
                                                <option value="amount">Amount</option>
                                                <option value="percentage">Percentage</option>
                                            </select>
                                        </td>
                                        <td>
    <div style={{ position: 'relative', display: 'inline-block' }}>
        <input
            type="number"
            value={editTax === 0 ? '' : editTax}
            readOnly={selectedProduct.fix_tax}
            placeholder="0"
            style={{ width: 80, paddingRight: 30 }}
            step="0.01"
            onChange={e => setEditTax(validateTax(e.target.value, editTaxType))}
        />
        {editTaxType === 'percentage' && parseFloat(editTax) > 0 && (() => {
            const rate = parseFloat(editRate) || 0;
            const discount = parseFloat(editDiscount) || 0;
            const discAmt = editDiscountType === 'percentage' ? rate * discount / 100 : discount;
            const afterDis = rate - discAmt;
            const taxAmt = afterDis * (parseFloat(editTax) || 0) / 100;
            return (
                <span style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    color: '#28a745', fontSize: 10, pointerEvents: 'none',
                }}>
                    ({'+ '+ Math.round(taxAmt)})
                </span>
            );
        })()}
    </div>
</td>
                                        <td><strong>{displayTotal}</strong></td>
                                    </tr>
                                ) : (
                                    <tr>
                                        <td colSpan={9} className={styles['no-product-message']}>
                                            Search and select a product to continue
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ── Code Type selector (outside preview section, matching Laravel) ── */}
                <div className={styles['barcode-code-type-row']}>
                    <label>Code Type:</label>
                    <select
                        value={codeType}
                        onChange={e => setCodeType(e.target.value)}
                    >
                        <option value="barcode">Barcode</option>
                        <option value="qrcode">QR Code</option>
                    </select>
                </div>

                {/* ── Preview Section ── */}
                <div className={`${styles['barcode-preview-section']}${showPreview ? ' ' + styles.show : ''}`}>
                    <h3>Barcode Preview</h3>

                    <div className={styles['barcode-preview-controls']}>
                        <div>
                            <label>Print Format:</label>
                            <select
                                value={printFormat}
                                onChange={e => setPrintFormat(e.target.value)}
                            >
                                <option value="thermal">Thermal Printer (80mm)</option>
                                <option value="a4">A4 Paper</option>
                                <option value="a5">A5 Paper</option>
                            </select>
                        </div>
                        <div>
                            <label>Number of Copies:</label>
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={numCopies}
                                onChange={e => {
                                    let v = parseInt(e.target.value) || 1;
                                    if (v > 50) v = 50;
                                    if (v < 1) v = 1;
                                    setNumCopies(v);
                                }}
                            />
                        </div>

                         {/* Action buttons */}
                         <div className={styles['barcode-action-buttons']}>
                            {hasChanges && !isBlocked('barcode.act.update-database') && (
                                <button
                                    className={`${styles['barcode-btn']} ${styles['update-btn']}`}
                                    onClick={handleUpdateDb}
                                    disabled={updating}
                                >
                                    {updating ? 'Updating...' : 'Update Database'}
                                </button>
                            )}
                            {!isBlocked('barcode.act.pdf') && (
                                <button
                                    className={`${styles['barcode-btn']} ${styles['generate-btn']}`}
                                    onClick={handleGenerate}
                                    disabled={!selectedProduct || generating}
                                >
                                    {generating ? 'Generating...' : 'Download PDF'}
                                </button>
                            )}
                            {!isBlocked('barcode.act.print') && (
                                <button
                                    className={`${styles['barcode-btn']} ${styles['print-btn']}`}
                                    onClick={handlePrint}
                                    disabled={!selectedProduct || printing}
                                >
                                    {printing ? 'Printing...' : 'Print'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Preview grid */}
                    <div className={`${styles['barcode-preview-grid']} ${styles[printFormat]}`}>
                        {showPreview
                            ? renderPreviewLabels()
                            : <div className={styles['no-product-message']}>Select a product to see preview</div>
                        }
                    </div>
                </div>

            </div>
        </>
    );
}