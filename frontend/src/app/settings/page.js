'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './settings.module.css';
import { apiFetch } from '@/lib/api';
import { useCurrency } from '@/lib/currency-context';

const MOCK_CURRENCIES = [
    { symbol: 'Rs', locale: 'en-PK', label: 'Pakistani Rupee (Rs)' },
    { symbol: '$', locale: 'en-US', label: 'US Dollar ($)' },
    { symbol: '€', locale: 'en-DE', label: 'Euro (€)' },
    { symbol: '£', locale: 'en-GB', label: 'British Pound (£)' },
    { symbol: '₹', locale: 'en-IN', label: 'Indian Rupee (₹)' },
    { symbol: 'AED', locale: 'ar-AE', label: 'UAE Dirham (AED)' },
    { symbol: 'SAR', locale: 'ar-SA', label: 'Saudi Riyal (SAR)' },
    { symbol: '৳', locale: 'bn-BD', label: 'Bangladeshi Taka (৳)' },
    { symbol: '¥', locale: 'ja-JP', label: 'Japanese Yen (¥)' },
    { symbol: '¥', locale: 'zh-CN', label: 'Chinese Yuan (¥)' },
    { symbol: 'CA$', locale: 'en-CA', label: 'Canadian Dollar (CA$)' },
    { symbol: 'A$', locale: 'en-AU', label: 'Australian Dollar (A$)' },
    { symbol: 'TRY', locale: 'tr-TR', label: 'Turkish Lira (TRY)' },
    { symbol: 'KWD', locale: 'ar-KW', label: 'Kuwaiti Dinar (KWD)' },
    { symbol: 'QAR', locale: 'ar-QA', label: 'Qatari Riyal (QAR)' },
];



export default function SettingsPage() {
    const router = useRouter();
    const { setCurrency: setGlobalCurrency } = useCurrency();

    // ─── Popup toast ────────────────────────────────────
    const [popup, setPopup] = useState(null); // { type: 'success' | 'error', message }

    useEffect(() => {
        if (!popup) return;
        const t = setTimeout(() => setPopup(null), 3000);
        return () => clearTimeout(t);
    }, [popup]);

    function showPopup(type, message) {
        setPopup({ type, message });
    }

    // ─── Fetch real app settings on mount ───────────────
    useEffect(() => {
        apiFetch('/settings/app')
        .then((res) => res.json())
            .then((data) => {
                if (!data) return;
                setLowInventory(data.default_low_inventory);
                setPurchase({
                    enable_default_discount: !!data.enable_default_discount,
                    default_discount_type: data.default_discount_type,
                    default_discount_value: data.default_discount_value,
                    enable_default_tax: !!data.enable_default_tax,
                    default_tax_type: data.default_tax_type,
                    default_tax_value: data.default_tax_value,
                });
            })
            .catch((err) => console.error('Failed to load app settings:', err));

            apiFetch('/settings/units')
            .then((res) => res.json())
            .then((data) => setUnits(data || []))
            .catch((err) => console.error('Failed to load units:', err));

        apiFetch('/settings/currency')
            .then((res) => res.json())
            .then((data) => {
                if (data) setCurrency(data);
            })
            .catch((err) => console.error('Failed to load currency settings:', err));
    }, []);

    // ─── Modal open state ───────────────────────────────
    const [inventoryOpen, setInventoryOpen] = useState(false);
    const [purchaseOpen, setPurchaseOpen] = useState(false);
    const [unitOpen, setUnitOpen] = useState(false);
    const [currencyOpen, setCurrencyOpen] = useState(false);
    const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
    const [autoDeleteOpen, setAutoDeleteOpen] = useState(false);

    // ─── Inventory settings ─────────────────────────────
    const [lowInventory, setLowInventory] = useState('');

    function openInventoryModal() {
        setInventoryOpen(true);
    }

    function submitInventory(e) {
        e.preventDefault();
        apiFetch('/settings/app/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_low_inventory: lowInventory }),
        })
            .then((res) => res.json())
            .then(() => {
                showPopup('success', 'Inventory settings saved successfully.');
                setInventoryOpen(false);
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to save inventory settings.');
            });
    }

    // ─── Purchase settings ──────────────────────────────
    const [purchase, setPurchase] = useState({
        enable_default_discount: false,
        default_discount_type: 'amount',
        default_discount_value: 0,
        enable_default_tax: false,
        default_tax_type: 'amount',
        default_tax_value: 0,
    });

    function openPurchaseModal() {
        setPurchaseOpen(true);
    }

    function submitPurchase(e) {
        e.preventDefault();
        apiFetch('/settings/app/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(purchase),
        })
            .then((res) => res.json())
            .then(() => {
                showPopup('success', 'Purchase settings saved successfully.');
                setPurchaseOpen(false);
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to save purchase settings.');
            });
    }

    // ─── Unit management ────────────────────────────────
    const [units, setUnits] = useState([]);
    const [newUnitName, setNewUnitName] = useState('');
    const [newUnitDisplayName, setNewUnitDisplayName] = useState('');

    function openUnitModal() {
        setNewUnitName('');
        setNewUnitDisplayName('');
        setUnitOpen(true);
    }

    function submitCreateUnit(e) {
        e.preventDefault();
        if (!newUnitName.trim() || !newUnitDisplayName.trim()) return;

        apiFetch('/settings/units', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: newUnitName.trim(),
                display_name: newUnitDisplayName.trim(),
            }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    showPopup('error', data.message || 'Failed to add unit.');
                    return;
                }
                setUnits((prev) => [...prev, data.unit]);
                setNewUnitName('');
                setNewUnitDisplayName('');
                showPopup('success', 'Unit added successfully.');
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to add unit.');
            });
    }

    function toggleUnit(id) {
        apiFetch(`/settings/units/${id}/toggle`, { method: 'POST' })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    showPopup('error', 'Failed to update unit.');
                    return;
                }
                setUnits((prev) => prev.map((u) => (u.id === id ? data.unit : u)));
                showPopup('success', 'Unit status updated.');
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to update unit.');
            });
    }

    function deleteUnit(id) {
        apiFetch(`/settings/units/${id}`, { method: 'DELETE' })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    showPopup('error', data.message || 'Failed to delete unit.');
                    return;
                }
                setUnits((prev) => prev.filter((u) => u.id !== id));
                showPopup('success', 'Unit deleted successfully.');
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to delete unit.');
            });
    }

    // ─── Currency settings ──────────────────────────────
    const [currency, setCurrency] = useState({
        currency_symbol: 'Rs',
        currency_locale: 'en-PK',
        currency_position: 'before',
    });

    function openCurrencyModal() {
        setCurrencyOpen(true);
    }

    function handleCurrencySelectChange(e) {
        const selected = MOCK_CURRENCIES.find((c) => c.locale === e.target.value) || MOCK_CURRENCIES[0];
        setCurrency((prev) => ({
            ...prev,
            currency_symbol: selected.symbol,
            currency_locale: selected.locale,
        }));
    }

    function submitCurrency(e) {
        e.preventDefault();
        apiFetch('/settings/currency/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currency),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success && data.settings) {
                    setGlobalCurrency(data.settings);
                }
                showPopup('success', 'Currency settings saved successfully.');
                setCurrencyOpen(false);
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to save currency settings.');
            });
    }

    const currencyPreview =
        currency.currency_position === 'before'
            ? `${currency.currency_symbol} 1,234.56`
            : `1,234.56 ${currency.currency_symbol}`;

    // ─── Admin password → Auto delete flow ──────────────
    const [adminPassword, setAdminPassword] = useState('');

    function submitAdminPassword(e) {
        e.preventDefault();
        apiFetch('/settings/verify-admin-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_password: adminPassword }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    setAdminPassword('');
                    setAdminPasswordOpen(false);
                    return apiFetch('/settings/auto-delete/get')
                        .then((res) => res.json())
                        .then((settings) => {
                            setAutoDeletePeriod(settings.auto_delete_period || 'never');
                            setAutoDeleteOpen(true);
                        });
                } else {
                    showPopup('error', data.message || 'Incorrect admin password.');
                }
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to verify admin password.');
            });
    }

    // ─── Auto delete settings ───────────────────────────
    const [autoDeletePeriod, setAutoDeletePeriod] = useState('never');

    function submitAutoDelete(e) {
        e.preventDefault();

        if (autoDeletePeriod !== 'never') {
            const confirmed = window.confirm(
                `Saving this will immediately and permanently delete old sales and customer records older than ${autoDeletePeriod}, and continue auto-deleting daily going forward. This action cannot be undone. Continue?`
            );
            if (!confirmed) return;
        }

        apiFetch('/settings/auto-delete/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_delete_period: autoDeletePeriod }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    showPopup('error', data.message || 'Failed to save auto delete settings.');
                    return;
                }

                if (data.delete_result && !data.delete_result.no_records) {
                    showPopup(
                        'success',
                        `Settings saved. Deleted ${data.delete_result.sales_deleted} sales and ${data.delete_result.customers_deleted} customers.`
                    );
                } else if (data.delete_result && data.delete_result.no_records) {
                    showPopup('success', 'Settings saved. No old records found to delete.');
                } else {
                    showPopup('success', data.message || 'Auto delete settings saved successfully.');
                }
                setAutoDeleteOpen(false);
            })
            .catch((err) => {
                console.error(err);
                showPopup('error', 'Failed to save auto delete settings.');
            });
    }

    return (
        <div className={styles.container}>
            {popup && (
                <div
                    className={`${styles.popup} ${
                        popup.type === 'success' ? styles.popupSuccess : styles.popupError
                    }`}
                >
                    {popup.message}
                </div>
            )}

            <div className={styles.mainText}>
                <h1>Setting</h1>
                <div className={styles.subText}>
                    <p>Manage and customize your system settings</p>
                    <button type="button" className={styles.backButton} onClick={() => router.back()}>
                        ← Back
                    </button>
                </div>
            </div>

            {/* Receipt Page Setting Card */}
            <div
                className={styles.settingCard}
                onClick={() => router.push('/settings/receipt')}
            >
                <h3>Receipt Page Settings</h3>
                <p>Configure the paper size for printing receipts (A4, A5, or 80mm thermal). Choose the preferred format for your POS system.</p>
            </div>

            {/* Low Inventory Setting Card */}
            <div className={styles.settingCard} onClick={openInventoryModal}>
                <h3>Inventory Settings</h3>
                <p>Set the default low inventory threshold. When product quantity falls below this value, you'll receive a low stock alert.</p>
            </div>

            {/* Default Purchase Settings Card */}
            <div className={styles.settingCard} onClick={openPurchaseModal}>
                <h3>Default Purchase Settings</h3>
                <p>Set default discount and tax values that will be automatically applied to new purchase items.</p>
            </div>

            {/* Unit Management Settings Card */}
            <div className={styles.settingCard} onClick={openUnitModal}>
                <h3>Unit Management</h3>
                <p>Manage product units. Toggle units on/off to show/hide them in the purchase form, or create custom units.</p>
            </div>

            {/* Currency Settings Card */}
            <div className={styles.settingCard} onClick={openCurrencyModal}>
                <h3>Currency Settings</h3>
                <p>Configure your currency symbol and display format. Select from predefined currencies or customize as needed.</p>
            </div>

            {/* Auto Delete Settings Card */}
            <div className={styles.settingCard} onClick={() => setAdminPasswordOpen(true)}>
                <h3>🗑️ Auto Delete Settings</h3>
                <p>Automatically delete old sales and customer records after a specified period. Credit sales and customers with balances are protected.</p>
            </div>

            {/* ─── Inventory Settings Modal ─────────────────── */}
            <div className={`${styles.modal} ${inventoryOpen ? styles.modalOpen : ''}`}>
                <div className={styles.modalContent}>
                    <span className={styles.close} onClick={() => setInventoryOpen(false)}>
                        &times;
                    </span>
                    <h2>Inventory Settings</h2>
                    <form onSubmit={submitInventory}>
                        <div className={styles.formGroup}>
                            <label htmlFor="default_low_inventory">Default Low Inventory Value:</label>
                            <input
                                type="number"
                                id="default_low_inventory"
                                min="1"
                                required
                                value={lowInventory}
                                onChange={(e) => setLowInventory(e.target.value)}
                            />
                            <small className={styles.helpText}>
                                Products will show low stock alert when quantity falls below this value.
                            </small>
                        </div>
                        <button type="submit" className={styles.btnSave}>
                            Save Settings
                        </button>
                    </form>
                </div>
            </div>

            {/* ─── Purchase Settings Modal ──────────────────── */}
            <div className={`${styles.modal} ${purchaseOpen ? styles.modalOpen : ''}`}>
                <div className={styles.modalContent}>
                    <span className={styles.close} onClick={() => setPurchaseOpen(false)}>
                        &times;
                    </span>
                    <h2>Default Purchase Settings</h2>
                    <form onSubmit={submitPurchase}>
                        {/* Discount Section */}
                        <div className={styles.formSection}>
                            <div className={styles.formGroup}>
                                <div className={styles.toggleWrapper}>
                                    <span>Default Discount</span>
                                    <label className={styles.switch}>
                                        <input
                                            type="checkbox"
                                            checked={purchase.enable_default_discount}
                                            onChange={(e) =>
                                                setPurchase((p) => ({ ...p, enable_default_discount: e.target.checked }))
                                            }
                                        />
                                        <span className={styles.slider}></span>
                                    </label>
                                </div>
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label htmlFor="default_discount_type">Discount Type:</label>
                                    <select
                                        id="default_discount_type"
                                        value={purchase.default_discount_type}
                                        onChange={(e) =>
                                            setPurchase((p) => ({ ...p, default_discount_type: e.target.value }))
                                        }
                                    >
                                        <option value="amount">Amount</option>
                                        <option value="percentage">Percentage</option>
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="default_discount_value">Discount Value:</label>
                                    <input
                                        type="number"
                                        id="default_discount_value"
                                        step="0.01"
                                        min="0"
                                        value={purchase.default_discount_value}
                                        onChange={(e) =>
                                            setPurchase((p) => ({ ...p, default_discount_value: e.target.value }))
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Tax Section */}
                        <div className={styles.formSection}>
                            <div className={styles.formGroup}>
                                <div className={styles.toggleWrapper}>
                                    <span>Default Tax</span>
                                    <label className={styles.switch}>
                                        <input
                                            type="checkbox"
                                            checked={purchase.enable_default_tax}
                                            onChange={(e) =>
                                                setPurchase((p) => ({ ...p, enable_default_tax: e.target.checked }))
                                            }
                                        />
                                        <span className={styles.slider}></span>
                                    </label>
                                </div>
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label htmlFor="default_tax_type">Tax Type:</label>
                                    <select
                                        id="default_tax_type"
                                        value={purchase.default_tax_type}
                                        onChange={(e) => setPurchase((p) => ({ ...p, default_tax_type: e.target.value }))}
                                    >
                                        <option value="amount">Amount</option>
                                        <option value="percentage">Percentage</option>
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label htmlFor="default_tax_value">Tax Value:</label>
                                    <input
                                        type="number"
                                        id="default_tax_value"
                                        step="0.01"
                                        min="0"
                                        value={purchase.default_tax_value}
                                        onChange={(e) =>
                                            setPurchase((p) => ({ ...p, default_tax_value: e.target.value }))
                                        }
                                    />
                                </div>
                            </div>
                        </div>

                        <button type="submit" className={styles.btnSave}>
                            Save Settings
                        </button>
                    </form>
                </div>
            </div>

            {/* ─── Unit Management Modal ────────────────────── */}
            <div className={`${styles.modal} ${unitOpen ? styles.modalOpen : ''}`}>
                <div className={`${styles.modalContent} ${styles.modalContentWide}`}>
                    <span className={styles.close} onClick={() => setUnitOpen(false)}>
                        &times;
                    </span>
                    <h2>Unit Management</h2>

                    {/* Create New Unit Form */}
                    <div className={styles.createUnitCard}>
                        <form onSubmit={submitCreateUnit} className={styles.createUnitForm}>
                            <div className={styles.inlineFormGroup}>
                                <label htmlFor="unit_name">Unit Name:</label>
                                <input
                                    type="text"
                                    id="unit_name"
                                    required
                                    value={newUnitName}
                                    onChange={(e) => setNewUnitName(e.target.value)}
                                />
                            </div>
                            <div className={styles.inlineFormGroup}>
                                <label htmlFor="unit_display_name">Display Name:</label>
                                <input
                                    type="text"
                                    id="unit_display_name"
                                    required
                                    value={newUnitDisplayName}
                                    onChange={(e) => setNewUnitDisplayName(e.target.value)}
                                />
                            </div>
                            <div className={styles.centerRow}>
                                <button type="submit" className={styles.btnSave} style={{ width: 200 }}>
                                    Add Unit
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Units List */}
                    <div className={styles.unitsList}>
                        {units.map((unit) => (
                            <div key={unit.id} className={styles.unitRow}>
                                <div>
                                    <div className={styles.unitRowName}>{unit.display_name}</div>
                                    <div className={styles.unitRowDisplay}>{unit.name}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <label className={styles.switch}>
                                        <input
                                            type="checkbox"
                                            checked={!!unit.is_active}
                                            onChange={() => toggleUnit(unit.id)}
                                        />
                                        <span className={styles.slider}></span>
                                    </label>
                                    {!unit.is_default && (
                                        <button
                                            type="button"
                                            className={styles.close}
                                            onClick={() => deleteUnit(unit.id)}
                                            title="Delete unit"
                                        >
                                            &times;
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ─── Currency Settings Modal ──────────────────── */}
            <div className={`${styles.modal} ${currencyOpen ? styles.modalOpen : ''}`}>
                <div className={`${styles.modalContent} ${styles.modalContentMd}`}>
                    <span className={styles.close} onClick={() => setCurrencyOpen(false)}>
                        &times;
                    </span>
                    <h2>Currency Settings</h2>
                    <form onSubmit={submitCurrency}>
                        <div className={styles.formGroup}>
                            <label htmlFor="currency_select">Select Currency:</label>
                            <select
                                id="currency_select"
                                required
                                value={currency.currency_locale}
                                onChange={handleCurrencySelectChange}
                            >
                                                                {MOCK_CURRENCIES.map((c) => (
                                    <option key={c.locale} value={c.locale}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="currency_position">Symbol Position:</label>
                            <select
                                id="currency_position"
                                required
                                value={currency.currency_position}
                                onChange={(e) =>
                                    setCurrency((c) => ({ ...c, currency_position: e.target.value }))
                                }
                            >
                                <option value="before">Before amount ({currency.currency_symbol} 1,234.56)</option>
                                <option value="after">After amount (1,234.56 {currency.currency_symbol})</option>
                            </select>
                        </div>

                        <div className={styles.previewBox}>
                            <strong>Preview:</strong>
                            <p className={styles.previewText}>{currencyPreview}</p>
                        </div>

                        <button type="submit" className={styles.btnSave}>
                            Save Settings
                        </button>
                    </form>
                </div>
            </div>

            {/* ─── Admin Password Verification Modal ────────── */}
            <div className={`${styles.modal} ${adminPasswordOpen ? styles.modalOpen : ''}`}>
                <div className={`${styles.modalContent} ${styles.modalContentSm}`}>
                    <span
                        className={styles.close}
                        onClick={() => {
                            setAdminPasswordOpen(false);
                            setAdminPassword('');
                        }}
                    >
                        &times;
                    </span>
                    <h2>Admin Verification Required</h2>
                    <p className={styles.mutedText} style={{ marginBottom: 20 }}>
                        Please enter admin password to access Auto Delete settings.
                    </p>
                    <form onSubmit={submitAdminPassword}>
                        <div className={styles.formGroup}>
                            <label htmlFor="admin_password">Admin Password:</label>
                            <input
                                type="password"
                                id="admin_password"
                                required
                                value={adminPassword}
                                onChange={(e) => setAdminPassword(e.target.value)}
                            />
                        </div>
                        <button type="submit" className={styles.btnSave}>
                            Verify
                        </button>
                    </form>
                </div>
            </div>

            {/* ─── Auto Delete Settings Modal ────────────────── */}
            <div className={`${styles.modal} ${autoDeleteOpen ? styles.modalOpen : ''}`}>
                <div className={`${styles.modalContent} ${styles.modalContentMd}`}>
                    <span className={styles.close} onClick={() => setAutoDeleteOpen(false)}>
                        &times;
                    </span>
                    <h2>Auto Delete Settings</h2>
                    <form onSubmit={submitAutoDelete}>
                        <div className={styles.formGroup}>
                            <label htmlFor="auto_delete_period">Delete records older than:</label>
                            <select
                                id="auto_delete_period"
                                required
                                value={autoDeletePeriod}
                                onChange={(e) => setAutoDeletePeriod(e.target.value)}
                            >
                                <option value="never">Never (Disabled)</option>
                                <option value="1year">1 Year</option>
                                <option value="2years">2 Years</option>
                                <option value="3years">3 Years</option>
                                <option value="4years">4 Years</option>
                                <option value="5years">5 Years</option>
                                <option value="10years">10 Years</option>
                            </select>
                            <small className={styles.helpText}>
                                ⚠️ <strong>Protected Records:</strong>
                                <ul className={styles.protectedList}>
                                    <li>Credit sales with unpaid balance</li>
                                    <li>Customers with current balance &gt; 0</li>
                                    <li>Customers with advance payment &gt; 0</li>
                                    <li>All records linked to protected sales/customers</li>
                                </ul>
                            </small>
                        </div>

                        <div className={styles.warningBox}>
                            <strong>⚠️ Warning:</strong>
                            <p>
                                This action will <strong>permanently delete</strong> old records. Deleted data
                                cannot be recovered. Make sure you have backups before enabling this feature.
                            </p>
                        </div>

                        <button type="submit" className={styles.btnSave}>
                            Save Settings
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}