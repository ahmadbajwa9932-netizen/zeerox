'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './stock-overview.module.css';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";

export default function StockOverviewPage() {

    const [availableStock, setAvailableStock]   = useState({ data: [], pagination: null });
    const [searchResults, setSearchResults]     = useState(null);
    const [outOfStock, setOutOfStock]           = useState({ data: [], pagination: null });

    const [pages, setPages] = useState({ available: 1, search: 1, outOfStock: 1 });

    const [searchQuantity, setSearchQuantity]   = useState('');
    const [searchAvailable, setSearchAvailable] = useState('');
    const [searchOutOfStock, setSearchOutOfStock] = useState('');

    const [priceVisible, setPriceVisible] = useState({
        available: false,
        search: false,
        outOfStock: false,
    });

    const searchTimeout = useRef(null);

    const loadData = useCallback(async (currentPages = pages) => {
        try {
            let url = `/api/purchases/stock-overview?page_available=${currentPages.available}&page_search=${currentPages.search}&page_out_of_stock=${currentPages.outOfStock}`;
            if (searchQuantity !== '')  url += `&search_quantity=${searchQuantity}`;
            if (searchAvailable)        url += `&search_available=${encodeURIComponent(searchAvailable)}`;
            if (searchOutOfStock)       url += `&search_out_of_stock=${encodeURIComponent(searchOutOfStock)}`;

            const res  = await apiFetch(url);
            const data = await res.json();
            if (data.success) {
                setAvailableStock(data.available_stock);
                setSearchResults(data.search_results);
                setOutOfStock(data.out_of_stock);
            }
        } catch (err) {
            console.error('Stock overview error:', err);
        }
    }, [pages, searchQuantity, searchAvailable, searchOutOfStock]);

    // Initial load
    useEffect(() => { loadData(); }, []);

    // Debounced reload on search changes
    useEffect(() => {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            const resetPages = { available: 1, search: 1, outOfStock: 1 };
            setPages(resetPages);
            loadData(resetPages);
        }, 500);
        return () => clearTimeout(searchTimeout.current);
    }, [searchQuantity, searchAvailable, searchOutOfStock]);

    function changePage(type, pg) {
        const newPages = { ...pages, [type]: pg };
        setPages(newPages);
        loadData(newPages);
    }

    function togglePrice(type) {
        setPriceVisible(prev => ({ ...prev, [type]: !prev[type] }));
    }

    // ── Eye icon SVG ───────────────────────────────────
    function EyeIcon({ visible }) {
        return (
            <svg width="20" height="20" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ cursor: 'pointer', marginLeft: 6, verticalAlign: 'middle' }}>
                {visible ? (
                    <>
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                    </>
                ) : (
                    <>
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                        <path d="M3 3l18 18" />
                    </>
                )}
            </svg>
        );
    }

    // ── Column pagination ──────────────────────────────
    function ColPagination({ pagination, type }) {
        if (!pagination || pagination.last_page <= 1) return null;
        const { current_page, last_page } = pagination;
        const start = Math.max(current_page - 1, 1);
        const end   = Math.min(start + 3, last_page);

        return (
<div className={styles['column-pagination']}>
<div className="custom-pagination">
                    {current_page > 1 && (
                        <button type="button" onClick={() => changePage(type, 1)}>First</button>
                    )}
                    {current_page > 1 && (
                        <button type="button" onClick={() => changePage(type, current_page - 1)}>‹</button>
                    )}
                    {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                        p === current_page
                        ? <span key={p} className={styles.active}>{p}</span>
                            : <button key={p} type="button" onClick={() => changePage(type, p)}>{p}</button>
                    ))}
                    {current_page < last_page && (
                        <button type="button" onClick={() => changePage(type, current_page + 1)}>›</button>
                    )}
                    {current_page < last_page && (
                        <button type="button" onClick={() => changePage(type, last_page)}>Last</button>
                    )}
                </div>
            </div>
        );
    }

    // ── Table rows ─────────────────────────────────────
    function renderRows(data, rowClass, priceKey, pagination) {
        if (!data || data.length === 0) return (
<tr><td colSpan={4} className={styles['empty-state']}>
                {rowClass === 'search-row' ? 'No products found' :
                 rowClass === 'out-of-stock-row' ? 'No out-of-stock products' : 'No products available'}
            </td></tr>
        );
        const startIndex = pagination ? (pagination.current_page - 1) * pagination.per_page : 0;
        return data.map((item, index) => (
<tr key={item.id} className={styles[rowClass]}>
                <td>{startIndex + index + 1}</td>
                <td>{item.product_name}</td>
                <td>{item.available_stock}</td>
                <td className={priceVisible[priceKey] ? '' : styles['price-hidden']}>
                    {priceVisible[priceKey] ? formatPrice(item.purchased_price) : '****'}
                </td>
            </tr>
        ));
    }

    return (
        <div className="container">
            <div className="container-child main-text">
                <h1>Stock Overview</h1>
            </div>
            <div className="container-child sub-text">
                <p>Monitor all product inventory levels across your store</p>
            </div>

            <div className={`sub-container ${styles['three-column-layout']}`}>

                {/* ── 1. Available Stock ─────────────── */}
                <div className="column-wrapper">
                <div className={`${styles['column-header']} ${styles.available}`}>Available Stock</div>
                    <div className={styles['search-input-wrapper']}>
                        <input type="text" placeholder="Search by product name..."
                            value={searchAvailable}
                            onChange={e => setSearchAvailable(e.target.value)} />
                    </div>
                    <div className="loading-overlay">
                        <table className={styles['column-table']}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Product Name</th>
                                    <th>Stock</th>
                                    <th>
                                        Price
                                        <span onClick={() => togglePrice('available')}>
                                            <EyeIcon visible={priceVisible.available} />
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                            {renderRows(availableStock.data, 'available-row', 'available', availableStock.pagination)}
                            </tbody>
                        </table>
                    </div>
                    <ColPagination pagination={availableStock.pagination} type="available" />
                </div>

                {/* ── 2. Search by Quantity ──────────── */}
                <div className="column-wrapper">
                    <div className={`${styles['column-header']} ${styles.search}`}>Search by Quantity</div>
                    <div className={styles['search-input-wrapper']}>
                        <input type="number" placeholder="Enter max quantity (e.g., 5)" min="0"
                            value={searchQuantity}
                            onChange={e => setSearchQuantity(e.target.value)} />
                    </div>
                    <div className="loading-overlay">
                        <table className={styles['column-table']}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Product Name</th>
                                    <th>Stock</th>
                                    <th>
                                        Price
                                        <span onClick={() => togglePrice('search')}>
                                            <EyeIcon visible={priceVisible.search} />
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {searchResults === null ? (
                                    <tr><td colSpan={4} className={styles['empty-state']}>
                                        Enter a quantity above to search
                                    </td></tr>
                                ) : renderRows(searchResults.data, 'search-row', 'search', searchResults.pagination)}
                            </tbody>
                        </table>
                    </div>
                    {searchResults && (
                        <ColPagination pagination={searchResults.pagination} type="search" />
                    )}
                </div>

                {/* ── 3. Out of Stock ────────────────── */}
                <div className="column-wrapper">
                <div className={`${styles['column-header']} ${styles['out-of-stock']}`}>Out of Stock</div>
                    <div className={styles['search-input-wrapper']}>
                        <input type="text" placeholder="Search by product name..."
                            value={searchOutOfStock}
                            onChange={e => setSearchOutOfStock(e.target.value)} />
                    </div>
                    <div className="loading-overlay">
                        <table className={styles['column-table']}>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Product Name</th>
                                    <th>Stock</th>
                                    <th>
                                        Price
                                        <span onClick={() => togglePrice('outOfStock')}>
                                            <EyeIcon visible={priceVisible.outOfStock} />
                                        </span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                            {renderRows(outOfStock.data, 'out-of-stock-row', 'outOfStock', outOfStock.pagination)}
                            </tbody>
                        </table>
                    </div>
                    <ColPagination pagination={outOfStock.pagination} type="outOfStock" />
                </div>

            </div>
        </div>
    );
}