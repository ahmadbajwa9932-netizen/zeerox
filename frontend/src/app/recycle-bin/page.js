'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatPrice } from '@/lib/currency-context';
import { usePermissions } from '@/lib/permissions';
import { RotateCcw, Inbox, Loader2 } from 'lucide-react';
import styles from './recycle-bin.module.css';

const TABS = [
    { key: 'purchases', label: 'Purchases' },
    { key: 'categories', label: 'Categories' },
    { key: 'suppliers', label: 'Suppliers' },
    { key: 'customers', label: 'Customers' },
    { key: 'sales', label: 'Sales' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'saleReturns', label: 'Sale Returns' },
    { key: 'walkInReturns', label: 'Walk-in Returns' },
    { key: 'manualNotes', label: 'Manual Notes' },
];

const COLUMNS = {
    purchases: [
        { key: 'product_name', label: 'Product' },
        { key: 'barcode', label: 'Barcode' },
        { key: 'category_name', label: 'Category' },
        { key: 'supplier_name', label: 'Supplier' },
        { key: 'purchased_price', label: 'Purchased price', money: true },
        { key: 'quantity', label: 'Qty' },
        { key: 'purchase_date', label: 'Purchase date' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    categories: [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    suppliers: [
        { key: 'name', label: 'Name' },
        { key: 'company', label: 'Company' },
        { key: 'contact_info', label: 'Contact' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    customers: [
        { key: 'name', label: 'Name' },
        { key: 'shop_name', label: 'Shop' },
        { key: 'city', label: 'City' },
        { key: 'contact', label: 'Contact' },
        { key: 'current_balance', label: 'Balance', money: true },
        { key: 'advance_payment', label: 'Advance', money: true },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    sales: [
        { key: 'voucher_no', label: 'Voucher #' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'payment_type', label: 'Payment type' },
        { key: 'grand_total', label: 'Grand total', money: true },
        { key: 'sale_date', label: 'Sale date' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    expenses: [
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', money: true },
        { key: 'date', label: 'Date' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    manualNotes: [
        { key: 'heading', label: 'Heading' },
        { key: 'created_at', label: 'Created at' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    saleReturns: [
        { key: 'voucher_no', label: 'Voucher #' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'total_return_amount', label: 'Return amount', money: true },
        { key: 'created_at', label: 'Return date' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
    walkInReturns: [
        { key: 'batch_no', label: 'Batch #' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'total_refund_amount', label: 'Refund amount', money: true },
        { key: 'created_at', label: 'Return date' },
        { key: 'deleted_at', label: 'Deleted at' },
    ],
};

export default function RecycleBinPage() {
    const [activeTab, setActiveTab] = useState('purchases');
    const { isBlocked } = usePermissions();
    const [counts, setCounts] = useState({});
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [restoringId, setRestoringId] = useState(null);

    // Load counts for all tabs once
    useEffect(() => {
        apiFetch('/api/recycle-bin/summary')
            .then((res) => res.json())
            .then((data) => setCounts(data.counts || {}))
            .catch(() => {});
    }, []);

    // Load records whenever the active tab changes
    useEffect(() => {
        setLoading(true);
        apiFetch(`/api/recycle-bin/${activeTab}`)
            .then((res) => res.json())
            .then((data) => setRecords(data.records || []))
            .finally(() => setLoading(false));
    }, [activeTab]);

    async function handleRestore(id) {
        setRestoringId(id);
        try {
            const res = await apiFetch(`/api/recycle-bin/${activeTab}/${id}/restore`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error('Restore failed');

            setRecords((prev) => prev.filter((r) => r.id !== id));
            setCounts((prev) => ({ ...prev, [activeTab]: Math.max(0, (prev[activeTab] || 1) - 1) }));
        } catch (err) {
            alert('Could not restore this record. Please try again.');
        } finally {
            setRestoringId(null);
        }
    }

    const columns = COLUMNS[activeTab] || [];

    return (
        <div className="container">
            <div className="container-child main-text">
                <h1>Recycle Bin</h1>
            </div>
            <div className="container-child sub-text">
                <p>Deleted records from every module, grouped by table</p>
            </div>

            <div className={styles.tabs}>
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabActive : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                        {counts[tab.key] > 0 && <span className={styles.badge}>{counts[tab.key]}</span>}
                    </button>
                ))}
            </div>

            <div className={styles.panel}>
                {loading ? (
                    <div className={styles.stateBox}>
                        <Loader2 size={20} className={styles.spinIcon} />
                        <span>Loading deleted records…</span>
                    </div>
                ) : records.length === 0 ? (
                    <div className={styles.stateBox}>
                        <Inbox size={22} />
                        <span>No deleted records here.</span>
                    </div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                {columns.map((col) => (
                                    <th key={col.key}>{col.label}</th>
                                ))}
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((record) => (
                                <tr key={record.id}>
                                    {columns.map((col) => (
                                        <td key={col.key}>
                                            {record[col.key] == null
                                                ? '—'
                                                : col.money
                                                ? formatPrice(record[col.key])
                                                : record[col.key]}
                                        </td>
                                    ))}
                                    <td>
                                    {!isBlocked('recycle-bin.act.restore') && (
                                        <button
                                            className={styles.restoreButton}
                                            disabled={restoringId === record.id}
                                            onClick={() => handleRestore(record.id)}
                                        >
                                            <RotateCcw size={14} />
                                            {restoringId === record.id ? 'Restoring…' : 'Restore'}
                                        </button>
                                    )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}