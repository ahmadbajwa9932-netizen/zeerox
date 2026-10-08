'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";
import styles from '../banking.module.css';

function badgeKey(bankName) {
    const key = bankName?.toLowerCase().replace(/\s+/g, '');
    if (key === 'jazzcash') return 'jazzcash';
    if (key === 'easypaisa') return 'easypaisa';
    if (key?.includes('mcb')) return 'mcb';
    if (key?.includes('hbl')) return 'hbl';
    return 'other';
}

export default function PaymentAccountDetailsPage() {
    const { id } = useParams();
    const router = useRouter();

    const [account, setAccount] = useState(null);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const [accRes, payRes] = await Promise.all([
                    apiFetch(`/api/bank-accounts/${id}`),
                    apiFetch(`/api/bank-accounts/${id}/payments`),
                ]);
                const accData = await accRes.json();
                const payData = await payRes.json();
                setAccount(accData.data || null);
                setPayments(payData.data || []);
            } finally {
                setLoading(false);
            }
        };
        if (id) load();
    }, [id]);

    if (loading) {
        return (
            <div className="container">
                <div className="loading-spinner"><div className="spinner" /></div>
            </div>
        );
    }

    if (!account) {
        return (
            <div className="container">
                <div className="container-child main-text"><h1>Account Not Found</h1></div>
                <div className="sub-container">
                    <div className={styles.emptyState}>This payment account may have been deleted.</div>
                    <a className="boton-elegante" onClick={() => router.push('/payment-accounts')}>Back to Payment Accounts</a>
                </div>
            </div>
        );
    }

    const key = badgeKey(account.bank_name);
    const initial = account.bank_name?.charAt(0)?.toUpperCase() || '?';

    return (
        <div className="container">
            <div className="container-child main-text">
                <h1>{account.bank_name} — Payment History</h1>
            </div>
            <div className="container-child sub-text">
                <p>Account details and linked transactions</p>
                <a className="boton-elegante" onClick={() => router.push('/payment-accounts')}>Back</a>
            </div>

            <div className="sub-container">

                <div className={styles.accountHeaderCard}>
                    <div className={styles.accountHeaderLeft}>
                        <div className={`${styles.accountAvatar} ${styles[key]}`}>{initial}</div>
                        <div className={styles.accountHeaderInfo}>
                            <h2>{account.account_title || account.bank_name}</h2>
                            <div className={styles.accountHeaderMeta}>
                                <span><strong>Bank:</strong>{account.bank_name}</span>
                                <span><strong>Account #:</strong>{account.account_number || '—'}</span>
                                <span><strong>Branch:</strong>{account.branch_name || '—'}</span>
                            </div>
                        </div>
                    </div>

                    <div className={styles.accountHeaderRight}>
                        <div className={styles.accountBalanceLabel}>Current Balance</div>
<div className={styles.accountBalanceValue}>{formatPrice(account.balance)}</div>
                        <div className={styles.accountStatusRow}>
                            <span className={`${styles.statusBadge} ${account.status ? styles.active : styles.inactive}`}>
                                {account.status ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    </div>
                </div>

                {payments.length === 0 ? (
                    <div className={styles.emptyState}>No payments linked to this account yet.</div>
                ) : (
                    <table>
                        <thead>
                            <tr><th>Voucher</th><th>Amount</th><th>Method</th><th>Date</th></tr>
                        </thead>
                        <tbody>
                            {payments.map((p) => (
                                <tr key={p.id}>
                                    <td>{p.voucher_no}</td>
                                    <td>{formatPrice(p.amount)}</td>
                                    <td>{p.method}</td>
                                    <td>{p.payment_date}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}