'use client';

import { useEffect, useState, useRef, Fragment, Suspense  } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useCurrency } from '@/lib/currency-context';
import receiptLabels from '@/lib/receiptLabels';
import styles from './receipt.module.css';

/* plain 2-decimal number, comma-separated — matches PHP number_format($x, 2) */
const fmtPlain = (n) =>
  parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ucfirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/* matches PHP's 'd M Y, h:i A' — e.g. "26 Aug 2026, 01:40 PM" */
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

/* matches PHP's 'd M Y' */
const formatDateOnly = (d) => {
  if (!d) return '';
  const date = new Date(d);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

function ReceiptContent() {
  const { formatPrice: fmtRs } = useCurrency();
  const params    = useSearchParams();
  const router    = useRouter();
  const voucher   = params.get('voucher');
  const isPreview = params.get('preview') === '1';
  const [receipt, setReceipt] = useState(null);
  const receiptRef = useRef(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!receiptRef.current) return;
    setIsDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const node = receiptRef.current;
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
        height: node.scrollHeight,
        width: node.scrollWidth,
      });
      const link = document.createElement('a');
      link.download = `receipt-${receipt?.sale?.voucher_no || 'preview'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to generate receipt image.');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (isPreview) {
      const qs = new URLSearchParams({
        paper_size: params.get('paper_size') || '80mm',
        design_type: params.get('design_type') || 'design1',
        language: params.get('language') || 'en',
        show_signature: params.get('show_signature') || '1',
        show_stamp: params.get('show_stamp') || '1',
        show_paid_overlay: params.get('show_paid_overlay') || '1',
      });
      apiFetch(`/settings/receipt/preview?${qs.toString()}`)
        .then((res) => res.json())
        .then(setReceipt)
        .catch(() => setReceipt(null));
      return;
    }

    if (!voucher) return;
    const raw = localStorage.getItem(`receipt:${voucher}`);
    if (raw) setReceipt(JSON.parse(raw));
  }, [voucher, isPreview, params]);

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

  const {
    shop, seller_name, sale, customer, items, previous_balance,
    total_payable, advance_used, advance_deposit_info, total_paid,
    was_previous_balance_cleared, receiptSettings, invoice_payment_breakdown,
  } = receipt;
  
  const isCompact = paperSize === '80mm';
  const paperClass = paperSize === 'A4' ? styles.paperA4 : paperSize === 'A5' ? styles.paperA5 : '';
  const salePayment = Math.min(sale.received_amount || 0, sale.grand_total);
  const oldBalancePayment = Math.max(0, (sale.received_amount || 0) - sale.grand_total - (sale.change_amount || 0));
  const showAdvanceBox = advance_used > 0 || (advance_deposit_info && advance_deposit_info.was_advance_involved);

  const isWalkIn = customer?.name === 'Walk-in Customer';


  return (
    <div className={styles.receiptPage}>
         {!isPreview && (
        <div className={`${styles.printContainer} ${styles.noPrint}`}>
          <button onClick={() => window.print()} className={styles.printBtn}>🖨️ Print</button>
          <button onClick={handleDownload} className={styles.printBtn} disabled={isDownloading}>
            {isDownloading ? 'Preparing…' : '⬇ Download'}
          </button>
        </div>
      )}

<div ref={receiptRef}>
{receipt.is_quotation && <div className={`${styles.paidOverlay} ${styles.overlayPartial}`}>QUOTATION</div>}
{!receipt.is_quotation && receiptSettings?.show_paid_overlay && sale.status === 'unpaid'  && <div className={`${styles.paidOverlay} ${styles.overlayUnpaid}`}>UNPAID</div>}
{!receipt.is_quotation && receiptSettings?.show_paid_overlay && sale.status === 'partial' && <div className={`${styles.paidOverlay} ${styles.overlayPartial}`}>{t.partial_payment}</div>}
{!receipt.is_quotation && receiptSettings?.show_paid_overlay && sale.status === 'paid'    && <div className={`${styles.paidOverlay} ${styles.overlayPaid}`}>{t.paid}</div>}
{design === 'design1' && (
      <div className={`${styles.design1} ${paperClass}`}>
        <div className={styles.header}>
          <h2 style={{ fontSize: 18, marginBottom: 2, textTransform: 'capitalize' }}>{shop?.shop_name || ''}</h2>
          <p style={{ fontSize: 9 }}>{shop?.address || ''}</p>
          <p style={{ fontSize: 9 }}>{shop?.phone || ''}</p>
        </div>

        <div>
        {!receipt.is_quotation && (
  <div className={styles.row}><span className={styles.label}>{t.voucher_no}</span><span>{sale.voucher_no}</span></div>
)}
          <div className={styles.row}><span className={styles.label}>{t.date}</span><span>{formatDateTime(sale.sale_date)}</span></div>
          <div className={styles.row}><span className={styles.label}>{t.seller}</span><span>{seller_name || 'N/A'}</span></div>
        </div>

        <div className={styles.divider} />

        <div>
        {isWalkIn ? (
            <>
              <div className={styles.row}><span className={styles.label}>{t.customer_name}</span><span>Walk-in Customer</span></div>
              {customer.contact && <div className={styles.row}><span className={styles.label}>{t.contact}</span><span>{customer.contact}</span></div>}
              {customer.city    && <div className={styles.row}><span className={styles.label}>{t.city}</span><span>{customer.city}</span></div>}
              <div className={styles.row}><span className={styles.label}>{t.type}</span><span>{ucfirst(sale.payment_type)}</span></div>
            </>
          ) : (
            <>
              <div className={styles.row}><span className={styles.label}>{t.customer_name}</span><span>{customer.name}</span></div>
              {customer.contact   && <div className={styles.row}><span className={styles.label}>{t.contact}</span><span>{customer.contact}</span></div>}
              {customer.shop_name && <div className={styles.row}><span className={styles.label}>{t.shop_name}</span><span>{customer.shop_name}</span></div>}
              {customer.city      && <div className={styles.row}><span className={styles.label}>{t.city}</span><span>{customer.city}</span></div>}
              <div className={styles.row}><span className={styles.label}>{t.type}</span><span>{ucfirst(customer.customer_type)}</span></div>
            </>
          )}
        </div>

        <div className={styles.dividerSolid} />
        <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '8px 0 5px 0', fontSize: 11 }}>{t.items}</div>

        <table>
          <thead>
            {isCompact ? (
              <tr>
                <th style={{ width: '50%' }}>{t.item}</th>
                <th style={{ width: '15%' }} className={styles.textCenter}>{t.quantity}</th>
                <th style={{ width: '20%' }} className={styles.textRight}>{t.price}</th>
                <th style={{ width: '20%' }} className={styles.textRight}>{t.total}</th>
              </tr>
            ) : (
              <tr>
                <th style={{ width: '40%' }}>{t.item}</th>
                <th style={{ width: '10%' }} className={styles.textCenter}>{t.quantity}</th>
                <th style={{ width: '10%' }} className={styles.textCenter}>{t.unit}</th>
                <th style={{ width: '18%' }} className={styles.textRight}>{t.price}</th>
                <th style={{ width: '15%' }} className={styles.textCenter}>{t.disc}</th>
                <th style={{ width: '15%' }} className={styles.textCenter}>{t.tax}</th>
                <th style={{ width: '17%' }} className={styles.textRight}>{t.total}</th>
              </tr>
            )}
          </thead>
          <tbody>
            {items.map((item, idx) => (
              isCompact ? (
                <Fragment key={item.id ?? idx}>
                  <tr>
                    <td style={{ fontWeight: 'bold' }}>{item.product_name}</td>
                    <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
                    <td className={styles.textRight}>{fmtPlain(item.price)}</td>
                    <td className={styles.textRight} style={{ fontWeight: 'bold' }}>{fmtPlain(item.total_after_tax)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px dashed #ddd' }}>
                    <td colSpan={4} style={{ fontSize: 10, padding: '0 0 3px 5px', color: '#000' }}>
                      {item.unit}
                      {item.discount_amount > 0 && (
                        <> | disc: {item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value)}</>
                      )}
                      {item.tax_amount > 0 && (
                        <> | tax: {item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value)}</>
                      )}
                    </td>
                  </tr>
                </Fragment>
              ) : (
                <tr key={item.id ?? idx} style={{ borderBottom: '1px dashed #ddd' }}>
                  <td>{item.product_name}</td>
                  <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
                  <td className={styles.textCenter}>{item.unit}</td>
                  <td className={styles.textRight}>{fmtPlain(item.price)}</td>
                  <td className={styles.textCenter}>
                    {item.discount_amount > 0
                      ? (item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value))
                      : '-'}
                  </td>
                  <td className={styles.textCenter}>
                    {item.tax_amount > 0
                      ? (item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value))
                      : '-'}
                  </td>
                  <td className={styles.textRight}>{fmtPlain(item.total_after_tax)}</td>
                </tr>
              )
            ))}
          </tbody>
        </table>

        <div className={styles.totalSection}>
          <div className={styles.totalRow}><span>{t.subtotal}:</span><span> {fmtRs(sale.subtotal)}</span></div>
          {sale.discount_amount > 0 && (
            <div className={styles.totalRow}>
              <span>{t.sale_discount} {sale.discount_type === 'percentage' ? `(${sale.discount}%)` : ''}</span>
              <span>-{fmtPlain(sale.discount_amount)}</span>
            </div>
          )}
          {sale.tax_amount > 0 && (
            <div className={styles.totalRow}>
              <span>{t.tax} {sale.tax_type === 'percentage' ? `(${sale.tax}%)` : ''}</span>
              <span>{fmtPlain(sale.tax_amount)}</span>
            </div>
          )}
        </div>

        <div className={styles.grandTotal}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t.grand_total}:</span><span> {fmtRs(sale.grand_total)}</span>
          </div>
        </div>

        {!receipt.is_quotation && (
          <>
            <div className={styles.dividerSolid} />
            <div style={{ textAlign: 'center', fontWeight: 'bold', margin: '8px 0', fontSize: 11 }}>{t.payment_details}</div>

            <div className={styles.row}><span className={styles.label}>{t.payment_type}</span><span>{ucfirst(sale.payment_type)}</span></div>
          </>
        )}

        {previous_balance > 0 && (
  <>
    <div className={styles.row}><span>{t.previous_balance}</span><span> {fmtRs(previous_balance)}</span></div>
    <div className={styles.row}><span>{t.current_sale}</span><span> {fmtRs(sale.grand_total)}</span></div>
    <div className={styles.divider} />
    <div className={styles.row} style={{ fontWeight: 'bold' }}>
      <span>{t.total_payable}</span><span> {fmtRs(total_payable)}</span>
    </div>
    {sale.received_amount > 0 && (
      <>
        <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
        <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}>
          <span>→ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span>
        </div>
        {oldBalancePayment > 0 && (
          <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}>
<span>→ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span>
          </div>
        )}
      </>
    )}
  </>
)}

{previous_balance <= 0 && sale.received_amount > 0 && (
  invoice_payment_breakdown && invoice_payment_breakdown.length > 0 ? (
    <>
      <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
      <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}>
        <span>→ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span>
      </div>
      {oldBalancePayment > 0 && (
        <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}>
          <span>→ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span>
        </div>
      )}
    </>
  ) : (
    <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
  )
)}

{showAdvanceBox && (
  <div className={styles.noticeBox}>
    <div style={{ fontWeight: 'bold', marginBottom: 3 }}>*** {t.advance_applied} ***</div>
    {advance_deposit_info?.total_deposited > 0 && (
      <div className={styles.row}><span>{t.total_advance_deposited}:</span><span> {fmtRs(advance_deposit_info.total_deposited)}</span></div>
    )}
    {advance_deposit_info?.used_for_current_sale > 0 && (
      <div className={styles.row}><span>{t.advance_used_current_sale}:</span><span> {fmtRs(advance_deposit_info.used_for_current_sale)}</span></div>
    )}
    {advance_deposit_info?.used_for_old_balance > 0 && (
      <>
        <div className={styles.row}><span>{t.advance_used_old_balance}:</span><span> {fmtRs(advance_deposit_info.used_for_old_balance)}</span></div>
        {advance_deposit_info.old_invoices_paid?.map((inv, i) => (
          <div key={i} className={styles.row} style={{ paddingLeft: 20, fontSize: 9, color: '#666' }}>
            <span>• {t.invoice} {inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
          </div>
        ))}
      </>
    )}
    {!advance_deposit_info && advance_used > 0 && (
      <div className={styles.row}><span>{t.advance_used}:</span><span> {fmtRs(advance_used)}</span></div>
    )}
    {advance_deposit_info ? (
      <div className={styles.row} style={{ fontWeight: 'bold' }}>
        <span>{t.remaining_advance}:</span><span> {fmtRs(advance_deposit_info.remaining)}</span>
      </div>
    ) : (customer?.advance_payment > 0 || advance_used > 0) && (
      <div className={styles.row}>
        <span>{t.remaining_advance}:</span><span> {fmtRs(customer?.advance_payment || 0)}</span>
      </div>
    )}
  </div>
)}

{!receipt.is_quotation && sale.status === 'paid' && (
  <>
    <div className={styles.row} style={{ fontWeight: 'bold' }}><span>{t.status}:</span><span>✓ {t.paid}</span></div>
    {sale.change_amount > 0 && (
      <div className={styles.row}><span>{t.change_amount}:</span><span> {fmtRs(sale.change_amount)}</span></div>
    )}
  </>
)}

        {sale.status === 'partial' && (
          <>
            <div className={styles.row} style={{ fontWeight: 'bold' }}><span>{t.status}:</span><span>{t.partial_payment}</span></div>
            {total_paid > 0 && (
              <div className={styles.row}><span>{t.already_paid}:</span><span> {fmtRs(total_paid)}</span></div>
            )}
            <div className={styles.row} style={{ fontWeight: 'bold' }}><span>{t.remaining_balance}:</span><span> {fmtRs(sale.remaining_balance)}</span></div>
            {sale.due_date && (
              <div className={styles.row}><span>{t.due_date}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
            )}
          </>
        )}

        {sale.status === 'unpaid' && (
          <div className={styles.noticeBox}>
            <div style={{ fontWeight: 'bold' }}>{t.credit_sale}</div>
            <div className={styles.row}><span>{t.amount_due}:</span><span> {fmtRs(sale.grand_total)}</span></div>
            {sale.due_date && (
              <div className={styles.row}><span>{t.due_date}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
            )}
          </div>
        )}

        {customer?.current_balance > 0 && (
          <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
            <span>{t.total_last_balance}:</span><span> {fmtRs(customer.current_balance)}</span>
          </div>
        )}

        {was_previous_balance_cleared && customer?.current_balance <= 0 && (
          <>
            <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
              <span>✓ {t.all_dues_cleared}</span>
            </div>
            <div className={styles.row}><span>{t.remaining_balance}</span><span>{fmtRs(0)}</span></div>
          </>
        )}

        <div style={{ marginTop: 15, fontSize: 10 }}>
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
  {receipt.is_quotation && (
    <p style={{ fontWeight: 'bold', color: '#c0392b', fontSize: 11, marginBottom: 6 }}>
      *** THIS IS A QUOTATION FOR PRICE ESTIMATION ONLY — NOT A VALID SALE RECEIPT ***
    </p>
  )}
  <p style={{ fontWeight: 'bold' }}>{t.thank_you}!</p>
  <p style={{ fontSize: 10, marginTop: 3 }}>Powered by ZeeroX POS{isCompact ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>
</div>
      </div>
)}

{design === 'design2' && (
  <div className={`${styles.design2} ${paperClass}`}>
<div className={styles.header}>
      <h1 style={{ fontSize: 20, marginBottom: 5, textTransform: 'capitalize' }}>{shop?.shop_name || 'Business/Shop Name'}</h1>
      <p style={{ fontSize: 10 }}>{shop?.address || ''}</p>
      <p style={{ fontSize: 10 }}>{shop?.phone || ''}</p>
    </div>

    <div className={styles.infoCard}>
    {!receipt.is_quotation && (
  <div className={styles.row}><span className={styles.label}>{t.voucher_no}</span><span style={{ fontWeight: 'bold' }}>{sale.voucher_no}</span></div>
)}
      <div className={styles.row}><span className={styles.label}>{t.date_time}</span><span>{formatDateTime(sale.sale_date)}</span></div>
      <div className={styles.row}><span className={styles.label}>{t.served_by}</span><span>{seller_name || 'N/A'}</span></div>
    </div>

    <div className={styles.infoCard}>
    {isWalkIn ? (
        <>
          <div className={styles.row}><span className={styles.label}>{t.customer_name}</span><span style={{ fontWeight: 'bold' }}>Walk-in Customer</span></div>
          {customer.contact && <div className={styles.row}><span className={styles.label}>{t.contact}</span><span>{customer.contact}</span></div>}
          {customer.city    && <div className={styles.row}><span className={styles.label}>{t.city}</span><span>{customer.city}</span></div>}
          <div className={styles.row}><span className={styles.label}>{t.type}</span><span>{ucfirst(sale.payment_type)}</span></div>
        </>
      ) : (
        <>
          <div className={styles.row}><span className={styles.label}>{t.customer_name}</span><span style={{ fontWeight: 'bold' }}>{customer.name}</span></div>
          {customer.contact   && <div className={styles.row}><span className={styles.label}>{t.contact}</span><span>{customer.contact}</span></div>}
          {customer.shop_name && <div className={styles.row}><span className={styles.label}>{t.shop_name}</span><span>{customer.shop_name}</span></div>}
          {customer.city      && <div className={styles.row}><span className={styles.label}>{t.city}</span><span>{customer.city}</span></div>}
          <div className={styles.row}><span className={styles.label}>{t.type}</span><span>{ucfirst(customer.customer_type)}</span></div>
        </>
      )}
    </div>

    <table>
      <thead>
        {isCompact ? (
          <tr>
            <th style={{ width: '50%' }}>{t.product}</th>
            <th style={{ width: '15%' }} className={styles.textCenter}>{t.quantity}</th>
            <th style={{ width: '20%' }} className={styles.textRight}>{t.price}</th>
            <th style={{ width: '20%' }} className={styles.textRight}>{t.total}</th>
          </tr>
        ) : (
          <tr>
            <th style={{ width: '40%' }}>{t.product}</th>
            <th style={{ width: '12%' }} className={styles.textCenter}>{t.quantity}</th>
            <th style={{ width: '12%' }} className={styles.textCenter}>{t.unit}</th>
            <th style={{ width: '18%' }} className={styles.textRight}>{t.price}</th>
            <th style={{ width: '12%' }} className={styles.textCenter}>{t.disc}</th>
            <th style={{ width: '12%' }} className={styles.textCenter}>{t.tax}</th>
            <th style={{ width: '18%' }} className={styles.textRight}>{t.total}</th>
          </tr>
        )}
      </thead>
      <tbody>
        {items.map((item, idx) => (
          isCompact ? (
            <Fragment key={item.id ?? idx}>
              <tr>
                <td style={{ fontWeight: 'bold' }}>{item.product_name}</td>
                <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
                <td className={styles.textRight}>{fmtPlain(item.price)}</td>
                <td className={styles.textRight} style={{ fontWeight: 'bold' }}>{fmtPlain(item.total_after_tax)}</td>
              </tr>
              <tr>
                <td colSpan={4} style={{ fontSize: 10, padding: '0 0 5px 5px', color: '#000', background: '#f8f9fa' }}>
                  {item.unit}
                  {item.discount_amount > 0 && (
                    <> | disc: {item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value)}</>
                  )}
                  {item.tax_amount > 0 && (
                    <> | tax: {item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value)}</>
                  )}
                </td>
              </tr>
            </Fragment>
          ) : (
            <tr key={item.id ?? idx}>
              <td>{item.product_name}</td>
              <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
              <td className={styles.textCenter}>{item.unit}</td>
              <td className={styles.textRight}>{fmtPlain(item.price)}</td>
              <td className={styles.textCenter}>
                {item.discount_amount > 0
                  ? (item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value))
                  : '-'}
              </td>
              <td className={styles.textCenter}>
                {item.tax_amount > 0
                  ? (item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value))
                  : '-'}
              </td>
              <td className={styles.textRight}>{fmtPlain(item.total_after_tax)}</td>
            </tr>
          )
        ))}
      </tbody>
    </table>

    <div className={styles.totalBox}>
      <div className={styles.totalRow}><span>{t.subtotal}:</span><span> {fmtRs(sale.subtotal)}</span></div>
      {sale.discount_amount > 0 && (
        <div className={styles.totalRow}>
          <span>{t.sale_discount} {sale.discount_type === 'percentage' ? `(${sale.discount}%)` : ''}:</span>
          <span>- {fmtRs(sale.discount_amount)}</span>
        </div>
      )}
      {sale.tax_amount > 0 && (
        <div className={styles.totalRow}>
          <span>{t.tax} {sale.tax_type === 'percentage' ? `(${sale.tax}%)` : ''}:</span>
          <span> {fmtRs(sale.tax_amount)}</span>
        </div>
      )}
<div className={styles.grandTotal} style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{t.grand_total}:</span><span> {fmtRs(sale.grand_total)}</span>
      </div>
    </div>

    <div>
    {!receipt.is_quotation && (
      <>
      <div style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 8 }}>{t.payment_information}</div>
      <div className={styles.row}><span className={styles.label}>{t.payment_method}</span><span style={{ fontWeight: 'bold' }}>{ucfirst(sale.payment_type)}</span></div>
      </>
    )}
      {previous_balance > 0 && (
        <>
          <div className={styles.row}><span>{t.previous_balance}</span><span> {fmtRs(previous_balance)}</span></div>
          <div className={styles.row}><span>{t.current_sale}</span><span> {fmtRs(sale.grand_total)}</span></div>
          <div className={styles.row} style={{ fontWeight: 'bold', padding: '5px 0', borderTop: '1px dashed #ccc', marginTop: 5 }}>
            <span>{t.total_payable}</span><span> {fmtRs(total_payable)}</span>
          </div>
          {sale.received_amount > 0 && (
            <>
              <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
              <div style={{ fontSize: 9, marginLeft: 10, marginTop: 3 }}>
                <div className={styles.row}><span>└ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span></div>
                {oldBalancePayment > 0 && (
                  <div className={styles.row}><span>└ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span></div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {previous_balance <= 0 && sale.received_amount > 0 && (
        invoice_payment_breakdown && invoice_payment_breakdown.length > 0 ? (
          <>
            <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
            <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}><span>→ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span></div>
            {oldBalancePayment > 0 && (
              <div className={styles.row} style={{ fontSize: 9, paddingLeft: 10 }}><span>→ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span></div>
            )}
          </>
        ) : (
          <div className={styles.row}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
        )
      )}

      {showAdvanceBox && (
        <div style={{ padding: 8, margin: '10px 0', borderRadius: 5 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 5, fontSize: 10 }}>⭐ {t.advance_payment_applied}</div>
          {advance_deposit_info?.total_deposited > 0 && (
            <div className={styles.row}><span>{t.total_advance_deposited}:</span><span> {fmtRs(advance_deposit_info.total_deposited)}</span></div>
          )}
          {advance_deposit_info?.used_for_current_sale > 0 && (
            <div className={styles.row}><span>{t.advance_used_current_sale}:</span><span> {fmtRs(advance_deposit_info.used_for_current_sale)}</span></div>
          )}
          {advance_deposit_info?.used_for_old_balance > 0 && (
            <>
              <div className={styles.row}><span>{t.advance_used_old_balance}:</span><span> {fmtRs(advance_deposit_info.used_for_old_balance)}</span></div>
              {advance_deposit_info.old_invoices_paid?.map((inv, i) => (
                <div key={i} className={styles.row} style={{ paddingLeft: 20, fontSize: 9, color: '#666' }}>
                  <span>• {t.invoice} {inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
                </div>
              ))}
            </>
          )}
          {!advance_deposit_info && advance_used > 0 && (
            <div className={styles.row}><span>{t.advance_used}:</span><span> {fmtRs(advance_used)}</span></div>
          )}
          {advance_deposit_info ? (
            <div className={styles.row} style={{ fontWeight: 'bold' }}><span>{t.remaining_advance}:</span><span> {fmtRs(advance_deposit_info.remaining)}</span></div>
          ) : (customer?.advance_payment > 0 || advance_used > 0) && (
            <div className={styles.row}><span>{t.remaining_advance}:</span><span> {fmtRs(customer?.advance_payment || 0)}</span></div>
          )}
        </div>
      )}

{!receipt.is_quotation && sale.status === 'paid' && (
  <>
    <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 8 }}><span>{t.status}:</span><span>✓ {t.paid}</span></div>
    {sale.change_amount > 0 && (
      <div className={styles.row}><span>{t.change_returned}:</span><span> {fmtRs(sale.change_amount)}</span></div>
    )}
  </>
)}
      {sale.status === 'partial' && (
        <>
          <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 8 }}><span>{t.status}:</span><span>{t.partial_payment}</span></div>
          {total_paid > 0 && (
            <div className={styles.row}><span>{t.amount_paid}:</span><span> {fmtRs(total_paid)}</span></div>
          )}
          <div className={styles.row} style={{ fontWeight: 'bold' }}><span>{t.balance_due}:</span><span> {fmtRs(sale.remaining_balance)}</span></div>
          {sale.due_date && (
            <div className={styles.row}><span>{t.due_date}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
          )}
        </>
      )}
      {sale.status === 'unpaid' && (
        <div style={{ padding: 10, margin: '10px 0', borderRadius: 5 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 5 }}>{t.credit_sale}</div>
          <div className={styles.row}><span>{t.amount_due}:</span><span style={{ fontWeight: 'bold' }}> {fmtRs(sale.grand_total)}</span></div>
          {sale.due_date && (
            <div className={styles.row}><span>{t.payment_due_by}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
          )}
        </div>
      )}

      {customer?.current_balance > 0 && (
        <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
          <span>{t.total_last_balance}:</span><span> {fmtRs(customer.current_balance)}</span>
        </div>
      )}
      {was_previous_balance_cleared && customer?.current_balance === 0 && (
        <>
          <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
            <span>{t.all_dues_cleared}</span>
          </div>
          <div className={styles.row}><span>{t.remaining_balance}</span><span>✓ {fmtRs(0)}</span></div>
        </>
      )}
    </div>

    {(receiptSettings?.show_signature || receiptSettings?.show_stamp) && (
      <div style={{ marginTop: 15, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        {receiptSettings?.show_signature && (
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ borderTop: '1px solid black', marginTop: 30, paddingTop: 5, fontSize: 9 }}> {t.signature}</div>
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
      {receipt.is_quotation && (
        <p style={{ fontWeight: 'bold', color: '#c0392b', fontSize: 11, marginBottom: 6 }}>
          *** THIS IS A QUOTATION FOR PRICE ESTIMATION ONLY — NOT A VALID SALE RECEIPT ***
        </p>
      )}
      <p style={{ fontSize: 11, fontWeight: 'bold' }}>{t.thank_you}</p>
      <p style={{ fontSize: 10, marginTop: 8, color: '#999' }}>Powered by ZeeroX POS{isCompact ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>
    </div>
  </div>
)}

{design === 'design3' && (
  <div className={`${styles.design3} ${paperClass}`}>
<div className={styles.header}>
      <h1 style={{ fontSize: 20, marginBottom: 5, textTransform: 'capitalize' }}>{shop?.shop_name || 'SHOP NAME'}</h1>
      <p style={{ fontSize: 9 }}>{shop?.address || ''}</p>
      <p style={{ fontSize: 9 }}>{shop?.phone || ''}</p>
    </div>

    <div className={styles.sectionTitle}>{t.invoice_details}</div>
    <div className={styles.infoGrid}>
    {!receipt.is_quotation && (
  <div className={styles.infoItem}><span className={styles.infoLabel}>{t.voucher_no}</span><span>{sale.voucher_no}</span></div>
)}
      <div className={styles.infoItem}><span className={styles.infoLabel}>{t.date}</span><span>{formatDateOnly(sale.sale_date)}</span></div>
      <div className={styles.infoItem}><span className={styles.infoLabel}>{t.time}</span><span>{formatDateTime(sale.sale_date).split(', ')[1]}</span></div>
      <div className={styles.infoItem}><span className={styles.infoLabel}>CASHIER:</span><span>{seller_name || 'N/A'}</span></div>
    </div>

    <div className={styles.sectionTitle}>{t.customer_information}</div>
    <div className={styles.infoGrid}>
    {isWalkIn ? (
        <>
          <div className={styles.infoItem}><span className={styles.infoLabel}>{t.customer_name}</span><span>WALK-IN CUSTOMER</span></div>
          {customer.contact && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.contact}</span><span>{customer.contact}</span></div>}
          {customer.city    && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.city}</span><span>{customer.city}</span></div>}
          <div className={styles.infoItem}><span className={styles.infoLabel}>{t.type}</span><span>{ucfirst(sale.payment_type).toUpperCase()}</span></div>
        </>
      ) : (
        <>
          <div className={styles.infoItem}><span className={styles.infoLabel}>{t.customer_name}</span><span>{customer.name}</span></div>
          {customer.contact   && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.contact}</span><span>{customer.contact}</span></div>}
          {customer.shop_name && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.shop_name}</span><span>{customer.shop_name}</span></div>}
          {customer.city      && <div className={styles.infoItem}><span className={styles.infoLabel}>{t.city}</span><span>{customer.city}</span></div>}
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t.type}</span>
            <span>{(customer.customer_type || '').toUpperCase()} <span className={styles.statusBadge}>{(customer.customer_type || '').toUpperCase()}</span></span>
          </div>
        </>
      )}
    </div>

    <div className={styles.sectionTitle}>{t.items_purchased}</div>
    <table>
      <thead>
        {isCompact ? (
          <tr>
            <th style={{ width: '50%' }}>{t.description}</th>
            <th style={{ width: '15%' }} className={styles.textCenter}>{t.quantity_full}</th>
            <th style={{ width: '20%' }} className={styles.textRight}>{t.rate}</th>
            <th style={{ width: '20%' }} className={styles.textRight}>{t.amount}</th>
          </tr>
        ) : (
          <tr>
            <th style={{ width: '40%' }}>{t.description}</th>
            <th style={{ width: '10%' }} className={styles.textCenter}>{t.quantity_full}</th>
            <th style={{ width: '10%' }} className={styles.textCenter}>{t.unit}</th>
            <th style={{ width: '18%' }} className={styles.textRight}>{t.rate}</th>
            <th style={{ width: '14%' }} className={styles.textCenter}>{t.disc}</th>
            <th style={{ width: '14%' }} className={styles.textCenter}>{t.tax}</th>
            <th style={{ width: '18%' }} className={styles.textRight}>{t.amount}</th>
          </tr>
        )}
      </thead>
      <tbody>
        {items.map((item, idx) => (
          isCompact ? (
            <Fragment key={item.id ?? idx}>
              <tr>
                <td style={{ fontWeight: 'bold' }}>{item.product_name}</td>
                <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
                <td className={styles.textRight}>{fmtPlain(item.price)}</td>
                <td className={styles.textRight} style={{ fontWeight: 'bold' }}>{fmtPlain(item.total_after_tax)}</td>
              </tr>
              <tr>
                <td colSpan={4} style={{ fontSize: 10, padding: '0 0 5px 5px', color: '#000' }}>
                  {t.unit}: {(item.unit || '').toUpperCase()}
                  {item.discount_amount > 0 && (
                    <> | {t.disc}: {item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value)}</>
                  )}
                  {item.tax_amount > 0 && (
                    <> | {t.tax}: {item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value)}</>
                  )}
                </td>
              </tr>
            </Fragment>
          ) : (
            <tr key={item.id ?? idx}>
              <td>{item.product_name}</td>
              <td className={styles.textCenter}>{item.type === 'service' ? '-' : item.quantity}</td>
              <td className={styles.textCenter}>{item.unit}</td>
              <td className={styles.textRight}>{fmtPlain(item.price)}</td>
              <td className={styles.textCenter}>
                {item.discount_amount > 0
                  ? (item.discount_type === 'percentage' ? `${item.discount_value}%` : fmtPlain(item.discount_value))
                  : '-'}
              </td>
              <td className={styles.textCenter}>
                {item.tax_amount > 0
                  ? (item.tax_type === 'percentage' ? `${item.tax_value}%` : fmtPlain(item.tax_value))
                  : '-'}
              </td>
              <td className={styles.textRight}>{fmtPlain(item.total_after_tax)}</td>
            </tr>
          )
        ))}
      </tbody>
    </table>

    <div className={styles.summaryBox}>
      <div className={styles.summaryRow}><span>{t.subtotal}:</span><span> {fmtRs(sale.subtotal)}</span></div>
      {sale.discount_amount > 0 && (
        <div className={styles.summaryRow}>
          <span>DISCOUNT {sale.discount_type === 'percentage' ? `(${sale.discount}%)` : ''}:</span>
          <span>- {fmtRs(sale.discount_amount)}</span>
        </div>
      )}
      {sale.tax_amount > 0 && (
        <div className={styles.summaryRow}>
          <span>{t.tax} {sale.tax_type === 'percentage' ? `(${sale.tax}%)` : ''}:</span>
          <span> {fmtRs(sale.tax_amount)}</span>
        </div>
      )}
<div className={`${styles.summaryRow} ${styles.totalRow}`} style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{t.grand_total}:</span><span> {fmtRs(sale.grand_total)}</span>
      </div>
    </div>

    <div className={styles.sectionTitle}>{t.payment_summary}</div>
    <div className={styles.paymentInfo}>
    {!receipt.is_quotation && (
      <div className={styles.summaryRow}><span style={{ fontWeight: 'bold' }}>PAYMENT METHOD:</span><span style={{ fontWeight: 'bold' }}>{ucfirst(sale.payment_type).toUpperCase()}</span></div>
    )}
      {previous_balance > 0 && (
        <>
          <div className={styles.summaryRow} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #ddd' }}>
            <span>{t.previous_balance}</span><span> {fmtRs(previous_balance)}</span>
          </div>
          <div className={styles.summaryRow}><span>{t.current_sale}</span><span> {fmtRs(sale.grand_total)}</span></div>
          <div className={styles.summaryRow} style={{ fontWeight: 'bold', marginTop: 5, paddingTop: 5, borderTop: '2px solid #000' }}>
            <span>{t.total_payable}</span><span> {fmtRs(total_payable)}</span>
          </div>
          {sale.received_amount > 0 && (
            <>
              <div className={styles.summaryRow}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
              <div style={{ fontSize: 9, marginLeft: 10, marginTop: 3 }}>
                <div className={styles.summaryRow}><span>└ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span></div>
                {oldBalancePayment > 0 && (
                  <div className={styles.summaryRow}><span>└ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span></div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {previous_balance <= 0 && sale.received_amount > 0 && (
        invoice_payment_breakdown && invoice_payment_breakdown.length > 0 ? (
          <>
            <div className={styles.summaryRow}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
            <div className={styles.summaryRow} style={{ fontSize: 9, paddingLeft: 10 }}><span>→ {t.applied_to_current_sale}:</span><span> {fmtRs(salePayment)}</span></div>
            {oldBalancePayment > 0 && (
              <div className={styles.summaryRow} style={{ fontSize: 9, paddingLeft: 10 }}><span>→ {t.applied_to_old_balance}:</span><span> {fmtRs(oldBalancePayment)}</span></div>
            )}
          </>
        ) : (
          <div className={styles.summaryRow}><span>{t.received_amount}</span><span> {fmtRs(sale.received_amount)}</span></div>
        )
      )}

      {showAdvanceBox && (
        <div style={{ border: '1px solid #000', padding: 8, margin: '10px 0' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 5, textAlign: 'center', fontSize: 9 }}>*** {t.advance_payment_applied} ***</div>
          {advance_deposit_info?.total_deposited > 0 && (
            <div className={styles.summaryRow}><span>{t.total_advance_deposited}:</span><span> {fmtRs(advance_deposit_info.total_deposited)}</span></div>
          )}
          {advance_deposit_info?.used_for_current_sale > 0 && (
            <div className={styles.summaryRow}><span>{t.advance_used_current_sale}:</span><span> {fmtRs(advance_deposit_info.used_for_current_sale)}</span></div>
          )}
          {advance_deposit_info?.used_for_old_balance > 0 && (
            <>
              <div className={styles.summaryRow}><span>{t.advance_used_old_balance}:</span><span> {fmtRs(advance_deposit_info.used_for_old_balance)}</span></div>
              {advance_deposit_info.old_invoices_paid?.map((inv, i) => (
                <div key={i} className={styles.summaryRow} style={{ paddingLeft: 20, fontSize: 9, color: '#666' }}>
                  <span>• {t.invoice} {inv.voucher_no}:</span><span> {fmtRs(inv.amount_paid)}</span>
                </div>
              ))}
            </>
          )}
          {!advance_deposit_info && advance_used > 0 && (
            <div className={styles.summaryRow}><span>{t.advance_deducted}:</span><span> {fmtRs(advance_used)}</span></div>
          )}
           {advance_deposit_info ? (
            <div className={styles.summaryRow} style={{ fontWeight: 'bold' }}><span>{t.remaining_advance}:</span><span> {fmtRs(advance_deposit_info.remaining)}</span></div>
          ) : (customer?.advance_payment > 0 || advance_used > 0) && (
            <div className={styles.summaryRow}><span>{t.remaining_advance}:</span><span> {fmtRs(customer?.advance_payment || 0)}</span></div>
          )}
        </div>
      )}

{!receipt.is_quotation && sale.status === 'paid' && (
  <>
    <div className={styles.summaryRow} style={{ fontWeight: 'bold', marginTop: 8 }}>
      <span>{t.status}:</span><span>{t.paid} <span className={styles.statusBadge}>✓</span></span>
    </div>
    {sale.change_amount > 0 && (
      <div className={styles.summaryRow}><span>{t.change_returned}:</span><span> {fmtRs(sale.change_amount)}</span></div>
    )}
  </>
)}
      {sale.status === 'partial' && (
        <>
          <div className={styles.summaryRow} style={{ fontWeight: 'bold', marginTop: 8 }}>
            <span>{t.status}:</span><span>{t.partial_payment} <span className={styles.statusBadge}>!</span></span>
          </div>
          {total_paid > 0 && (
            <div className={styles.summaryRow}><span>{t.paid_amount}:</span><span> {fmtRs(total_paid)}</span></div>
          )}
          <div className={styles.summaryRow} style={{ fontWeight: 'bold' }}><span>{t.remaining_balance}:</span><span> {fmtRs(sale.remaining_balance)}</span></div>
          {sale.due_date && (
            <div className={styles.summaryRow}><span>{t.due_date}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
          )}
        </>
      )}
      {sale.status === 'unpaid' && (
        <div style={{ border: '1px solid #000', padding: 10, margin: '10px 0', textAlign: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 5 }}>{t.credit_sale}</div>
          <div className={styles.summaryRow} style={{ fontWeight: 'bold' }}><span>{t.amount_due}:</span><span> {fmtRs(sale.grand_total)}</span></div>
          {sale.due_date && (
            <div className={styles.summaryRow} style={{ marginTop: 5 }}><span>{t.due_date}:</span><span>{formatDateOnly(sale.due_date)}</span></div>
          )}
        </div>
      )}

      {customer?.current_balance > 0 && (
        <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
          <span>{t.total_last_balance}:</span><span> {fmtRs(customer.current_balance)}</span>
        </div>
      )}
      {was_previous_balance_cleared && customer?.current_balance === 0 && (
        <>
          <div className={styles.row} style={{ fontWeight: 'bold', marginTop: 10, paddingTop: 10, borderTop: '2px solid #000', fontSize: 10 }}>
            <span>{t.all_dues_cleared}</span>
          </div>
          <div className={styles.row}><span>{t.remaining_balance}</span><span>✓ {fmtRs(0)}</span></div>
        </>
      )}
    </div>

    {(receiptSettings?.show_signature || receiptSettings?.show_stamp) && (
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {receiptSettings?.show_signature && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '2px solid #000', marginTop: 30, paddingTop: 5, fontSize: 9, fontWeight: 'bold' }}>{t.signature}</div>
          </div>
        )}
        {receiptSettings?.show_stamp && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '2px solid #000', marginTop: 30, paddingTop: 5, fontSize: 9, fontWeight: 'bold' }}>{t.authorized_stamp}</div>
          </div>
        )}
      </div>
    )}

<div className={styles.footer}>
      {receipt.is_quotation && (
        <p style={{ fontWeight: 'bold', color: '#c0392b', fontSize: 11, marginBottom: 6 }}>
          *** THIS IS A QUOTATION FOR PRICE ESTIMATION ONLY — NOT A VALID SALE RECEIPT ***
        </p>
      )}
      <p style={{ fontSize: 10, fontWeight: 'bold' }}>{t.thank_you}</p>
      <p style={{ fontSize: 10, marginTop: 8 }}>Powered by ZeeroX POS{isCompact ? <br /> : ' | '}Made by ZIT Solutions | Contact: +92 300 0000000</p>

    </div>
  </div>
)}

</div>
    </div>
  );
}


export default function ReceiptPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>}>
      <ReceiptContent />
    </Suspense>
  );
}