'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";

// ─── HELPERS ─────────────────────────────────────────────────────────────────


function formatQuantity(num) {
    return parseFloat(num).toFixed(0).replace(/\d(?=(\d{3})+$)/g, '$&,');
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
// Mirrors renderPagination() in category_products.js exactly

function Pagination({ pagination, search, onPage }) {
    if (!pagination) return null;

    const { current_page, last_page, has_more_pages, on_first_page, total } = pagination;

    return (
        <div className="custom-pagination" id="paginationContainer">
            {/* Search result count - mirrors JS renderPagination search info */}
            {search && total > 0 && (
                <div style={{ marginBottom: '10px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                    Found <strong>{total}</strong> result{total !== 1 ? 's' : ''} for &quot;{search}&quot;
                </div>
            )}

            {last_page <= 1 ? null : (() => {
                const start = Math.max(current_page - 2, 1);
                const end   = Math.min(current_page + 2, last_page);
                const pages = [];
                for (let p = start; p <= end; p++) pages.push(p);

                return (
                    <>
                        {on_first_page
                            ? <span className="disabled">« First</span>
                            : <span onClick={() => onPage(1)} style={{ cursor: 'pointer' }}>« First</span>}

                        {on_first_page
                            ? <span className="disabled">←</span>
                            : <span onClick={() => onPage(current_page - 1)} style={{ cursor: 'pointer' }}>←</span>}

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
                            ? <span onClick={() => onPage(current_page + 1)} style={{ cursor: 'pointer' }}>→</span>
                            : <span className="disabled">→</span>}

                        {has_more_pages
                            ? <span onClick={() => onPage(last_page)} style={{ cursor: 'pointer' }}>Last »</span>
                            : <span className="disabled">Last »</span>}
                    </>
                );
            })()}
        </div>
    );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function CategoryProductsPage() {
    const { id }   = useParams();
    const router   = useRouter();

    const [category, setCategory]     = useState(null);
    const [purchases, setPurchases]   = useState([]);
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading]       = useState(true);

    // Mirrors JS globals: sortColumn, sortDirection, currentPage
    const [sortColumn, setSortColumn] = useState('purchase_date');
    const [sortDir, setSortDir]       = useState('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [search, setSearch]         = useState('');

    const searchTimeout = useRef(null);

    // ── loadPurchases - mirrors JS loadPurchases(page) exactly ────────────────
    const loadPurchases = useCallback(async (page) => {
        setLoading(true);

        const params = new URLSearchParams({
            page,
            sort_column:    sortColumn,
            sort_direction: sortDir,
        });
        if (search.trim()) {
            params.set('search', search.trim());
        }

        try {
            const res = await apiFetch(`/api/categories/${id}/products?${params}`);
            const data = await res.json();

            if (data.success) {
                setCategory(data.category);
                setPurchases(data.data);
                setPagination(data.pagination);
            } else {
                showError();
            }
        } catch (err) {
            console.error('Error:', err);
            showError();
        } finally {
            setLoading(false);
        }
    }, [id, sortColumn, sortDir, search]);

    // Initial load + reload on deps change — mirrors DOMContentLoaded + sort/search triggers
    useEffect(() => {
        loadPurchases(currentPage);
    }, [loadPurchases, currentPage]);

    // ── F2 focus shortcut - mirrors keydown listener in category_products.js ──
    useEffect(() => {
        function handleKeydown(e) {
            if (e.key === 'F2') {
                e.preventDefault();
                document.getElementById('singleInputSearch')?.focus();
            }
        }
        document.addEventListener('keydown', handleKeydown);
        return () => document.removeEventListener('keydown', handleKeydown);
    }, []);

    // ── Search input handler - mirrors searchInput 'input' event listener ─────
    function handleSearch(e) {
        const val = e.target.value;
        setSearch(val);

        // Show "Searching..." in tbody immediately (mirrors JS behavior)
        if (val) setLoading(true);

        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            setCurrentPage(1); // triggers loadPurchases via useEffect
        }, 100); // mirrors the 100ms debounce in JS
    }

    // ── Sort handler - mirrors click listener on .sort-icons span ─────────────
    function handleSort(col, dir) {
        setSortColumn(col);
        setSortDir(dir);
        setCurrentPage(1);
    }

    function showError() {
        setPurchases([]);
    }

    // ── SortableTh - mirrors the sortable <th> markup in blade template ───────
    function SortableTh({ col, label }) {
        return (
            <th className="sortable" data-column={col}>
                <div className="sortable-header">
                    <span>{label}</span>
                    <span className="sort-icons">
                        <span
                            className={`sort-up${sortColumn === col && sortDir === 'asc' ? ' active' : ''}`}
                            data-direction="asc"
                            onClick={() => handleSort(col, 'asc')}
                        >▲</span>
                        <span
                            className={`sort-down${sortColumn === col && sortDir === 'desc' ? ' active' : ''}`}
                            data-direction="desc"
                            onClick={() => handleSort(col, 'desc')}
                        >▼</span>
                    </span>
                </div>
            </th>
        );
    }

    // ── renderTable logic - mirrors renderTable() in category_products.js ──────
    function renderRows() {
        if (loading) {
            return (
                <tr>
                    <td colSpan={9}>
                        <div className="loading-spinner">
                            <div className="spinner"></div>
                            <p>{search ? 'Searching...' : 'Loading purchases...'}</p>
                        </div>
                    </td>
                </tr>
            );
        }

        if (purchases.length === 0) {
            return <tr><td colSpan={9}>No Record found.</td></tr>;
        }

        return purchases.map((purchase, index) => {
            const rowNumber = pagination ? pagination.first_item + index : index + 1;

            const purchaseDate = new Date(purchase.purchase_date).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric'
            });

            const isService          = purchase.type === 'service';
            const availableStock     = purchase.quantity - purchase.sold_quantity;
            const availableStockValue = availableStock * purchase.purchased_price;
            const totalValue         = purchase.purchased_price * purchase.quantity;

            return (
                <tr key={purchase.id}>
                    <td style={{ padding: '12px 0' }}>{rowNumber}</td>
                    <td>
                        {purchase.product_name}
                        {isService && (
                            <span style={{ color: '#666', fontSize: '12px' }}> (Service)</span>
                        )}
                    </td>
                    <td>{purchase.unit}</td>
                    <td>{isService ? '-' : formatPrice(purchase.purchased_price)}</td>
                    <td>{isService ? '-' : formatQuantity(purchase.quantity)}</td>
                    <td>{isService ? '-' : formatPrice(totalValue)}</td>
                    <td>{isService ? '-' : availableStock}</td>
                    <td>{isService ? '-' : formatPrice(availableStockValue)}</td>
                    <td>{purchaseDate}</td>
                </tr>
            );
        });
    }

    return (
        <>
            <div className="container">
                {/* Header - mirrors blade @section content header */}
                <div className="container-child main-text">
                    <h1>Categories</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Products under {category?.name ?? '...'}</p>
                    {/* Back button - mirrors blade back button */}
                    <button
                        id="back-buttons"
                        className="boton-elegante"
                        onClick={() => router.back()}
                    >
                        ← Back
                    </button>
                </div>

                <div className="sub-container">
                    {/* Report format + search bar - mirrors blade report-search-container */}
                    <div className="report-search-container">
                        {/* Search - mirrors blade search-container + JS input listener */}
                        <div className="search-container">
                            <input
                                type="text"
                                id="singleInputSearch"
                                name="text"
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

                    {/* Table - mirrors blade #singleSearchTable */}
                    <table id="singleSearchTable">
                        <thead>
                            <tr>
                                <th>No.</th>
                                <SortableTh col="product_name"      label="Product Name" />
                                <SortableTh col="unit"              label="Unit" />
                                <SortableTh col="purchased_price"   label="Purchased Price" />
                                <SortableTh col="total_stock"       label="Total Stock" />
                                <SortableTh col="total"             label="Total" />
                                <SortableTh col="available_stock"   label="Available Stock" />
                                <SortableTh col="available_stock_rs" label="Available Stock Value" />
                                <SortableTh col="purchase_date"     label="Date" />
                            </tr>
                        </thead>
                        <tbody id="purchasesTableBody">
                            {renderRows()}
                        </tbody>
                    </table>

                    {/* Pagination - mirrors renderPagination() */}
                    <Pagination
                        pagination={pagination}
                        search={search}
                        onPage={(p) => setCurrentPage(p)}
                    />
                </div>
            </div>
        </>
    );
}