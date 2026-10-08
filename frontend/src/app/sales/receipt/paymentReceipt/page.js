'use client';

import { useEffect, useState, Fragment, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCurrency } from '@/lib/currency-context';
import receiptLabels from '@/lib/receiptLabels';
import styles from '../printReceipt/receipt.module.css';

const ucfirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/* matches PHP's 'd M Y, h:i A' */
const formatDateTime = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${minutes} ${ampm}`;
};

/* matches PHP's 'd/m/Y' (design3) */
const formatDateSlash = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

/* matches PHP's 'h:i A' (design3) */
const formatTimeOnly = (d) => {
  if (!d) return '';
  const date = new Date(d);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  return `${hh}:${minutes} ${ampm}`;
};

function PaymentReceiptContent() {
  const { formatPrice: fmtRs } = useCurrency();
  const params = useSearchParams();
  const paymentId = params.get('payment');
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (!paymentId) return;
    const raw = localStorage.getItem(`payment-receipt:${paymentId}`);
    if (raw) setReceipt(JSON.parse(raw));
  }, [paymentId]);

  const design = receipt?.receiptSettings?.design_type || 'design1';
  const paperSize = receipt?.receiptSettings?.paper_size || '80mm';
  const lang = receipt?.receiptSettings?.language || 'en';
  const t = receiptLabels[lang] || receiptLabels.en;

  useEffect(() => {
    if (!receipt) return;
    const sizeMap = { '80mm': '80mm auto', A4: 'A4', A5: 'A5' };
    const styleTag = document.createElement('style');
    styleTag.textContent = `@media print { @page { size: ${sizeMap[paperSize] || '80mm auto'}; margin: 0mm; } }`;
    document.head.appendChild(styleTag);
    return () => document.head.removeChild(styleTag);
  }, [receipt, paperSize]);

  if (!receipt) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading receipt…</div>;
  }

  const { shop, paymentData, customer, receipt_customer_type, transactionType, receiptSettings } = receipt;

  const paperClass = paperSize === 'A4' ? styles.paperA4 : paperSize === 'A5' ? styles.paperA5 : '';
  const isCustomer = customer && customer.name !== 'Walk-in Customer';
  const changeAmount = (paymentData.received_amount || 0) - (paymentData.previous_balance || 0);
  const breakdown = paymentData.advance_usage_breakdown;

  return (
    <div className={styles.receiptPage}>
      <div className={`${styles.printContainer} ${styles.noPrint}`}>
        <button onClick={() => window.print()} className={styles.printBtn}>🖨️ Print</button>
      </div>

      {design === 'design1' && (
        <div className={`${styles.design1} ${paperClass}`}>
          <div className={styles.header}>
            <h2 style={{ fontSize: 18, marginBottom: 2 }}>{shop?.shop_name || ''}</h2>
            <p style={{ fontSize: 9 }}>{shop?.address || ''}</p>
            <p style={{ fontSize: 9 }}>{shop?.phone || ''}</p>
          </div>

          <div>
            <div className={styles.row}><span className={styles.label}>{t.date}:</span><span>{formatDateTime(paymentData.payment_date)}</span></div>
            <div className={styles.row}><span className={styles.label}>{t.seller}:</span><span>{paymentData.user?.name || 'N/A'}</span></div>
          </div>

          <div className={styles.divider} />

          {isCustomer && (
            <div>
              <div className={styles.row}><span className={styles.label}>{t.customer_name}:</span><span>{customer.name}</span></div>
              {customer.contact && <div className={styles.row}><span className={styles.label}>{t.contact}:</span><span>{customer.contact}</span></div>}
              {customer.shop_name && <div className={styles.row}><span className={styles.label}>{t.shop_name}:</span><span>{customer.shop_name}</span></div>}
              {customer.city && <div className={styles.row}><span className={styles.label}>{t.city}:</span><span>{customer.city}</span></div>}
              <div className={styles.row}><span className={styles.label}>{t.type}:</span><span>{ucfirst(receipt_customer_type)}</span></div>
            </div>
          )}

          {transactionType === 'payment_only' && (
            <>
              <div className={styles.dividerSolid} />
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 12 }}>
                {(t.payment_received || 'PAYMENT RECEIVED').toUpperCase()}
              </div>
              <div>
                <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>
                <div className={styles.row}><span className={styles.label}>{t.amount_paid}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.received_amount)}</span></div>
                {paymentData.previous_balance > 0 && (
                  <div className={styles.row}><span className={styles.label}>{t.previous_balance}:</span><span> {fmtRs(paymentData.previous_balance)}</span></div>
                )}
                {paymentData.remaining_balance > 0 ? (
                  <div className={styles.row}><span className={styles.label}>{t.remaining_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.remaining_balance)}</span></div>
                ) : (
                  <>
                    <div className={styles.row}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                    <div className={styles.row}><span className={styles.label}>{t.remaining_balance}: </span><span style={{ fontWeight: 'bold' }}>{fmtRs(0)}</span></div>
                    {changeAmount > 0 && (
                      <div className={styles.row}><span className={styles.label}>{t.change_amount}: </span><span style={{ fontWeight: 'bold' }}> {fmtRs(changeAmount)}</span></div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {transactionType === 'advance_return' && (
            <>
              <div className={styles.dividerSolid} />
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 14 }}>
                {(t.advance_return || 'FULL ADVANCE RETURNED').toUpperCase()}
              </div>
              <div>
                <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>
                <div className={styles.row} style={{ background: '#ffe6e6', padding: 8, margin: '10px 0' }}>
                  <span className={styles.label}>{t.returned_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.previous_advance)}</span>
                </div>
                <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                <div style={{ marginTop: 15, padding: 10, background: '#f8f9fa', border: '1px dashed #666', textAlign: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: 11 }}>✓ {(t.full_advance_returned || 'FULL ADVANCE RETURNED TO CUSTOMER').toUpperCase()}</span>
                </div>
              </div>
            </>
          )}

          {transactionType === 'advance_only' && (
            <>
              <div className={styles.dividerSolid} />
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 12 }}>
                {(t.advance_payment_received || 'ADVANCE PAYMENT RECEIVED').toUpperCase()}
              </div>
              <div>
                <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>

                {paymentData.advance_sub_type === 'partial_return' && (
                  <>
                    <div className={styles.row}><span className={styles.label}>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                    <div className={styles.row} style={{ background: '#ffe6e6', padding: 8, margin: '8px 0' }}>
                      <span className={styles.label}>{t.returned_amount}:</span><span style={{ fontWeight: 'bold', color: '#d32f2f' }}> {fmtRs(paymentData.returned_amount)}</span>
                    </div>
                    <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.remaining_advance)}</span></div>
                  </>
                )}

                {paymentData.advance_sub_type === 'add' && (
                  <>
                    <div className={styles.row}><span className={styles.label}>{t.new_advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
                    {paymentData.previous_advance > 0 && (
                      <div className={styles.row}><span className={styles.label}>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                    )}
                  </>
                )}

                {paymentData.advance_sub_type !== 'partial_return' && paymentData.advance_sub_type !== 'add' && (
                  <div className={styles.row}><span className={styles.label}>{t.advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
                )}

                {paymentData.advance_sub_type === 'offset' && breakdown && (
                  <div style={{ marginTop: 10, padding: 8, border: '1px dashed #666' }}>
                    <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>***{t.advance_usage}***</div>
                    {breakdown.used_for_old_balance > 0 && (
                      <>
                        <div className={styles.row}><span className={styles.label}>{t.paid_old_dues}:</span><span> {fmtRs(breakdown.used_for_old_balance)}</span></div>
                        {breakdown.old_invoices_paid?.length > 0 && (
                          <div style={{ marginLeft: 10, fontSize: 8, marginTop: 3 }}>
                            {breakdown.old_invoices_paid.map((inv, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'center', gap: 15 }}>
                                <span>→ Invoice #{inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(breakdown.remaining)}</span></div>
                    {breakdown.remaining > 0 && (
                      <>
                        <div className={styles.dividerSolid} />
                        <div className={styles.row}><span className={styles.label}>{t.remaining_last_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                        <div className={styles.row}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                      </>
                    )}
                  </div>
                )}

                {paymentData.advance_sub_type !== 'offset' && customer?.advance_payment > 0 && (
                  <div className={styles.row}><span className={styles.label}>{t.total_advance_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(customer.advance_payment)}</span></div>
                )}

                {paymentData.advance_sub_type !== 'offset' && !(customer?.advance_payment > 0) && paymentData.remaining_advance === 0 && (
                  <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                )}

                {paymentData.remaining_balance > 0 && (
                  <div className={styles.noticeBox} style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>{t.remaining_debt}</div>
                    <div className={styles.row}><span>{t.amount_due}:</span><span> {fmtRs(paymentData.remaining_balance)}</span></div>
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 15, fontSize: 9 }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
              {receiptSettings?.show_signature && (
                <span style={{ display: 'inline-block', width: '50%' }}>{t.signature}: ___________________</span>
              )}
              {receiptSettings?.show_stamp && (
                <span style={{ display: 'inline-block', width: '50%' }}>{t.stamp}: ___________________</span>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <p style={{ fontWeight: 'bold' }}>{t.thank_you}!</p>
            <p style={{ fontSize: 10, marginTop: 3 }}>Powered by ZeeroX POS{paperSize === '80mm' ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>
          </div>
        </div>
      )}

      {design === 'design2' && (
        <div className={`${styles.design2} ${paperClass}`}>
          <div className={styles.header}>
            <h1 style={{ fontSize: 20, marginBottom: 5 }}>{shop?.shop_name || 'Business/Shop Name'}</h1>
            <p style={{ fontSize: 10 }}>{shop?.address || ''}</p>
            <p style={{ fontSize: 10 }}>{shop?.phone || ''}</p>
          </div>

          <div className={styles.infoCard}>
            <div className={styles.row}><span className={styles.label}>{t.date} & {t.time}:</span><span>{formatDateTime(paymentData.payment_date)}</span></div>
            <div className={styles.row}><span className={styles.label}>{t.served_by}:</span><span>{paymentData.user?.name || 'N/A'}</span></div>
          </div>

          {isCustomer && (
            <div className={styles.infoCard}>
              <div className={styles.row}><span className={styles.label}>{t.customer_name}:</span><span style={{ fontWeight: 'bold' }}>{customer.name}</span></div>
              {customer.contact && <div className={styles.row}><span className={styles.label}>{t.contact}:</span><span>{customer.contact}</span></div>}
              {customer.shop_name && <div className={styles.row}><span className={styles.label}>{t.shop_name}:</span><span>{customer.shop_name}</span></div>}
              {customer.city && <div className={styles.row}><span className={styles.label}>{t.city}:</span><span>{customer.city}</span></div>}
              <div className={styles.row}><span className={styles.label}>{t.type}:</span><span>{ucfirst(receipt_customer_type)}</span></div>
            </div>
          )}

          {transactionType === 'payment_only' && (
            <div className={styles.infoCard}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 10, fontSize: 12 }}>
                {(t.payment_received || 'PAYMENT RECEIVED').toUpperCase()}
              </div>
              <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span style={{ fontWeight: 'bold' }}>{ucfirst(paymentData.payment_type)}</span></div>
              <div className={styles.row}><span className={styles.label}>{t.amount_paid}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.received_amount)}</span></div>
              {paymentData.previous_balance > 0 && (
                <div className={styles.row}><span className={styles.label}>{t.previous_balance}:</span><span> {fmtRs(paymentData.previous_balance)}</span></div>
              )}
              {paymentData.remaining_balance > 0 ? (
                <div className={styles.row}><span className={styles.label}>{t.remaining_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.remaining_balance)}</span></div>
              ) : (
                <>
                  <div className={styles.row}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                  <div className={styles.row}><span className={styles.label}>{t.remaining_balance}: </span><span style={{ fontWeight: 'bold' }}>{fmtRs(0)}</span></div>
                  {changeAmount > 0 && (
                    <div className={styles.row}><span className={styles.label}>{t.change_amount}: </span><span style={{ fontWeight: 'bold' }}> {fmtRs(changeAmount)}</span></div>
                  )}
                </>
              )}
            </div>
          )}

          {transactionType === 'advance_return' && (
            <>
              <div className={styles.dividerSolid} />
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 14 }}>
                {(t.advance_return || 'FULL ADVANCE RETURNED').toUpperCase()}
              </div>
              <div>
                <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>
                <div className={styles.row} style={{ background: '#ffe6e6', padding: 8, margin: '10px 0' }}>
                  <span className={styles.label}>{t.returned_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.previous_advance)}</span>
                </div>
                <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                <div style={{ marginTop: 15, padding: 10, background: '#f8f9fa', border: '1px dashed #666', textAlign: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: 11 }}>✓ {(t.full_advance_returned || 'FULL ADVANCE RETURNED TO CUSTOMER').toUpperCase()}</span>
                </div>
              </div>
            </>
          )}

          {transactionType === 'advance_only' && (
            <>
              <div className={styles.dividerSolid} />
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 12 }}>
                {(t.advance_payment_received || 'ADVANCE PAYMENT RECEIVED').toUpperCase()}
              </div>
              <div>
                <div className={styles.row}><span className={styles.label}>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>

                {paymentData.advance_sub_type === 'partial_return' && (
                  <>
                    <div className={styles.row}><span className={styles.label}>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                    <div className={styles.row} style={{ background: '#ffe6e6', padding: 8, margin: '8px 0' }}>
                      <span className={styles.label}>{t.returned_amount}:</span><span style={{ fontWeight: 'bold', color: '#d32f2f' }}> {fmtRs(paymentData.returned_amount)}</span>
                    </div>
                    <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.remaining_advance)}</span></div>
                  </>
                )}

                {paymentData.advance_sub_type === 'add' && (
                  <>
                    <div className={styles.row}><span className={styles.label}>{t.new_advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
                    {paymentData.previous_advance > 0 && (
                      <div className={styles.row}><span className={styles.label}>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                    )}
                  </>
                )}

                {paymentData.advance_sub_type !== 'partial_return' && paymentData.advance_sub_type !== 'add' && (
                  <div className={styles.row}><span className={styles.label}>{t.advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
                )}

                {paymentData.advance_sub_type === 'offset' && breakdown && (
                  <div style={{ marginTop: 10, padding: 8, border: '1px dashed #666' }}>
                    <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>***{t.advance_usage}***</div>
                    {breakdown.used_for_old_balance > 0 && (
                      <>
                        <div className={styles.row}><span className={styles.label}>{t.paid_old_dues}:</span><span> {fmtRs(breakdown.used_for_old_balance)}</span></div>
                        {breakdown.old_invoices_paid?.length > 0 && (
                          <div style={{ marginLeft: 10, fontSize: 8, marginTop: 3 }}>
                            {breakdown.old_invoices_paid.map((inv, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'center', gap: 15 }}>
                                <span>→ Invoice #{inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(breakdown.remaining)}</span></div>
                    {breakdown.remaining > 0 && (
                      <>
                        <div className={styles.dividerSolid} />
                        <div className={styles.row}><span className={styles.label}>{t.remaining_last_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                        <div className={styles.row}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                      </>
                    )}
                  </div>
                )}

                {paymentData.advance_sub_type !== 'offset' && customer?.advance_payment > 0 && (
                  <div className={styles.row}><span className={styles.label}>{t.total_advance_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(customer.advance_payment)}</span></div>
                )}

                {paymentData.advance_sub_type !== 'offset' && !(customer?.advance_payment > 0) && paymentData.remaining_advance === 0 && (
                  <div className={styles.row}><span className={styles.label}>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                )}

                {paymentData.remaining_balance > 0 && (
                  <div className={styles.noticeBox} style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>{t.remaining_debt}</div>
                    <div className={styles.row}><span>{t.amount_due}:</span><span> {fmtRs(paymentData.remaining_balance)}</span></div>
                  </div>
                )}
              </div>
            </>
          )}

          {(receiptSettings?.show_signature || receiptSettings?.show_stamp) && (
            <div style={{ marginTop: 15, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              {receiptSettings?.show_signature && (
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ borderTop: '1px solid black', marginTop: 30, paddingTop: 5, fontSize: 9 }}>{t.customer_signature}</div>
                </div>
              )}
              {receiptSettings?.show_stamp && (
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ borderTop: '1px solid black', marginTop: 30, paddingTop: 5, fontSize: 9 }}>{t.authorized_stamp}</div>
                </div>
              )}
            </div>
          )}

          <div className={styles.footer}>
            <p style={{ fontSize: 11, fontWeight: 'bold' }}>{t.thank_you}</p>
            <p style={{ fontSize: 10, marginTop: 8 }}>Powered by ZeeroX POS{paperSize === '80mm' ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>
          </div>
        </div>
      )}

      {design === 'design3' && (
        <div className={`${styles.design3} ${paperClass}`}>
          <div className={styles.header}>
            <h1 style={{ fontSize: 20, marginBottom: 5 }}>{shop?.shop_name || 'SHOP NAME'}</h1>
            <p style={{ fontSize: 9 }}>{shop?.address || ''}</p>
            <p style={{ fontSize: 9 }}>{shop?.phone || ''}</p>
          </div>

          <div className={styles.sectionTitle}>{t.transaction_details}</div>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>{t.date}:</span><span>{formatDateSlash(paymentData.payment_date)}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>{t.time}:</span><span>{formatTimeOnly(paymentData.payment_date)}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>{t.cashier}:</span><span>{paymentData.user?.name || 'N/A'}</span></div>
          </div>

          {isCustomer && (
            <>
              <div className={styles.sectionTitle}>{t.customer_information}</div>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}><span className={styles.infoLabel}>{t.customer_name}:</span><span>{customer.name}</span></div>
                {customer.contact && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.contact}:</span><span>{customer.contact}</span></div>}
                {customer.shop_name && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.shop_name}:</span><span>{customer.shop_name}</span></div>}
                {customer.city && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.city}:</span><span>{customer.city}</span></div>}
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>{t.type}:</span>
                  <span>{(receipt_customer_type || '').toUpperCase()} <span className={styles.statusBadge}>{(receipt_customer_type || '').toUpperCase()}</span></span>
                </div>
              </div>
            </>
          )}

          {transactionType === 'payment_only' && (
            <>
              <div className={styles.sectionTitle}>{(t.payment_received || 'PAYMENT RECEIVED').toUpperCase()}</div>
              <div className={styles.paymentInfo}>
                <div className={styles.summaryRow}><span style={{ fontWeight: 'bold' }}>{(t.payment_method || 'PAYMENT METHOD').toUpperCase()}:</span><span style={{ fontWeight: 'bold' }}>{(paymentData.payment_type || '').toUpperCase()}</span></div>
                <div className={styles.summaryRow}><span>{(t.amount_paid || 'AMOUNT PAID').toUpperCase()}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.received_amount)}</span></div>
                {paymentData.previous_balance > 0 && (
                  <div className={styles.summaryRow}><span>{(t.previous_balance || 'PREVIOUS BALANCE').toUpperCase()}:</span><span> {fmtRs(paymentData.previous_balance)}</span></div>
                )}
                {paymentData.remaining_balance > 0 ? (
                  <div className={`${styles.summaryRow} ${styles.totalRow}`}><span>{(t.remaining_balance || 'REMAINING BALANCE').toUpperCase()}:</span><span> {fmtRs(paymentData.remaining_balance)}</span></div>
                ) : (
                  <>
                    <div className={styles.summaryRow}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                    <div className={styles.summaryRow}><span>{t.remaining_balance}: </span><span style={{ fontWeight: 'bold' }}>{fmtRs(0)}</span></div>
                    {changeAmount > 0 && (
                      <div className={styles.summaryRow}><span>{t.change_amount}: </span><span style={{ fontWeight: 'bold' }}> {fmtRs(changeAmount)}</span></div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {transactionType === 'advance_return' && (
            <div>
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0' }}>
                {(t.advance_return || 'FULL ADVANCE RETURNED').toUpperCase()}
              </div>
              <div className={styles.summaryRow}><span>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>
              <div className={styles.summaryRow} style={{ background: '#ffe6e6', padding: 8, margin: '10px 0' }}>
                <span>{t.returned_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.previous_advance)}</span>
              </div>
              <div className={styles.summaryRow}><span>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
              <div style={{ marginTop: 15, padding: 10, background: '#f8f9fa', border: '1px dashed #666', textAlign: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: 11 }}>✓ {(t.full_advance_returned || 'FULL ADVANCE RETURNED TO CUSTOMER').toUpperCase()}</span>
              </div>
            </div>
          )}

          {transactionType === 'advance_only' && (
            <div>
              <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '15px 0', fontSize: 12 }}>
                {(t.advance_payment_received || 'ADVANCE PAYMENT RECEIVED').toUpperCase()}
              </div>
              <div className={styles.summaryRow}><span>{t.payment_type}:</span><span>{ucfirst(paymentData.payment_type)}</span></div>

              {paymentData.advance_sub_type === 'partial_return' && (
                <>
                  <div className={styles.summaryRow}><span>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                  <div className={styles.summaryRow} style={{ background: '#ffe6e6', padding: 8, margin: '8px 0' }}>
                    <span>{t.returned_amount}:</span><span style={{ fontWeight: 'bold', color: '#d32f2f' }}> {fmtRs(paymentData.returned_amount)}</span>
                  </div>
                  <div className={styles.summaryRow}><span>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.remaining_advance)}</span></div>
                </>
              )}

              {paymentData.advance_sub_type === 'add' && (
                <>
                  <div className={styles.summaryRow}><span>{t.new_advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
                  {paymentData.previous_advance > 0 && (
                    <div className={styles.summaryRow}><span>{t.previous_advance}:</span><span> {fmtRs(paymentData.previous_advance)}</span></div>
                  )}
                </>
              )}

              {paymentData.advance_sub_type !== 'partial_return' && paymentData.advance_sub_type !== 'add' && (
                <div className={styles.summaryRow}><span>{t.advance_amount}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(paymentData.advance_amount)}</span></div>
              )}

              {paymentData.advance_sub_type === 'offset' && breakdown && (
                <div style={{ marginTop: 10, padding: 8, border: '1px dashed #666' }}>
                  <div style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: 5 }}>***{t.advance_usage}***</div>
                  {breakdown.used_for_old_balance > 0 && (
                    <>
                      <div className={styles.summaryRow}><span>{t.paid_old_dues}:</span><span> {fmtRs(breakdown.used_for_old_balance)}</span></div>
                      {breakdown.old_invoices_paid?.length > 0 && (
                        <div style={{ marginLeft: 10, fontSize: 8, marginTop: 3 }}>
                          {breakdown.old_invoices_paid.map((inv, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'center', gap: 15 }}>
                              <span>→ Invoice #{inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className={styles.summaryRow}><span>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(breakdown.remaining)}</span></div>
                  {breakdown.remaining > 0 && (
                    <>
                      <div className={styles.dividerSolid} />
                      <div className={styles.summaryRow}><span>{t.remaining_last_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
                      <div className={styles.summaryRow}><span style={{ fontWeight: 'bold' }}>✓ {(t.all_dues_cleared || 'ALL DUES CLEARED').toUpperCase()}</span></div>
                    </>
                  )}
                </div>
              )}

              {paymentData.advance_sub_type !== 'offset' && customer?.advance_payment > 0 && (
                <div className={styles.summaryRow}><span>{t.total_advance_balance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(customer.advance_payment)}</span></div>
              )}

              {paymentData.advance_sub_type !== 'offset' && !(customer?.advance_payment > 0) && paymentData.remaining_advance === 0 && (
                <div className={styles.summaryRow}><span>{t.remaining_advance}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(0)}</span></div>
              )}

              {paymentData.remaining_balance > 0 && (
                <div style={{ border: '1px solid #000', padding: 10, margin: '10px 0', textAlign: 'center' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 5 }}>{t.remaining_debt}</div>
                  <div className={styles.summaryRow}><span>{t.amount_due}:</span><span> {fmtRs(paymentData.remaining_balance)}</span></div>
                </div>
              )}
            </div>
          )}

          {(receiptSettings?.show_signature || receiptSettings?.show_stamp) && (
            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {receiptSettings?.show_signature && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ borderTop: '2px solid #000', marginTop: 40, paddingTop: 5, fontSize: 8, fontWeight: 'bold' }}>{(t.signature || 'SIGNATURE').toUpperCase()}</div>
                </div>
              )}
              {receiptSettings?.show_stamp && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ borderTop: '2px solid #000', marginTop: 40, paddingTop: 5, fontSize: 8, fontWeight: 'bold' }}>{(t.stamp || 'STAMP').toUpperCase()}</div>
                </div>
              )}
            </div>
          )}

          <div className={styles.footer}>
            <p style={{ fontWeight: 'bold', fontSize: 10 }}>{(t.thank_you || 'THANK YOU').toUpperCase()}</p>
            <p style={{ fontSize: 10, marginTop: 5 }}>Powered by ZeeroX POS{paperSize === '80mm' ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>
          </div>
        </div>
      )}
    </div>
  );
}


export default function PaymentReceiptPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
      <PaymentReceiptContent />
    </Suspense>
  );
}