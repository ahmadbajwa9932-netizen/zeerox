import db from '../db.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

const PER_PAGE = 10;

const COLUMN_MAP = {
    'voucher_no': 'sales.voucher_no',
    'sales.voucher_no': 'sales.voucher_no',
    'sale_date': 'sales.sale_date',
    'sales.sale_date': 'sales.sale_date',
    'created_at': 'sales.created_at',
    'sales.created_at': 'sales.created_at',
    'grand_total': 'sales.grand_total',
    'sales.grand_total': 'sales.grand_total',
    'payment_type': 'sales.payment_type',
    'sales.payment_type': 'sales.payment_type',
    'id': 'sales.id',
};

const ALLOWED_SEARCH_TYPES = ['voucher', 'customer', 'product'];
const ALLOWED_PAYMENT_TYPES = ['cash', 'card', 'credit', 'advance'];

function firstDayOfMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function lastDayOfMonth() {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

async function performUndoSale(id) {
    const conn = await db.getConnection();
    let sale, customer, relatedPayments = [];

    try {
        await conn.beginTransaction();

        const [saleRows] = await conn.query(`SELECT * FROM sales WHERE id = ?`, [id]);
        sale = saleRows[0];
        if (!sale) throw new Error('Sale not found');

        const [customerRows] = await conn.query(`SELECT * FROM customers WHERE id = ?`, [sale.customer_id]);
        customer = customerRows[0];
        if (!customer) throw new Error('Customer not found for this sale');

        // STEP 1: REVERSE ADVANCE PAYMENT TRANSACTIONS
        const [advanceLogs] = await conn.query(
            `SELECT * FROM customer_advance_logs WHERE sale_id = ?`, [sale.id]
        );
        if (advanceLogs.length > 0) {
            const notNewLog = advanceLogs.find(l => !l.is_new_advance);
            const advanceBeforeSale = notNewLog ? parseFloat(notNewLog.previous_balance) : 0;
            const advanceAfterSale = parseFloat(customer.advance_payment);
            const netChangeInAdvance = advanceAfterSale - advanceBeforeSale;

            if (netChangeInAdvance !== 0) {
                await conn.query(`UPDATE customers SET advance_payment = ? WHERE id = ?`, [advanceBeforeSale, customer.id]);
                customer.advance_payment = advanceBeforeSale;
            }
            await conn.query(`DELETE FROM customer_advance_logs WHERE sale_id = ?`, [sale.id]);
        }

        // STEP 2: REVERSE CREDIT BALANCE CHANGES
        if (sale.payment_type === 'credit' && parseFloat(sale.remaining_balance) > 0) {
            await conn.query(`UPDATE customers SET current_balance = current_balance - ? WHERE id = ?`, [sale.remaining_balance, customer.id]);
            customer.current_balance = parseFloat(customer.current_balance) - parseFloat(sale.remaining_balance);
        }

        // STEP 3: REVERSE OLD BALANCE PAYMENTS
        const [groupRows] = await conn.query(
            `SELECT transaction_group_id FROM payments WHERE sale_id = ? LIMIT 1`, [sale.id]
        );
        const transactionGroupId = groupRows[0]?.transaction_group_id || null;

        if (transactionGroupId) {
            const [rp] = await conn.query(
                `SELECT payments.*, sales.id as other_sale_id, sales.voucher_no,
                        sales.remaining_balance as sale_remaining_balance,
                        sales.received_amount as sale_received_amount,
                        sales.grand_total, sales.status, sales.payment_type as sale_payment_type
                 FROM payments
                 JOIN sales ON payments.sale_id = sales.id
                 WHERE payments.transaction_group_id = ?
                   AND payments.sale_id != ?
                   AND sales.customer_id = ?`,
                [transactionGroupId, sale.id, customer.id]
            );
            relatedPayments = rp;
        }

        for (const payment of relatedPayments) {
            const newRemaining = parseFloat(payment.sale_remaining_balance) + parseFloat(payment.amount);
            let newStatus = payment.status;
            if (newRemaining >= parseFloat(payment.grand_total)) newStatus = 'unpaid';
            else if (newRemaining > 0) newStatus = 'partial';

            let newPaymentType = payment.sale_payment_type;
            if (newStatus !== 'paid' && newPaymentType !== 'credit') newPaymentType = 'credit';

            const newReceivedAmount = parseFloat(payment.sale_received_amount) - parseFloat(payment.amount);

            await conn.query(
                `UPDATE sales SET remaining_balance = ?, received_amount = ?, status = ?, payment_type = ? WHERE id = ?`,
                [newRemaining, newReceivedAmount, newStatus, newPaymentType, payment.other_sale_id]
            );
            await conn.query(`UPDATE customers SET current_balance = current_balance + ? WHERE id = ?`, [payment.amount, customer.id]);
            customer.current_balance = parseFloat(customer.current_balance) + parseFloat(payment.amount);

            if (payment.bank_account_id) {
                await conn.query(
                    `UPDATE bank_accounts SET balance = balance - ?, updated_at = NOW() WHERE id = ?`,
                    [payment.amount, payment.bank_account_id]
                );
            }

            await conn.query(`DELETE FROM payments WHERE id = ?`, [payment.id]);
        }

        // STEP 4: RESTOCK PRODUCTS
        const [saleItems] = await conn.query(
            `SELECT sale_items.*, purchases.type as purchase_type
             FROM sale_items
             JOIN purchases ON sale_items.purchase_id = purchases.id
             WHERE sale_items.sale_id = ?`,
            [sale.id]
        );

        for (const item of saleItems) {
            if (item.purchase_type === 'product') {
                const [[{ returnedQty }]] = await conn.query(
                    `SELECT COALESCE(SUM(quantity_returned),0) as returnedQty
                     FROM sale_return_items WHERE sale_item_id = ?`,
                    [item.id]
                );
                const qtyToRestore = item.quantity - returnedQty;
                await conn.query(
                    `UPDATE purchases SET sold_quantity = sold_quantity - ? WHERE id = ?`,
                    [qtyToRestore, item.purchase_id]
                );
            }
            await conn.query(`DELETE FROM sale_return_items WHERE sale_item_id = ?`, [item.id]);
            await conn.query(`DELETE FROM sale_items WHERE id = ?`, [item.id]);
        }

        // STEP 5: REVERSE BANK ACCOUNT CREDITS, THEN DELETE CURRENT SALE PAYMENTS
        const [salePayments] = await conn.query(
            `SELECT bank_account_id, amount FROM payments WHERE sale_id = ? AND bank_account_id IS NOT NULL`,
            [sale.id]
        );
        for (const p of salePayments) {
            await conn.query(
                `UPDATE bank_accounts SET balance = balance - ?, updated_at = NOW() WHERE id = ?`,
                [p.amount, p.bank_account_id]
            );
        }
        await conn.query(`DELETE FROM payments WHERE sale_id = ?`, [sale.id]);

        // STEP 6: ADJUST CUSTOMER TYPE
        let newCustomerType = customer.customer_type;
        if (parseFloat(customer.advance_payment) > 0) newCustomerType = 'advance';
        else if (parseFloat(customer.current_balance) > 0) newCustomerType = 'credit';
        else if (!['cash', 'card'].includes(customer.customer_type)) newCustomerType = 'cash';
        await conn.query(`UPDATE customers SET customer_type = ? WHERE id = ?`, [newCustomerType, customer.id]);
        customer.customer_type = newCustomerType;

        // STEP 7: DELETE THE SALE
        await conn.query(`DELETE FROM sales WHERE id = ?`, [sale.id]);

        await conn.commit();
        return { success: true, sale, customer, relatedPayments };

    } catch (err) {
        await conn.rollback();
        return { success: false, message: err.message };
    } finally {
        conn.release();
    }
}

export default async function generalSalesRoutes(fastify) {

    fastify.get('/api/sales/general/data', async (req, reply) => {
        try {
            const page = parseInt(req.query.page) || 1;

            let sortColumn = req.query.sort_column || 'voucher_no';
            const actualSortColumn = COLUMN_MAP[sortColumn] || 'sales.voucher_no';
            let sortDirection = (req.query.sort_direction || 'desc').toLowerCase();
            if (!['asc', 'desc'].includes(sortDirection)) sortDirection = 'desc';

            const searchQuery = req.query.search || '';
            let searchType = req.query.search_type || 'voucher';
            const filterPayment = req.query.filter_payment || '';
            if (!ALLOWED_SEARCH_TYPES.includes(searchType)) searchType = 'voucher';

            let startDate = req.query.start_date || null;
            let endDate = req.query.end_date || null;
            if (!startDate && !endDate) {
                startDate = firstDayOfMonth();
                endDate = lastDayOfMonth();
            }

            const highlightSaleId = req.query.highlight ? parseInt(req.query.highlight) : null;

            // ── Shared WHERE (existence of remaining-qty items + date range + search) ──
            const where = [
                `sales.deleted_at IS NULL`,
            ];
            const params = [];

            if (startDate && endDate) {
                where.push(`DATE(sales.sale_date) >= ? AND DATE(sales.sale_date) <= ?`);
                params.push(startDate, endDate);
            } else if (startDate) {
                where.push(`DATE(sales.sale_date) >= ?`);
                params.push(startDate);
            } else if (endDate) {
                where.push(`DATE(sales.sale_date) <= ?`);
                params.push(endDate);
            }

            if (filterPayment && ALLOWED_PAYMENT_TYPES.includes(filterPayment)) {
                where.push(`sales.payment_type = ?`);
                params.push(filterPayment);
            }

            if (searchQuery) {
                switch (searchType) {
                    case 'voucher':
                        where.push(`sales.voucher_no LIKE ?`);
                        params.push(`%${searchQuery}%`);
                        break;
                    case 'customer':
                        where.push(`customers.name LIKE ?`);
                        params.push(`%${searchQuery}%`);
                        break;
                    case 'product':
                        where.push(`EXISTS (
                            SELECT 1 FROM sale_items si2
                            JOIN purchases p2 ON si2.purchase_id = p2.id
                            WHERE si2.sale_id = sales.id
                              AND p2.product_name LIKE ?
                              AND si2.deleted_at IS NULL
                        )`);
                        params.push(`%${searchQuery}%`);
                        break;
                }
            }

            const whereSql = where.join(' AND ');

            const orderSql = actualSortColumn === 'sales.voucher_no'
                ? `ORDER BY CAST(SUBSTRING_INDEX(sales.voucher_no, '-', -1) AS UNSIGNED) ${sortDirection}, sales.id ${sortDirection}`
                : `ORDER BY ${actualSortColumn} ${sortDirection}`;

            // ── Determine target page (if a highlight id was passed) ──
            let targetPage = page;
            if (highlightSaleId && !searchQuery) {
                const posSql = `
                    SELECT sales.id
                    FROM sales
                    LEFT JOIN customers ON sales.customer_id = customers.id
                    WHERE ${whereSql}
                    ${orderSql}
                `;
                const [idRows] = await db.query(posSql, params);
                const position = idRows.findIndex(r => r.id === highlightSaleId);
                if (position !== -1) {
                    targetPage = Math.floor(position / PER_PAGE) + 1;
                }
            }

            const offset = (targetPage - 1) * PER_PAGE;

            // ── Count (cheap — no aggregation needed) ──
            const countSql = `
                SELECT COUNT(*) as total
                FROM sales
                LEFT JOIN customers ON sales.customer_id = customers.id
                WHERE ${whereSql}
            `;
            const [countRows] = await db.query(countSql, params);
            const total = countRows[0]?.total || 0;

            // ── Page of sales (basic columns only — cheap) ──
            const pageSql = `
            SELECT
 sales.id as sale_id,
 sales.voucher_no,
 sales.sale_date,
 sales.payment_type,
 sales.status,
 sales.grand_total,
 customers.name as customer_name,
 sales.seller_name
FROM sales
LEFT JOIN customers ON sales.customer_id = customers.id
WHERE ${whereSql}
${orderSql}
LIMIT ? OFFSET ?
`;
            const [salesRows] = await db.query(pageSql, [...params, PER_PAGE, offset]);

            const saleIds = salesRows.map(s => s.sale_id);

            let itemCounts = {};
            let productNames = {};
            let saleItemsGrouped = {};

            if (saleIds.length > 0) {
                const placeholders = saleIds.map(() => '?').join(',');

                // ── Item counts (only for current page's sale_ids — cheap) ──
                const [countItemRows] = await db.query(`
                    SELECT sale_items.sale_id, COUNT(DISTINCT sale_items.id) as total_items
                    FROM sale_items
                    JOIN purchases ON sale_items.purchase_id = purchases.id
                    WHERE sale_items.sale_id IN (${placeholders})
                      AND sale_items.deleted_at IS NULL
                    GROUP BY sale_items.sale_id
                `, saleIds);
                itemCounts = countItemRows.reduce((acc, r) => ({ ...acc, [r.sale_id]: r.total_items }), {});

                // ── Product names (only for the page — GROUP_CONCAT avoided; built in JS) ──
                const [productRows] = await db.query(`
                    SELECT sale_items.sale_id, purchases.product_name
                    FROM sale_items
                    JOIN purchases ON sale_items.purchase_id = purchases.id
                    WHERE sale_items.sale_id IN (${placeholders})
                      AND sale_items.deleted_at IS NULL
                    ORDER BY sale_items.id
                `, saleIds);

                const grouped = productRows.reduce((acc, r) => {
                    if (!acc[r.sale_id]) acc[r.sale_id] = [];
                    acc[r.sale_id].push(r.product_name);
                    return acc;
                }, {});
                productNames = Object.fromEntries(
                    Object.entries(grouped).map(([id, names]) => [
                        id,
                        names.length > 1 ? `${names[0]} + ${names.length - 1} more` : (names[0] || '-'),
                    ])
                );

                // ── Detailed sale items (for the expandable row) ──
                const [itemRows] = await db.query(`
                    SELECT
                        sale_items.sale_id,
                        purchases.type,
                        purchases.product_name,
                        sale_items.price,
                        sale_items.quantity as original_quantity,
                        sale_items.discount_type,
                        sale_items.discount_value,
                        sale_items.discount_amount as original_discount_amount,
                        sale_items.tax_type,
                        sale_items.tax_value,
                        sale_items.tax_amount as original_tax_amount,
                        sale_items.total_after_tax
                    FROM sale_items
                    JOIN purchases ON sale_items.purchase_id = purchases.id
                    WHERE sale_items.sale_id IN (${placeholders})
                      AND sale_items.deleted_at IS NULL
                `, saleIds);

                saleItemsGrouped = itemRows.reduce((acc, row) => {
                    if (!acc[row.sale_id]) acc[row.sale_id] = [];
                    acc[row.sale_id].push(row);
                    return acc;
                }, {});
            }

            // ── Attach calculated fields to each sale row ──
            const data = salesRows.map(sale => ({
                ...sale,
                total_items: itemCounts[sale.sale_id] || 0,
                products: productNames[sale.sale_id] || '-',
            }));

            const lastPage = Math.max(Math.ceil(total / PER_PAGE), 1);

            return reply.send({
                success: true,
                data,
                saleItems: saleItemsGrouped,
                highlightSaleId: highlightSaleId || null,
                pagination: {
                    current_page: targetPage,
                    last_page: lastPage,
                    per_page: PER_PAGE,
                    total,
                    first_item: total === 0 ? 0 : offset + 1,
                    last_item: Math.min(offset + PER_PAGE, total),
                    has_more_pages: targetPage < lastPage,
                    on_first_page: targetPage <= 1,
                },
            });
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ success: false, error: err.message });
        }
    });

    fastify.delete('/api/sales/general/:id/undo-sale', async (req, reply) => {
        const { id } = req.params;
        const isSilent = req.query.silent === 'true' || req.query.silent === '1';

        const result = await performUndoSale(id);

        if (!result.success) {
            fastify.log.error('Error permanently deleting sale: ' + result.message);
            return reply.code(500).send({ success: false, message: 'Failed to delete sale: ' + result.message });
        }

        const { sale, customer, relatedPayments } = result;

        // Only a real "undo sale" action (not the silent step inside go-to-edit,
        // which is followed immediately by a store call and logged as 'edit' there).
        if (!isSilent) {
            await logActivity(req, {
                action_type: 'undo',
                description: `Undo sale "${sale.voucher_no}" (Rs ${parseFloat(sale.grand_total).toFixed(2)}, ${sale.payment_type}) and restocked its items`,
                entity_type: 'sale',
                entity_id: sale.id,
                old_data: sale,
            });
        }

        if (isSilent) {
            return reply.send({ success: true });
        }

        const messages = ['Sale permanently deleted successfully.'];
        if (parseFloat(sale.remaining_balance) > 0) {
            messages.push(`Unpaid balance of Rs. ${parseFloat(sale.remaining_balance).toFixed(2)} removed from customer account.`);
        }
        if (relatedPayments.length > 0) {
            const totalOldPayments = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
            messages.push(`Old balance payments of Rs. ${totalOldPayments.toFixed(2)} reversed.`);
        }
        messages.push('Products restocked to inventory.');

        return reply.send({
            success: true,
            message: messages.join(' '),
            customer_updates: {
                advance_payment: customer.advance_payment,
                current_balance: customer.current_balance,
                customer_type: customer.customer_type
            }
        });
    });

        // ─────────────────────────────────────────────────────────
    // DELETE /api/sales/general/:id/delete — soft delete (default) or permanent (?permanent=true)
    // Cascades to sale_items, sale_return_items, payments, customer_advance_logs.
    // Blocked for credit sales that still have a partial/unpaid balance.
    // ─────────────────────────────────────────────────────────
    fastify.delete('/api/sales/general/:id/delete', async (req, reply) => {
        const { id } = req.params;
        const isPermanent = req.query.permanent === 'true';

        try {
            const [[sale]] = await db.query(
                'SELECT * FROM sales WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!sale) {
                return reply.code(404).send({ success: false, message: 'Sale not found.' });
            }

            if (sale.payment_type === 'credit' && ['partial', 'unpaid'].includes(sale.status)) {
                return reply.code(422).send({
                    success: false,
                    message: 'This credit sale has a partial or unpaid balance and cannot be deleted.'
                });
            }

            if (isPermanent) {
                await db.query(
                    `DELETE sri FROM sale_return_items sri
                     JOIN sale_items si ON sri.sale_item_id = si.id
                     WHERE si.sale_id = ?`,
                    [id]
                );
                await db.query('DELETE FROM sale_items WHERE sale_id = ?', [id]);
                await db.query('DELETE FROM payments WHERE sale_id = ?', [id]);
                await db.query('DELETE FROM customer_advance_logs WHERE sale_id = ?', [id]);
                await db.query('DELETE FROM sales WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'permanent_delete',
                    description: `Permanently deleted sale "${sale.voucher_no}" (Rs ${parseFloat(sale.grand_total).toFixed(2)}, ${sale.payment_type})`,
                    entity_type: 'sale',
                    entity_id: id,
                    old_data: sale,
                });

                return reply.send({ success: true, message: 'Sale permanently deleted.' });
            } else {
                await db.query('UPDATE sale_items SET deleted_at = NOW() WHERE sale_id = ? AND deleted_at IS NULL', [id]);
                await db.query('UPDATE payments SET deleted_at = NOW() WHERE sale_id = ? AND deleted_at IS NULL', [id]);
                await db.query('UPDATE customer_advance_logs SET deleted_at = NOW() WHERE sale_id = ? AND deleted_at IS NULL', [id]);
                await db.query('UPDATE sales SET deleted_at = NOW() WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'soft delete',
                    description: `Soft Deleted sale "${sale.voucher_no}" (Rs ${parseFloat(sale.grand_total).toFixed(2)}, ${sale.payment_type})`,
                    entity_type: 'sale',
                    entity_id: id,
                    old_data: sale,
                });

                return reply.send({ success: true, message: 'Sale deleted successfully.' });
            }
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ success: false, message: 'Something went wrong. Please try again!' });
        }
    });

    // ─────────────────────────────────────────────────────────
    // GO TO EDIT — snapshot the sale, then delete it silently
    // Ported from Laravel SalesController::goToEdit
    // ─────────────────────────────────────────────────────────
    fastify.get('/api/sales/:id/go-to-edit', async (req, reply) => {
        const { id } = req.params;

        try {
            const [saleRows] = await db.query(`SELECT * FROM sales WHERE id = ?`, [id]);
            const sale = saleRows[0];
            if (!sale) {
                return reply.code(404).send({ success: false, message: 'Sale not found' });
            }

            const [customerRows] = await db.query(`SELECT * FROM customers WHERE id = ?`, [sale.customer_id]);
            const customer = customerRows[0];
            if (!customer) {
                return reply.code(404).send({ success: false, message: 'Customer not found for this sale' });
            }

            const [[cardPayment]] = await db.query(
                `SELECT bank_account_id FROM payments WHERE sale_id = ? AND bank_account_id IS NOT NULL LIMIT 1`,
                [sale.id]
            );

            // dateStrings:true in db.js means sale_date already comes back as 'YYYY-MM-DD HH:MM:SS'
            const saleDate = sale.sale_date
                ? sale.sale_date.replace(' ', 'T').slice(0, 16)
                : (() => {
                    // Local clock, matching how sale_date is stored — toISOString()
                    // here would print UTC and read 5 hours behind in PKT.
                    const d = new Date();
                    const p2 = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
                  })();

            const saleCopy = {
                voucher_no: sale.voucher_no,
                sale_date: saleDate,
                payment_type: sale.payment_type,
                subtotal: sale.subtotal,
                discount: sale.discount,
                discount_type: sale.discount_type,
                tax: sale.tax ?? 0,
                tax_type: sale.tax_type ?? 'amount',
                grand_total: sale.grand_total,
                received_amount: sale.received_amount,
                bank_account_id: cardPayment?.bank_account_id || null,
                customer: {
                    id: customer.id,
                    name: customer.name,
                    city: customer.city,
                    contact: customer.contact,
                    shop_name: customer.shop_name,
                },
                items: [],
            };

            const [items] = await db.query(
                `SELECT sale_items.*, purchases.product_name, purchases.sold_price, purchases.unit,
                        purchases.purchased_price, purchases.type, purchases.quantity as purchase_quantity,
                        purchases.sold_quantity, purchases.fix_sold_price,
                        purchases.discount_type as purchase_discount_type,
                        purchases.discount as purchase_discount, purchases.fix_discount,
                        purchases.tax_type as purchase_tax_type, purchases.tax as purchase_tax,
                        purchases.fix_tax, purchases.barcode
                 FROM sale_items
                 JOIN purchases ON sale_items.purchase_id = purchases.id
                 WHERE sale_items.sale_id = ?`,
                [sale.id]
            );

            for (const item of items) {
                const [[{ returnedQty }]] = await db.query(
                    `SELECT COALESCE(SUM(quantity_returned), 0) as returnedQty
                     FROM sale_return_items WHERE sale_item_id = ?`,
                    [item.id]
                );
                const remainingQty = item.quantity - returnedQty;

                if (remainingQty > 0) {
                    saleCopy.items.push({
                        purchase_id: item.purchase_id,
                        purchase: {
                            id: item.purchase_id,
                            name: item.product_name,
                            product_name: item.product_name,
                            price: item.sold_price,
                            unit: item.unit,
                            purchased_price: item.purchased_price,
                            type: item.type,
                            quantity: item.purchase_quantity,
                            sold_quantity: item.sold_quantity,
                            available_stock: item.purchase_quantity - item.sold_quantity,
                            fix_sold_price: item.fix_sold_price ?? 0,
                            discount_type: item.purchase_discount_type ?? 'amount',
                            discount: item.purchase_discount ?? 0,
                            fix_discount: item.fix_discount ?? 0,
                            tax_type: item.purchase_tax_type ?? 'amount',
                            tax: item.purchase_tax ?? 0,
                            fix_tax: item.fix_tax ?? 0,
                            barcode: item.barcode,
                        },
                        quantity: remainingQty,
                        price: item.price,
                        discount_type: item.discount_type ?? 'amount',
                        discount_value: item.discount_value ?? 0,
                        tax_type: item.tax_type ?? 'amount',
                        tax_value: item.tax_value ?? 0,
                    });
                }
            }

            fastify.log.info(`Sale data copied for edit: sale_id=${sale.id}, voucher=${saleCopy.voucher_no}, items=${saleCopy.items.length}`);

            // Stash the pre-edit values (including per-item detail and
            // sale-level discount/tax amounts) so the upcoming
            // /api/sales/store call can log one clean, detailed "edit" diff.
            await db.query(
                `INSERT INTO pending_sale_edits (original_voucher_no, user_id, old_data)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE old_data = VALUES(old_data), user_id = VALUES(user_id), created_at = NOW()`,
                [
                    sale.voucher_no,
                    req.user?.id || null,
                    JSON.stringify({
                        voucher_no: sale.voucher_no,
                        payment_type: sale.payment_type,
                        subtotal: sale.subtotal,
                        discount_type: sale.discount_type,
                        discount: sale.discount,
                        discount_amount: sale.discount_amount,
                        tax_type: sale.tax_type,
                        tax: sale.tax,
                        tax_amount: sale.tax_amount,
                        grand_total: sale.grand_total,
                        received_amount: sale.received_amount,
                        items: items.map(item => ({
                            product_name: item.product_name,
                            quantity: item.quantity,
                            price: item.price,
                            discount_type: item.discount_type ?? 'amount',
                            discount_value: item.discount_value ?? 0,
                            tax_type: item.tax_type ?? 'amount',
                            tax_value: item.tax_value ?? 0,
                        })),
                    }),
                ]
            );

            const deleteResult = await performUndoSale(sale.id);
            if (!deleteResult.success) {
                fastify.log.error(`Deletion failed for sale ${sale.id}: ${deleteResult.message}`);
                return reply.code(500).send({
                    success: false,
                    message: 'Failed to delete original sale: ' + deleteResult.message,
                });
            }

            fastify.log.info(`Sale ${sale.id} successfully deleted for edit mode`);

            return reply.send({ success: true, saleData: saleCopy });

        } catch (err) {
            fastify.log.error('Edit mode deletion failed: ' + err.message);
            return reply.code(500).send({ success: false, message: 'Failed to prepare edit: ' + err.message });
        }
    });

    // ─────────────────────────────────────────────────────────
    // GET /api/sales/:id/receipt-data
    // Returns the exact receipt JSON that was saved when the sale
    // was created in sales.js. Used by the "Print Receipt" action
    // on the General Sales page, for cases where the shopkeeper
    // forgot to print at the time of sale.
    // ─────────────────────────────────────────────────────────
    fastify.get('/api/sales/:id/receipt-data', async (req, reply) => {
        const { id } = req.params;
        try {
            const [[sale]] = await db.query(`SELECT * FROM sales WHERE id = ?`, [id]);
            if (!sale) {
                return reply.code(404).send({ success: false, message: 'Sale not found.' });
            }

            const [[customer]]  = await db.query(`SELECT * FROM customers WHERE id = ?`, [sale.customer_id]);
            const [[shop]]      = await db.query(`SELECT shop_name, address, phone FROM admin_settings LIMIT 1`);
            const [[rSettings]] = await db.query(`SELECT * FROM receipt_settings WHERE id = 1`);

            const [items] = await db.query(`
                SELECT sale_items.*, purchases.type, purchases.product_name, purchases.unit
                FROM sale_items
                JOIN purchases ON sale_items.purchase_id = purchases.id
                WHERE sale_items.sale_id = ? AND sale_items.deleted_at IS NULL
            `, [id]);

            const formattedItems = items.map(item => ({
                id: item.id,
                product_name: item.product_name,
                unit: item.unit,
                type: item.type,
                quantity: item.quantity,
                price: item.price,
                discount_type: item.discount_type,
                discount_value: item.discount_value,
                discount_amount: item.discount_amount,
                tax_type: item.tax_type,
                tax_value: item.tax_value,
                tax_amount: item.tax_amount,
                total_after_discount: item.total_after_discount,
            }));

            // ── Advance actually applied to THIS sale — payments rows
            // are written once and never rewritten, so this is exact. ──
            const [[advRow]] = await db.query(
                `SELECT COALESCE(SUM(amount),0) as used
                 FROM payments WHERE sale_id = ? AND method = 'advance' AND deleted_at IS NULL`,
                [id]
            );
            const advanceUsedThisSale = parseFloat(advRow.used) || 0;

            let advanceDepositInfo = null;
            if (advanceUsedThisSale > 0) {
                const [[groupRow]] = await db.query(
                    `SELECT transaction_group_id FROM payments WHERE sale_id = ? AND method = 'advance' LIMIT 1`,
                    [id]
                );

                let usedForOldBalance = 0;
                let oldInvoicesPaid = [];
                let totalDeposited = advanceUsedThisSale; // fallback only for sales made before this fix

                if (groupRow?.transaction_group_id) {
                    const [oldPayments] = await db.query(
                        `SELECT p.amount, s.voucher_no FROM payments p
                         JOIN sales s ON s.id = p.sale_id
                         WHERE p.transaction_group_id = ? AND p.sale_id != ? AND p.method = 'advance'`,
                        [groupRow.transaction_group_id, id]
                    );
                    usedForOldBalance = oldPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
                    oldInvoicesPaid = oldPayments.map(p => ({
                        voucher_no: p.voucher_no,
                        amount_paid: parseFloat(p.amount),
                    }));

                    const [[depositRow]] = await db.query(
                        `SELECT amount_deposited FROM advance_deposits WHERE transaction_group_id = ? LIMIT 1`,
                        [groupRow.transaction_group_id]
                    );
                    if (depositRow) {
                        totalDeposited = parseFloat(depositRow.amount_deposited);
                    }
                }

                advanceDepositInfo = {
                    total_deposited: totalDeposited,
                    used_for_current_sale: advanceUsedThisSale,
                    used_for_old_balance: usedForOldBalance,
                    remaining: parseFloat(customer?.advance_payment || 0),
                    old_invoices_paid: oldInvoicesPaid,
                };
            }

            const previousBalance  = parseFloat(sale.previous_balance_snapshot || 0);
            const grandTotal       = parseFloat(sale.grand_total);
            const remainingBalance = parseFloat(sale.remaining_balance);
            const liveCustomerBal  = parseFloat(customer?.current_balance || 0);

            const receipt = {
                is_quotation: false,
                shop: shop || {},
                seller_name: sale.seller_name || 'N/A',
                sale: {
                    voucher_no: sale.voucher_no,
                    sale_date: sale.sale_date,
                    payment_type: sale.payment_type,
                    status: sale.status,
                    subtotal: sale.subtotal,
                    discount_type: sale.discount_type,
                    discount: sale.discount,
                    discount_amount: sale.discount_amount,
                    tax_type: sale.tax_type,
                    tax: sale.tax,
                    tax_amount: sale.tax_amount,
                    grand_total: sale.grand_total,
                    received_amount: sale.received_amount,
                    change_amount: sale.change_amount,
                    remaining_balance: sale.remaining_balance,
                    due_date: sale.due_date,
                },
                customer: {
                    name: customer?.name || 'Walk-in Customer',
                    contact: customer?.contact || '',
                    shop_name: customer?.shop_name || '',
                    city: customer?.city || '',
                    customer_type: customer?.customer_type || 'cash',
                    current_balance: liveCustomerBal,
                    advance_payment: parseFloat(customer?.advance_payment || 0),
                },
                items: formattedItems,
                previous_balance: previousBalance,
                total_payable: previousBalance > 0 ? previousBalance + grandTotal : grandTotal,
                advance_used: advanceUsedThisSale,
                advance_deposit_info: advanceDepositInfo,
                total_paid: grandTotal - remainingBalance,
                was_previous_balance_cleared: previousBalance > 0 && liveCustomerBal <= 0,
                receiptSettings: {
                    paper_size: rSettings?.paper_size || '80mm',
                    design_type: rSettings?.design_type || 'design1',
                    language: rSettings?.language || 'en',
                    show_signature: !!rSettings?.show_signature,
                    show_stamp: !!rSettings?.show_stamp,
                    show_paid_overlay: !!rSettings?.show_paid_overlay,
                },
            };

            return reply.send({ success: true, receipt });
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ success: false, message: err.message });
        }
    });

}