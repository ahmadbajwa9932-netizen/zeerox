'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from "@/lib/currency-context";
import { apiFetch } from '@/lib/api';
import styles from './banking.module.css';

const BANK_PRESETS = ['JazzCash', 'EasyPaisa', 'MCB Bank', 'HBL Bank', 'UBL', 'Meezan Bank', 'Allied Bank', 'Bank Alfalah', 'Other'];

function badgeClass(bankName) {
    const key = bankName?.toLowerCase().replace(/\s+/g, '');
    if (key === 'jazzcash') return styles.jazzcash;
    if (key === 'easypaisa') return styles.easypaisa;
    if (key?.includes('mcb')) return styles.mcb;
    if (key?.includes('hbl')) return styles.hbl;
    return styles.other;
}

export default function BankingPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    const [showAddModal, setShowAddModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        bank_name: 'JazzCash',
        custom_bank_name: '',
        account_title: '',
        account_number: '',
        branch_name: '',
        balance: '',
    });

    const [openDropdown, setOpenDropdown] = useState(null);
    const [popup, setPopup] = useState(null);

    const showPopup = (message, type = 'success') => {
        setPopup({ message, type });
        setTimeout(() => setPopup(null), 3000);
    };

    const loadAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/api/bank-accounts?search=${encodeURIComponent(search)}`);
            const data = await res.json();
            setAccounts(data.data || []);
        } catch {
            showPopup('Failed to load bank accounts', 'error');
        } finally {
            setLoading(false);
        }
    }, [search]);

    useEffect(() => {
        const t = setTimeout(loadAccounts, 300);
        return () => clearTimeout(t);
    }, [loadAccounts]);

    const resetForm = () => setForm({
        bank_name: 'JazzCash',
        custom_bank_name: '',
        account_title: '',
        account_number: '',
        branch_name: '',
        balance: '',
    });

    const handleAdd = async (e) => {
        e.preventDefault();
        const bankName = form.bank_name === 'Other' ? form.custom_bank_name.trim() : form.bank_name;

        if (!bankName) {
            showPopup('Please enter a bank name', 'error');
            return;
        }

        setSaving(true);
        try {
            const res = await apiFetch('/api/bank-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bank_name: bankName,
                    account_title: form.account_title,
                    account_number: form.account_number,
                    branch_name: form.branch_name,
                    balance: form.balance,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);

            showPopup('Bank account added successfully');
            setShowAddModal(false);
            resetForm();
            loadAccounts();
        } catch (err) {
            showPopup(err.message || 'Failed to add bank account', 'error');
        } finally {
            setSaving(false);
        }
    };

    const openPayments = (account) => {
        setOpenDropdown(null);
        router.push(`/payment-accounts/${account.id}`);
    };

    const handleDelete = async (id) => {
        setOpenDropdown(null);
        try {
            await apiFetch(`/api/bank-accounts/${id}`, { method: 'DELETE' });
            showPopup('Bank account removed');
            loadAccounts();
        } catch {
            showPopup('Failed to remove bank account', 'error');
        }
    };

    const handleToggleStatus = async (acc) => {
        setOpenDropdown(null);
        try {
            await apiFetch(`/api/bank-accounts/${acc.id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: acc.status ? 0 : 1 }),
            });
            showPopup(acc.status ? 'Account deactivated' : 'Account activated');
            loadAccounts();
        } catch {
            showPopup('Failed to update account status', 'error');
        }
    };

    return (
        <div className="container">
        <div className="container-child main-text">
            <h1>Banking Details</h1>
        </div>
        <div className="container-child sub-text">
            <p>Manage All Bank Accounts</p>
        </div>

        <div className="sub-container">
                <div className="report-search-container">
                    <div className="search-container">
                        <input
                            className="input"
                            placeholder="Search bank, title or account no."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <span className="icon1"><i className="fa-solid fa-magnifying-glass" /></span>
                    </div>
                </div>

                <div className="add-button">
                    <button onClick={() => setShowAddModal(true)}>
                        <span>Add Account</span>
                    </button>
                </div>

                {loading ? (
                    <div className="loading-spinner"><div className="spinner" /></div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>Bank / Wallet</th>
                                <th>Account Title</th>
                                <th>Account Number</th>
                                <th>Branch</th>
                                <th>Current Balance</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.length === 0 ? (
                                <tr><td colSpan={7} className={styles.emptyState}>No bank accounts added yet.</td></tr>
                            ) : accounts.map((acc) => (
                                <tr key={acc.id}>
                                    <td><span className={`${styles.bankBadge} ${badgeClass(acc.bank_name)}`}>{acc.bank_name}</span></td>
                                    <td>{acc.account_title || '—'}</td>
                                    <td>{acc.account_number || '—'}</td>
                                    <td>{acc.branch_name || '—'}</td>
                                    <td className={styles.balancePill}>{formatPrice(acc.balance)}</td>
                                    <td>
                                        <span className={`${styles.statusBadge} ${acc.status ? styles.active : styles.inactive}`}>
                                            {acc.status ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="dropdown">
                                            <button
                                                className="dropdown-toggle"
                                                onClick={() => setOpenDropdown(openDropdown === acc.id ? null : acc.id)}
                                            >
                                                ⋮
                                            </button>
                                            <div className={`dropdown-menu ${openDropdown === acc.id ? 'open' : ''}`} style={{ display: openDropdown === acc.id ? 'flex' : 'none', cursor:'pointer' }}>
                                                <a onClick={() => openPayments(acc)}>View Payments</a>
                                                <a onClick={() => handleToggleStatus(acc)}>{acc.status ? 'Deactivate' : 'Activate'}</a>
                                                <a onClick={() => handleDelete(acc.id)}>Delete</a>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ADD ACCOUNT MODAL */}
            <div className={`category-modal ${showAddModal ? 'open' : ''}`}>
                <div className="category-modal-content">
                    <h3>Add Bank Account</h3>
                    <form onSubmit={handleAdd}>
                        <div className={styles.formGrid}>
                            <div className={styles.formGroup}>
                                <label>Bank / Wallet</label>
                                <select
                                    value={form.bank_name}
                                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                                >
                                    {BANK_PRESETS.map((b) => <option key={b} value={b}>{b}</option>)}
                                </select>
                            </div>

                            {form.bank_name === 'Other' && (
                                <div className={styles.formGroup}>
                                    <label>Custom Bank Name</label>
                                    <input
                                        value={form.custom_bank_name}
                                        onChange={(e) => setForm({ ...form, custom_bank_name: e.target.value })}
                                        placeholder="e.g. Sadapay"
                                    />
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label>Account Title</label>
                                <input
                                    value={form.account_title}
                                    onChange={(e) => setForm({ ...form, account_title: e.target.value })}
                                    placeholder="Account holder name"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Account Number</label>
                                <input
                                    value={form.account_number}
                                    onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Branch (optional)</label>
                                <input
                                    value={form.branch_name}
                                    onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label>Starting Balance</label>
                                <input
                                    type="number"
                                    value={form.balance}
                                    onChange={(e) => setForm({ ...form, balance: e.target.value })}
                                    placeholder="0"
                                />
                            </div>

                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-neutral" onClick={() => { setShowAddModal(false); resetForm(); }}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Account'}</button>
                        </div>
                    </form>
                </div>
            </div>

            {popup && <div className={`popup ${popup.type}`}>{popup.message}</div>}
        </div>
    );
}