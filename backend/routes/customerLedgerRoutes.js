import pool from '../db.js';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCurrencySettings, formatPrice } from '../utils/currency.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// routes/ -> project root -> public (matches server.js: path.join(__dirname, 'public'))
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export default async function customerLedgerRoutes(fastify) {
  // Equivalent to Laravel downloadLedger($id)
  fastify.get('/api/customers/:id/ledger/download', async (req, reply) => {
    const { id } = req.params;

    // Customer
    const [customerRows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
    if (!customerRows.length) {
      return reply.code(404).send({ success: false, message: 'Customer not found' });
    }
    const customer = customerRows[0];

    // Shop (AdminSetting::first())
    const [shopRows] = await pool.query('SELECT * FROM admin_settings LIMIT 1');
    const shop = shopRows[0] || {};

    // Logo -> base64 data URI (Puppeteer setContent can't resolve /public/ relative paths)
    let logoDataUri = null;
    if (shop.logo) {
      try {
        const logoPath = path.join(PUBLIC_DIR, shop.logo);
        const buf = await fs.readFile(logoPath);
        const ext = path.extname(shop.logo).slice(1) || 'png';
        logoDataUri = `data:image/${ext};base64,${buf.toString('base64')}`;
      } catch (err) {
        req.log.warn(`Ledger PDF: could not read logo file "${shop.logo}": ${err.message}`);
      }
    }

    const currency = await getCurrencySettings();

    // salesData — mirrors the leftJoin query exactly
    const [salesData] = await pool.query(
      `SELECT
         sales.id as sale_id,
         sales.voucher_no,
         sales.payment_type,
         sales.grand_total,
         sales.received_amount,
         sales.remaining_balance,
         sales.sale_date,
         purchases.product_name,
         sale_items.quantity as original_quantity,
         sale_items.price,
         sale_items.total_after_discount,
         COALESCE(returned_qty.total_returned, 0) as returned_quantity
       FROM sales
       LEFT JOIN sale_items ON sales.id = sale_items.sale_id AND sale_items.deleted_at IS NULL
       LEFT JOIN purchases ON sale_items.purchase_id = purchases.id
       LEFT JOIN (
         SELECT sale_item_id, SUM(quantity_returned) as total_returned, SUM(amount_refunded) as total_refunded
         FROM sale_return_items
         GROUP BY sale_item_id
       ) as returned_qty ON sale_items.id = returned_qty.sale_item_id
             WHERE sales.customer_id = ? AND sales.deleted_at IS NULL
       ORDER BY sales.sale_date ASC, sales.id ASC`,
      [id]
    );

    // payments
    const [payments] = await pool.query(
      `SELECT payments.*, sales.voucher_no
       FROM payments
       JOIN sales ON payments.sale_id = sales.id
             WHERE sales.customer_id = ? AND sales.deleted_at IS NULL AND payments.deleted_at IS NULL
       ORDER BY payments.payment_date ASC`,
      [id]
    );

    const html = buildLedgerHtml({ customer, salesData, payments, shop, currency, logoDataUri });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename="account_ledger_${(customer.name || 'customer').replace(/[^a-z0-9]/gi, '_')}.pdf"`
      );
      return reply.send(pdfBuffer);
    } finally {
      await browser.close();
    }
  });
}

// ── Helpers (mirror Blade @php logic + window.formatPrice) ──────────

function formatDate(dateInput) {
  if (!dateInput) return 'N/A';
  const d = new Date(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(dateInput) {
  const d = new Date(dateInput);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const round2 = (n) => Math.round(n * 100) / 100;

// ── HTML builder ─────────────────────────────────────────────────────

function buildLedgerHtml({ customer, salesData, payments, shop, currency, logoDataUri }) {
  const fmt = (v) => formatPrice(v, currency);

  // Group item rows into invoices. A Map keeps the SQL date order —
  // a plain object would re-sort numeric sale ids and scramble the dates.
  const invoices = [];
  const invoiceById = new Map();
  for (const row of salesData) {
    let inv = invoiceById.get(row.sale_id);
    if (!inv) {
      inv = {
        voucher_no: row.voucher_no,
        payment_type: row.payment_type,
        sale_date: row.sale_date,
        grand_total: Number(row.grand_total) || 0,
        products: [],
        payments: [],
        paid: 0,
      };
      invoiceById.set(row.sale_id, inv);
      invoices.push(inv);
    }
    if (row.product_name) inv.products.push(row.product_name);
  }

  // Attach every payment to its own invoice
  for (const p of payments) {
    const inv = invoiceById.get(p.sale_id);
    if (!inv) continue;
    inv.payments.push(p);
    inv.paid += Number(p.amount) || 0;
  }

  let totalSales = 0;
  let totalPaid = 0;
  let totalDue = 0;

  // Period info (unchanged)
  let periodHtml = '';
  if (salesData.length > 0) {
    const times = salesData.map((s) => new Date(s.sale_date).getTime());
    const minDate = new Date(Math.min(...times));
    const maxDate = new Date(Math.max(...times));
    periodHtml = `<div class="period-info">PERIOD FROM ${formatDate(minDate)} TO ${formatDate(maxDate)}</div>`;
  }

  // ── One block per invoice: invoice line + its payment lines ──
  let blocksHtml = '';
  invoices.forEach((inv, index) => {
    const due = Math.max(0, round2(inv.grand_total - inv.paid));
    totalSales += inv.grand_total;
    totalPaid += inv.paid;
    totalDue += due;

    let itemsLabel = 'No items';
    if (inv.products.length === 1) itemsLabel = escapeHtml(inv.products[0]);
    else if (inv.products.length > 1) itemsLabel = `${escapeHtml(inv.products[0])} + ${inv.products.length - 1} more`;

    let tag = '<span class="tag">Paid</span>';
    if (due > 0) {
      tag = inv.paid > 0
        ? '<span class="tag tag-due">Partly Paid</span>'
        : '<span class="tag tag-due">Unpaid</span>';
    }

       // # cell spans the invoice line + all its payment lines so the block reads as one unit
       const blockRows = 1 + Math.max(inv.payments.length, 1);

       let rows = `
         <tr class="inv-row">
           <td class="c b num-cell" rowspan="${blockRows}">${index + 1}</td>
           <td>${formatDate(inv.sale_date)}<div class="sub">${formatTime(inv.sale_date)}</div></td>
           <td>
             <span class="inv-no">Invoice ${escapeHtml(inv.voucher_no)}</span>${tag}
             <div class="sub">${itemsLabel}</div>
           </td>
           <td class="c b">${capitalize(inv.payment_type)}</td>
           <td class="r b">${fmt(inv.grand_total)}</td>
           <td></td>
           <td></td>
         </tr>`;
   

    if (!inv.payments.length) {
      rows += `
             <tr class="pay-row">
          <td></td>
          <td class="pay-desc">No payment received yet</td>
          <td></td>
          <td></td>
          <td class="r">-</td>
          <td class="r due">${fmt(inv.grand_total)}</td>
        </tr>`;

    }

    let remaining = inv.grand_total;
    inv.payments.forEach((p, i) => {
      remaining = Math.max(0, round2(remaining - (Number(p.amount) || 0)));
      const label = inv.payments.length > 1 ? `Payment ${i + 1}` : 'Payment';
      const method = !p.method
        ? ''
        : p.method === 'advance'
          ? ' from advance balance'
          : ` by ${capitalize(String(p.method))}`;

      rows += `
              <tr class="pay-row">
          <td>${formatDate(p.payment_date)}<div class="sub">${formatTime(p.payment_date)}</div></td>
          <td class="pay-desc">${label} received${method}</td>
          <td></td>
          <td></td>
          <td class="r">${fmt(p.amount)}</td>
          <td class="r ${remaining > 0 ? 'due' : ''}">${fmt(remaining)}</td>
        </tr>`;
    });

    // Each invoice is its own <tbody> so a block never splits across pages
    blocksHtml += `<tbody class="inv-block">${rows}</tbody>`;
  });

  if (!invoices.length) {
    blocksHtml = `<tbody><tr><td colspan="7" class="c empty">No invoices found for this customer.</td></tr></tbody>`;
  } else {
    blocksHtml += `
      <tbody>
        <tr class="total-row">
          <td colspan="4" class="r">TOTAL</td>
          <td class="r">${fmt(totalSales)}</td>
          <td class="r">${fmt(totalPaid)}</td>
          <td class="r ${totalDue > 0 ? 'due' : ''}">${fmt(totalDue)}</td>
        </tr>
      </tbody>`;
  }

  const advanceBalance = Number(customer.advance_payment) > 0 ? Number(customer.advance_payment) : 0;
  const logoHtml = logoDataUri ? `<img src="${logoDataUri}" alt="Logo" class="company-logo">` : '';
  const now = new Date();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Account Ledger - ${escapeHtml(customer.name)}</title>
<style>${LEDGER_CSS}</style>
</head>
<body>
<div class="header">
  <table class="header-table">
    <tr>
      <td class="header-left">
        <div class="shop-details">
          <div class="shop-name" style="text-transform: capitalize;">${shop.shop_name || 'N/A'}</div>
          <div class="detail-line">${shop.address || 'N/A'}</div>
          <div class="detail-line">City: ${shop.city || 'N/A'}</div>
          <div class="detail-line">Phone: ${shop.phone || 'N/A'}</div>
        </div>
      </td>
      <td class="header-center">
        <h1>ACCOUNT LEDGER</h1>
        <div class="subheading">Customer Transaction Report</div>
      </td>
      <td class="header-right">${logoHtml}</td>
    </tr>
  </table>
</div>

<div class="account-details">
  <h3>Account Details</h3>
  <div class="details-grid">
    <div class="details-row">
      <div class="details-label">CUSTOMER NAME</div>
      <div class="details-value">${customer.name || 'Walk-in Customer'}</div>
      <div class="details-label">CONTACT</div>
      <div class="details-value">${customer.contact || 'N/A'}</div>
    </div>
    <div class="details-row">
      <div class="details-label">BUSINESS/SHOP NAME</div>
      <div class="details-value">${customer.shop_name || 'N/A'}</div>
      <div class="details-label">CITY</div>
      <div class="details-value">${customer.city || 'N/A'}</div>
    </div>
  </div>
</div>

${periodHtml}

<!-- Account summary -->
<div class="section-title">Account Summary</div>
<table class="summary">
  <tr>
    <td>
      <div class="s-label">Total Sales</div>
      <div class="s-value">${fmt(totalSales)}</div>
      <div class="s-sub">${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}</div>
    </td>
    <td>
      <div class="s-label">Total Paid</div>
      <div class="s-value">${fmt(totalPaid)}</div>
      <div class="s-sub">All payments received</div>
    </td>
    <td class="s-due">
      <div class="s-label">Balance Due</div>
      <div class="s-value ${totalDue > 0 ? 'due' : ''}">${fmt(totalDue)}</div>
      <div class="s-sub">${totalDue > 0 ? 'Amount still to be paid' : 'Nothing to pay'}</div>
    </td>
    <td>
      <div class="s-label">Advance Balance</div>
      <div class="s-value">${fmt(advanceBalance)}</div>
      <div class="s-sub">Available for future purchases</div>
    </td>
  </tr>
</table>

<!-- Transactions: each invoice with its own payments underneath -->
<div class="section-title">Transaction Details</div>
<p class="how-to">
  Each invoice is shown with the payments made against it listed underneath.
  <strong>Remaining</strong> shows how much of that invoice is still unpaid after each payment.
</p>
<table class="ledger">
  <thead>
    <tr>
      <th style="width: 5%;" class="c">#</th>
      <th style="width: 12%;">Date</th>
      <th style="width: 32%;">Details</th>
      <th style="width: 9%;" class="c">Type</th>
      <th style="width: 14%;" class="r">Sale Amount</th>
      <th style="width: 14%;" class="r">Paid</th>
      <th style="width: 14%;" class="r">Remaining</th>

    </tr>
  </thead>
  ${blocksHtml}
</table>

<div class="statement-note">
  This is a computer-generated statement. For any questions please contact
  <strong>${escapeHtml(shop.shop_name || 'the shop')}</strong>${shop.phone ? ` at <strong>${escapeHtml(shop.phone)}</strong>` : ''}.
</div>

<div class="generated-info">
  <div class="footer-company">Powered by ZIT Solutions - ZeeroX Software</div>
  <div>Generated on: ${formatDate(now)} ${formatTime(now)}</div>
</div>
</body>
</html>`;
}

const LEDGER_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 10px; padding: 15px; color: #000; }

/* ── Header / account details / period — unchanged ── */
.header { width: 100%; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #000; }
.header-table { width: 100%; border-collapse: collapse; }
.header-table td { vertical-align: top; padding: 5px; }
.header-left { width: 30%; text-align: left; }
.header-center { width: 40%; text-align: center; }
.header-right { width: 30%; text-align: right; }
.company-logo { max-width: 80px; max-height: 80px; object-fit: contain; }
.shop-details .shop-name { font-weight: bold; font-size: 11px; margin-bottom: 4px; }
.shop-details .detail-line { margin-bottom: 2px; color: #555; font-size: 9px; }
.header h1 { font-size: 20px; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; }
.header .subheading { font-size: 12px; color: #666; margin-top: 3px; }
.account-details { background: #f9f9f9; padding: 10px; margin-bottom: 15px; border: 1px solid #ddd; }
.account-details h3 { font-size: 11px; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.details-grid { display: table; width: 100%; }
.details-row { display: table-row; }
.details-label { display: table-cell; padding: 3px 5px; font-weight: bold; width: 20%; }
.details-value { display: table-cell; padding: 3px 5px; width: 30%; }
.period-info { text-align: center; font-size: 10px; font-weight: bold; margin-bottom: 15px; padding: 5px; background: #f0f0f0; border: 1px solid #ddd; }

/* ── Helpers ── */
.r { text-align: right; }
.c { text-align: center; }
.b { font-weight: bold; }
.sub { font-size: 8px; color: #666; margin-top: 2px; }
.empty { padding: 16px 6px !important; color: #666; font-style: italic; }
.due { color: #b00020 !important; font-weight: bold; }   /* only colour: money still owed */

.section-title {
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 16px 0 6px;
  padding-bottom: 4px;
  border-bottom: 1.5px solid #000;
}

/* ── Summary ── */
.summary { width: 100%; border-collapse: collapse; border: 1px solid #000; }
.summary td { width: 25%; padding: 9px 12px; border-left: 1px solid #ccc; vertical-align: top; }
.summary td:first-child { border-left: none; }
.s-label { font-size: 8px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
.s-value { font-size: 14px; font-weight: bold; margin-top: 4px; }
.s-sub { font-size: 8px; color: #777; margin-top: 2px; }
.s-due { background: #f2f2f2; }
.s-due .s-value { font-size: 16px; }

/* ── Transactions table ── */
.how-to { font-size: 8.5px; color: #555; margin-bottom: 6px; line-height: 1.4; }

.ledger { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
.ledger thead { display: table-header-group; }   /* repeat header on every page */
.ledger th {
  padding: 7px 6px;
  font-size: 8.5px;
  font-weight: bold;
  text-transform: uppercase;
  text-align: left;
  background: #e6e6e6;
  border: 1px solid #000;
  border-bottom: 1.5px solid #000;
}
.ledger th.r { text-align: right; }
.ledger th.c { text-align: center; }

/* thin grid on every cell so columns are clearly separated */
.ledger td {
  padding: 5px 6px;
  font-size: 9px;
  vertical-align: middle;
  border: 1px solid #bdbdbd;
}

.inv-block { page-break-inside: avoid; }

/* sale line — grey + bold, thick line on top separates one invoice from the next */
.inv-row td {
  background: #f2f2f2;
  padding-top: 7px;
  padding-bottom: 7px;
  border-top: 1.5px solid #000;
}
.inv-no { font-weight: bold; font-size: 9.5px; }

/* merged # cell for the whole block */
.num-cell {
  background: #fff !important;
  font-size: 10px;
  vertical-align: middle !important;
  border-top: 1.5px solid #000 !important;
}

/* payment lines — white, indented with an arrow */
.pay-row td { background: #fff; color: #333; }
.pay-desc { position: relative; padding-left: 20px !important; }
.pay-desc::before { content: '\\21B3'; position: absolute; left: 7px; color: #777; }

/* status tag */
.tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  font-size: 7.5px;
  font-weight: bold;
  text-transform: uppercase;
  border: 1px solid #000;
  border-radius: 2px;
  vertical-align: 1px;
}
.tag-due { color: #b00020; border-color: #b00020; }


/* grand total */
.total-row td {
  padding: 8px 6px;
  font-size: 10px;
  font-weight: bold;
  background: #f2f2f2;
  border-top: 2px solid #000;
  border-bottom: 2px solid #000;
}

/* ── Footer ── */
.statement-note { margin-top: 18px; font-size: 8.5px; color: #555; text-align: center; }
.generated-info { margin-top: 10px; text-align: center; font-size: 9px; color: #555; }
.footer-company { font-weight: bold; color: #000; }
`;
