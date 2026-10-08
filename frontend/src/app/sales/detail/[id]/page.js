'use client';

import { Suspense, useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";
import styles from './sale-detail.module.css';
import './sale-detail.css';


function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
}

const HEADINGS = {
    product: 'Product',
    quantity: 'Quantity',
    price: 'Unit Price',
    discount: 'Discount',
    tax: 'Tax',
    total: 'Total',
};

// Next.js requires useSearchParams() to be wrapped in Suspense, otherwise it
// forces the whole page out of static rendering and can throw a build error.
export default function SaleDetailPageWrapper({ params }) {
    return (
        <Suspense fallback={<LoadingState />}>
            <SaleDetailPage params={params} />
        </Suspense>
    );
}

function LoadingState() {
    return (
        <div className="container">
            <div className="loading-spinner">
                <div className="spinner"></div>
                <p>Loading sale details...</p>
            </div>
        </div>
    );
}

function SaleDetailPage({ params }) {
    const router = useRouter();
    const { id: voucherNo } = use(params);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);

    useEffect(() => {
        if (!voucherNo) {
            setLoading(false);
            setError('No voucher number provided.');
            return;
        }

        setLoading(true);
        setError(null);

        apiFetch(`/api/sales/details/${voucherNo}/data`)
            .then((res) => res.json())
            .then((result) => {
                if (result.success) {
                    setData(result.data);
                } else {
                    throw new Error('Failed to load sale details');
                }
            })
            .catch((err) => {
                console.error('Error loading sale details:', err);
                setError('Error loading sale details. Please refresh the page.');
            })
            .finally(() => setLoading(false));
    }, [voucherNo]);

    if (loading) return <LoadingState />;

    return (
        <div className="container">
            {error && (
                <div className="loading-spinner">
                    <p style={{ color: 'red' }}>{error}</p>
                </div>
            )}

            {!error && data && <SaleDetailContent data={data} router={router} />}
        </div>
    );
}

function SaleDetailContent({ data, router }) {
    const { sale, sale_items: saleItems, payments } = data;

    return (
        <>
            <div className="container-child main-text">
                <h1>Sale Details - {sale.voucher_no}</h1>
            </div>

            <div className="container-child sub-text">
                <p>Complete summary and customer details</p>
                <button
                    type="button"
                    id="back-buttons"
                    className="boton-elegante"
                    onClick={() => router.back()}
                >
                    ← Back
                </button>
            </div>

            <div className="sub-container">
                {saleItems.length > 0 && <ItemsTable items={saleItems} />}

                <div className={styles.ledgerGrid}>
                    <SaleSummary sale={sale} />
                    <CustomerInfo customer={sale.customer} />
                </div>

                {data.is_advance_sale && <AdvanceCard data={data} />}

                {payments.length > 0 && <PaymentsTable payments={payments} />}
            </div>

            </>
    );
}

function ItemsTable({ items }) {
    return (
        <div className="detail-section" style={{ marginBottom: 10 }}>
            <h3 style={{ marginBottom: 10 }}>Sale Items</h3>
            <table className="table">
                <thead>
                    <tr>
                        <th>{HEADINGS.product}</th>
                        <th>{HEADINGS.quantity}</th>
                        <th>{HEADINGS.price}</th>
                        <th>{HEADINGS.discount}</th>
                        <th>{HEADINGS.tax}</th>
                        <th>{HEADINGS.total}</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item) => (
                        <tr key={item.id}>
                            <td>{item.product_name}</td>
                            <td>{item.quantity}</td>
                            <td>{formatPrice(item.price)}</td>
                            <td>
                                {item.discount_amount > 0
                                    ? (item.discount_type === 'percentage'
                                        ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.discount_amount)})`
                                        : formatPrice(item.discount_amount))
                                    : '-'}
                            </td>
                            <td>
                                {item.tax_amount > 0
                                    ? (item.tax_type === 'percentage'
                                        ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.tax_amount)})`
                                        : formatPrice(item.tax_amount))
                                    : '-'}
                            </td>
                            <td><strong>{formatPrice(item.total_after_tax)}</strong></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PaymentsTable({ payments }) {
    return (
        <div className="detail-section" style={{ marginTop: 10 }}>
            <h3 style={{ marginBottom: 10 }}>Payments</h3>
            <table className="table">
                <thead>
                    <tr>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Payment Date</th>
                    </tr>
                </thead>
                <tbody>
                    {payments.map((payment) => (
                        <tr key={payment.id}>
                            <td>{formatPrice(payment.amount)}</td>
                            <td>{payment.method}</td>
                            <td>{formatDate(payment.payment_date)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SaleSummary({ sale }) {
    return (
        <div className={styles.ledgerPanel}>
            <h3>Sale Summary</h3>

            <Row label="Subtotal:" value={formatPrice(sale.subtotal)} />
            <Row
                label="Discount:"
                value={
                    sale.discount_type === 'percentage'
                        ? `${parseFloat(sale.discount).toFixed(0)}% (${formatPrice(sale.discount_amount)})`
                        : formatPrice(sale.discount_amount)
                }
            />
            <Row
                label="Tax:"
                value={
                    sale.tax_type === 'percentage'
                        ? `${parseFloat(sale.tax).toFixed(0)}% (${formatPrice(sale.tax_amount)})`
                        : formatPrice(sale.tax_amount)
                }
            />
            <Row label="Grand Total:" value={<strong>{formatPrice(sale.grand_total)}</strong>} />
            <Row label="Received Amount:" value={formatPrice(sale.received_amount)} />
            <Row label="Change:" value={formatPrice(sale.change_amount)} />
            <Row
                label="Payment Type:"
                value={sale.payment_type.charAt(0).toUpperCase() + sale.payment_type.slice(1)}
            />
            <Row label="Sale Date:" value={formatDate(sale.sale_date)} />
        </div>
    );
}

function AdvanceCard({ data }) {
    return (
        <div className={`${styles.ledgerCard} ${styles.ledgerCardAdvance}`}>
            <div className={styles.ledgerCardAccent} />
            <div className={styles.ledgerCardHeader}>
                <span className={styles.ledgerCardIcon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <rect x="2.5" y="6" width="19" height="13" rx="2" />
                        <path d="M2.5 10h19" />
                        <circle cx="17" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
                    </svg>
                </span>
                <div>
                    <p className={styles.ledgerCardEyebrow}>Advance Account</p>
                    <h3 className={styles.ledgerCardTitle}>Advance Payment Details</h3>
                </div>
            </div>

            <div className={styles.ledgerCardBody}>
                <Row label="Previous Advance Balance:" value={formatPrice(data.previous_advance || 0)} mono />
                <Row label="Advance Used in This Sale:" value={`− ${formatPrice(data.advance_used || 0)}`} mono muted />
            </div>

            <div className={styles.ledgerCardTotal}>
                <span>Remaining Advance Balance</span>
                <strong>{formatPrice(data.remaining_advance || 0)}</strong>
            </div>
        </div>
    );
}

function CustomerInfo({ customer }) {
    return (
        <div className={styles.ledgerPanel}>
            <h3>Customer Information</h3>
            <Row label="Name:" value={customer?.name || 'Walk-in Customer'} />
            <Row label="Business/Shop Name:" value={customer?.shop_name || 'N/A'} />
            <Row label="Contact:" value={customer?.contact || 'N/A'} />
            <Row label="City:" value={customer?.city || 'N/A'} />
            <Row label="Customer Type:" value={customer?.customer_type || 'Walk-in'} />
        </div>
    );
}

function Row({ label, value, strike, mono = false, muted = false }) {
    return (
        <div className="detail-row">
            <span className="detail-label" style={muted ? { color: '#9a938a' } : undefined}>{label}</span>
            <span
                className="detail-value"
                style={{
                    ...(strike ? { textDecoration: 'line-through', color: '#888' } : {}),
                    ...(mono ? { fontFamily: "'IBM Plex Mono','Courier New',monospace" } : {}),
                    ...(muted ? { color: '#9a938a' } : {}),
                }}
            >
                {value}
            </span>
        </div>
    );
}