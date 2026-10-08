'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './add-expense.module.css';
import { apiFetch } from '@/lib/api';

const CATEGORIES = ['Rent', 'Bills', 'Salaries', 'Other'];
// Local (not UTC) YYYY-MM-DD, evaluated per call. As a module-level const it
// was both a day behind before 5 AM PKT and stale if the app stayed open
// past midnight.
function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcDays(start, end) {
    if (!start || !end) return '';
    const diff = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : '';
}

const emptyRow = () => ({ category: 'Rent', description: '', amount: '', date: todayLocal(), start_date: todayLocal(), end_date: todayLocal(), days: 1 });

export default function AddExpensePage() {
    const router = useRouter();
    const [mode, setMode] = useState('single');
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);

    const [single, setSingle] = useState({
        category: '',
        description: '',
        amount: '',
        date: todayLocal(),
        start_date: todayLocal(),
        end_date: todayLocal(),
        days: 1,
    });

    const [rows, setRows] = useState([emptyRow()]);

    useEffect(() => {
        setSingle(prev => ({ ...prev, days: calcDays(prev.start_date, prev.end_date) || 1 }));
    }, [single.start_date, single.end_date]);

    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    const handleSingleChange = (e) => {
        setSingle(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSingleSubmit = async (e) => {
        e.preventDefault();
        if (!single.category) return showToast('Please select a category.', 'error');
        if (!single.amount || parseFloat(single.amount) < 0) return showToast('Enter a valid amount.', 'error');
        if (!single.date) return showToast('Date is required.', 'error');
        if (!single.start_date || !single.end_date) return showToast('Start date and end date are required.', 'error');
        if (!single.days || single.days < 1 || single.days > 365) return showToast('Date range must be between 1 and 365 days.', 'error');

        setLoading(true);
        try {
            const res = await apiFetch('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: single.category,
                    description: single.description,
                    amount: parseFloat(single.amount),
                    date: single.date,
                    start_date: single.start_date,
                    end_date: single.end_date,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            showToast('Expense added successfully!', 'success');
            setSingle({ category: '', description: '', amount: '', date: todayLocal(), start_date: todayLocal(), end_date: todayLocal(), days: 1 });
        } catch (err) {
            showToast(err.message || 'Something went wrong.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleRowChange = (index, field, value) => {
        setRows(prev => prev.map((row, i) => {
            if (i !== index) return row;
            const updated = { ...row, [field]: value };
            if (field === 'start_date' || field === 'end_date') {
                updated.days = calcDays(updated.start_date, updated.end_date) || 1;
            }
            return updated;
        }));
    };

    const addRow = () => setRows(prev => [...prev, emptyRow()]);

    const removeRow = (index) => {
        if (rows.length === 1) return;
        setRows(prev => prev.filter((_, i) => i !== index));
    };

    const handleMultipleSubmit = async (e) => {
        e.preventDefault();
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!r.category) return showToast(`Row ${i + 1}: category is required.`, 'error');
            if (!r.amount || parseFloat(r.amount) < 0) return showToast(`Row ${i + 1}: valid amount required.`, 'error');
            if (!r.date) return showToast(`Row ${i + 1}: date is required.`, 'error');
            if (!r.start_date || !r.end_date) return showToast(`Row ${i + 1}: start date and end date are required.`, 'error');
            if (!r.days || r.days < 1 || r.days > 365) return showToast(`Row ${i + 1}: date range must be 1–365 days.`, 'error');
        }

        setLoading(true);
        try {
            const res = await apiFetch('/api/expenses/multiple', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expenses: rows.map(r => ({
                        category: r.category,
                        description: r.description,
                        amount: parseFloat(r.amount),
                        date: r.date,
                        start_date: r.start_date,
                        end_date: r.end_date,
                    })),
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            showToast('Expenses added successfully!', 'success');
            setRows([emptyRow()]);
        } catch (err) {
            showToast(err.message || 'Something went wrong.', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.message}
                </div>
            )}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Manage Expenses</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Add your business expenses here</p>
                    <button className="boton-elegante" onClick={() => router.back()}>← Back</button>
                </div>

                <div className="sub-container">

                    {/* Mode Selection */}
                    <div className={styles['entry-mode']}>
                        <label><strong>Entry Mode:</strong></label>
                        <div className={styles['mode-tabs']}>
                            <button
                                type="button"
                                className={`${styles['mode-tab']}${mode === 'single' ? ' ' + styles['mode-tab-active'] : ''}`}
                                onClick={() => setMode('single')}
                            >
                                Single Entry
                            </button>
                            <button
                                type="button"
                                className={`${styles['mode-tab']}${mode === 'multiple' ? ' ' + styles['mode-tab-active'] : ''}`}
                                onClick={() => setMode('multiple')}
                            >
                                Multiple Entries
                            </button>
                        </div>
                    </div>

                    {/* Single Form */}
                    {mode === 'single' && (
                        <form className={styles['expense-form-wrapper']} onSubmit={handleSingleSubmit}>
                            <div className={styles['category-amount']}>
                                <div className={styles['input-group-select']}>
                                    <span className={styles['input-group-text']}>Category</span>
                                    <select name="category" value={single.category} onChange={handleSingleChange} required>
                                        <option value="">-- Select --</option>
                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className={styles['input-group']}>
                                    <span className={styles['input-group-text']}>Amount</span>
                                    <input type="number" name="amount" placeholder="Enter amount"
                                        value={single.amount} onChange={handleSingleChange} min="0" step="0.01" required />
                                </div>
                            </div>

                            <div className={styles['input-group']}>
                                <span className={styles['input-group-text']}>Description</span>
                                <input type="text" name="description" placeholder="e.g. Electricity Bill"
                                    value={single.description} onChange={handleSingleChange} />
                            </div>

                            <div className={styles['input-group']}>
                                <span className={styles['input-group-text']}>Date</span>
                                <input type="date" name="date"
                                    value={single.date} onChange={handleSingleChange} required />
                            </div>

                            <div className={styles['category-amount']}>
                                <div className={styles['input-group']}>
                                    <span className={styles['input-group-text']}>Start Date</span>
                                    <input type="date" name="start_date"
                                        value={single.start_date} onChange={handleSingleChange} required />
                                </div>
                                <div className={styles['input-group']}>
                                    <span className={styles['input-group-text']}>End Date</span>
                                    <input type="date" name="end_date"
                                        value={single.end_date} onChange={handleSingleChange} min={single.start_date} required />
                                </div>
                            </div>

                            <div className={styles['input-group']}>
                                <span className={styles['input-group-text']}>Days</span>
                                <input type="number" name="days" placeholder="Auto-calculated"
                                    value={single.days} readOnly disabled />
                            </div>

                            <button type="submit" className={`btn ${styles['btn-primary']}`} disabled={loading}>
                                {loading ? 'Saving...' : 'Save Expense'}
                            </button>
                        </form>
                    )}

                    {/* Multiple Form */}
                    {mode === 'multiple' && (
                        <form className={styles['expense-form-wrapper']} onSubmit={handleMultipleSubmit}>
                            <div className={styles['table-wrapper']}>
                                <table>
                                    <thead>
                                    <tr>
                                            <th>Category</th>
                                            <th>Description</th>
                                            <th>Amount</th>
                                            <th>Date</th>
                                            <th>Start Date</th>
                                            <th>End Date</th>
                                            <th>Days</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, i) => (
                                            <tr key={i}>
                                                <td>
                                                    <select value={row.category}
                                                        onChange={e => handleRowChange(i, 'category', e.target.value)} required>
                                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input type="text" value={row.description}
                                                        onChange={e => handleRowChange(i, 'description', e.target.value)} />
                                                </td>
                                                <td>
                                                    <input type="number" value={row.amount}
                                                        onChange={e => handleRowChange(i, 'amount', e.target.value)}
                                                        min="0" step="0.01" required />
                                                </td>
                                                <td>
                                                    <input type="date" value={row.date}
                                                        onChange={e => handleRowChange(i, 'date', e.target.value)} required />
                                                </td>
                                                <td>
                                                    <input type="date" value={row.start_date}
                                                        onChange={e => handleRowChange(i, 'start_date', e.target.value)} required />
                                                </td>
                                                <td>
                                                    <input type="date" value={row.end_date}
                                                        onChange={e => handleRowChange(i, 'end_date', e.target.value)}
                                                        min={row.start_date} required />
                                                </td>
                                                <td>
                                                    <input type="number" value={row.days} readOnly disabled />
                                                </td>
                                                <td>
                                                    <button type="button" className="btn btn-danger"
                                                        onClick={() => removeRow(i)} disabled={rows.length === 1}>
                                                        ✕
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className={styles['multi-actions']}>
                                <button type="button" className={`btn ${styles['btn-success']}`} onClick={addRow}>+ Add Row</button>
                                <button type="submit" className={`btn ${styles['btn-primary']}`} disabled={loading}>
                                    {loading ? 'Saving...' : 'Save All Expenses'}
                                </button>
                            </div>
                        </form>
                    )}

                </div>
            </div>
        </>
    );
}