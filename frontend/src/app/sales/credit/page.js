'use client';

import React ,{ useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { formatPrice } from "@/lib/currency-context";
import './credit-sale.css';

export default function CreditSalesPage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();
    const [sales, setSales] = useState([]);
    const [saleItems, setSaleItems] = useState({});
    const [pagination, setPagination] = useState({});
    const [loading, setLoading] = useState(true);
    const [openRows, setOpenRows] = useState({});
    const [openDropdown, setOpenDropdown] = useState(null);

    const [sortColumn, setSortColumn] = useState('sales.sale_date');
    const [sortDirection, setSortDirection] = useState('desc');

    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState('voucher');
    const [currentPage, setCurrentPage] = useState(1);

    const [paymentModal, setPaymentModal] = useState({ open: false, saleId: null, max: 0 });
    const [editDueDateModal, setEditDueDateModal] = useState({ open: false, saleId: null, customerName: '', currentDueDate: '', newDueDate: '' });
    const [reduceQtyModal, setReduceQtyModal] = useState({ open: false, saleId: null, itemId: null, productName: '', currentQty: 0, newQty: '' });

    const searchTimeout = useRef(null);

    function loadCreditSalesWithSearch(page, query, type) {
        setLoading(true);
        let url = `/api/sales/credit/data?page=${page}&sort_column=${sortColumn}&sort_direction=${sortDirection}`;
        if (query) {
            url += `&search=${encodeURIComponent(query)}&search_type=${type}`;
        }
    
        apiFetch(url, { headers: { 'Accept': 'application/json' } })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setSales(data.data);
                    setSaleItems(data.saleItems);
                    setPagination(data.pagination);
                    setCurrentPage(page);
                } else {
                    setSales([]);
                }
            })
            .catch(() => setSales([]))
            .finally(() => setLoading(false));
    }
    
    function loadCreditSales(page) {
        loadCreditSalesWithSearch(page, searchQuery, searchType);
    }

    useEffect(() => {
        loadCreditSales(1);
    }, [sortColumn, sortDirection]);

    useEffect(() => {
        function handleKeyDown(e) {
            // F2 → focus search
            if (e.key === 'F2') {
                e.preventDefault();
                document.querySelector('#creditSearchbar-dropdown input.input')?.focus();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        function handleOutsideClick(e) {
            if (!e.target.closest('.credit-dropdown')) {
                setOpenDropdown(null);
            }
        }
        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
    }, []);

    function handleSort(column, direction) {
        setSortColumn(column);
        setSortDirection(direction);
    }

    function handleSearchChange(value) {
        setSearchQuery(value);
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            loadCreditSalesWithSearch(1, value, searchType);
        }, 300);
    }

    function handleSearchTypeChange(value) {
        setSearchType(value);
        if (searchQuery) loadCreditSalesWithSearch(1, searchQuery, value);
    }

    function toggleDetails(saleId) {
        setOpenRows(prev => ({ ...prev, [saleId]: !prev[saleId] }));
    }

    function toggleDropdown(saleId) {
        setOpenDropdown(prev => (prev === saleId ? null : saleId));
    }


    function formatDate(dateString) {
        if (!dateString || dateString === 'null' || dateString === 'undefined') return 'Not Set';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Not Set';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
    }

    function openPaymentModal(saleId, balance) {
        setPaymentModal({ open: true, saleId, max: balance });
    }

    function closePaymentModal() {
        setPaymentModal({ open: false, saleId: null, max: 0 });
    }

    function openEditDueDateModal(saleId, customerName, currentDueDate) {
        setEditDueDateModal({
            open: true,
            saleId,
            customerName,
            currentDueDate: formatDate(currentDueDate),
            newDueDate: ''
        });
    }

    function closeEditDueDateModal() {
        setEditDueDateModal({ open: false, saleId: null, customerName: '', currentDueDate: '', newDueDate: '' });
    }

    function handleMarkAsPaid(saleId) {
        if (!confirm('This will mark the sale as paid. Are you sure?')) return;
        apiFetch(`/api/sales/${saleId}/mark-paid`, {
            method: 'POST',
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCreditSales(currentPage);
                else alert(data.message || 'Failed to mark as paid');
            })
            .catch(() => alert('An error occurred'));
    }
    
    function handleReturnSale(saleId, voucherNo) {
        if (!confirm(`Return voucher ${voucherNo}?\n\nThis will:\n- Delete the entire sale\n- Restore inventory quantities\n- Remove all payment records\n\nThis cannot be undone.`)) return;
        apiFetch(`/api/sales/credit/${saleId}/return`, {
            method: 'DELETE',
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCreditSales(currentPage);
                else alert(data.message || 'Failed to return sale');
            })
            .catch(() => alert('An error occurred'));
    }
    
    function handleDeleteItem(saleId, itemId, productName) {
        if (!confirm(`Delete "${productName}" from this sale?\n\nThis will restore inventory and recalculate totals.`)) return;
        apiFetch(`/api/sales/credit/${saleId}/item/${itemId}/delete`, {
            method: 'DELETE',
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) loadCreditSales(currentPage);
                else alert(data.message || 'Failed to delete item');
            })
            .catch(() => alert('An error occurred'));
    }
    
    function handleReduceQty(saleId, itemId, productName, currentQty) {
        setReduceQtyModal({ open: true, saleId, itemId, productName, currentQty, newQty: '' });
    }
    
    function closeReduceQtyModal() {
        setReduceQtyModal({ open: false, saleId: null, itemId: null, productName: '', currentQty: 0, newQty: '' });
    }
    
    function handleReduceQtySubmit(e) {
        e.preventDefault();
        const deductQty = parseInt(reduceQtyModal.newQty);
if (isNaN(deductQty) || deductQty <= 0 || deductQty >= reduceQtyModal.currentQty) {
    alert('Please enter a valid quantity to deduct (must be less than current quantity)');
    return;
}
const newQty = reduceQtyModal.currentQty - deductQty;
apiFetch(`/api/sales/credit/${reduceQtyModal.saleId}/item/${reduceQtyModal.itemId}/reduce`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_quantity: newQty })
})
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    closeReduceQtyModal();
                    loadCreditSales(currentPage);
                } else {
                    alert(data.message || 'Failed to reduce quantity');
                }
            })
            .catch(() => alert('An error occurred'));
    }
    
    function handleDownloadPdf(voucherNo) {
        window.location.href = `http://localhost:4000/api/sales/credit/${voucherNo}/pdf`;
    }
    
    function handleShareWhatsApp(voucherNo, customerName) {
        const link = document.createElement('a');
        link.href = `http://localhost:4000/api/sales/credit/${voucherNo}/pdf`;
        link.download = `credit-sale-${voucherNo}.pdf`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    
        const message = `Credit Sale Invoice - ${voucherNo}\nCustomer: ${customerName}\n\nPlease see the attached PDF for complete details!`;
        setTimeout(() => {
            window.location.href = `whatsapp://send?text=${encodeURIComponent(message)}`;
            setTimeout(() => {
                if (confirm('WhatsApp app not detected. Open WhatsApp Web instead?')) {
                    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
                }
            }, 1500);
        }, 1000);
    }

    function handleAddPayment(e) {
        e.preventDefault();
        const form = e.target;
        const amount = form.querySelector('input[type="number"]').value;
        const method = form.querySelector('select').value;
    
        if (!amount || parseFloat(amount) < 1) {
            alert('Please enter a valid amount.');
            return;
        }
    
        apiFetch('/api/sales/add-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sale_id: paymentModal.saleId, amount: parseFloat(amount), payment_method: method })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    closePaymentModal();
                    loadCreditSales(currentPage);
                } else {
                    alert(data.message || 'Failed to add payment');
                }
            })
            .catch(() => alert('An error occurred'));
    }

    function handleUpdateDueDate(e) {
        e.preventDefault();
        if (!editDueDateModal.newDueDate) {
            alert('Please select a due date.');
            return;
        }
    
        apiFetch(`/api/sales/${editDueDateModal.saleId}/due-date`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_due_date: editDueDateModal.newDueDate })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    closeEditDueDateModal();
                    loadCreditSales(currentPage);
                } else {
                    alert(data.message || 'Failed to update due date');
                }
            })
            .catch(() => alert('An error occurred'));
    }

    function renderSortIcons(column) {
        return (
            <span className="sort-icons">
                <span
                    className={`sort-up ${sortColumn === column && sortDirection === 'asc' ? 'active' : ''}`}
                    onClick={() => handleSort(column, 'asc')}
                >▲</span>
                <span
                    className={`sort-down ${sortColumn === column && sortDirection === 'desc' ? 'active' : ''}`}
                    onClick={() => handleSort(column, 'desc')}
                >▼</span>
            </span>
        );
    }

    function renderPaginationLinks() {
        if (!pagination.last_page || pagination.last_page <= 1) return null;

        const start = Math.max(pagination.current_page - 2, 1);
        const end = Math.min(pagination.current_page + 2, pagination.last_page);
        const pages = [];
        for (let p = start; p <= end; p++) pages.push(p);

        return (
            <div className="custom-pagination">
                {searchQuery && pagination.total > 0 && (
                    <div style={{ width: '100%', marginBottom: '10px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                        Found <strong>{pagination.total}</strong> result{pagination.total !== 1 ? 's' : ''} for "{searchQuery}"
                    </div>
                )}

                {pagination.on_first_page ? (
                    <>
                        <span className="disabled">« First</span>
                        <span className="disabled">←</span>
                    </>
                ) : (
                    <>
                        <a onClick={() => loadCreditSales(1)}>« First</a>
                        <a onClick={() => loadCreditSales(pagination.current_page - 1)}>←</a>
                    </>
                )}

                {start > 1 && <span className="dots">...</span>}

                {pages.map(p => (
                    p === pagination.current_page
                        ? <span key={p} className="active">{p}</span>
                        : <a key={p} onClick={() => loadCreditSales(p)}>{p}</a>
                ))}

                {end < pagination.last_page && <span className="dots">...</span>}

                {pagination.has_more_pages ? (
                    <>
                        <a onClick={() => loadCreditSales(pagination.current_page + 1)}>→</a>
                        <a onClick={() => loadCreditSales(pagination.last_page)}>Last »</a>
                    </>
                ) : (
                    <>
                        <span className="disabled">→</span>
                        <span className="disabled">Last »</span>
                    </>
                )}
            </div>
        );
    }

    function renderSaleItemsTable(saleId) {
        const items = saleItems[saleId] || [];
        if (items.length === 0) return <p style={{ padding: '10px' }}>No items found</p>;

        return (
            <table className="table table-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Price (per unit)</th>
                        <th>Quantity</th>
                        <th>Discount</th>
                        <th>Tax</th>
                        <th>Total</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => {
                        const quantityDisplay = item.type === 'service'
                            ? <span style={{ color: '#666' }}>-</span>
                            : <>{item.remaining_quantity} {item.returned_quantity > 0 && <small style={{ color: '#888' }}>({item.returned_quantity} returned)</small>}</>;

                        let discountDisplay = '-';
                        if (item.adjusted_discount_amount > 0) {
                            discountDisplay = item.discount_type === 'percentage'
                                ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.adjusted_discount_amount)})`
                                : `${formatPrice(item.adjusted_discount_amount)}`;
                        }

                        let taxDisplay = '-';
                        if (item.adjusted_tax_amount > 0) {
                            taxDisplay = item.tax_type === 'percentage'
                                ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.adjusted_tax_amount)})`
                                : `${formatPrice(item.adjusted_tax_amount)}`;
                        }

                        return (
                            <tr key={item.id}>
                                <td>{item.product_name}{item.type === 'service' && <span style={{ color: '#666', fontSize: '11px' }}> (Service)</span>}</td>
                                <td>{formatPrice(item.price)}</td>
                                <td>{quantityDisplay}</td>
                                <td>{discountDisplay}</td>
                                <td>{taxDisplay}</td>
                                <td>{formatPrice(item.total_after_tax)}</td>
                                <td>
                                {item.type === 'product' && !isBlocked('sales.credit.act.reduce-qty') && (
    <button className="btn btn-warning btn-sm" onClick={() => handleReduceQty(saleId, item.id, item.product_name, item.remaining_quantity)}>Reduce Qty</button>
)}
{!isBlocked('sales.credit.act.delete-item') && (
    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteItem(saleId, item.id, item.product_name)}>Delete Item</button>
)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    }

    return (
        <div className="container">
            <div className="container-child main-text"><h1>Credit Sales</h1></div>
            <div className="container-child sub-text"><p>List of unpaid credit sales</p></div>

            <div className="sub-container">
                <div className="report-search-container">
                    <div id="creditSearchbar-dropdown">
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px' }}>
                            <p style={{ position: 'relative', top: '9px' }}>Search by:</p>
                            <select
                                id="creditSearchType"
                                className="input"
                                style={{ width: '140px' }}
                                value={searchType}
                                onChange={e => handleSearchTypeChange(e.target.value)}
                            >
                                <option value="voucher">Invoice No</option>
                                <option value="customer">Customer</option>
                                <option value="contact">Contact</option>
                            </select>
                        </div>
                        <div className="search-container">
                            <input
                                type="text"
                                className="input"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={e => handleSearchChange(e.target.value)}
                            />
                            <span className="icon1">
                                <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path opacity="1" d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                                    <path opacity="1" d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" />
                                    <path opacity="1" d="M22 22L20 20" stroke="#000" strokeWidth="3.5" />
                                </svg>
                            </span>
                        </div>
                    </div>
                </div>

                <table id="creditSalesTable">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Invoice No</span>
                                    {renderSortIcons('sales.voucher_no')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Customer</span>
                                    {renderSortIcons('customers.name')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Business/Shop Name</span>
                                    {renderSortIcons('customers.shop_name')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Contact</span>
                                    {renderSortIcons('customers.contact')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Total Amount</span>
                                    {renderSortIcons('grand_total')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Status</span>
                                    {renderSortIcons('status')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Paid Amount</span>
                                    {renderSortIcons('received_amount')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Remaining Balance</span>
                                    {renderSortIcons('remaining_balance')}
                                </div>
                            </th>
                            <th className="sortable">
                                <div className="sortable-header">
                                    <span>Due Date</span>
                                    {renderSortIcons('due_date')}
                                </div>
                            </th>
                            <th>Details</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="creditSalesTableBody">
                        {loading ? (
                            <tr>
                                <td colSpan="12">
                                    <div className="loading-spinner">
                                        <div className="spinner"></div>
                                        <p>Loading credit sales...</p>
                                    </div>
                                </td>
                            </tr>
                        ) : sales.length === 0 ? (
                            <tr><td colSpan="12">No credit sales found.</td></tr>
                        ) : (
                            sales.map((sale, index) => {
                                const rowNumber = (pagination.first_item || 1) + index;
                                const paidAmount = parseFloat(sale.grand_total) - parseFloat(sale.remaining_balance);
                                const isOpen = !!openRows[sale.id];

                                return (
    <React.Fragment key={sale.id}>
        <tr>
                                            <td>{rowNumber}</td>
                                            <td>
                                                <button
                                                    className="toggle-details"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                                    onClick={() => toggleDetails(sale.id)}
                                                >
                                                    {isOpen ? '\u25B2' : '\u25BC'}
                                                </button>
                                                {sale.voucher_no}
                                            </td>
                                            <td>{sale.customer ? sale.customer.name : 'N/A'}</td>
                                            <td>{sale.customer?.shop_name || 'N/A'}</td>
                                            <td>{sale.customer?.contact || 'N/A'}</td>
                                            <td>{formatPrice(sale.grand_total)}</td>
                                            <td><span className="badge badge-warning">{sale.status.charAt(0).toUpperCase() + sale.status.slice(1)}</span></td>
                                            <td>{formatPrice(paidAmount)}</td>
                                            <td>{formatPrice(sale.remaining_balance)}</td>
                                            <td>{sale.due_date ? formatDate(sale.due_date) : '-'}</td>
                                            <td>
                                                <button type="button"
                                                onClick={() => router.push(`/sales/credit/details/${sale.voucher_no}`)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                                <i className="fa fa-eye" style={{ fontSize: 18, color: '#5c6670' }} />
                                            </button>
                                            </td>
                                            <td>
                                                <div className="credit-dropdown">
                                                    <button className="dropdown-toggle" onClick={() => toggleDropdown(sale.id)}>⋮</button>
                                                    <div className="credit-dropdown-menu" style={{ display: openDropdown === sale.id ? 'block' : 'none' }}>
                                                    {!isBlocked('sales.credit.act.mark-paid') && (
    <button className="credit-action-btn" onClick={() => { handleMarkAsPaid(sale.id); toggleDropdown(null); }}>Mark as Paid</button>
)}
{!isBlocked('sales.credit.act.add-payment') && (
    <button
        className="credit-action-btn"
        onClick={() => { openPaymentModal(sale.id, sale.remaining_balance); toggleDropdown(null); }}
    >
        Add Payment
    </button>
)}
{!isBlocked('sales.credit.act.return-sale') && (
    <button className="credit-action-btn" onClick={() => { handleReturnSale(sale.id, sale.voucher_no); toggleDropdown(null); }}>Return Sale</button>
)}
{!isBlocked('sales.credit.act.edit-due-date') && (
    <button
        className="credit-action-btn"
        onClick={() => { openEditDueDateModal(sale.id, sale.customer?.name, sale.due_date); toggleDropdown(null); }}
    >
        Edit Due Date
    </button>
)}
{!isBlocked('sales.credit.act.download-pdf') && (
    <button className="credit-action-btn" onClick={() => handleDownloadPdf(sale.voucher_no)}>Download PDF</button>
)}
{!isBlocked('sales.credit.act.share-whatsapp') && (
    <button className="credit-action-btn btn-whatsapp" onClick={() => handleShareWhatsApp(sale.voucher_no, sale.customer?.name)}>Share on WhatsApp</button>
)}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                        <tr style={{ display: isOpen ? 'table-row' : 'none', background: '#f9f9f9' }}>
                                            <td colSpan="12">
                                                {isOpen && renderSaleItemsTable(sale.id)}
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>

                <div id="creditPaginationContainer">
                    {renderPaginationLinks()}
                </div>
            </div>

            {/* Payment Modal */}
            {paymentModal.open && (
                <>
                    <div id="modalBackdrop" style={{ display: 'block' }} onClick={closePaymentModal}></div>
                    <div id="paymentModal" style={{ display: 'block' }}>
                        <form onSubmit={handleAddPayment}>
                            <input type="hidden" value={paymentModal.saleId || ''} readOnly />
                            <label>Amount</label>
                            <input type="number" max={paymentModal.max} required />
                            <label>Payment Method</label>
                            <select required>
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                            </select>
                            <button type="submit">Submit</button>
                            <button type="button" className="close-btn" onClick={closePaymentModal}>Close</button>
                        </form>
                    </div>
                </>
            )}

            {/* Edit Due Date Modal */}
            {editDueDateModal.open && (
                <div style={{ display: 'flex', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, justifyContent: 'center', alignItems: 'center' }}>
                    <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '500px', width: '90%' }}>
                        <h3 style={{ marginBottom: '20px', color: '#333' }}>Edit Due Date</h3>
                        <form onSubmit={handleUpdateDueDate}>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Customer:</label>
                                <input type="text" readOnly value={editDueDateModal.customerName} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                            </div>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Current Due Date:</label>
                                <input type="text" readOnly value={editDueDateModal.currentDueDate} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>New Due Date:</label>
                                <input
                                    type="datetime-local"
                                    required
                                    value={editDueDateModal.newDueDate}
                                    onChange={e => setEditDueDateModal(prev => ({ ...prev, newDueDate: e.target.value }))}
                                    style={{ width: '100%', padding: '10px', border: '2px solid #ddd', borderRadius: '6px' }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={closeEditDueDateModal} style={{ padding: '10px 20px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" style={{ padding: '10px 20px', background: 'rgb(44, 75, 212)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Update</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reduce Qty Modal */}
{reduceQtyModal.open && (
    <div style={{ display: 'flex', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginBottom: '20px', color: '#333' }}>Reduce Quantity</h3>
            <form onSubmit={handleReduceQtySubmit}>
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Product:</label>
                    <input type="text" readOnly value={reduceQtyModal.productName} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                </div>
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Current Quantity:</label>
                    <input type="text" readOnly value={reduceQtyModal.currentQty} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                </div>
                <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Quantity to Deduct:</label>
                    <input
                        type="number"
                        required
                        min="0"
                        max={reduceQtyModal.currentQty}
                        value={reduceQtyModal.newQty}
                        onChange={e => setReduceQtyModal(prev => ({ ...prev, newQty: e.target.value }))}
                        style={{ width: '100%', padding: '10px', border: '2px solid #ddd', borderRadius: '6px' }}
                    />
                </div>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '20px' }}>Enter how many units to remove. Enter current quantity to delete the item entirely.</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={closeReduceQtyModal} style={{ padding: '10px 20px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" style={{ padding: '10px 20px', background: 'rgb(44, 75, 212)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Update</button>
                </div>
            </form>
        </div>
    </div>
)}
        </div>
    );
}