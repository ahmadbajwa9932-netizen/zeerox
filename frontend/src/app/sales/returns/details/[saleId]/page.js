'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";
import styles from './return-detail.module.css';

// ── column headings (mirrors window.returnedDetailSaleHeadings) ──
const headings = {
    product:           'Product',
    orgQuantity:       'Original Qty',
    returnedQuantity:  'Returned Qty',
    remainingQuantity: 'Remaining Qty',
    price:             'Unit Price',
    total:             'Original Total',
    remainingTotal:    'Remaining Total',
    quantity:          'Qty',
    refund:            'Refund',
};

// ── formatDate (mirrors JS formatDate exactly) ───────────────────
function formatDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day     = date.getDate();
    const month   = months[date.getMonth()];
    const year    = date.getFullYear();
    let hours     = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm    = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
}


// ════════════════════════════════════════════════════════════════
export default function ReturnDetailPage({ params }) {
    const { saleId: voucherNo } = use(params); // dynamic segment now carries the voucher_no
    const router     = useRouter();

    const [loading, setLoading]   = useState(true);
    const [error,   setError]     = useState(null);
    const [data,    setData]      = useState(null);

    // ── mirrors DOMContentLoaded fetch in returnedSale_detail.js ──
    useEffect(() => {
        apiFetch(`/api/sales/returned/${voucherNo}/details`, {
            method:  'GET',
            headers: {
                'Accept':           'application/json',
            },
        })
            .then((res) => res.json())
            .then((result) => {
                if (result.success) {
                    setData(result.data);
                } else {
                    setError('Failed to load return details');
                }
            })
            .catch(() => setError('Error loading return details. Please refresh the page.'))
            .finally(() => setLoading(false));
        }, [voucherNo]);

    // ── loading spinner (mirrors #loading-spinner) ───────────────
    if (loading) {
        return (
            <div className="container">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading return details...</p>
                </div>
            </div>
        );
    }

    // ── error state ──────────────────────────────────────────────
    if (error) {
        return (
            <div className="container">
                <div className="loading-spinner">
                    <p style={{ color: 'red' }}>{error}</p>
                </div>
            </div>
        );
    }

    const sale              = data.sale;
    const returns           = data.returns;
    const originalSaleItems = data.original_sale_items;

    // ════════════════════════════════════════════════════════════
    // populateItemsTable
    // ════════════════════════════════════════════════════════════
    function ItemsTable() {
        return (
            <div className={styles['detail-section']} style={{ marginBottom: '10px' }}>
                <h3 style={{ marginBottom: '10px', color: '#2a2a2a' }}>
                    Original Sale Items (Return Status)
                </h3>
                <table className="table">
                    <thead>
                        <tr>
                            <th>{headings.product}</th>
                            <th>{headings.orgQuantity}</th>
                            <th>{headings.returnedQuantity}</th>
                            <th>{headings.remainingQuantity}</th>
                            <th>{headings.price}</th>
                            <th>{headings.total}</th>
                            <th>{headings.remainingTotal}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {originalSaleItems.map((item) => {
                            const hasReturns = item.returned_quantity > 0;
                            return (
                                <tr key={item.id}>
                                    <td>{item.product_name}</td>
                                    <td>{item.original_quantity}</td>
                                    <td style={{ color: '#e74c3c' }}>
                                        {hasReturns ? item.returned_quantity : '-'}
                                    </td>
                                    <td>
                                        <strong style={{ color: item.remaining_quantity > 0 ? '#28a745' : '#6c757d' }}>
                                            {item.remaining_quantity}
                                        </strong>
                                    </td>
                                    <td>{formatPrice(item.price)}</td>
                                    <td style={{
                                        textDecoration: hasReturns ? 'line-through' : 'none',
                                        color: hasReturns ? '#888' : 'inherit',
                                    }}>
                                        {formatPrice(item.original_total)}
                                    </td>
                                    <td>
                                        <strong>{formatPrice(item.remaining_total)}</strong>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════
    // populateFinancialSummary
    // ════════════════════════════════════════════════════════════
    function FinancialSummary() {
        // mirrors populateFinancialSummary tax display logic exactly
        let currentTaxDisplay;
        if (sale.tax_type === 'percentage') {
            const currentTaxPercentage = data.adjusted_subtotal > 0
                ? (data.adjusted_tax / data.adjusted_subtotal) * 100
                : 0;
            currentTaxDisplay = `${currentTaxPercentage.toFixed(1)}% (${formatPrice(data.adjusted_tax)})`;
        } else {
            currentTaxDisplay = formatPrice(data.adjusted_tax);
        }

        return (
            <div className={styles['detail-section']} id="financial-summary-section">
                <h3>Financial Summary <span style={{ fontSize: '14px' }}>(After Returns)</span></h3>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Original Subtotal:</span>
                    <span className={styles['detail-value']} style={{ textDecoration: 'line-through', color: '#888' }}>
                        {formatPrice(sale.subtotal)}
                    </span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Current Subtotal:</span>
                    <span className={styles['detail-value']}>{formatPrice(data.adjusted_subtotal)}</span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Original Discount:</span>
                    <span className={styles['detail-value']} style={{ textDecoration: 'line-through', color: '#888' }}>
                        {sale.discount_type === 'percentage'
                            ? `${parseFloat(sale.discount).toFixed(0)}% (${formatPrice(sale.discount_amount)})`
                            : formatPrice(sale.discount_amount)
                        }
                    </span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Current Discount:</span>
                    <span className={styles['detail-value']}>{formatPrice(data.adjusted_discount_amount)}</span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Original Tax:</span>
                    <span className={styles['detail-value']} style={{ textDecoration: 'line-through', color: '#888' }}>
                        {sale.tax_type === 'percentage'
                            ? `${parseFloat(sale.tax).toFixed(0)}% (${formatPrice(sale.tax_amount)})`
                            : formatPrice(sale.tax_amount)
                        }
                    </span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Current Tax:</span>
                    <span className={styles['detail-value']}>{currentTaxDisplay}</span>
                </div>

                <div className={styles['detail-row']} style={{ borderTop: '2px solid #e74c3c', paddingTop: '10px' }}>
                    <span className={styles['detail-label']}>Original Grand Total:</span>
                    <span className={styles['detail-value']} style={{ textDecoration: 'line-through', color: '#888' }}>
                        {formatPrice(sale.grand_total)}
                    </span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Total Refunded Amount:</span>
                    <span className={styles['detail-value']} style={{ color: '#e74c3c' }}>
                        -{formatPrice(data.total_returned_amount)}
                    </span>
                </div>

                <div className={styles['detail-row']} style={{ borderTop: '1px solid #ccc', paddingTop: '10px' }}>
                    <span className={styles['detail-label']}><strong>Current Net Sale:</strong></span>
                    <span className={styles['detail-value']}><strong>{formatPrice(data.adjusted_grand_total)}</strong></span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Received Amount:</span>
                    <span className={styles['detail-value']}>{formatPrice(sale.received_amount)}</span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Change Given:</span>
                    <span className={styles['detail-value']}>{formatPrice(sale.change_amount)}</span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Payment Type:</span>
                    <span className={styles['detail-value']}>
                        {sale.payment_type ? sale.payment_type.charAt(0).toUpperCase() + sale.payment_type.slice(1) : 'N/A'}
                    </span>
                </div>

                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Original Sale Date:</span>
                    <span className={styles['detail-value']}>{formatDate(sale.sale_date)}</span>
                </div>
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════
    // populateCustomerInfo
    // ════════════════════════════════════════════════════════════
    function CustomerInfo() {
        const customer = sale.customer;
        return (
            <div className={styles['detail-section']} id="customer-info-section">
                <h3>Customer Information</h3>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Name:</span>
                    <span className={styles['detail-value']}>{customer?.name || 'Walk-in Customer'}</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Business/Shop Name:</span>
                    <span className={styles['detail-value']}>{customer?.shop_name || 'N/A'}</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Contact:</span>
                    <span className={styles['detail-value']}>{customer?.contact || 'N/A'}</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>City:</span>
                    <span className={styles['detail-value']}>{customer?.city || 'N/A'}</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Customer Type:</span>
                    <span className={styles['detail-value']}>{customer?.customer_type || 'Walk-in'}</span>
                </div>
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════
    // populateReturnSummary
    // ════════════════════════════════════════════════════════════
    function ReturnSummary() {
        const returnRate = parseFloat(sale.grand_total) > 0
            ? (data.total_returned_amount / parseFloat(sale.grand_total)) * 100
            : 0;

        return (
            <div className={styles['detail-section']} id="return-summary-section">
                <h3>Return Summary</h3>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Total Returns:</span>
                    <span className={styles['detail-value']}>{data.total_return_transactions} transaction(s)</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Items Returned:</span>
                    <span className={styles['detail-value']}>{data.total_items_returned}</span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Total Refunded:</span>
                    <span className={styles['detail-value']} style={{ color: '#e74c3c' }}>
                        {formatPrice(data.total_returned_amount)}
                    </span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Net Sale Value:</span>
                    <span className={styles['detail-value']}>
                        <strong>{formatPrice(data.adjusted_grand_total)}</strong>
                    </span>
                </div>
                <div className={styles['detail-row']}>
                    <span className={styles['detail-label']}>Return Rate:</span>
                    <span className={styles['detail-value']}>{returnRate.toFixed(1)}%</span>
                </div>
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════
    // populateReturnTransactions
    // ════════════════════════════════════════════════════════════
    function ReturnTransactions() {
        return (
            <div className={styles['detail-section']} style={{ marginTop: '30px' }}>
                <h3 style={{ marginBottom: '10px', color: '#2a2a2a' }}>Return Transaction History</h3>

                {returns.map((returnItem, index) => (
                    <div
                        key={returnItem.id}
                        style={{
                            marginBottom: '20px',
                            padding: '15px',
                            border: '1px solid #ddd',
                            borderRadius: '5px',
                            background: '#f8f9fa',
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '10px',
                        }}>
                            <strong>
                                Return #{index + 1} - RET-{String(returnItem.id).padStart(4, '0')}
                            </strong>
                            <span style={{ color: '#666' }}>
                                {formatDate(returnItem.created_at)}
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: '20px', marginBottom: '10px' }}>
                            <div>
                                <strong>Status:</strong>{' '}
                                {returnItem.status.charAt(0).toUpperCase() + returnItem.status.slice(1)}
                            </div>
                            <div>
                                <strong>Refund Amount:</strong>{' '}
                                <span style={{ color: '#e74c3c' }}>
                                    {formatPrice(returnItem.total_return_amount)}
                                </span>
                            </div>
                        </div>

                        {returnItem.notes && (
                            <div style={{ marginBottom: '10px' }}>
                                <strong>Notes:</strong> <em>{returnItem.notes}</em>
                            </div>
                        )}

                        <div>
                            <strong>Items Returned:</strong>
                            <table style={{
                                width: '100%',
                                marginTop: '5px',
                                fontSize: '14px',
                                borderCollapse: 'collapse',
                            }}>
                                <thead>
                                    <tr style={{ background: '#e9ecef' }}>
                                        <th style={{ padding: '8px', border: '1px solid #ddd' }}>{headings.product}</th>
                                        <th style={{ padding: '8px', border: '1px solid #ddd' }}>{headings.quantity}</th>
                                        <th style={{ padding: '8px', border: '1px solid #ddd' }}>{headings.price}</th>
                                        <th style={{ padding: '8px', border: '1px solid #ddd' }}>{headings.refund}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {returnItem.items.map((item) => (
                                        <tr key={item.id}>
                                            <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                                                {item.purchase.product_name}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                                                {item.quantity_returned}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                                                {formatPrice(item.unit_net_after_discount)}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                                                {formatPrice(item.amount_refunded)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // ════════════════════════════════════════════════════════════
    // RENDER — mirrors blade #return-details-content structure
    // ════════════════════════════════════════════════════════════
    return (
        <div className="container">
            {/* mirrors .container-child.main-text */}
            <div className="container-child main-text">
                <h1>Return Details - {sale.voucher_no}</h1>
                <div id="returns-warning">
                    <small style={{ color: '#e74c3c' }}>
                        ⚠️ {data.total_return_transactions} return transaction(s) - {data.total_items_returned} items returned
                    </small>
                </div>
            </div>

            {/* mirrors .container-child.sub-text with back button */}
            <div className="container-child sub-text">
                <p>Complete return history and financial impact</p>
                <a
                    href="/sales/returns"
                    className="boton-elegante"
                >
                    ← Back
                </a>
            </div>

            <div className="sub-container">
                {/* mirrors #items-table-container */}
                <ItemsTable />

                {/* mirrors .detail-box with three sections */}
                <div className={styles['detail-box']}>
                    <FinancialSummary />
                    <CustomerInfo />
                    <ReturnSummary />
                </div>

                {/* mirrors #return-transactions-container */}
                <ReturnTransactions />
            </div>
        </div>
    );
}