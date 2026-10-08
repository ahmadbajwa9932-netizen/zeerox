'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './expense.module.css';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";
import { usePermissions } from '@/lib/permissions';

const CATEGORIES = ['Rent', 'Bills', 'Salaries', 'Other'];

export default function ExpensesPage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();
    const [items, setItems]           = useState([]);
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading]       = useState(true);
    const [toast, setToast]           = useState(null);

    const [page, setPage]                   = useState(1);
    const [sortColumn, setSortColumn]       = useState('id');
    const [sortDirection, setSortDirection] = useState('desc');
    const [search, setSearch]               = useState('');

    // Delete modal
    const [deleteModal, setDeleteModal] = useState({ open: false, id: null });

    // Edit modal
    const [editModal, setEditModal] = useState({ open: false });
    const [editForm, setEditForm]   = useState({ id: '', category: '', description: '', amount: '', date: '', start_date: '', end_date: '', days: 1 });
    const [editLoading, setEditLoading] = useState(false);

    useEffect(() => {
        setEditForm(prev => ({ ...prev, days: calcDays(prev.start_date, prev.end_date) || prev.days }));
    }, [editForm.start_date, editForm.end_date]);

    // Dropdown ref for closing on outside click
    const [openDropdown, setOpenDropdown] = useState(null);
    const dropdownRef = useRef(null);

    // ── Load data ────────────────────────────────────
    const loadData = useCallback(async (pg = 1, col = sortColumn, dir = sortDirection, q = search) => {
        setLoading(true);
        try {
            const url = `/api/expenses?page=${pg}&sort_column=${col}&sort_direction=${dir}&search=${encodeURIComponent(q)}`;
            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setItems(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load expenses', 'error');
            }
        } catch {
            showToast('An error occurred', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(1); }, []);

    // Search debounce
    useEffect(() => {
        const t = setTimeout(() => {
            setPage(1);
            loadData(1, sortColumn, sortDirection, search);
        }, 300);
        return () => clearTimeout(t);
    }, [search]);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (!e.target.closest('.action-dropdown')) setOpenDropdown(null);
        }
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDirection(dir);
        setPage(1);
        loadData(1, col, dir, search);
    }

    function SortIcons({ col }) {
        return (
            <span className="sort-icons">
                <span
                    className={sortColumn === col && sortDirection === 'asc' ? 'active' : ''}
                    onClick={() => handleSort(col, 'asc')}>▲</span>
                <span
                    className={sortColumn === col && sortDirection === 'desc' ? 'active' : ''}
                    onClick={() => handleSort(col, 'desc')}>▼</span>
            </span>
        );
    }

    // new
function formatDate(str) {
    if (!str) return 'N/A';
    const date = new Date(str);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const local = date.toLocaleDateString('en-CA'); // gives YYYY-MM-DD in local timezone
    const parts = local.split('-');
    return `${parseInt(parts[2])}-${months[parseInt(parts[1]) - 1]}-${parts[0]}`;
}


function calcDays(start, end) {
    if (!start || !end) return '';
    const diff = Math.floor((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
    return diff > 0 ? diff : '';
}

       // ── Delete ───────────────────────────────────────
       async function handleSoftDelete() {
        try {
            const res  = await apiFetch(`/api/expenses/${deleteModal.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                setDeleteModal({ open: false, id: null });
                loadData(page, sortColumn, sortDirection, search);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('An error occurred while deleting', 'error');
        }
    }

    async function handlePermanentDelete() {
        const confirmed = window.confirm('Permanently delete this expense? This cannot be undone.');
        if (!confirmed) return;
        try {
            const res  = await apiFetch(`/api/expenses/${deleteModal.id}?permanent=true`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                setDeleteModal({ open: false, id: null });
                loadData(page, sortColumn, sortDirection, search);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('An error occurred while deleting', 'error');
        }
    }

    // ── Edit ─────────────────────────────────────────
    async function openEditModal(id) {
        try {
            const res  = await apiFetch(`/api/expenses/${id}`);
            const data = await res.json();
            if (data.success) {
                const d = data.data;
                setEditForm({
                    id:          d.id,
                    category:    d.category,
                    description: d.description || '',
                    amount:      d.amount,
                    date:        d.date,
                    start_date:  d.start_date,
                    end_date:    d.end_date,
                    days:        d.days || 1,
                });
                setEditModal({ open: true });
            }
        } catch {
            showToast('Failed to load expense', 'error');
        }
    }

    async function submitEdit() {
        if (!editForm.category || !editForm.amount || !editForm.date || !editForm.start_date || !editForm.end_date)
            return showToast('All required fields must be filled.', 'error');

        setEditLoading(true);
        try {
            const res  = await apiFetch(`/api/expenses/${editForm.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category:    editForm.category,
                    description: editForm.description,
                    amount:      parseFloat(editForm.amount),
                    date:        editForm.date,
                    start_date:  editForm.start_date,
                    end_date:    editForm.end_date,
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                setEditModal({ open: false });
                loadData(page, sortColumn, sortDirection, search);
            } else {
                showToast(data.message || 'Failed to update', 'error');
            }
        } catch {
            showToast('An error occurred', 'error');
        } finally {
            setEditLoading(false);
        }
    }

    return (
        <>
            {toast && <div className={`popup ${toast.kind}`} key={toast.key}>{toast.message}</div>}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Expense Records</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Manage All Expenses</p>
                </div>

                <div className="sub-container">

                    {/* Add Button */}
                    <div className="add-button">
                        <button onClick={() => router.push('/expenses/add')}>
                            <span>Add</span>
                        </button>
                    </div>

                    {/* Search */}
                    <div className="report-search-container">
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="search..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
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
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Category</span><SortIcons col="category" />
                                    </div>
                                </th>
                                <th>Description</th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Amount</span><SortIcons col="amount" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Date</span><SortIcons col="date" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>Start Date</span><SortIcons col="start_date" />
                                    </div>
                                </th>
                                <th className="sortable">
                                    <div className="sortable-header">
                                        <span>End Date</span><SortIcons col="end_date" />
                                    </div>
                                </th>
                                <th>Days</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                        {loading ? (
                                <tr><td colSpan={9}>
                                    <div className="loading-spinner">
                                        <div className="spinner"></div>
                                        <p>Loading expenses...</p>
                                    </div>
                                </td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan={9} style={{ textAlign: 'center' }}>No expenses found.</td></tr>
                            ) : items.map((item, index) => {
                                const rowNum = pagination ? pagination.first_item + index : index + 1;
                                return (
                                    <tr key={item.id}>
                                        <td>{rowNum}</td>
                                        <td>{item.category}</td>
                                        <td>{item.description || 'N/A'}</td>
                                        <td>{formatPrice(item.amount)}</td>
                                        <td>{formatDate(item.date)}</td>
                                        <td>{formatDate(item.start_date)}</td>
                                        <td>{formatDate(item.end_date)}</td>
                                        <td>{item.days}</td>
                                        <td>
                                            <div className="action-dropdown">
                                                <button
                                                    className="dropdown-toggle"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenDropdown(openDropdown === item.id ? null : item.id);
                                                    }}
                                                >⋮</button>
                                                <div className={`action-dropdown-menu${openDropdown === item.id ? ' open' : ''}`}>
                                                {!isBlocked('expenses.index.act.edit') && (
                                                    <button onClick={() => { setOpenDropdown(null); openEditModal(item.id); }}>Edit</button>
                                                )}
                                                {!isBlocked('expenses.index.act.delete') && (
                                                    <button
                                                        onClick={() => { setOpenDropdown(null); setDeleteModal({ open: true, id: item.id }); }}
                                                    >Delete
                                                    </button>
                                                )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    {pagination && <Pagination pagination={pagination} onPageChange={p => {
                        setPage(p);
                        loadData(p, sortColumn, sortDirection, search);
                    }} />}
                </div>
            </div>

                        {/* ── Delete Modal ── */}
                        <div className={`delete-modal${deleteModal.open ? ' open' : ''}`}>
                <div className={`${styles['delete-modal-content']} delete-confirm-modal-content`}>
                    <div className="delete-confirm-modal-title">Delete this expense?</div>
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
                    <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => setDeleteModal({ open: false, id: null })}>
                        Cancel
                    </button>
                </div>
            </div>

            {/* ── Edit Modal ── */}
            <div className={`delete-modal${editModal.open ? ' open' : ''}`}>
            <div className={styles['delete-modal-content']}>
            <h3 style={{ marginTop: 0 }}>Edit Expense</h3>

                    <div style={{ marginBottom: 10 }}>
                        <label>Category:</label>
                        <select
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.category}
                            onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}
                        >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label>Description:</label>
                        <input
                            type="text"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.description}
                            onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                        />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label>Amount:</label>
                        <input
                            type="number"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.amount}
                            onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))}
                            min="0" step="0.01" required
                        />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label>Date:</label>
                        <input
                            type="date"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.date}
                            onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))}
                            required
                        />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label>Start Date:</label>
                        <input
                            type="date"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.start_date}
                            onChange={e => setEditForm(p => ({ ...p, start_date: e.target.value }))}
                            required
                        />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label>End Date:</label>
                        <input
                            type="date"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.end_date}
                            onChange={e => setEditForm(p => ({ ...p, end_date: e.target.value }))}
                            min={editForm.start_date}
                            required
                        />
                    </div>

                    <div style={{ marginBottom: 16 }}>
                        <label>Days:</label>
                        <input
                            type="number"
                            style={{ width: '100%', padding: 8, marginTop: 4 }}
                            value={editForm.days}
                            readOnly
                            disabled
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn btn-primary" onClick={submitEdit} disabled={editLoading}>
                            {editLoading ? 'Saving...' : 'Update'}
                        </button>
                        <button className="btn btn-neutral" onClick={() => setEditModal({ open: false })}>Cancel</button>
                    </div>
                </div>
            </div>
        </>
    );
}

function Pagination({ pagination, onPageChange }) {
    const { current_page, last_page, on_first_page, has_more_pages } = pagination;
    if (last_page <= 1) return null;

    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);
    const pages = [];
    for (let p = start; p <= end; p++) pages.push(p);

    return (
        <div className="custom-pagination">
            {on_first_page
                ? <span className="disabled">« First</span>
                : <a onClick={() => onPageChange(1)}>« First</a>}
            {on_first_page
                ? <span className="disabled">←</span>
                : <a onClick={() => onPageChange(current_page - 1)}>←</a>}
            {start > 1 && <span className="dots">…</span>}
            {pages.map(p => (
                <span
                    key={p}
                    className={p === current_page ? 'active' : ''}
                    style={p !== current_page ? { cursor: 'pointer' } : {}}
                    onClick={() => p !== current_page && onPageChange(p)}
                >{p}</span>
            ))}
            {end < last_page && <span className="dots">…</span>}
            {has_more_pages
                ? <a onClick={() => onPageChange(current_page + 1)}>→</a>
                : <span className="disabled">→</span>}
            {has_more_pages
                ? <a onClick={() => onPageChange(last_page)}>Last »</a>
                : <span className="disabled">Last »</span>}
        </div>
    );
}