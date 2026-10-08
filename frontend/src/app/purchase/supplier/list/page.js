'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatPrice } from "@/lib/currency-context";
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';

export default function SupplierListPage() {
    const router = useRouter();

    const [suppliers, setSuppliers]     = useState([]);
    const [pagination, setPagination]   = useState(null);
    const [loading, setLoading]         = useState(true);
    const [toast, setToast]             = useState(null);
    const [page, setPage]               = useState(1);
    const [sortColumn, setSortColumn]   = useState('name');
    const [sortDirection, setSortDirection] = useState('desc');
    const [searchQuery, setSearchQuery] = useState('');

    // Delete modal
    const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }
    const [deleteOption, setDeleteOption] = useState(null); // 'only' | 'with_purchases'
    // Edit modal
    const [editTarget, setEditTarget]   = useState(null); // supplier object
    const [editName, setEditName]       = useState('');
    const [editCompany, setEditCompany] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const [editContact, setEditContact] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    const searchTimeout = useRef(null);
    const isMounted = useRef(false);

    const loadSuppliers = useCallback(async (pg = 1) => {
        setLoading(true);
        try {
            let url = `/api/suppliers?page=${pg}&sort_column=${sortColumn}&sort_direction=${sortDirection}`;
if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setSuppliers(data.data);
                setPagination(data.pagination);
            } else {
                showToast('Failed to load suppliers', 'error');
            }
        } catch {
            showToast('An error occurred while loading suppliers', 'error');
        } finally {
            setLoading(false);
        }
    }, [sortColumn, sortDirection, searchQuery]);

    useEffect(() => { loadSuppliers(page); }, [sortColumn, sortDirection]);

    // WITH
useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    clearTimeout(searchTimeout.current);
    if (!searchQuery) { setPage(1); loadSuppliers(1); return; }
    searchTimeout.current = setTimeout(() => {
        setPage(1);
        loadSuppliers(1);
    }, 350);
    return () => clearTimeout(searchTimeout.current);
}, [searchQuery]);

    // Keyboard shortcuts
    useEffect(() => {
        function handler(e) {
            if (e.key === 'F2') {
                e.preventDefault();
                document.querySelector('.search-container .input')?.focus();
            }
            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
                e.preventDefault();
                const btns = Array.from(document.querySelectorAll('.dropdown-toggle'))
                    .filter(b => b.getClientRects().length > 0);
                if (btns.length) btns[0].focus();
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const btns = Array.from(document.querySelectorAll('.dropdown-toggle'))
                    .filter(b => b.getClientRects().length > 0);
                const idx = btns.indexOf(document.activeElement);
                if (idx === -1) return;
                e.preventDefault();
                if (e.key === 'ArrowDown' && idx < btns.length - 1) btns[idx + 1].focus();
                if (e.key === 'ArrowUp'   && idx > 0)               btns[idx - 1].focus();
            }
        }
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    function showToast(message, kind = 'success') {
        setToast({ message, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDirection(dir);
        setPage(1);
    }

    // ── Edit modal ─────────────────────────────────────
    function openEdit(supplier) {
        setEditTarget(supplier);
        setEditName(supplier.name || '');
        setEditCompany(supplier.company || '');
        setEditAddress(supplier.address || '');
        setEditContact(supplier.contact_info || '');
    }

    async function handleEditSubmit(e) {
        e.preventDefault();
        if (!editName.trim()) { showToast('Supplier name is required.', 'error'); return; }
        setEditLoading(true);
        try {
            const res  = await apiFetch(`/api/suppliers/${editTarget.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supplier_name: editName,
                    company:       editCompany,
                    address:       editAddress,
                    contact_info:  editContact,
                }),
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                setEditTarget(null);
                loadSuppliers(page);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Request failed. Try again.', 'error');
        } finally {
            setEditLoading(false);
        }
    }

        // ── Delete modal ───────────────────────────────────
        async function handleSoftDelete() {
            if (!deleteTarget || !deleteOption) return;
            try {
                const res  = await apiFetch(`/api/suppliers/${deleteTarget.id}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete_option: deleteOption }),
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message, 'success');
                    setDeleteTarget(null);
                    setDeleteOption(null);
                    loadSuppliers(page);
                } else {
                    showToast(data.message, 'error');
                }
            } catch {
                showToast('An error occurred.', 'error');
            }
        }
    
        async function handlePermanentDelete() {
            if (!deleteTarget || !deleteOption) return;
            const confirmed = window.confirm(
                `Permanently delete "${deleteTarget.name}"? This cannot be undone.`
            );
            if (!confirmed) return;

            await sendPermanentDelete(false);
        }

        async function sendPermanentDelete(confirmPartial) {
            try {
                const res  = await apiFetch(`/api/suppliers/${deleteTarget.id}?permanent=true`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete_option: deleteOption, confirm_partial: confirmPartial }),
                });
                const data = await res.json();

                if (data.success) {
                    showToast(data.message, 'success');
                    setDeleteTarget(null);
                    setDeleteOption(null);
                    loadSuppliers(page);
                    return;
                }

                if (data.needs_confirmation) {
                    const proceed = window.confirm(data.message);
                    if (proceed) {
                        await sendPermanentDelete(true);
                    }
                    return;
                }

                showToast(data.message, 'error');
            } catch {
                showToast('An error occurred.', 'error');
            }
        }


    function SortIcons({ col }) {
        return (
            <span className="sort-icons">
                <span className={`sort-up${sortColumn === col && sortDirection === 'asc' ? ' active' : ''}`}
                    onClick={() => handleSort(col, 'asc')}>▲</span>
                <span className={`sort-down${sortColumn === col && sortDirection === 'desc' ? ' active' : ''}`}
                    onClick={() => handleSort(col, 'desc')}>▼</span>
            </span>
        );
    }

    return (
        <>
            {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.message}
                </div>
            )}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Suppliers Directory</h1>
                </div>
                <div className="container-child sub-text">
                    <p>View and manage store suppliers</p>
                </div>

                <div className="sub-container">
                    {/* Search */}
                    <div className="report-search-container">
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="Search by name or company..."
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
                    <table id="supplierTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <th className="sortable"><div className="sortable-header"><span>Supplier Name</span><SortIcons col="name" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Company Name</span><SortIcons col="company" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Address</span><SortIcons col="address" /></div></th>
                                <th className="sortable"><div className="sortable-header"><span>Contact Info</span><SortIcons col="contact_info" /></div></th>
                                <th>Total Purchases</th>
                                <th>Total Purchases Value</th>
                                <th>See Details</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={9}>
                                    <div className="loading-spinner"><div className="spinner"></div><p>Loading suppliers...</p></div>
                                </td></tr>
                            ) : suppliers.length === 0 ? (
                                <tr><td colSpan={9}>No suppliers found.</td></tr>
                            ) : suppliers.map((s, index) => {
                                const rowNumber = pagination ? pagination.first_item + index : index + 1;
                                return (
                                    <tr key={s.id}>
                                        <td>{rowNumber}</td>
                                        <td>{s.name ?? 'N/A'}</td>
                                        <td>{s.company ?? 'N/A'}</td>
                                        <td>{s.address ?? 'N/A'}</td>
                                        <td>{s.contact_info ?? 'N/A'}</td>
                                        <td>{s.purchases_count}</td>
                                        <td>{formatPrice(s.total_purchase_amount)}</td>
                                        <td>
                                            <button type="button"
                                                onClick={() => router.push(`/purchase/supplier/${s.id}`)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                                <i className="fa fa-eye" style={{ fontSize: 18, color: '#5c6670' }} />
                                            </button>
                                        </td>
                                        <td>
                                            <ActionDropdown
                                                onEdit={() => openEdit(s)}
                                                onDelete={() => setDeleteTarget({ id: s.id, name: s.name })}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {pagination && (
                        <Pagination
                            pagination={pagination}
                            onPageChange={p => { setPage(p); loadSuppliers(p); }}
                            searchQuery={searchQuery}
                        />
                    )}
                </div>
            </div>

            {/* ── Edit Modal ───────────────────────────── */}
            {editTarget && (
                <div className="delete-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
                    <div className="delete-modal-content" style={{ minWidth: 340 }}>
                        <h3 style={{ marginTop: 0 }}>Edit Supplier</h3>
                        <form onSubmit={handleEditSubmit}>
                            <div style={{ marginBottom: 10 }}>
                                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Supplier Name <span style={{ color: 'red' }}>*</span></label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                    required
                                    autoFocus
                                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
                                />
                            </div>
                            <div style={{ marginBottom: 10 }}>
                                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Company</label>
                                <input type="text" value={editCompany} onChange={e => setEditCompany(e.target.value)}
                                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ marginBottom: 10 }}>
                                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Address</label>
                                <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)}
                                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Contact Info</label>
                                <input type="text" value={editContact} onChange={e => setEditContact(e.target.value)}
                                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ marginTop: 12 }}>
                                <button type="submit" className="btn btn-primary" disabled={editLoading}>
                                    {editLoading ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <button type="button" className="btn btn-neutral" onClick={() => setEditTarget(null)}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

                        {/* ── Delete Modal: Step 1 — choose scope ───── */}
                        {deleteTarget && !deleteOption && (
                <div className="delete-modal" style={{ display: 'flex' }} role="dialog" aria-modal="true">
                    <div className="delete-modal-content delete-confirm-modal-content">
                        <div className="delete-confirm-modal-title">Delete "{deleteTarget.name}"?</div>
                        <div className="delete-confirm-modal-text">
                            Choose whether to delete only this supplier, or the supplier along with all its purchases.
                        </div>
                        <div className="delete-confirm-modal-actions">
                            <button className="delete-confirm-btn delete-confirm-btn-soft" onClick={() => setDeleteOption('only')}>
                                Only Supplier
                            </button>
                            <button className="delete-confirm-btn delete-confirm-btn-permanent" onClick={() => setDeleteOption('with_purchases')}>
                                Supplier &amp; Purchases
                            </button>
                        </div>
                        <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── Delete Modal: Step 2 — soft vs permanent ── */}
            {deleteTarget && deleteOption && (
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
                        <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => { setDeleteTarget(null); setDeleteOption(null); }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

function ActionDropdown({ onEdit, onDelete }) {
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

    return (
        <div className="dropdown" ref={ref}>
            <button className="dropdown-toggle" onClick={() => setOpen(o => !o)}>⋮</button>
            {open && (
                <div className="action-dropdown-menu" style={{ display: 'block' }}>
                    {!isBlocked('purchase.supplier.act.edit') && (
                    <button type="button" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
                    )}
                    {!isBlocked('purchase.supplier.act.delete') && (
                    <button type="button" onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
                    )}
                </div>
            )}
        </div>
    );
}

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