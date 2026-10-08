'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from './categories.module.css';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';

// ─── TOAST ────────────────────────────────────────────
function Toast({ message, type, onDone }) {
    useEffect(() => {
        const t = setTimeout(onDone, 3000);
        return () => clearTimeout(t);
    }, [onDone]);

    return <div className={`popup ${type}`}>{message}</div>;
}

function DeleteModal({ category, onClose, onDeleted }) {
    const [loading, setLoading]         = useState(false);
    const [mode, setMode]               = useState(null); // 'soft' | 'permanent' — chosen in step 1
    const [targetOptions, setTargetOptions] = useState([]);
    const [targetId, setTargetId]       = useState('');
    const [fetchingOptions, setFetchingOptions] = useState(false);

    const hasPurchases = (category.purchases_count || 0) > 0;

    // Step 1 → Step 2: load categories to move purchases into (only if there are purchases)
    async function chooseMode(selectedMode) {
        setMode(selectedMode);
        if (!hasPurchases) return;
        setFetchingOptions(true);
        try {
            const res  = await apiFetch(`/api/categories/options?exclude_id=${category.id}`);
            const data = await res.json();
            if (data.success) setTargetOptions(data.categories);
        } catch {
            // options list failing isn't fatal — user just won't see any options
        } finally {
            setFetchingOptions(false);
        }
    }

    async function handleConfirm() {
        if (hasPurchases && !targetId) return;
        if (mode === 'permanent') {
            const confirmed = window.confirm(`Permanently delete "${category.name}"? This cannot be undone.`);
            if (!confirmed) return;
        }
        setLoading(true);
        try {
            const url = mode === 'permanent'
                ? `/api/categories/${category.id}?permanent=true`
                : `/api/categories/${category.id}`;
                const res  = await apiFetch(url, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(hasPurchases ? { target_category_id: targetId } : {}),
                });
            const data = await res.json();
            if (data.success) {
                onDeleted(data.message);
            } else {
                onDeleted(data.message, 'error');
            }
        } catch {
            onDeleted('An error occurred.', 'error');
        } finally {
            setLoading(false);
        }
    }

    // ── Step 1: soft delete vs permanent delete ─────────
    if (!mode) {
        return (
            <div className="delete-modal open">
                <div className="delete-modal-content delete-confirm-modal-content">
                    <div className="delete-confirm-modal-title">Delete "{category.name}"?</div>
                    <div className="delete-confirm-modal-text">
                        Soft delete can be restored later from Recycle Bin. Permanent delete cannot be undone.
                    </div>
                    <div className="delete-confirm-modal-actions">
                        <button className="delete-confirm-btn delete-confirm-btn-soft" onClick={() => chooseMode('soft')}>
                            Soft delete
                        </button>
                        <button className="delete-confirm-btn delete-confirm-btn-permanent" onClick={() => chooseMode('permanent')}>
                            Permanent delete
                        </button>
                    </div>
                    <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

        // ── Step 2: pick a category to move purchases into (skipped when there are none) ──
        return (
            <div className="delete-modal open">
                <div className="delete-modal-content delete-confirm-modal-content">
                    {hasPurchases ? (
                        <>
                            <div className="delete-confirm-modal-title">Move purchases out of "{category.name}"</div>
                            <div className="delete-confirm-modal-text">
                                All purchases in this category must be moved before it can be deleted. Choose a category to move them into.
                            </div>
    
                            {fetchingOptions ? (
                                <div className="loading-spinner"><div className="spinner"></div><p>Loading categories...</p></div>
                            ) : (
                                <select
                                    value={targetId}
                                    onChange={e => setTargetId(e.target.value)}
                                    style={{ width: '100%', padding: '8px 10px', margin: '10px 0', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
                                >
                                    <option value="">Select a category...</option>
                                    {targetOptions.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="delete-confirm-modal-title">Delete "{category.name}"?</div>
                            <div className="delete-confirm-modal-text">
                                This category has no products. {mode === 'permanent' ? 'This cannot be undone.' : 'You can restore it later from the Recycle Bin.'}
                            </div>
                        </>
                    )}
    
                    <div className="delete-confirm-modal-actions">
                        <button
                            className={mode === 'permanent' ? 'delete-confirm-btn delete-confirm-btn-permanent' : 'delete-confirm-btn delete-confirm-btn-soft'}
                            disabled={loading || (hasPurchases && !targetId)}
                            onClick={handleConfirm}
                        >
                            {loading ? 'Processing...' : mode === 'permanent' ? 'Permanently Delete' : 'Soft Delete'}
                        </button>
                    </div>
                    <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => setMode(null)} disabled={loading}>
                        Back
                    </button>
                </div>
            </div>
        );
}

// ─── ADD / EDIT MODAL ─────────────────────────────────
function CategoryModal({ editId, onClose, onSaved }) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);

    useEffect(() => {
        if (editId) {
            setFetching(true);
            apiFetch(`/api/categories/${editId}`)
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        setName(data.category.name);
                        setDescription(data.category.description || '');
                    }
                })
                .finally(() => setFetching(false));
        }
    }, [editId]);

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            const url = editId ? `/api/categories/${editId}` : '/api/categories';
            const method = editId ? 'PUT' : 'POST';
            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description }),
            });
            const data = await res.json();
            if (data.success) {
                onSaved(data.message, 'success');
            } else {
                onSaved(data.message, 'error');
            }
        } catch {
            onSaved('An error occurred.', 'error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="category-modal open">
            <div className="category-modal-content">
                <h3>{editId ? 'Edit Category' : 'Add Category'}</h3>

                {fetching ? (
                    <div className="loading-spinner">
                        <div className="spinner"></div>
                        <p>Loading...</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <label>Category Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            autoFocus
                        />

                        <label>Description</label>
                        <textarea
                            rows={4}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />

                        <div className="modal-actions">
                            <button type="button" className="btn btn-neutral" onClick={onClose} disabled={loading}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Processing...' : editId ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

// ─── PAGINATION ───────────────────────────────────────
function Pagination({ pagination, onPage }) {
    if (!pagination || pagination.last_page <= 1) return null;

    const { current_page, last_page, has_more_pages, on_first_page } = pagination;

    const pages = [];
    const start = Math.max(current_page - 2, 1);
    const end   = Math.min(current_page + 2, last_page);

    for (let p = start; p <= end; p++) pages.push(p);

    return (
        <div className="custom-pagination">
            {on_first_page
                ? <span className="disabled">« First</span>
                : <span onClick={() => onPage(1)}>« First</span>}

            {on_first_page
                ? <span className="disabled">←</span>
                : <span onClick={() => onPage(current_page - 1)}>←</span>}

            {start > 1 && <span className="dots">...</span>}

            {pages.map(p => (
                <span
                    key={p}
                    className={p === current_page ? 'active' : ''}
                    onClick={() => p !== current_page && onPage(p)}
                    style={{ cursor: p !== current_page ? 'pointer' : 'default' }}
                >
                    {p}
                </span>
            ))}

            {end < last_page && <span className="dots">...</span>}

            {has_more_pages
                ? <span onClick={() => onPage(current_page + 1)}>→</span>
                : <span className="disabled">→</span>}

            {has_more_pages
                ? <span onClick={() => onPage(last_page)}>Last »</span>
                : <span className="disabled">Last »</span>}
        </div>
    );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function CategoriesPage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();
    const [categories, setCategories]   = useState([]);
    const [pagination, setPagination]   = useState(null);
    const [loading, setLoading]         = useState(true);
    const [search, setSearch]           = useState('');
    const [sortColumn, setSortColumn]   = useState('created_at');
    const [sortDir, setSortDir]         = useState('desc');
    const [currentPage, setCurrentPage] = useState(1);

    const [modalOpen, setModalOpen]       = useState(false);
    const [editId, setEditId]             = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [openDropdown, setOpenDropdown] = useState(null);

    const [toast, setToast] = useState(null);
    const searchTimeout = useRef(null);

    // ── Fetch ──────────────────────────────────────────
    const fetchCategories = useCallback(async (page, showSpinner = true) => {
        if (showSpinner) setLoading(true);
        try {
            const params = new URLSearchParams({
                page,
                sort_column: sortColumn,
                sort_direction: sortDir,
                ...(search ? { search } : {}),
            });
            const res  = await apiFetch(`/api/categories?${params}`);
            const data = await res.json();
            if (data.success) {
                setCategories(data.data);
                setPagination(data.pagination);
            }
        } catch {
            showToast('Failed to load categories', 'error');
        } finally {
            setLoading(false);
        }
    }, [sortColumn, sortDir, search]);

    useEffect(() => {
        fetchCategories(currentPage);
    }, [fetchCategories, currentPage]);

    // ── Search debounce ────────────────────────────────
    function handleSearch(e) {
        const val = e.target.value;
        setSearch(val);
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            setCurrentPage(1);
        }, 300);
    }

    // ── Sort ───────────────────────────────────────────
    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDir(dir);
        setCurrentPage(1);
    }

    // ── Toast ──────────────────────────────────────────
    function showToast(message, type = 'success') {
        setToast({ message, type, key: Date.now() });
    }

    // ── Toggle status ──────────────────────────────────
    async function toggleStatus(id, currentStatus) {
        try {
            const res  = await apiFetch(`/api/categories/${id}/toggle-status`, { method: 'PATCH' });
            const data = await res.json();
            if (data.success) {
                setCategories(prev =>
                    prev.map(c => c.id === id ? { ...c, status: data.status } : c)
                );
                showToast(data.message);
            } else {
                showToast(data.message, 'error');
            }
        } catch {
            showToast('Failed to update status', 'error');
        }
    }

    // ── Modal helpers ──────────────────────────────────
    function openAdd() {
        setEditId(null);
        setModalOpen(true);
    }

    function openEdit(id) {
        setEditId(id);
        setModalOpen(true);
        setOpenDropdown(null);
    }

    function closeModal() {
        setModalOpen(false);
        setEditId(null);
    }

    function onSaved(message, type = 'success') {
        showToast(message, type);
        if (type === 'success') {
            closeModal();
            fetchCategories(currentPage, false);
        }
    }

    function onDeleted(message, type = 'success') {
        showToast(message, type);
        setDeleteTarget(null);
        if (type === 'success') fetchCategories(currentPage, false);
    }

    // ── Sortable th ────────────────────────────────────
    function SortableTh({ col, label }) {
        return (
            <th className="sortable" data-column={col}>
                <div className="sortable-header">
                    <span>{label}</span>
                    <span className="sort-icons">
                        <span
                            className={`sort-up${sortColumn === col && sortDir === 'asc' ? ' active' : ''}`}
                            onClick={() => handleSort(col, 'asc')}
                            data-direction="asc"
                        >▲</span>
                        <span
                            className={`sort-down${sortColumn === col && sortDir === 'desc' ? ' active' : ''}`}
                            onClick={() => handleSort(col, 'desc')}
                            data-direction="desc"
                        >▼</span>
                    </span>
                </div>
            </th>
        );
    }

    useEffect(() => {
        function handler(e) {
            if (!e.target.closest('.action-dropdown')) {
                setOpenDropdown(null);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <>
            {/* Toast */}
            {toast && (
                <Toast
                    key={toast.key}
                    message={toast.message}
                    type={toast.type}
                    onDone={() => setToast(null)}
                />
            )}

            {/* Add/Edit Modal */}
            {modalOpen && (
                <CategoryModal editId={editId} onClose={closeModal} onSaved={onSaved} />
            )}

            {/* Delete Modal */}
            {deleteTarget && (
                <DeleteModal
                    category={deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onDeleted={onDeleted}
                />
            )}

            <div className="container">
                {/* Header */}
                <div className="container-child main-text">
                    <h1>Available Categories</h1>
                </div>
                <div className="container-child sub-text">
                    <p>See the categories</p>
                </div>

                <div className="sub-container">
                    {/* Top bar: Add button + Search */}
                    <div className="add-button">
                        <button onClick={openAdd}>
                            <span>Add</span>
                        </button>
                    </div>

                    <div className="report-search-container">
                        {/* Search */}
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="Search..."
                                value={search}
                                onChange={handleSearch}
                            />
                            <span className="icon1">
                                <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path opacity="1" d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path opacity="1" d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path opacity="1" d="M22 22L20 20" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </span>
                        </div>
                    </div>

                    {/* Table */}
                    <table id="categoryTable">
                        <thead>
                            <tr>
                                <th>#</th>
                                <SortableTh col="name" label="Category Name" />
                                <th>Description</th>
                                <SortableTh col="status" label="Status" />
                                <th>Change Status</th>
                                <SortableTh col="purchases_count" label="Total Products" />
                                <SortableTh col="created_at" label="Date" />
                                <th>See Detail</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={9}>
                                        <div className="loading-spinner">
                                            <div className="spinner"></div>
                                            <p>Loading categories...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : categories.length === 0 ? (
                                <tr>
                                    <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: '#666' }}>
                                        No categories found.
                                    </td>
                                </tr>
                            ) : (
                                categories.map((cat, index) => {
                                    const rowNumber = pagination ? pagination.first_item + index : index + 1;
                                    const createdDate = new Date(cat.created_at).toLocaleDateString('en-GB', {
                                        day: 'numeric', month: 'short', year: 'numeric'
                                    });
                                    const isProtected = cat.name === 'Misc' || cat.name === 'Services';

                                    return (
                                        <tr key={cat.id}>
                                            <td>{rowNumber}</td>
                                            <td>{cat.name}</td>
                                            <td>{cat.description || 'N/A'}</td>
                                            <td>
                                                <span style={{ color: cat.status ? 'green' : 'red' }}>
                                                    {cat.status ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td>
                                                <label className={styles.switch}>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!cat.status}
                                                        disabled={isProtected}
                                                        onChange={() => !isProtected && toggleStatus(cat.id, cat.status)}
                                                        style={isProtected ? { cursor: 'not-allowed' } : {}}
                                                    />
                                                    <span
                                                        className={`${styles.slider} round`}
                                                        style={isProtected ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                                                    ></span>
                                                </label>
                                            </td>
                                            <td>{cat.purchases_count}</td>
                                            <td>{createdDate}</td>
                                            <td>
                                            <button type="button"
                                                onClick={() => router.push(`/categories/${cat.id}`)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                                <i className="fa fa-eye" style={{ fontSize: 18, color: '#5c6670' }} />
                                            </button>
                                        </td>
                                            <td>
    <div className="action-dropdown">
        <button
            className="dropdown-toggle"
            onClick={() =>
                setOpenDropdown(openDropdown === cat.id ? null : cat.id)
            }
        >
            ⋮
        </button>
        {openDropdown === cat.id && (
            <div className="action-dropdown-menu open">
                {!isBlocked('categories.list.act.edit') && (
                <a
                    href="#"
                    onClick={e => { e.preventDefault(); openEdit(cat.id); }}
                >
                    Edit
                </a>
                )}
                {!isProtected && !isBlocked('categories.list.act.delete') && (
                    <button
                        id="delete-button"
                        onClick={() => {
                            setDeleteTarget(cat);
                            setOpenDropdown(null);
                        }}
                    >
                        Delete
                    </button>
                )}
            </div>
        )}
    </div>
</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                    {/* Pagination */}
                    <Pagination pagination={pagination} onPage={p => setCurrentPage(p)} />
                </div>
            </div>
        </>
    );
}