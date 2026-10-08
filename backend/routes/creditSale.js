import pool from '../db.js';
import { logActivity, describeChanges, formatValue, formatDateValue  } from '../helpers/activityLogger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { getCurrencySettings, formatPrice } from '../utils/currency.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export default async function creditSaleRoutes(fastify) {

    // GET /sales/credit/data  -> mirrors getCreditSalesData()
    fastify.get('/api/sales/credit/data', async (req, reply) => {
        const page = parseInt(req.query.page) || 1;
        const perPage = 10;
        const offset = (page - 1) * perPage;

        const sortableColumns = {
            customer_name: 'customers.name',
            shop_name: 'customers.shop_name',
            contact: 'customers.contact',
            invoice_no: 'sales.voucher_no',
            voucher_no: 'sales.voucher_no',
            grand_total: 'sales.grand_total',
            sale_date: 'sales.sale_date',
            remaining_balance: 'sales.remaining_balance',
            payment_type: 'sales.payment_type',
            status: 'sales.status',
            id: 'sales.id',
            due_date: 'sales.due_date',
        };

        let sortColumn = sortableColumns[req.query.sort_column] || 'sales.id';
        let sortDirection = (req.query.sort_direction || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        const searchQuery = req.query.search || null;
        const searchType = req.query.search_type || 'voucher';

        try {
            // ── Build WHERE + params (mirrors Laravel query builder) ──
            let where = `sales.payment_type = 'credit'
                         AND sales.status IN ('unpaid','partial')
                         AND sales.deleted_at IS NULL`;
            const params = [];

            if (searchQuery) {
                if (searchType === 'voucher') {
                    where += ` AND sales.voucher_no LIKE ?`;
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'customer') {
                    where += ` AND customers.name LIKE ?`;
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'contact') {
                    where += ` AND customers.contact LIKE ?`;
                    params.push(`%${searchQuery}%`);
                }
            }

            // total count for pagination
            const [countRows] = await pool.query(
                `SELECT COUNT(*) as total
                 FROM sales
                 JOIN customers ON sales.customer_id = customers.id
                 WHERE ${where}`,
                params
            );
            const total = countRows[0].total;

            // main page query
            const [salesRows] = await pool.query(
                `SELECT sales.*,
                        customers.id as customer_id_ref,
                        customers.name as customer_name,
                        customers.shop_name as customer_shop_name,
                        customers.contact as customer_contact
                 FROM sales
                 JOIN customers ON sales.customer_id = customers.id
                 WHERE ${where}
                 ORDER BY ${sortColumn} ${sortDirection}
                 LIMIT ? OFFSET ?`,
                [...params, perPage, offset]
            );

            // shape "customer" relation like Laravel's ->with('customer')
            const sales = salesRows.map(row => ({
                ...row,
                customer: {
                    id: row.customer_id_ref,
                    name: row.customer_name,
                    shop_name: row.customer_shop_name,
                    contact: row.customer_contact,
                }
            }));

            const saleIds = sales.map(s => s.id);
            let saleItems = {};

            if (saleIds.length > 0) {
                const placeholders = saleIds.map(() => '?').join(',');

                const [itemRows] = await pool.query(
                    `SELECT
                        sale_items.id,
                        sale_items.sale_id,
                        purchases.type,
                        purchases.product_name,
                        sale_items.price,
                        sale_items.quantity as original_quantity,
                        COALESCE(returned_qty.total_returned, 0) as returned_quantity,
                        (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) as remaining_quantity,
                        sale_items.discount_type,
                        sale_items.discount_value,
                        sale_items.discount_amount as original_discount_amount,
                        sale_items.tax_type,
                        sale_items.tax_value,
                        sale_items.tax_amount as original_tax_amount,
                        CASE
                            WHEN (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) > 0
                            THEN (sale_items.discount_amount * (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) / sale_items.quantity)
                            ELSE 0
                        END as adjusted_discount_amount,
                        CASE
                            WHEN (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) > 0
                            THEN (sale_items.tax_amount * (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) / sale_items.quantity)
                            ELSE 0
                        END as adjusted_tax_amount,
                        CASE
                            WHEN sale_items.tax_type = 'percentage' AND (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) > 0
                            THEN sale_items.tax_value
                            WHEN sale_items.tax_type = 'amount' AND (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) > 0
                            THEN (sale_items.tax_amount * (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) / sale_items.quantity)
                            ELSE 0
                        END as adjusted_tax_value,
                        CASE
                            WHEN (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) > 0
                            THEN (sale_items.quantity - COALESCE(returned_qty.total_returned, 0)) * (sale_items.total_after_tax / sale_items.quantity)
                            ELSE 0
                        END as total_after_tax
                     FROM sale_items
                     JOIN purchases ON sale_items.purchase_id = purchases.id
                     LEFT JOIN (
                         SELECT sale_item_id, SUM(quantity_returned) as total_returned
                         FROM sale_return_items
                         GROUP BY sale_item_id
                     ) as returned_qty ON sale_items.id = returned_qty.sale_item_id
                     WHERE sale_items.sale_id IN (${placeholders})
                       AND sale_items.deleted_at IS NULL
                     HAVING remaining_quantity > 0`,
                    saleIds
                );

                // groupBy sale_id (mirrors Laravel ->groupBy('sale_id'))
                saleItems = itemRows.reduce((acc, item) => {
                    if (!acc[item.sale_id]) acc[item.sale_id] = [];
                    acc[item.sale_id].push(item);
                    return acc;
                }, {});
            }

            const lastPage = Math.max(Math.ceil(total / perPage), 1);

            return reply.send({
                success: true,
                data: sales,
                saleItems,
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    first_item: total === 0 ? 0 : offset + 1,
                    last_item: Math.min(offset + perPage, total),
                    has_more_pages: page < lastPage,
                    on_first_page: page === 1,
                }
            });

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to load credit sales' });
        }
    });

    // POST /api/sales/:id/mark-paid  ->  mirrors markAsPaid()
fastify.post('/api/sales/:id/mark-paid', async (req, reply) => {
    const saleId = parseInt(req.params.id);

    try {
        const [[saleRows]] = await pool.query(
            `SELECT sales.*, customers.current_balance as customer_balance
             FROM sales
             LEFT JOIN customers ON sales.customer_id = customers.id
             WHERE sales.id = ?`,
            [saleId]
        );

        if (!saleRows) {
            return reply.status(404).send({ success: false, message: 'Sale not found.' });
        }

        const sale = saleRows;

        if (sale.status === 'paid') {
            return reply.send({ success: false, message: 'This sale is already marked as paid.' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Calculate already paid amount
            const [[{ alreadyPaid }]] = await conn.query(
                `SELECT COALESCE(SUM(amount), 0) as alreadyPaid FROM payments WHERE sale_id = ? AND deleted_at IS NULL`,
                [saleId]
            );

            const remainingToPay = parseFloat(sale.grand_total) - parseFloat(alreadyPaid);

            let lastPaymentMethod = 'cash';

            // If something is still due, add the difference as a new payment
            if (remainingToPay > 0) {
                await conn.query(
                    `INSERT INTO payments (sale_id, amount, method, payment_date, created_at, updated_at)
                     VALUES (?, ?, 'cash', NOW(), NOW(), NOW())`,
                    [saleId, remainingToPay]
                );
                lastPaymentMethod = 'cash';
            }

            const oldRemainingBalance = parseFloat(sale.remaining_balance);

            // Update sale status
            await conn.query(
                `UPDATE sales SET status = 'paid', remaining_balance = 0, received_amount = grand_total, updated_at = NOW() WHERE id = ?`,
                [saleId]
            );

            // Reduce customer balance
            if (sale.customer_id && oldRemainingBalance > 0) {
                await conn.query(
                    `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                    [oldRemainingBalance, sale.customer_id]
                );
            }

            // Determine final payment method
            const [methodRows] = await conn.query(
                `SELECT method FROM payments WHERE sale_id = ? AND deleted_at IS NULL`,
                [saleId]
            );

            let finalMethod = 'cash';
            if (methodRows.length > 0) {
                const methodCounts = {};
                methodRows.forEach(r => {
                    methodCounts[r.method] = (methodCounts[r.method] || 0) + 1;
                });
                const sorted = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);
                const maxCount = sorted[0][1];
                const topMethods = sorted.filter(e => e[1] === maxCount).map(e => e[0]);
                finalMethod = topMethods.length === 1 ? topMethods[0] : lastPaymentMethod;
            }

            // Update sale payment_type
            await conn.query(
                `UPDATE sales SET payment_type = ?, updated_at = NOW() WHERE id = ?`,
                [finalMethod, saleId]
            );

            // Clear due_date if exists
            if (sale.due_date) {
                await conn.query(
                    `UPDATE sales SET due_date = NULL, updated_at = NOW() WHERE id = ?`,
                    [saleId]
                );
            }

            // Update customer type if no other credit sales
            if (sale.customer_id) {
                const [[{ hasCreditSales }]] = await conn.query(
                    `SELECT COUNT(*) as hasCreditSales FROM sales WHERE customer_id = ? AND payment_type = 'credit' AND id != ? AND deleted_at IS NULL`,
                    [sale.customer_id, saleId]
                );
                if (!hasCreditSales) {
                    await conn.query(
                        `UPDATE customers SET customer_type = ?, updated_at = NOW() WHERE id = ?`,
                        [finalMethod, sale.customer_id]
                    );
                }
            }

            await conn.commit();

            await logActivity(req, {
                action_type: 'edit',
                description: `Marked credit sale "${sale.voucher_no}" as paid — Remaining balance: ${formatValue(oldRemainingBalance)} → 0`,
                entity_type: 'sale',
                entity_id: saleId,
                old_data: { status: sale.status, remaining_balance: oldRemainingBalance },
                new_data: { status: 'paid', remaining_balance: 0 },
            });

            return reply.send({ success: true, message: 'Sale marked as paid successfully!' });

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error: ' + err.message });
    }
});

// POST /api/sales/add-payment  ->  mirrors addPayment()
fastify.post('/api/sales/add-payment', async (req, reply) => {
    const { sale_id, amount, payment_method } = req.body;

    if (!sale_id || !amount || !payment_method) {
        return reply.status(400).send({ success: false, message: 'sale_id, amount, and payment_method are required.' });
    }
    if (!['cash', 'card'].includes(payment_method)) {
        return reply.status(400).send({ success: false, message: 'Invalid payment method.' });
    }
    if (parseFloat(amount) < 1) {
        return reply.status(400).send({ success: false, message: 'Amount must be at least 1.' });
    }

    try {
        const [[saleRows]] = await pool.query(
            `SELECT sales.*, customers.current_balance as customer_balance
             FROM sales
             LEFT JOIN customers ON sales.customer_id = customers.id
             WHERE sales.id = ?`,
            [sale_id]
        );

        if (!saleRows) {
            return reply.status(404).send({ success: false, message: 'Sale not found.' });
        }

        const sale = saleRows;

        if (sale.status === 'paid') {
            return reply.send({ success: false, message: 'This sale is already fully paid.' });
        }

        if (parseFloat(amount) > parseFloat(sale.remaining_balance)) {
            const currency = await getCurrencySettings();
            return reply.status(400).send({ success: false, message: `Amount cannot exceed remaining balance of ${formatPrice(sale.remaining_balance, currency)}` });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Create payment record
            const [insertResult] = await conn.query(
                `INSERT INTO payments (sale_id, amount, method, payment_date, created_at, updated_at)
                 VALUES (?, ?, ?, NOW(), NOW(), NOW())`,
                [sale_id, amount, payment_method]
            );

            // Reduce customer balance
            if (sale.customer_id) {
                await conn.query(
                    `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                    [amount, sale.customer_id]
                );
            }

            // Update remaining balance
            const newBalance = Math.max(parseFloat(sale.remaining_balance) - parseFloat(amount), 0);
            const newStatus = newBalance <= 0 ? 'paid' : 'partial';

            await conn.query(
                `UPDATE sales SET remaining_balance = ?, status = ?, received_amount = received_amount + ?, updated_at = NOW() WHERE id = ?`,
                [newBalance, newStatus, amount, sale_id]
            );

            // If fully paid, determine final payment type
            if (newStatus === 'paid') {
                const [methodRows] = await conn.query(
                    `SELECT method FROM payments WHERE sale_id = ? AND deleted_at IS NULL`,
                    [sale_id]
                );

                const methodCounts = {};
                methodRows.forEach(r => {
                    methodCounts[r.method] = (methodCounts[r.method] || 0) + 1;
                });
                const sorted = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);
                const maxCount = sorted[0][1];
                const topMethods = sorted.filter(e => e[1] === maxCount).map(e => e[0]);
                const finalMethod = topMethods.length === 1 ? topMethods[0] : payment_method;

                await conn.query(
                    `UPDATE sales SET payment_type = ?, updated_at = NOW() WHERE id = ?`,
                    [finalMethod, sale_id]
                );

                // Clear due_date
                if (sale.due_date) {
                    await conn.query(
                        `UPDATE sales SET due_date = NULL, updated_at = NOW() WHERE id = ?`,
                        [sale_id]
                    );
                }

                // Update customer type
                if (sale.customer_id) {
                    const [[{ hasCreditSales }]] = await conn.query(
                        `SELECT COUNT(*) as hasCreditSales FROM sales WHERE customer_id = ? AND payment_type = 'credit' AND id != ? AND deleted_at IS NULL`,
                        [sale.customer_id, sale_id]
                    );
                    if (!hasCreditSales) {
                        await conn.query(
                            `UPDATE customers SET customer_type = ?, updated_at = NOW() WHERE id = ?`,
                            [finalMethod, sale.customer_id]
                        );
                    }
                }
            }

            await conn.commit();

            await logActivity(req, {
                action_type: 'edit',
                description: `Added ${payment_method} payment of Rs ${parseFloat(amount).toFixed(2)} to credit sale "${sale.voucher_no}" — Remaining balance: ${formatValue(sale.remaining_balance)} → ${formatValue(newBalance)}`,
                entity_type: 'sale',
                entity_id: sale_id,
                old_data: { remaining_balance: sale.remaining_balance, status: sale.status },
                new_data: { remaining_balance: newBalance, status: newStatus },
            });

            return reply.send({ success: true, message: 'Payment added successfully!' });

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error: ' + err.message });
    }
});

// PUT /api/sales/:id/due-date  ->  mirrors updateDueDate()
fastify.put('/api/sales/:id/due-date', async (req, reply) => {
    const saleId = parseInt(req.params.id);
    const { new_due_date } = req.body;

    if (!new_due_date) {
        return reply.status(422).send({ success: false, message: 'Please select a due date.' });
    }

    const selectedDateTime = new Date(new_due_date);
    if (isNaN(selectedDateTime.getTime())) {
        return reply.status(422).send({ success: false, message: 'Invalid date format.' });
    }
    if (selectedDateTime <= new Date()) {
        return reply.status(422).send({ success: false, message: 'Cannot set a past date or time. Please select a future date and time.' });
    }

    try {
        const [[sale]] = await pool.query(
            `SELECT id, voucher_no, payment_type, status, due_date FROM sales WHERE id = ? AND deleted_at IS NULL`,
            [saleId]
        );

        if (!sale) {
            return reply.status(404).send({ success: false, message: 'Sale not found.' });
        }
        if (sale.payment_type !== 'credit') {
            return reply.status(400).send({ success: false, message: 'Only credit sales can have due dates updated.' });
        }
        if (sale.status === 'paid') {
            return reply.status(400).send({ success: false, message: 'Cannot update due date for paid sales.' });
        }

        // Format to MySQL datetime
        const pad = n => String(n).padStart(2, '0');
        const d = selectedDateTime;
        const mysqlDatetime = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

        await pool.query(
            `UPDATE sales SET due_date = ?, updated_at = NOW() WHERE id = ?`,
            [mysqlDatetime, saleId]
        );

        await logActivity(req, {
            action_type: 'edit',
            description: `Updated due date for credit sale "${sale.voucher_no}" — ${formatDateValue(sale.due_date)} → ${formatDateValue(mysqlDatetime)}`,
            entity_type: 'sale',
            entity_id: saleId,
            old_data: { due_date: sale.due_date },
            new_data: { due_date: mysqlDatetime },
        });

        return reply.send({ success: true, message: 'Due date updated successfully!', new_due_date: mysqlDatetime });

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error updating due date: ' + err.message });
    }
});

// DELETE /api/sales/credit/:id/return  ->  mirrors returnCreditSale()
fastify.delete('/api/sales/credit/:id/return', async (req, reply) => {
    const saleId = parseInt(req.params.id);

    try {
        const [[sale]] = await pool.query(
            `SELECT id, voucher_no, status, payment_type, remaining_balance, grand_total, customer_id FROM sales WHERE id = ? AND deleted_at IS NULL`,
            [saleId]
        );

        if (!sale) {
            return reply.status(404).send({ success: false, message: 'Sale not found.' });
        }
        if (!['unpaid', 'partial'].includes(sale.status) || sale.payment_type !== 'credit') {
            return reply.status(400).send({ success: false, message: 'Only unpaid credit sales can be returned.' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Restore inventory quantities
            const [saleItems] = await conn.query(
                `SELECT sale_items.quantity, sale_items.purchase_id, purchases.product_name
                 FROM sale_items
                 JOIN purchases ON sale_items.purchase_id = purchases.id
                 WHERE sale_items.sale_id = ? AND sale_items.deleted_at IS NULL`,
                [saleId]
            );

            for (const item of saleItems) {
                await conn.query(
                    `UPDATE purchases SET sold_quantity = sold_quantity - ?, updated_at = NOW() WHERE id = ?`,
                    [item.quantity, item.purchase_id]
                );
            }

            // Reduce customer balance
            if (sale.customer_id && parseFloat(sale.remaining_balance) > 0) {
                await conn.query(
                    `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                    [sale.remaining_balance, sale.customer_id]
                );
            }

            // Delete payments
            await conn.query(`DELETE FROM payments WHERE sale_id = ?`, [saleId]);

            // Delete sale items
            await conn.query(`DELETE FROM sale_items WHERE sale_id = ?`, [saleId]);

            // Delete the sale
            await conn.query(`DELETE FROM sales WHERE id = ?`, [saleId]);

            await conn.commit();

            const itemsSummary = saleItems.map(i => `${i.product_name} (Qty: ${formatValue(i.quantity)})`).join(', ');
            await logActivity(req, {
                action_type: 'delete',
                description: `Returned credit sale "${sale.voucher_no}" (Rs ${formatValue(sale.grand_total)}) — inventory restored — Items: ${itemsSummary}`,
                entity_type: 'sale',
                entity_id: saleId,
                old_data: sale,
            });

            return reply.send({ success: true, message: 'Credit sale returned successfully and inventory restored.' });

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error returning sale: ' + err.message });
    }
});

// DELETE /api/sales/credit/:saleId/item/:itemId/delete  ->  mirrors deleteCreditSaleItem()
fastify.delete('/api/sales/credit/:saleId/item/:itemId/delete', async (req, reply) => {
    const saleId = parseInt(req.params.saleId);
    const saleItemId = parseInt(req.params.itemId);

    try {
        const [[sale]] = await pool.query(
            `SELECT id, voucher_no, status, payment_type, remaining_balance, grand_total, customer_id,
                    discount_type, discount, tax_type, tax
             FROM sales WHERE id = ? AND deleted_at IS NULL`,
            [saleId]
        );

        if (!sale) return reply.status(404).send({ success: false, message: 'Sale not found.' });
        if (!['unpaid', 'partial'].includes(sale.status) || sale.payment_type !== 'credit') {
            return reply.status(400).send({ success: false, message: 'Items can only be deleted from unpaid credit sales.' });
        }

        const [[saleItem]] = await pool.query(
            `SELECT sale_items.*, purchases.product_name
             FROM sale_items
             JOIN purchases ON sale_items.purchase_id = purchases.id
             WHERE sale_items.id = ? AND sale_items.sale_id = ? AND sale_items.deleted_at IS NULL`,
            [saleItemId, saleId]
        );

        if (!saleItem) return reply.status(404).send({ success: false, message: 'Item not found.' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Restore inventory
            await conn.query(
                `UPDATE purchases SET sold_quantity = sold_quantity - ?, updated_at = NOW() WHERE id = ?`,
                [saleItem.quantity, saleItem.purchase_id]
            );

            // Delete the sale item
            await conn.query(`DELETE FROM sale_items WHERE id = ?`, [saleItemId]);

            // Check remaining items
            const [[{ itemCount }]] = await conn.query(
                `SELECT COUNT(*) as itemCount FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
                [saleId]
            );

            if (itemCount === 0) {
                // No items left — reduce customer balance then delete sale
                if (sale.customer_id && parseFloat(sale.remaining_balance) > 0) {
                    await conn.query(
                        `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                        [sale.remaining_balance, sale.customer_id]
                    );
                }
                await conn.query(`DELETE FROM payments WHERE sale_id = ?`, [saleId]);
                await conn.query(`DELETE FROM sales WHERE id = ?`, [saleId]);

                await conn.commit();

                await logActivity(req, {
                    action_type: 'delete',
                    description: `Deleted item "${saleItem.product_name}" (Qty: ${formatValue(saleItem.quantity)}) from credit sale "${sale.voucher_no}" — last item removed, sale deleted`,
                    entity_type: 'sale',
                    entity_id: saleId,
                    old_data: { product_name: saleItem.product_name, quantity: saleItem.quantity },
                });

                return reply.send({ success: true, message: 'Item deleted successfully and totals recalculated.' });

            } else {
                const oldRemainingBalance = parseFloat(sale.remaining_balance);

                // Recalculate totals
                const [[{ newSubtotal }]] = await conn.query(
                    `SELECT COALESCE(SUM(total_after_discount), 0) as newSubtotal FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
                    [saleId]
                );

                let newSaleDiscountAmount = 0;
                if (sale.discount_type === 'percentage' && parseFloat(sale.discount) > 0) {
                    newSaleDiscountAmount = (newSubtotal * parseFloat(sale.discount)) / 100;
                } else if (sale.discount_type === 'amount') {
                    newSaleDiscountAmount = Math.min(parseFloat(sale.discount), newSubtotal);
                }

                let newTaxAmount = 0;
                if (sale.tax_type === 'percentage' && parseFloat(sale.tax) > 0) {
                    newTaxAmount = (newSubtotal * parseFloat(sale.tax)) / 100;
                } else if (sale.tax_type === 'amount') {
                    newTaxAmount = Math.min(parseFloat(sale.tax), newSubtotal);
                }

                const newGrandTotal = newSubtotal - newSaleDiscountAmount + newTaxAmount;
                const paidAmount = parseFloat(sale.grand_total) - oldRemainingBalance;
                const newRemainingBalance = Math.max(0, newGrandTotal - paidAmount);

                await conn.query(
                    `UPDATE sales SET subtotal = ?, discount_amount = ?, tax_amount = ?, grand_total = ?, remaining_balance = ?, updated_at = NOW() WHERE id = ?`,
                    [newSubtotal, newSaleDiscountAmount, newTaxAmount, newGrandTotal, newRemainingBalance, saleId]
                );

                const balanceDifference = oldRemainingBalance - newRemainingBalance;
                if (balanceDifference !== 0 && sale.customer_id) {
                    await conn.query(
                        `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                        [balanceDifference, sale.customer_id]
                    );
                }

                await conn.commit();

                await logActivity(req, {
                    action_type: 'delete',
                    description: `Deleted item "${saleItem.product_name}" (Qty: ${formatValue(saleItem.quantity)}) from credit sale "${sale.voucher_no}" — Grand Total: ${formatValue(sale.grand_total)} → ${formatValue(newGrandTotal)}`,
                    entity_type: 'sale',
                    entity_id: saleId,
                    old_data: { product_name: saleItem.product_name, quantity: saleItem.quantity, grand_total: sale.grand_total },
                    new_data: { grand_total: newGrandTotal },
                });

                return reply.send({ success: true, message: 'Item deleted successfully and totals recalculated.' });
            }

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error deleting item: ' + err.message });
    }
});

// PATCH /api/sales/credit/:saleId/item/:itemId/reduce  ->  mirrors reduceCreditSaleItemQuantity()
fastify.patch('/api/sales/credit/:saleId/item/:itemId/reduce', async (req, reply) => {
    const saleId = parseInt(req.params.saleId);
    const saleItemId = parseInt(req.params.itemId);
    const { new_quantity } = req.body;

    if (new_quantity === undefined || new_quantity === null || parseInt(new_quantity) < 0) {
        return reply.status(400).send({ success: false, message: 'new_quantity is required and must be >= 0.' });
    }

    const newQuantity = parseInt(new_quantity);

    try {
        const [[sale]] = await pool.query(
            `SELECT id, voucher_no, status, payment_type, remaining_balance, grand_total, customer_id,
                    discount_type, discount, tax_type, tax
             FROM sales WHERE id = ? AND deleted_at IS NULL`,
            [saleId]
        );

        if (!sale) return reply.status(404).send({ success: false, message: 'Sale not found.' });
        if (!['unpaid', 'partial'].includes(sale.status) || sale.payment_type !== 'credit') {
            return reply.status(400).send({ success: false, message: 'Quantity can only be reduced for unpaid credit sales.' });
        }

        const [[saleItem]] = await pool.query(
            `SELECT sale_items.*, purchases.product_name
             FROM sale_items
             JOIN purchases ON sale_items.purchase_id = purchases.id
             WHERE sale_items.id = ? AND sale_items.sale_id = ? AND sale_items.deleted_at IS NULL`,
            [saleItemId, saleId]
        );

        if (!saleItem) return reply.status(404).send({ success: false, message: 'Item not found.' });

        const currentQuantity = saleItem.quantity;

        if (newQuantity >= currentQuantity) {
            return reply.status(400).send({ success: false, message: 'New quantity must be less than current quantity.' });
        }

        // If 0, delegate to delete item logic by calling the same pool queries inline
        if (newQuantity === 0) {
            // Re-use delete item logic inline
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();

                await conn.query(
                    `UPDATE purchases SET sold_quantity = sold_quantity - ?, updated_at = NOW() WHERE id = ?`,
                    [currentQuantity, saleItem.purchase_id]
                );

                await conn.query(`DELETE FROM sale_items WHERE id = ?`, [saleItemId]);

                const [[{ itemCount }]] = await conn.query(
                    `SELECT COUNT(*) as itemCount FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
                    [saleId]
                );

                if (itemCount === 0) {
                    if (sale.customer_id && parseFloat(sale.remaining_balance) > 0) {
                        await conn.query(
                            `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                            [sale.remaining_balance, sale.customer_id]
                        );
                    }
                    await conn.query(`DELETE FROM payments WHERE sale_id = ?`, [saleId]);
                    await conn.query(`DELETE FROM sales WHERE id = ?`, [saleId]);

                    await conn.commit();

                    await logActivity(req, {
                        action_type: 'edit',
                        description: `Reduced "${saleItem.product_name}" quantity to 0 on credit sale "${sale.voucher_no}" — last item removed, sale deleted`,
                        entity_type: 'sale',
                        entity_id: saleId,
                        old_data: { product_name: saleItem.product_name, quantity: currentQuantity },
                        new_data: { quantity: 0 },
                    });

                    return reply.send({ success: true, message: `Item removed. Quantity was ${currentQuantity}, now 0.` });
                } else {
                    const oldRemainingBalance = parseFloat(sale.remaining_balance);
                    const [[{ newSubtotal }]] = await conn.query(
                        `SELECT COALESCE(SUM(total_after_discount), 0) as newSubtotal FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
                        [saleId]
                    );
                    let newSaleDiscountAmount = 0;
                    if (sale.discount_type === 'percentage' && parseFloat(sale.discount) > 0) {
                        newSaleDiscountAmount = (newSubtotal * parseFloat(sale.discount)) / 100;
                    } else if (sale.discount_type === 'amount') {
                        newSaleDiscountAmount = Math.min(parseFloat(sale.discount), newSubtotal);
                    }
                    let newTaxAmount = 0;
                    if (sale.tax_type === 'percentage' && parseFloat(sale.tax) > 0) {
                        newTaxAmount = (newSubtotal * parseFloat(sale.tax)) / 100;
                    } else if (sale.tax_type === 'amount') {
                        newTaxAmount = Math.min(parseFloat(sale.tax), newSubtotal);
                    }
                    const newGrandTotal = newSubtotal - newSaleDiscountAmount + newTaxAmount;
                    const paidAmount = parseFloat(sale.grand_total) - oldRemainingBalance;
                    const newRemainingBalance = Math.max(0, newGrandTotal - paidAmount);
                    await conn.query(
                        `UPDATE sales SET subtotal = ?, discount_amount = ?, tax_amount = ?, grand_total = ?, remaining_balance = ?, updated_at = NOW() WHERE id = ?`,
                        [newSubtotal, newSaleDiscountAmount, newTaxAmount, newGrandTotal, newRemainingBalance, saleId]
                    );
                    const balanceDifference = oldRemainingBalance - newRemainingBalance;
                    if (balanceDifference !== 0 && sale.customer_id) {
                        await conn.query(
                            `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                            [balanceDifference, sale.customer_id]
                        );
                    }

                    await conn.commit();

                    await logActivity(req, {
                        action_type: 'edit',
                        description: `Reduced "${saleItem.product_name}" quantity to 0 on credit sale "${sale.voucher_no}" — Grand Total: ${formatValue(sale.grand_total)} → ${formatValue(newGrandTotal)}`,
                        entity_type: 'sale',
                        entity_id: saleId,
                        old_data: { product_name: saleItem.product_name, quantity: currentQuantity, grand_total: sale.grand_total },
                        new_data: { quantity: 0, grand_total: newGrandTotal },
                    });

                    return reply.send({ success: true, message: `Item removed. Quantity was ${currentQuantity}, now 0.` });
                }

            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }
        }

        // Normal reduce (newQuantity > 0)
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const quantityDifference = currentQuantity - newQuantity;

            // Restore inventory for reduced quantity
            await conn.query(
                `UPDATE purchases SET sold_quantity = sold_quantity - ?, updated_at = NOW() WHERE id = ?`,
                [quantityDifference, saleItem.purchase_id]
            );

           // Recalculate item totals
           const unitPrice = parseFloat(saleItem.price);
           const newItemTotal = unitPrice * newQuantity;

           let newDiscountAmount = 0;
           if (saleItem.discount_type === 'percentage' && parseFloat(saleItem.discount_value) > 0) {
               newDiscountAmount = (newItemTotal * parseFloat(saleItem.discount_value)) / 100;
           } else if (saleItem.discount_type === 'amount') {
               newDiscountAmount = (parseFloat(saleItem.discount_amount) * newQuantity) / currentQuantity;
           }

           const newTotalAfterDiscount = newItemTotal - newDiscountAmount;

           let newItemTaxAmount = 0;
           if (saleItem.tax_type === 'percentage' && parseFloat(saleItem.tax_value) > 0) {
               newItemTaxAmount = (newTotalAfterDiscount * parseFloat(saleItem.tax_value)) / 100;
           } else if (saleItem.tax_type === 'amount') {
               newItemTaxAmount = (parseFloat(saleItem.tax_amount) * newQuantity) / currentQuantity;
           }

           const newTotalAfterTax = newTotalAfterDiscount + newItemTaxAmount;

           await conn.query(
               `UPDATE sale_items SET quantity = ?, total = ?, discount_amount = ?, total_after_discount = ?, tax_amount = ?, total_after_tax = ?, updated_at = NOW() WHERE id = ?`,
               [newQuantity, newItemTotal, newDiscountAmount, newTotalAfterDiscount, newItemTaxAmount, newTotalAfterTax, saleItemId]
           );

            const oldRemainingBalance = parseFloat(sale.remaining_balance);

            // Recalculate sale totals
            const [[{ newSubtotal }]] = await conn.query(
                `SELECT COALESCE(SUM(total_after_discount), 0) as newSubtotal FROM sale_items WHERE sale_id = ? AND deleted_at IS NULL`,
                [saleId]
            );

            let newSaleDiscountAmount = 0;
            if (sale.discount_type === 'percentage' && parseFloat(sale.discount) > 0) {
                newSaleDiscountAmount = (newSubtotal * parseFloat(sale.discount)) / 100;
            } else if (sale.discount_type === 'amount') {
                newSaleDiscountAmount = Math.min(parseFloat(sale.discount), newSubtotal);
            }

            let newTaxAmount = 0;
            if (sale.tax_type === 'percentage' && parseFloat(sale.tax) > 0) {
                newTaxAmount = (newSubtotal * parseFloat(sale.tax)) / 100;
            } else if (sale.tax_type === 'amount') {
                newTaxAmount = Math.min(parseFloat(sale.tax), newSubtotal);
            }

            const newGrandTotal = newSubtotal - newSaleDiscountAmount + newTaxAmount;
            const paidAmount = parseFloat(sale.grand_total) - oldRemainingBalance;
            const newRemainingBalance = Math.max(0, newGrandTotal - paidAmount);

            await conn.query(
                `UPDATE sales SET subtotal = ?, discount_amount = ?, tax_amount = ?, grand_total = ?, remaining_balance = ?, updated_at = NOW() WHERE id = ?`,
                [newSubtotal, newSaleDiscountAmount, newTaxAmount, newGrandTotal, newRemainingBalance, saleId]
            );

            const balanceDifference = oldRemainingBalance - newRemainingBalance;
            if (balanceDifference !== 0 && sale.customer_id) {
                await conn.query(
                    `UPDATE customers SET current_balance = current_balance - ?, updated_at = NOW() WHERE id = ?`,
                    [balanceDifference, sale.customer_id]
                );
            }

            await conn.commit();

            await logActivity(req, {
                action_type: 'edit',
                description: `Reduced "${saleItem.product_name}" quantity on credit sale "${sale.voucher_no}" — Qty: ${currentQuantity} → ${newQuantity}, Grand Total: ${formatValue(sale.grand_total)} → ${formatValue(newGrandTotal)}`,
                entity_type: 'sale',
                entity_id: saleId,
                old_data: { product_name: saleItem.product_name, quantity: currentQuantity, grand_total: sale.grand_total },
                new_data: { quantity: newQuantity, grand_total: newGrandTotal },
            });

            return reply.send({ success: true, message: `Quantity reduced from ${currentQuantity} to ${newQuantity}.` });

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error reducing quantity: ' + err.message });
    }
});

// GET /api/sales/credit/:voucher_no/pdf  ->  mirrors generateCreditSalePdf()
fastify.get('/api/sales/credit/:voucher_no/pdf', async (req, reply) => {
    const voucherNo = req.params.voucher_no;

    try {
        // Fetch sale with customer
        const [[sale]] = await pool.query(
            `SELECT sales.*, 
                    customers.name as customer_name,
                    customers.shop_name as customer_shop_name,
                    customers.contact as customer_contact,
                    customers.city as customer_city
             FROM sales
             LEFT JOIN customers ON sales.customer_id = customers.id
             WHERE sales.voucher_no = ? AND sales.deleted_at IS NULL`,
            [voucherNo]
        );

        if (!sale) {
            return reply.status(404).send({ success: false, message: 'Sale not found.' });
        }

        // Fetch sale items
        const [items] = await pool.query(
            `SELECT sale_items.*,
                    purchases.product_name,
                    purchases.type as product_type
             FROM sale_items
             JOIN purchases ON sale_items.purchase_id = purchases.id
             WHERE sale_items.sale_id = ? AND sale_items.deleted_at IS NULL`,
            [sale.id]
        );

        // Fetch payments
        const [payments] = await pool.query(
            `SELECT * FROM payments WHERE sale_id = ? AND deleted_at IS NULL ORDER BY payment_date ASC`,
            [sale.id]
        );

        // Fetch admin settings
        const [[admin]] = await pool.query(`SELECT * FROM admin_settings LIMIT 1`);
        const currency = await getCurrencySettings();

        const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const remainingBalance = parseFloat(sale.remaining_balance);

        function formatDate(dateString) {
            if (!dateString) return 'N/A';
            const d = new Date(dateString);
            if (isNaN(d.getTime())) return 'N/A';
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        }

        function formatDateTime(dateString) {
            if (!dateString) return 'N/A';
            const d = new Date(dateString);
            if (isNaN(d.getTime())) return 'N/A';
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
                ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }

        // Build logo HTML
        let logoHtml = '';
        if (admin?.logo) {
            const logoPath = path.join(PUBLIC_DIR, admin.logo);
            if (fs.existsSync(logoPath)) {
                const logoData = fs.readFileSync(logoPath);
                const ext = path.extname(admin.logo).replace('.', '') || 'png';
                const base64 = logoData.toString('base64');
                logoHtml = `<img src="data:image/${ext};base64,${base64}" alt="Logo" class="company-logo">`;
            }
        }

        // Build items rows HTML
        let itemRowsHtml = '';
        items.forEach((item, index) => {
            const qtyDisplay = item.product_type === 'service' ? '-' : item.quantity;

            let discountDisplay = '-';
            if (parseFloat(item.discount_amount) > 0) {
                discountDisplay = item.discount_type === 'percentage'
                ? `${parseFloat(item.discount_value).toFixed(0)}% (${formatPrice(item.discount_amount, currency)})`
                : formatPrice(item.discount_amount, currency);
            }

            let taxDisplay = '-';
            if (parseFloat(item.tax_amount) > 0) {
                taxDisplay = item.tax_type === 'percentage'
                ? `${parseFloat(item.tax_value).toFixed(0)}% (${formatPrice(item.tax_amount, currency)})`
                : formatPrice(item.tax_amount, currency);
            }

            const serviceLabel = item.product_type === 'service' ? ' (service)' : '';

            itemRowsHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.product_name}${serviceLabel}</td>
                    <td>${formatPrice(item.price, currency)}</td>
                    <td>${qtyDisplay}</td>
                    <td>${discountDisplay}</td>
                    <td>${taxDisplay}</td>
                    <td>${formatPrice(item.total_after_tax, currency)}</td>
                </tr>
            `;
        });

        // Build discount/tax summary rows
        let discountSummaryHtml = '';
        if (parseFloat(sale.discount_amount) > 0) {
            const discountLabel = sale.discount_type === 'percentage'
            ? `${parseFloat(sale.discount).toFixed(0)}% (${formatPrice(sale.discount_amount, currency)})`
            : formatPrice(sale.discount_amount, currency);
            discountSummaryHtml = `
                <div class="summary-row">
                    <span>Discount:</span>
                    <span>${discountLabel}</span>
                </div>
            `;
        }

        let taxSummaryHtml = '';
        if (parseFloat(sale.tax_amount) > 0) {
            const taxLabel = sale.tax_type === 'percentage'
            ? `${parseFloat(sale.tax).toFixed(0)}% (${formatPrice(sale.tax_amount, currency)})`
            : formatPrice(sale.tax_amount, currency);
            taxSummaryHtml = `
                <div class="summary-row">
                    <span>Tax:</span>
                    <span>${taxLabel}</span>
                </div>
            `;
        }

        // Build payment history HTML
        let paymentHistoryHtml = '';
        if (payments.length > 0) {
            let paymentRows = '';
            payments.forEach((payment, index) => {
                paymentRows += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${formatDate(payment.created_at)}</td>
                        <td>${formatPrice(payment.amount, currency)}</td>
                    </tr>
                `;
            });
            paymentHistoryHtml = `
                <div style="margin-top: 15px;">
                    <div class="heading" style="font-size: 12px; margin-bottom: 10px;">Payment History</div>
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Date</th>
                                <th>Amount</th>
                            </tr>
                        </thead>
                        <tbody>${paymentRows}</tbody>
                    </table>
                </div>
            `;
        }

        // Shop name row
        const shopNameHtml = sale.customer_shop_name
            ? `<div class="info-row"><span class="info-label">Business/Shop Name:</span><span>${sale.customer_shop_name}</span></div>`
            : '';

        const statusClass = sale.status === 'paid' ? 'status-paid' : sale.status === 'partial' ? 'status-partial' : 'status-unpaid';

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Credit Sale - ${sale.voucher_no}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; color: #333; font-size: 9px; }
        .header-section { width: 100%; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #000; }
        .header-table { width: 100%; border-collapse: collapse; }
        .header-table td { vertical-align: top; padding: 5px; border: none; }
        .header-left { width: 30%; text-align: left; }
        .header-center { width: 40%; text-align: center; }
        .header-right { width: 30%; text-align: right; }
        .company-logo { max-width: 80px; max-height: 80px; object-fit: contain; }
        .shop-details .shop-name { font-weight: bold; font-size: 11px; margin-bottom: 4px; color: #2c3e50;text-transform: capitalize }
        .shop-details .detail-line { margin-bottom: 2px; color: #555; font-size: 9px; }
        .main-heading { font-size: 20px; margin-bottom: 5px; text-transform: uppercase; font-weight: bold; color: #2c3e50; }
        .sub-heading { font-size: 12px; color: #666; margin-top: 3px; }
        .customer-info { background-color: #ecf0f1; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .info-label { font-weight: bold; color: #2c3e50; }
        .header { margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #bdc3c7; }
        .heading { font-size: 14px; font-weight: bold; color: #2c3e50; margin-bottom: 3px; }
        .meta { font-size: 8px; color: #7f8c8d; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 8px; }
        th { background-color: #34495e; color: white; padding: 6px 4px; text-align: left; font-weight: bold; font-size: 8px; }
        td { border: 1px solid #ddd; padding: 5px 4px; vertical-align: top; }
        tr:nth-child(even) { background-color: #f8f9fa; }
        .summary-box { background-color: #ecf0f1; padding: 10px; border-radius: 5px; margin-top: 15px; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 9px; }
        .summary-total { font-weight: bold; font-size: 11px; color: #2c3e50; border-top: 2px solid #34495e; padding-top: 5px; margin-top: 5px; }
        .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 7px; color: #7f8c8d; text-align: center; }
        .footer-company { font-weight: bold; color: #2c3e50; }
        .status-badge { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 7px; font-weight: bold; }
        .status-unpaid { background-color: #e74c3c; color: white; }
        .status-partial { background-color: #f39c12; color: white; }
        .status-paid { background-color: #27ae60; color: white; }
    </style>
</head>
<body>
    <div class="header-section">
        <table class="header-table">
            <tr>
                <td class="header-left">
                    <div class="shop-details">
                        <div class="shop-name">${admin?.shop_name ?? 'N/A'}</div>
                        <div class="detail-line">${admin?.address ?? 'N/A'}</div>
                        <div class="detail-line">City: ${admin?.city ?? 'N/A'}</div>
                        <div class="detail-line">Phone: ${admin?.phone ?? 'N/A'}</div>
                    </div>
                </td>
                <td class="header-center">
                    <div class="main-heading">CREDIT SALE INVOICE</div>
                    <div class="sub-heading">Invoice #${sale.voucher_no}</div>
                </td>
                <td class="header-right">${logoHtml}</td>
            </tr>
        </table>
    </div>

    <div class="customer-info">
        <div class="info-row"><span class="info-label">Customer:</span><span>${sale.customer_name ?? 'N/A'}</span></div>
        ${shopNameHtml}
        <div class="info-row"><span class="info-label">Contact:</span><span>${sale.customer_contact ?? 'N/A'}</span></div>
        <div class="info-row"><span class="info-label">City:</span><span>${sale.customer_city ?? 'N/A'}</span></div>
    </div>

    <div class="header">
        <div class="heading">Credit Sale Invoice - ${sale.voucher_no}</div>
        <div class="meta">
            Generated on ${formatDateTime(new Date())} |
            Sale Date: ${formatDate(sale.sale_date)} |
            Due Date: ${sale.due_date ? formatDate(sale.due_date) : 'Not Set'}
        </div>
        <div class="meta" style="margin-top: 5px;">
            Status: <span class="status-badge ${statusClass}">${sale.status.charAt(0).toUpperCase() + sale.status.slice(1)}</span>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Product/Service</th>
                <th>Price</th>
                <th>Quantity</th>
                <th>Discount</th>
                <th>Tax</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
    </table>

    <div class="summary-box">
              <div class="summary-row"><span>Subtotal:</span><span>${formatPrice(sale.subtotal, currency)}</span></div>
        ${discountSummaryHtml}
        ${taxSummaryHtml}
        <div class="summary-row summary-total"><span>Grand Total:</span><span>${formatPrice(sale.grand_total, currency)}</span></div>
        <div class="summary-row" style="color: #27ae60;"><span>Paid Amount:</span><span>${formatPrice(totalPaid, currency)}</span></div>
        <div class="summary-row summary-total" style="color: #e74c3c;"><span>Remaining Balance:</span><span>${formatPrice(remainingBalance, currency)}</span></div>
    </div>

    ${paymentHistoryHtml}

    <div class="footer">
        <div class="footer-company">Powered by ZIT Solutions - ZeeroX Software</div>
        <div>Invoice created on ${formatDate(sale.created_at)}</div>
    </div>
</body>
</html>`;

        // Generate PDF with Puppeteer
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }, printBackground: true });
        await browser.close();

        reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="credit-sale-${voucherNo}.pdf"`)
            .send(Buffer.from(pdfBuffer));

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error generating PDF: ' + err.message });
    }
});

// GET /api/credit-sales/details/:voucher_no/data  ->  mirrors getCreditSaleDetailsData()
fastify.get('/api/credit-sales/details/:voucher_no/data', async (req, reply) => {
    const voucherNo = req.params.voucher_no;

    try {
        const [[sale]] = await pool.query(
            `SELECT sales.*,
                    customers.name as customer_name,
                    customers.shop_name as customer_shop_name,
                    customers.contact as customer_contact,
                    customers.city as customer_city,
                    customers.customer_type as customer_type
             FROM sales
             LEFT JOIN customers ON sales.customer_id = customers.id
             WHERE sales.voucher_no = ? AND sales.payment_type = 'credit' AND sales.deleted_at IS NULL`,
            [voucherNo]
        );

        if (!sale) {
            return reply.status(404).send({ success: false, message: 'Credit sale not found.' });
        }

        // Fetch sale items
        const [items] = await pool.query(
            `SELECT sale_items.*,
                    purchases.product_name,
                    purchases.type as product_type
             FROM sale_items
             JOIN purchases ON sale_items.purchase_id = purchases.id
             WHERE sale_items.sale_id = ? AND sale_items.deleted_at IS NULL`,
            [sale.id]
        );

        // Fetch payments
        const [payments] = await pool.query(
            `SELECT * FROM payments WHERE sale_id = ? AND deleted_at IS NULL ORDER BY payment_date ASC`,
            [sale.id]
        );

        const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const remainingBalance = parseFloat(sale.grand_total) - totalPaid;

        return reply.send({
            success: true,
            data: {
                sale: {
                    ...sale,
                    customer: {
                        name: sale.customer_name,
                        shop_name: sale.customer_shop_name,
                        contact: sale.customer_contact,
                        city: sale.customer_city,
                        customer_type: sale.customer_type,
                    },
                    saleItems: items,
                    payments: payments,
                },
                total_paid: totalPaid,
                remaining_balance: remainingBalance,
                is_fully_paid: remainingBalance <= 0,
            }
        });

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Error loading credit sale details: ' + err.message });
    }
});

}