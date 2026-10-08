import db from '../db.js';
import { logActivity, describeChanges, describeItemChanges, valuesEqual, formatValue } from '../helpers/activityLogger.js';
/* ============================================================
   Shared with salesReport.js — same accounting logic:
   revenue = item's total_after_discount minus its proportional
   share of the sale-level discount; cost = purchased_price * qty.
   Deliberately does NOT touch sale_returns / sale_return_items.
   ============================================================ */
const DISCOUNT_ALLOC_JOIN = `
  INNER JOIN (
    SELECT sale_id, SUM(total_after_discount) AS items_sum
    FROM sale_items
    GROUP BY sale_id
  ) sis ON sis.sale_id = si.sale_id
`;
const REVENUE_EXPR = `(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END))`;
const COST_EXPR = `(si.purchased_price * si.quantity)`;

export default async function salesRoutes(fastify) {

  // ── Next voucher number ──────────────────────────────
  async function getNextVoucherNo(conn) {
    const d = new Date();
    const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;    
    await conn.execute(
      `INSERT INTO invoice_counters (\`date\`, last_number)
       VALUES (?, 1)
       ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
      [today]
    );
    const [[row]] = await conn.execute(
      'SELECT last_number FROM invoice_counters WHERE `date` = ?',
      [today]
    );
    return `INV-${today}-${row.last_number}`;
  }

  // ── Generate unique payment token ────────────────────
  function generateTransactionToken() {
    return `tkn_${Date.now()}${Math.floor(Math.random() * 10000)}`;
  }

  // ── Find customer by contact (update it), else create new ──
  async function resolveCustomer(conn, body, paymentType) {
    let customer = null;

    if (body.contact) {
      const [[existing]] = await conn.execute(
        'SELECT * FROM customers WHERE contact = ? AND deleted_at IS NULL LIMIT 1',
        [body.contact]
      );
      if (existing) {
        await conn.execute(
          `UPDATE customers
           SET name = ?, shop_name = ?, city = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            body.customer_name || existing.name,
            body.shop_name     || existing.shop_name,
            body.city          || existing.city,
            existing.id,
          ]
        );
        const [[refreshed]] = await conn.execute('SELECT * FROM customers WHERE id = ?', [existing.id]);
        customer = refreshed;
      }
    }

    if (!customer) {
      const custName = body.customer_name || 'Walk-in Customer';
      const [result] = await conn.execute(
        `INSERT INTO customers (name, shop_name, customer_type, city, contact, current_balance, advance_payment)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [custName, body.shop_name || null, paymentType, body.city || null, body.contact || null]
      );
      const [[newCust]] = await conn.execute('SELECT * FROM customers WHERE id = ?', [result.insertId]);
      customer = newCust;
    }

    return customer;
  }

    // ── Store sale items + update stock ─────────────────
    async function storeSaleItems(conn, saleId, items) {
      const receiptItems = [];
      for (const item of items) {
       const [[purchase]] = await conn.execute(
          'SELECT * FROM purchases WHERE id = ? LIMIT 1',
          [item.purchase_id]
        );
        if (!purchase) throw new Error(`Product not found: ${item.purchase_id}`);
      const qty   = parseFloat(item.quantity);
      const price = parseFloat(item.price);
      const total = qty * price;

      // If sold price differs from current purchase price, shift old price to previous_sold_price
      const currentSoldPrice = parseFloat(purchase.sold_price);
      if (!purchase.fix_sold_price && currentSoldPrice !== price) {
        await conn.execute(
          'UPDATE purchases SET previous_sold_price = ?, sold_price = ?, updated_at = NOW() WHERE id = ?',
          [currentSoldPrice, price, item.purchase_id]
        );
      }

      const discType = item.discount_type  || 'amount';
      const discVal  = parseFloat(item.discount_value) || 0;
      const discAmt  = discType === 'percentage' ? (total * discVal / 100) : discVal;
      const afterDisc = total - discAmt;

      const taxType = item.tax_type  || 'amount';
      const taxVal  = parseFloat(item.tax_value) || 0;
      const taxAmt  = taxType === 'percentage' ? (afterDisc * taxVal / 100) : taxVal;
      const afterTax = afterDisc + taxAmt;

      await conn.execute(
        'UPDATE purchases SET sold_quantity = sold_quantity + ?, updated_at = NOW() WHERE id = ?',
        [qty, item.purchase_id]
      );

      await conn.execute(
        `INSERT INTO sale_items
           (sale_id, purchase_id, quantity, price, purchased_price,
            discount_type, discount_value, discount_amount,
            tax_type, tax_value, tax_amount,
            total, total_after_discount, total_after_tax)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, item.purchase_id, qty, price, parseFloat(purchase.purchased_price) || 0,
          discType, discVal, discAmt,
          taxType, taxVal, taxAmt,
          total, afterDisc, afterTax,
        ]
      );

      receiptItems.push({
        product_name: purchase.product_name,
        unit: purchase.unit,
        type: purchase.type,
        quantity: qty,
        price,
        discount_type: discType,
        discount_value: discVal,
        discount_amount: discAmt,
        tax_type: taxType,
        tax_value: taxVal,
        tax_amount: taxAmt,
        total,
        total_after_discount: afterDisc,
        total_after_tax: afterTax,
      });
    }
    return receiptItems;
  }

  // ════════════════════════════════════════════════════
  //  GET /api/sales/next-voucher-no
  // ════════════════════════════════════════════════════
  fastify.get('/api/sales/next-voucher-no', async (req, reply) => {
    const conn = await db.getConnection();
    try {
      const d = new Date();
      const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;      
      const [[row]] = await conn.execute(
        'SELECT last_number FROM invoice_counters WHERE `date` = ?',
        [today]
      );
      const next = (row?.last_number || 0) + 1;
      return reply.send({ voucher_no: `INV-${today}-${next}` });
    } finally {
      conn.release();
    }
  });

  // ════════════════════════════════════════════════════
  //  POST /api/sales/store
  // ════════════════════════════════════════════════════
  fastify.post('/api/sales/store', async (req, reply) => {
    const body         = req.body;
    const sellerId     = req.session?.userId || req.user?.id;
    const paymentType  = body.payment_type;
    const customerType = body.customer_type;
    const grandTotal   = parseFloat(body.grand_total   || 0);
    const receivedAmt  = parseFloat(body.received_amount || 0);
    const saleDate     = body.sale_date ? new Date(body.sale_date) : new Date();
    const items        = body.items || [];

    if (!['cash', 'card', 'credit', 'advance'].includes(paymentType)) {
      return reply.status(422).send({ success: false, message: 'Invalid payment type.' });
    }

    const bankAccountId = body.bank_account_id || null;
    if (paymentType === 'card' && !bankAccountId) {
      return reply.status(422).send({ success: false, message: 'Please select a bank account for this card payment.' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // ──────────────────────────────────────────────
      // SCENARIO 3 — ADVANCE DEPOSIT (no items)
      // ──────────────────────────────────────────────
      if (paymentType === 'advance' && items.length === 0) {
        // advance_payment = first-time advance (customer had 0 before)
        // add_more_advance = topping up an existing advance
        // Both add to the balance the same way, so combine them.
        const addAmount    = parseFloat(body.advance_payment || 0) + parseFloat(body.add_more_advance || 0);
        const returnAmount = parseFloat(body.return_advance || 0);

        if (!body.customer_name || !body.contact) {
          await conn.rollback();
          return reply.status(422).send({ success: false, message: 'Customer name and contact are required for advance.' });
        }
        if (addAmount <= 0 && returnAmount <= 0) {
          await conn.rollback();
          return reply.status(422).send({ success: false, message: 'Please enter an amount.' });
        }

        // Find existing customer by contact (update it) or create new
        const customer = await resolveCustomer(conn, body, 'advance');

        const messages = [];
        const oldInvoicesPaid = [];
        let totalAppliedToOldDues = 0;
        let leftoverAfterDues = addAmount;
        let depositToken = null;

        // ── Money coming in first settles the customer's OLD outstanding
        //    credit sales (oldest first), same transaction_group_id.
        //    Whatever's left over becomes new/added advance. ──
        if (addAmount > 0) {
          depositToken = generateTransactionToken();

          const [oldUnpaidSales] = await conn.execute(
            `SELECT * FROM sales
             WHERE customer_id = ? AND payment_type = 'credit'
               AND status IN ('unpaid','partial') AND deleted_at IS NULL
             ORDER BY sale_date ASC, id ASC
             FOR UPDATE`,
            [customer.id]
          );

          if (oldUnpaidSales.length > 0) {
            let pool = addAmount;

            for (const oldSale of oldUnpaidSales) {
              if (pool <= 0) break;

              const owed = parseFloat(oldSale.remaining_balance);
              const pay  = Math.min(owed, pool);
              const previousPool = pool;
              pool -= pay;

              const newReceived    = parseFloat(oldSale.received_amount) + pay;
              const newRemaining   = owed - pay;
              const newStatus      = newRemaining <= 0 ? 'paid' : 'partial';
              const newPaymentType = newStatus === 'paid' ? 'advance' : oldSale.payment_type;

              await conn.execute(
                `UPDATE sales
                 SET received_amount = ?, remaining_balance = ?, status = ?, payment_type = ?, updated_at = NOW()
                 WHERE id = ?`,
                [newReceived, newRemaining, newStatus, newPaymentType, oldSale.id]
              );

              await conn.execute(
                `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
                 VALUES (?, ?, 'advance', ?, ?)`,
                [oldSale.id, pay, saleDate, depositToken]
              );

              await conn.execute(
                `INSERT INTO customer_advance_logs
                   (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
                 VALUES (?, ?, ?, ?, ?, 0)`,
                [customer.id, oldSale.id, previousPool, pay, pool]
              );

              totalAppliedToOldDues += pay;
              oldInvoicesPaid.push({ voucher_no: oldSale.voucher_no, amount_paid: pay });
            }

            leftoverAfterDues = pool;

            if (totalAppliedToOldDues > 0) {
              messages.push(`Rs ${totalAppliedToOldDues.toFixed(2)} applied to old credit balance`);
            }
          }

          // ── Permanently record the exact deposited amount for this
          // event. This is the ONLY correct source for reprints later —
          // part of this money may have become new advance balance and
          // never touched any `payments` row at all. ──
          await conn.execute(
            `INSERT INTO advance_deposits (transaction_group_id, customer_id, amount_deposited)
             VALUES (?, ?, ?)`,
            [depositToken, customer.id, addAmount]
          );
        }

        const previousAdvanceBalance = parseFloat(customer.advance_payment || 0);
        const previousCreditBalance  = parseFloat(customer.current_balance  || 0);
        let runningBalance = previousAdvanceBalance;

        // ── Whatever's left after clearing old dues becomes new/added advance ──
        if (leftoverAfterDues > 0) {
          const previousBalance = runningBalance;
          runningBalance += leftoverAfterDues;

          await conn.execute(
            `INSERT INTO customer_advance_logs
               (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
             VALUES (?, NULL, ?, 0, ?, 1)`,
            [customer.id, previousBalance, runningBalance]
          );

          messages.push(`Advance of Rs ${leftoverAfterDues.toFixed(2)} added`);
        }

        // ── Return advance ──
        if (returnAmount > 0) {
          if (returnAmount > runningBalance) {
            await conn.rollback();
            return reply.status(422).send({ success: false, message: 'Return amount exceeds available advance balance.' });
          }

          const previousBalance = runningBalance;
          runningBalance -= returnAmount;

          await conn.execute(
            `INSERT INTO customer_advance_logs
               (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
             VALUES (?, NULL, ?, 0, ?, 0)`,
            [customer.id, previousBalance, runningBalance]
          );

          messages.push(`Rs ${returnAmount.toFixed(2)} returned`);
        }

        await conn.execute(
          `UPDATE customers
           SET advance_payment = ?, current_balance = current_balance - ?, customer_type = 'advance', updated_at = NOW()
           WHERE id = ?`,
          [runningBalance, totalAppliedToOldDues, customer.id]
        );

        // ── Work out which of the 7 receipt scenarios this is ──
        let transactionType = 'advance_only';
        let advanceSubType  = null;
        const paymentDataExtra = {};

        if (addAmount <= 0 && returnAmount > 0) {
          // Scenario 5 — return advance
          if (runningBalance <= 0) {
            transactionType = 'advance_return'; // full return
            paymentDataExtra.previous_advance = previousAdvanceBalance;
          } else {
            advanceSubType = 'partial_return';
            paymentDataExtra.previous_advance  = previousAdvanceBalance;
            paymentDataExtra.returned_amount   = returnAmount;
            paymentDataExtra.remaining_advance = runningBalance;
          }
        } else if (addAmount > 0) {
          if (totalAppliedToOldDues > 0) {
            // Scenarios 6 & 7 — old dues settled first, then advance
            advanceSubType = 'offset';
            paymentDataExtra.advance_amount = addAmount;
            paymentDataExtra.advance_usage_breakdown = {
              used_for_old_balance: totalAppliedToOldDues,
              old_invoices_paid:    oldInvoicesPaid,
              remaining:            runningBalance,
            };
            paymentDataExtra.remaining_balance = Math.max(0, previousCreditBalance - totalAppliedToOldDues);
          } else if (previousAdvanceBalance > 0) {
            // Scenario 4 — add more advance
            advanceSubType = 'add';
            paymentDataExtra.previous_advance = previousAdvanceBalance;
            paymentDataExtra.advance_amount   = leftoverAfterDues;
          } else {
            // Scenario 3 — simple first-time advance
            paymentDataExtra.advance_amount = leftoverAfterDues;
          }
        }

        const [[shopInfoAdv]]      = await conn.execute('SELECT shop_name, address, phone FROM admin_settings LIMIT 1');
        const [[sellerRowAdv]]     = await conn.execute('SELECT name FROM users WHERE id = ?', [sellerId]);
        const [[finalCustomerAdv]] = await conn.execute('SELECT * FROM customers WHERE id = ?', [customer.id]);
        const [[receiptSettingsAdv]] = await conn.execute('SELECT * FROM receipt_settings WHERE id = 1');

        await conn.commit();
        return reply.send({
          success: true,
          type: 'advance_only',
          message: `${messages.join(', ')} successfully.`,
          receipt: {
            shop: shopInfoAdv || {},
            seller_name: sellerRowAdv?.name || 'N/A',
            transactionType,
            receipt_customer_type: 'advance',
            paymentData: {
              payment_date:      saleDate,
              user:              { name: sellerRowAdv?.name || 'N/A' },
              payment_type:      body.payment_type || 'cash',
              advance_sub_type:  advanceSubType,
              ...paymentDataExtra,
            },
            customer: {
              id:              customer.id,
              name:            finalCustomerAdv.name,
              contact:         body.contact   || finalCustomerAdv.contact,
              shop_name:       body.shop_name || finalCustomerAdv.shop_name,
              city:            body.city      || finalCustomerAdv.city,
              advance_payment: parseFloat(finalCustomerAdv.advance_payment),
            },
            receiptSettings: {
              paper_size:        receiptSettingsAdv?.paper_size || '80mm',
              design_type:       receiptSettingsAdv?.design_type || 'design1',
              language:          receiptSettingsAdv?.language || 'en',
              show_signature:    !!receiptSettingsAdv?.show_signature,
              show_stamp:        !!receiptSettingsAdv?.show_stamp,
              show_paid_overlay: !!receiptSettingsAdv?.show_paid_overlay,
            },
          },
        });
      }

      // ──────────────────────────────────────────────
      // SCENARIOS 1 & 2 — SALE WITH ITEMS
      // ──────────────────────────────────────────────
      if (items.length === 0) {
        await conn.rollback();
        return reply.status(422).send({ success: false, message: 'No items provided.' });
      }

      // Credit requires name + contact
      if (paymentType === 'credit' && (!body.customer_name || !body.contact)) {
        await conn.rollback();
        return reply.status(422).send({ success: false, message: 'Customer name and contact are required for credit sales.' });
      }

      // ── Resolve customer (update existing by contact, or create new) ──
      const customer = await resolveCustomer(conn, body, paymentType);

    // ── Advance sale validation (payment type advance + items in cart) ──
      // The customer must fund this sale — plus any old outstanding credit
      // balance — from a fresh advance deposit; leftover becomes their new
      // advance balance.
      if (paymentType === 'advance') {
        const advancePaymentEntered = parseFloat(body.advance_payment || 0);
        if (advancePaymentEntered <= 0) {
          await conn.rollback();
          return reply.status(422).send({ success: false, message: 'Advance payment is required to store this sale.' });
        }
        const custAdvanceAvailable = parseFloat(customer.advance_payment || 0);
        const custCreditBalance    = parseFloat(customer.current_balance || 0);
        const obligation = grandTotal + custCreditBalance;
        if (custAdvanceAvailable + advancePaymentEntered <= obligation) {
          await conn.rollback();
          return reply.status(422).send({ success: false, message: 'Advance payment must be greater than the grand total plus any outstanding credit balance.' });
        }
      }

      // ── Voucher + totals ──
      const voucherNo   = await getNextVoucherNo(conn);
      const subtotal    = parseFloat(body.subtotal || 0);
      const discType    = body.discount_type || 'amount';
      const discVal     = parseFloat(body.discount || 0);
      const discAmt     = discType === 'percentage' ? (subtotal * discVal / 100) : discVal;
      const afterDisc   = subtotal - discAmt;
      const taxType     = body.tax_type || 'amount';
      const taxVal      = parseFloat(body.tax || 0);
      const taxAmt      = taxType === 'percentage' ? (afterDisc * taxVal / 100) : taxVal;
      const changeAmt   = parseFloat(body.change_amount || 0);

   // ── Payment logic per type ──
   let saleStatus       = 'paid';
   let remainingBalance = 0;
   let finalPaymentType = paymentType;
   let currentSaleApplied = grandTotal; // how much of received_amount belongs to THIS sale
   let advanceUsedForCredit = 0; // advance automatically applied to a credit sale, if customer has advance balance

   // SCENARIO 1 — Cash / Card
   if (paymentType === 'cash' || paymentType === 'card') {
     saleStatus       = 'paid';
     remainingBalance = 0;
     finalPaymentType = paymentType;
     currentSaleApplied = grandTotal;
   }

// SCENARIO 2 — Credit
if (paymentType === 'credit') {
  // If the customer already has an advance balance, it's automatically
  // applied to this credit sale first (capped at the grand total).
  const custAdvanceAvailable = parseFloat(customer.advance_payment || 0);
  advanceUsedForCredit = Math.min(custAdvanceAvailable, grandTotal);

  // Total money covering this sale = advance used + whatever was typed
  // into Received Amount (uncapped — overpayment becomes change, handled by the frontend).
  const totalApplied = advanceUsedForCredit + receivedAmt;

  if (totalApplied <= 0) {
    // Full credit — no payment at all
    saleStatus       = 'unpaid';
    remainingBalance = grandTotal;
    currentSaleApplied = 0;
  } else if (totalApplied < grandTotal) {
    // Partial — advance and/or received amount cover part of it
    saleStatus       = 'partial';
    remainingBalance = grandTotal - totalApplied;
    currentSaleApplied = totalApplied;
  } else {
    // Fully paid via advance + received amount
    saleStatus       = 'paid';
    remainingBalance = 0;
    currentSaleApplied = totalApplied;
  }

  // Regardless of what the shopkeeper picked on the UI,
  // a sale that ends up fully paid can never stay labeled 'credit'.
  if (saleStatus === 'paid') {
    finalPaymentType = advanceUsedForCredit > 0 ? 'advance' : 'cash';
  }
}

   // Anything received beyond what THIS sale needed carries forward
   // to settle the customer's OLDER outstanding credit sales (oldest first).
   // Skipped when advance was used on this sale — that money stays scoped to this sale only.
   let leftoverForOldDues = advanceUsedForCredit > 0
     ? 0
     : Math.max(0, receivedAmt - currentSaleApplied);

   // What actually gets stored in sales.received_amount for THIS sale.
   // Cash/card: store exactly what the cashier typed, or grand_total if the
   // field was left blank. currentSaleApplied stays grandTotal above for the
   // old-dues waterfall calc — unaffected. Credit/advance keep their existing
   // currentSaleApplied logic (partial payments, advance funding) unchanged.
   let receivedAmountToStore = currentSaleApplied;
   if (paymentType === 'cash' || paymentType === 'card') {
     receivedAmountToStore = receivedAmt > 0 ? receivedAmt : grandTotal;
   }


         // ── Insert sale ──
         const dueDate = (paymentType === 'credit' && body.due_date) ? new Date(body.due_date) : null;

         const previousBalanceAtSale = parseFloat(customer.current_balance || 0);
   
         const [[sellerInfoForInsert]] = await conn.execute('SELECT name FROM users WHERE id = ?', [sellerId]);
         const sellerNameForInsert = sellerInfoForInsert?.name || null;
   
         const [saleResult] = await conn.execute(
           `INSERT INTO sales
              (voucher_no, sale_date, customer_id, seller_id, seller_name, payment_type,
               subtotal, discount_type, discount, discount_amount,
               tax_type, tax, tax_amount,
               grand_total, received_amount, change_amount,
               remaining_balance, previous_balance_snapshot,
               due_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
             voucherNo, saleDate, customer.id, sellerId, sellerNameForInsert, finalPaymentType,
             subtotal, discType, discVal, discAmt,
             taxType, taxVal, taxAmt,
             grandTotal, receivedAmountToStore, changeAmt,
             remainingBalance, previousBalanceAtSale,
             dueDate, saleStatus,
           ]
         );
         const saleId = saleResult.insertId;

// ── Sale items + stock ──
const receiptItems = await storeSaleItems(conn, saleId, items);

// Shared payment token — old credit dues settled by an advance deposit,
// the sale itself, and any cash/card advance-deduction rows below all
// belong to the same transaction.
const paymentToken = generateTransactionToken();

// ── Advance deposit used for this sale (payment type advance + items) ──
// If the customer also has old outstanding credit sales, the incoming
// advance money settles those first (oldest first), then funds this sale,
// and only what's left becomes the customer's new advance balance.
let advanceFundedThisSale = false;
let advanceDepositInfo = null;
if (paymentType === 'advance') {
  const advancePaymentEntered = parseFloat(body.advance_payment || 0);
  let pool = parseFloat(customer.advance_payment || 0) + advancePaymentEntered;
  let totalAppliedToOldCreditDues = 0;
  let usedForThisSale = 0;
  const oldInvoicesPaid = [];

  const [oldUnpaidSales] = await conn.execute(
    `SELECT * FROM sales
     WHERE customer_id = ? AND id != ? AND payment_type = 'credit'
       AND status IN ('unpaid','partial') AND deleted_at IS NULL
     ORDER BY sale_date ASC, id ASC
     FOR UPDATE`,
    [customer.id, saleId]
  );

  for (const oldSale of oldUnpaidSales) {
    if (pool <= 0) break;

    const owed = parseFloat(oldSale.remaining_balance);
    const pay  = Math.min(owed, pool);
    const previousPool = pool;
    pool -= pay;

    const newReceived  = parseFloat(oldSale.received_amount) + pay;
    const newRemaining = owed - pay;
    const newStatus    = newRemaining <= 0 ? 'paid' : 'partial';

    await conn.execute(
      `UPDATE sales
       SET received_amount = ?, remaining_balance = ?, status = ?, payment_type = 'advance', updated_at = NOW()
       WHERE id = ?`,
      [newReceived, newRemaining, newStatus, oldSale.id]
    );

    await conn.execute(
      `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
       VALUES (?, ?, 'advance', ?, ?)`,
      [oldSale.id, pay, saleDate, paymentToken]
    );

    await conn.execute(
      `INSERT INTO customer_advance_logs
         (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [customer.id, oldSale.id, previousPool, pay, pool]
    );

    totalAppliedToOldCreditDues += pay;
    oldInvoicesPaid.push({ voucher_no: oldSale.voucher_no, amount_paid: pay });
  }
  
    // ── Fund THIS sale from whatever's left in the pool ──
    if (pool > 0) {
      const previousPool = pool;
      usedForThisSale = Math.min(pool, grandTotal);
      pool -= usedForThisSale;

    // The sale itself is always funded via the customer's advance —
    // method 'advance' regardless of whether old credit dues were also
    // settled from the same deposit above.
    await conn.execute(
      `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
       VALUES (?, ?, 'advance', ?, ?)`,
      [saleId, usedForThisSale, saleDate, paymentToken]
    );

    await conn.execute(
      `INSERT INTO customer_advance_logs
         (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [customer.id, saleId, previousPool, usedForThisSale, pool]
    );

    advanceFundedThisSale = true;
  }

   // Whatever's left after settling old dues and this sale is the new
  // advance balance — already reflected as `pool` in the last log row above.
  await conn.execute(
    `UPDATE customers
     SET advance_payment = ?, current_balance = current_balance - ?, customer_type = 'advance', updated_at = NOW()
     WHERE id = ?`,
    [pool, totalAppliedToOldCreditDues, customer.id]
  );

  await conn.execute(
    `INSERT INTO advance_deposits (transaction_group_id, customer_id, amount_deposited)
     VALUES (?, ?, ?)`,
    [paymentToken, customer.id, advancePaymentEntered]
  );

  advanceDepositInfo = {
    total_deposited: advancePaymentEntered,
    used_for_current_sale: usedForThisSale,
    used_for_old_balance: totalAppliedToOldCreditDues,
    remaining: pool,
    old_invoices_paid: oldInvoicesPaid,
  };
}

 // ── Advance deduction log (credit sales — automatic, amount already computed above) ──
  if (paymentType === 'credit' && advanceUsedForCredit > 0) {
    const custAdvance = parseFloat(customer.advance_payment || 0);
    const remainingAdvance = custAdvance - advanceUsedForCredit;

    await conn.execute(
      `INSERT INTO customer_advance_logs
         (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [customer.id, saleId, custAdvance, advanceUsedForCredit, remainingAdvance]
    );

    await conn.execute(
      'UPDATE customers SET advance_payment = ?, updated_at = NOW() WHERE id = ?',
      [remainingAdvance, customer.id]
    );
  }

  // ── Advance deduction (cash/card sales only, if the shopkeeper confirmed it) ──
  let advanceDeductAmount = 0;
  if ((paymentType === 'cash' || paymentType === 'card') && body.deduct_advance) {
      const custAdvance = parseFloat(customer.advance_payment || 0);
      if (custAdvance > 0) {
        advanceDeductAmount = Math.min(custAdvance, grandTotal);
        const remainingAdvance = custAdvance - advanceDeductAmount;

        await conn.execute(
          `INSERT INTO customer_advance_logs
             (customer_id, sale_id, previous_balance, used_amount, remaining_balance, is_new_advance)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [customer.id, saleId, custAdvance, advanceDeductAmount, remainingAdvance]
        );

        await conn.execute(
          'UPDATE customers SET advance_payment = ?, updated_at = NOW() WHERE id = ?',
          [remainingAdvance, customer.id]
        );
      }
    }

  // ── Payment record(s) for THIS sale (cash/card and credit only —
    //    advance-funded sales with items were already recorded above) ──
    if (paymentType === 'cash' || paymentType === 'card') {
      const cardAccountId = paymentType === 'card' ? bankAccountId : null;

      if (advanceDeductAmount > 0) {
        // One row for the advance portion — always method 'advance', never linked to a bank account.
        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
           VALUES (?, ?, 'advance', ?, ?)`,
          [saleId, advanceDeductAmount, saleDate, paymentToken]
        );

        // A second row only exists if the shopkeeper actually typed something
        // into Received Amount (covering any gap the advance didn't reach).
        if (receivedAmt > 0) {
          await conn.execute(
            `INSERT INTO payments (sale_id, amount, method, bank_account_id, payment_date, transaction_group_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [saleId, receivedAmt, paymentType, cardAccountId, saleDate, paymentToken]
          );

          if (cardAccountId) {
            await conn.execute(
              'UPDATE bank_accounts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
              [receivedAmt, cardAccountId]
            );
          }
        }
      } else {
        // No advance deduction — normal cash/card sale, full grand total in one row.
        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, bank_account_id, payment_date, transaction_group_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [saleId, currentSaleApplied, paymentType, cardAccountId, saleDate, paymentToken]
        );

        if (cardAccountId) {
          await conn.execute(
            'UPDATE bank_accounts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
            [currentSaleApplied, cardAccountId]
          );
        }
      }
    } else if (paymentType === 'credit') {
      if (advanceUsedForCredit > 0) {
        // One row for the advance portion — always method 'advance'.
        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
           VALUES (?, ?, 'advance', ?, ?)`,
          [saleId, advanceUsedForCredit, saleDate, paymentToken]
        );

        // A second row only exists if the shopkeeper actually typed something
        // into Received Amount.
        if (receivedAmt > 0) {
          await conn.execute(
            `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
             VALUES (?, ?, 'cash', ?, ?)`,
            [saleId, receivedAmt, saleDate, paymentToken]
          );
        }
      } else if (currentSaleApplied > 0) {
        // No advance involved — original behavior, unchanged.
        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
           VALUES (?, ?, 'cash', ?, ?)`,
          [saleId, currentSaleApplied, saleDate, paymentToken]
        );
      }
    }

    // ── Waterfall: apply leftover received amount to customer's OLDER
    //    outstanding credit sales, oldest first, same transaction_group_id ──
    const settledOldSales = [];
    let totalAppliedToOldDues = 0;

    if (leftoverForOldDues > 0) {
      const [oldUnpaidSales] = await conn.execute(
        `SELECT * FROM sales
         WHERE customer_id = ? AND id != ? AND payment_type = 'credit'
           AND status IN ('unpaid','partial') AND deleted_at IS NULL
         ORDER BY sale_date ASC, id ASC
         FOR UPDATE`,
        [customer.id, saleId]
      );

      let remaining = leftoverForOldDues;

      const leftoverMethod        = (paymentType === 'cash' || paymentType === 'card') ? paymentType : 'cash';
      const leftoverBankAccountId = paymentType === 'card' ? bankAccountId : null;

      for (const oldSale of oldUnpaidSales) {
        if (remaining <= 0) break;

        const owed = parseFloat(oldSale.remaining_balance);
        const pay  = Math.min(owed, remaining);

        const newReceived    = parseFloat(oldSale.received_amount) + pay;
        const newRemaining   = owed - pay;
        const newStatus      = newRemaining <= 0 ? 'paid' : 'partial';
        const newPaymentType = newStatus === 'paid' ? leftoverMethod : oldSale.payment_type;

        await conn.execute(
          `UPDATE sales
           SET received_amount = ?, remaining_balance = ?, status = ?, payment_type = ?, updated_at = NOW()
           WHERE id = ?`,
          [newReceived, newRemaining, newStatus, newPaymentType, oldSale.id]
        );

        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, bank_account_id, payment_date, transaction_group_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [oldSale.id, pay, leftoverMethod, leftoverBankAccountId, saleDate, paymentToken]
        );

        if (leftoverBankAccountId) {
          await conn.execute(
            'UPDATE bank_accounts SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
            [pay, leftoverBankAccountId]
          );
        }

        settledOldSales.push({
          sale_id: oldSale.id, voucher_no: oldSale.voucher_no,
          paid: pay, status: newStatus, remaining: newRemaining,
        });

        totalAppliedToOldDues += pay;
        remaining -= pay;
      }
    }

    // ── Update customer balance ──
    // Add remaining balance from THIS sale (if credit & unpaid/partial),
    // subtract whatever leftover cash was used to clear older dues.
    const balanceDelta = (paymentType === 'credit' ? remainingBalance : 0) - totalAppliedToOldDues;

    if (balanceDelta !== 0) {
      await conn.execute(
        `UPDATE customers SET current_balance = current_balance + ?, updated_at = NOW() WHERE id = ?`,
        [balanceDelta, customer.id]
      );
    }
    if (paymentType === 'credit' && remainingBalance > 0) {
      await conn.execute(
        `UPDATE customers SET customer_type = 'credit', updated_at = NOW() WHERE id = ?`,
        [customer.id]
      );
    }

       // ── Build receipt payload for the print view ──
       const [[shopInfo]]      = await conn.execute('SELECT shop_name, address, phone FROM admin_settings LIMIT 1');
       const [[sellerRow]]     = await conn.execute('SELECT name FROM users WHERE id = ?', [sellerId]);
       const [[finalCustomer]] = await conn.execute('SELECT * FROM customers WHERE id = ?', [customer.id]);
       const [[receiptSettings]]  = await conn.execute('SELECT * FROM receipt_settings WHERE id = 1');
   
       const previousBalance   = parseFloat(customer.current_balance || 0);
       const advanceUsedAmount = advanceUsedForCredit || advanceDeductAmount ||
         (paymentType === 'advance' && advanceDepositInfo ? advanceDepositInfo.used_for_current_sale : 0);
       const wasPreviousBalanceCleared = previousBalance > 0 && parseFloat(finalCustomer.current_balance) <= 0;
   
       const receipt = {
         shop: shopInfo || {},
         seller_name: sellerRow?.name || 'N/A',
         sale: {
           voucher_no: voucherNo,
           sale_date: saleDate,
           payment_type: finalPaymentType,
           status: saleStatus,
           subtotal, discount_type: discType, discount: discVal, discount_amount: discAmt,
           tax_type: taxType, tax: taxVal, tax_amount: taxAmt,
           grand_total: grandTotal,
           received_amount: receivedAmountToStore,
           change_amount: changeAmt,
           remaining_balance: remainingBalance,
           due_date: dueDate,
         },
         customer: {
           id: customer.id,
           name: customer.name,
           contact: body.contact || customer.contact,
           shop_name: body.shop_name || customer.shop_name,
           city: body.city || customer.city,
           customer_type: customerType,
           current_balance: parseFloat(finalCustomer.current_balance),
           advance_payment: parseFloat(finalCustomer.advance_payment),
         },
         items: receiptItems,
         previous_balance: previousBalance,
         total_payable: previousBalance > 0 ? previousBalance + grandTotal : grandTotal,
         advance_used: advanceUsedAmount,
         advance_deposit_info: advanceDepositInfo,
         total_paid: currentSaleApplied,
         was_previous_balance_cleared: wasPreviousBalanceCleared,
         settled_old_sales: settledOldSales,
         receiptSettings: {
           paper_size: receiptSettings?.paper_size || '80mm',
           design_type: receiptSettings?.design_type || 'design1',
           language: receiptSettings?.language || 'en',
           show_signature: !!receiptSettings?.show_signature,
           show_stamp: !!receiptSettings?.show_stamp,
           show_paid_overlay: !!receiptSettings?.show_paid_overlay,
         },
       };
       await conn.commit();

       // ── If this save is completing an edit (go-to-edit stashed the old
       //    values under body.original_voucher_no), log one clean diff. ──
       if (body.original_voucher_no) {
           const [[pending]] = await conn.execute(
               'SELECT * FROM pending_sale_edits WHERE original_voucher_no = ?',
               [body.original_voucher_no]
           );
           if (pending) {
            const oldData = typeof pending.old_data === 'string' ? JSON.parse(pending.old_data) : pending.old_data;

            const newItemsForLog = receiptItems.map(ri => ({
                product_name: ri.product_name,
                quantity: ri.quantity,
                price: ri.price,
                discount_type: ri.discount_type,
                discount_value: ri.discount_value,
                tax_type: ri.tax_type,
                tax_value: ri.tax_value,
            }));

            const newDataForLog = {
                payment_type: finalPaymentType,
                subtotal,
                discount_type: discType,
                discount: discVal,
                discount_amount: discAmt,
                tax_type: taxType,
                tax: taxVal,
                tax_amount: taxAmt,
                grand_total: grandTotal,
                received_amount: receivedAmountToStore,
                items: newItemsForLog,
            };

            // Sale-level changes (payment type, subtotal, grand total, received amount)
            const saleLevelLabels = {
                payment_type: 'Payment Type',
                subtotal: 'Subtotal',
                grand_total: 'Grand Total',
                received_amount: 'Received Amount',
            };
            const saleLevelChanges = describeChanges(oldData, newDataForLog, saleLevelLabels);

             // Discount — show type-aware value plus the actual Rs amount
             const fmtDisc = (type, val) => type === 'percentage' ? `${formatValue(val)}%` : formatValue(val);
             if (oldData.discount_type !== discType || !valuesEqual(oldData.discount, discVal)) {
                 saleLevelChanges.push(
                     `Discount: ${fmtDisc(oldData.discount_type, oldData.discount)} (Rs ${Number(oldData.discount_amount || 0).toFixed(2)}) → ${fmtDisc(discType, discVal)} (Rs ${discAmt.toFixed(2)})`
                 );
             }

             // Tax — same treatment
             const fmtTax = (type, val) => type === 'percentage' ? `${formatValue(val)}%` : formatValue(val);
             if (oldData.tax_type !== taxType || !valuesEqual(oldData.tax, taxVal)) {
                 saleLevelChanges.push(
                     `Tax: ${fmtTax(oldData.tax_type, oldData.tax)} (Rs ${Number(oldData.tax_amount || 0).toFixed(2)}) → ${fmtTax(taxType, taxVal)} (Rs ${taxAmt.toFixed(2)})`
                 );
             }

            const itemChanges = describeItemChanges(oldData.items || [], newItemsForLog);
            const allChanges = [...saleLevelChanges, ...itemChanges];
            const changeText = allChanges.length > 0 ? allChanges.join('; ') : 'No values changed';

            await logActivity(req, {
                action_type: 'edit',
                description: `Edited sale "${body.original_voucher_no}" → new voucher "${voucherNo}" — ${changeText}`,
                entity_type: 'sale',
                entity_id: saleId,
                old_data: oldData,
                new_data: newDataForLog,
            });

            await conn.execute('DELETE FROM pending_sale_edits WHERE original_voucher_no = ?', [body.original_voucher_no]);
        }
       }

     return reply.send({
       success:      true,
       message:      `Sale saved! Voucher: ${voucherNo}`,
       sale_id:      saleId,
       voucher_no:   voucherNo,
       settled_old_sales: settledOldSales, // any previous credit sales this payment also cleared
       receipt,
     });

    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.status(500).send({
        success: false,
        message: err.message || 'An error occurred while saving the sale.',
      });
    } finally {
      conn.release();
    }
  });

// ════════════════════════════════════════════════════
  //  POST /api/sales/pay-balance
  //  Customer pays off old credit balance only — no items
  // ════════════════════════════════════════════════════
  fastify.post('/api/sales/pay-balance', async (req, reply) => {
    const body     = req.body;
    const amount   = parseFloat(body.amount || 0);
    const sellerId = req.session?.userId || req.user?.id;

    if (!body.contact) {
      return reply.status(422).send({ success: false, message: 'Customer contact is required.' });
    }
    if (amount <= 0) {
      return reply.status(422).send({ success: false, message: 'Amount must be greater than 0.' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [[customer]] = await conn.execute(
        'SELECT * FROM customers WHERE contact = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [body.contact]
      );
      if (!customer) {
        await conn.rollback();
        return reply.status(404).send({ success: false, message: 'Customer not found.' });
      }

      const [unpaidSales] = await conn.execute(
        `SELECT * FROM sales
         WHERE customer_id = ? AND payment_type = 'credit' AND status IN ('unpaid','partial') AND deleted_at IS NULL
         ORDER BY sale_date ASC, id ASC
         FOR UPDATE`,
        [customer.id]
      );

      if (unpaidSales.length === 0) {
        await conn.rollback();
        return reply.status(422).send({ success: false, message: 'No outstanding credit sales for this customer.' });
      }

      const token   = generateTransactionToken();
      const payDate = body.payment_date ? new Date(body.payment_date) : new Date();
      let remaining = amount;
      const settled = [];

      for (const sale of unpaidSales) {
        if (remaining <= 0) break;

        const owed = parseFloat(sale.remaining_balance);
        const pay  = Math.min(owed, remaining);

        const newReceived    = parseFloat(sale.received_amount) + pay;
        const newRemaining   = owed - pay;
        const newStatus      = newRemaining <= 0 ? 'paid' : 'partial';
        const newPaymentType = newStatus === 'paid' ? 'cash' : 'credit';

        await conn.execute(
          `UPDATE sales
           SET received_amount = ?, remaining_balance = ?, status = ?, payment_type = ?, updated_at = NOW()
           WHERE id = ?`,
          [newReceived, newRemaining, newStatus, newPaymentType, sale.id]
        );

        await conn.execute(
          `INSERT INTO payments (sale_id, amount, method, payment_date, transaction_group_id)
           VALUES (?, ?, 'cash', ?, ?)`,
          [sale.id, pay, payDate, token]
        );

        settled.push({ sale_id: sale.id, voucher_no: sale.voucher_no, paid: pay, status: newStatus, payment_type: newPaymentType, remaining: newRemaining });
        remaining -= pay;
      }

      const totalApplied     = amount - remaining;
      const previousBalance  = parseFloat(customer.current_balance || 0);
      const remainingBalance = Math.max(0, previousBalance - totalApplied);

      await conn.execute(
        'UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?',
        [totalApplied, customer.id]
      );

      const [[shopInfo]]        = await conn.execute('SELECT shop_name, address, phone FROM admin_settings LIMIT 1');
      const [[sellerRow]]       = await conn.execute('SELECT name FROM users WHERE id = ?', [sellerId]);
      const [[finalCustomer]]   = await conn.execute('SELECT * FROM customers WHERE id = ?', [customer.id]);
      const [[receiptSettings]] = await conn.execute('SELECT * FROM receipt_settings WHERE id = 1');

      await conn.commit();
      return reply.send({
        success: true,
        message: `Payment of Rs ${totalApplied.toFixed(2)} applied to ${settled.length} sale(s).`,
        transaction_id: token,
        settled,
        unused_amount: remaining,
        receipt: {
          shop: shopInfo || {},
          seller_name: sellerRow?.name || 'N/A',
          transactionType: 'payment_only',
          receipt_customer_type: 'credit',
          paymentData: {
            payment_date:      payDate,
            user:              { name: sellerRow?.name || 'N/A' },
            payment_type:      body.payment_type || 'cash',
            received_amount:   amount,
            previous_balance:  previousBalance,
            remaining_balance: remainingBalance,
          },
          customer: {
            id:              customer.id,
            name:            finalCustomer.name,
            contact:         finalCustomer.contact,
            shop_name:       finalCustomer.shop_name,
            city:            finalCustomer.city,
            advance_payment: parseFloat(finalCustomer.advance_payment),
          },
          receiptSettings: {
            paper_size:        receiptSettings?.paper_size || '80mm',
            design_type:       receiptSettings?.design_type || 'design1',
            language:          receiptSettings?.language || 'en',
            show_signature:    !!receiptSettings?.show_signature,
            show_stamp:        !!receiptSettings?.show_stamp,
            show_paid_overlay: !!receiptSettings?.show_paid_overlay,
          },
        },
      });

    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.status(500).send({ success: false, message: err.message || 'An error occurred while applying payment.' });
    } finally {
      conn.release();
    }
  });

  // ════════════════════════════════════════════════════
  //  GET /api/sales/product-history/:purchaseId
  //  Powers the "History" button on the POS product search.
  // ════════════════════════════════════════════════════
  fastify.get('/api/sales/product-history/:purchaseId', async (req, reply) => {
    const conn = await db.getConnection();
    try {
      const purchaseId = parseInt(req.params.purchaseId, 10);
      if (!purchaseId) {
        return reply.status(422).send({ success: false, message: 'Invalid product id.' });
      }

      const [[product]] = await conn.execute(
        `SELECT p.*, c.name AS category_name, sup.name AS supplier_name
         FROM purchases p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers sup ON sup.id = p.supplier_id
         WHERE p.id = ? LIMIT 1`,
        [purchaseId]
      );
      if (!product) {
        return reply.status(404).send({ success: false, message: 'Product not found.' });
      }

      const aggSql = `
      SELECT
        COALESCE(SUM(si.quantity), 0) AS total_sold,
        COALESCE(SUM(${REVENUE_EXPR}), 0) AS total_revenue,
        COALESCE(SUM(${COST_EXPR}), 0) AS total_cost,
        COUNT(DISTINCT si.sale_id) AS total_transactions
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      ${DISCOUNT_ALLOC_JOIN}
      WHERE si.purchase_id = ?
    `;
    const [[agg]] = await conn.execute(aggSql, [purchaseId]);

    const walkInSql = `
      SELECT
        COALESCE(SUM(wr.quantity_returned), 0) AS qty_returned,
        COALESCE(SUM(wr.revenue_without_tax), 0) AS revenue_returned,
        COALESCE(SUM(wr.profit_without_tax), 0) AS profit_returned
      FROM walk_in_returns wr
      WHERE wr.purchase_id = ?
    `;
    const [[walkIn]] = await conn.execute(walkInSql, [purchaseId]);

      const txSql = `
        SELECT
          s.voucher_no, COALESCE(s.sale_date, s.created_at) AS date, s.payment_type,
          COALESCE(cu.name, 'Walk-in Customer') AS customer,
          si.quantity, si.price, si.total_after_discount AS total
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        LEFT JOIN customers cu ON cu.id = s.customer_id
        WHERE si.purchase_id = ?
        ORDER BY COALESCE(s.sale_date, s.created_at) DESC
        LIMIT 100
      `;
      const [transactions] = await conn.execute(txSql, [purchaseId]);

      const rawRevenue = Number(agg.total_revenue);
      const rawCost     = Number(agg.total_cost);

      const totalRevenue = rawRevenue - Number(walkIn.revenue_returned);
      const totalCost    = rawCost;
      const totalProfit  = (rawRevenue - rawCost) - Number(walkIn.profit_returned);
      const totalSold    = Number(agg.total_sold) - Number(walkIn.qty_returned);

      return reply.send({
        success: true,
        data: {
          product_name:       product.product_name,
          unit:                product.unit,
          category:            product.category_name || 'Uncategorized',
          supplier:            product.supplier_name || 'N/A',
          purchase_price:      Number(product.purchased_price),
          selling_price:       Number(product.sold_price),
          total_purchased:     Number(product.quantity),
          total_sold:          totalSold,
          available_stock:     Number(product.quantity) - Number(product.sold_quantity),
          total_transactions:  Number(agg.total_transactions),
          total_revenue:       totalRevenue,
          total_profit:        totalProfit,
          transactions: transactions.map((t) => ({
            date:       t.date,
            invoice_no: t.voucher_no,
            customer:   `${t.customer} (${t.payment_type})`,
            qty:        Number(t.quantity),
            price:      Number(t.price),
            total:      Number(t.total),
            payment:    (t.payment_type || '').toUpperCase(),
          })),
        },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, message: err.message || 'Failed to load product history.' });
    } finally {
      conn.release();
    }
  });

  // ════════════════════════════════════════════════════
  //  GET /api/settings/shop-info  (for quotation receipts)
  // ════════════════════════════════════════════════════
  fastify.get('/api/sales/shop-info-for-quotation', async (req, reply) => {
    const conn = await db.getConnection();
    try {
      const [[shop]] = await conn.execute(
        'SELECT shop_name, phone, address FROM admin_settings LIMIT 1'
      );
      return reply.send({ success: true, shop: shop || {} });
    } finally {
      conn.release();
    }
  });

}