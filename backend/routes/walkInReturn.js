import pool from '../db.js';
import { logActivity, formatValue } from '../helpers/activityLogger.js';
// ─── Helper: total units already walk-in-returned for a purchase ───────────
async function totalWalkInReturned(purchaseId) {
    const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(quantity_returned), 0) AS total
         FROM walk_in_returns
         WHERE purchase_id = ?`,
        [purchaseId]
    );
    return parseInt(row.total, 10);
}

// ─── Helper: generate next batch_no (WIR-00001, WIR-00002, …) ─────────────
async function generateBatchNo() {
    const [[row]] = await pool.query(
        `SELECT batch_no FROM walk_in_return_sessions ORDER BY id DESC LIMIT 1`
    );
    const last = row?.batch_no ?? null;
    const next = last ? parseInt(last.slice(4), 10) + 1 : 1;
    return 'WIR-' + String(next).padStart(5, '0');
}

export default async function walkInReturnRoutes(fastify) {

    // ── GET /walk-in-return/create ──────────────────────────────────────────
    // Just a signal endpoint; the real page is rendered by Next.js
    fastify.get('/api/walk-in-return/create', async (req, reply) => {
        return reply.send({ page: 'walk_in_return' });
    });

    // ── GET /walk-in-return/search-products ────────────────────────────────
    // Search products by name, product_code, barcode, or qr_code
    fastify.get('/api/walk-in-return/search-products', async (req, reply) => {
        const q = (req.query.q ?? '').trim();

        if (q.length < 1) {
            return reply.send([]);
        }

        const like = `%${q}%`;

        const [products] = await pool.query(
            `SELECT
                id,
                product_name,
                product_code,
                barcode,
                qr_code,
                sold_price,
                unit,
                discount_type,
                discount,
                tax_type,
                tax,
                quantity,
                sold_quantity
             FROM purchases
             WHERE type IN ('product', 'medicine')
               AND deleted_at IS NULL
               AND (
                   product_name  LIKE ? OR
                   product_code  LIKE ? OR
                   barcode       LIKE ? OR
                   qr_code       LIKE ?
               )
             LIMIT 15`,
            [like, like, like, like]
        );

        // Attach available_stock to each product (mirrors Laravel's map)
        const result = await Promise.all(
            products.map(async (p) => {
                const returned = await totalWalkInReturned(p.id);
                p.available_stock = Math.max(
                    0,
                    parseInt(p.quantity, 10) - parseInt(p.sold_quantity, 10) + returned
                );
                return p;
            })
        );

        return reply.send(result);
    });

    // ── POST /walk-in-return ────────────────────────────────────────────────
    // Process and save the walk-in return (carbon copy of Laravel store())
    fastify.post('/api/walk-in-return', async (req, reply) => {
        const body = req.body;

        // ── Validation ──────────────────────────────────────────────────────
        if (!body.items || !Array.isArray(body.items) || body.items.length < 1) {
            return reply.status(422).send({ error: 'items is required and must be a non-empty array.' });
        }

        for (const [i, item] of body.items.entries()) {
            if (!item.purchase_id) {
                return reply.status(422).send({ error: `items[${i}].purchase_id is required.` });
            }
            if (!item.quantity_returned || parseInt(item.quantity_returned, 10) < 1) {
                return reply.status(422).send({ error: `items[${i}].quantity_returned must be an integer >= 1.` });
            }
            if (item.unit_price == null || parseFloat(item.unit_price) < 0) {
                return reply.status(422).send({ error: `items[${i}].unit_price must be a number >= 0.` });
            }

            // Verify purchase exists
            const [[purchase]] = await pool.query(
                `SELECT id FROM purchases WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
                [item.purchase_id]
            );
            if (!purchase) {
                return reply.status(422).send({ error: `items[${i}].purchase_id does not exist.` });
            }
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // ── Pull sale-level discount / tax from body ───────────────────
            const saleDiscType  = body.sale_discount_type  ?? null;
            const saleDiscValue = parseFloat(body.sale_discount_value ?? 0);
            const saleTaxType   = body.sale_tax_type        ?? null;
            const saleTaxValue  = parseFloat(body.sale_tax_value   ?? 0);

            let totalSubtotal       = 0;
            let totalDiscountAmount = 0;
            let totalTaxAmount      = 0;
            let totalRefund         = 0;
            const lineItems         = [];

            // ── STEP 1: Calculate each line item ───────────────────────────
            for (const item of body.items) {
                const qty           = parseInt(item.quantity_returned, 10);
                const unitPrice     = parseFloat(item.unit_price);
                const discountType  = item.discount_type  ?? null;
                const discountValue = parseFloat(item.discount_value ?? 0);
                const taxType       = item.tax_type        ?? null;
                const taxValue      = parseFloat(item.tax_value   ?? 0);

                const subtotal = unitPrice * qty;

                // Item-level discount
                let discountAmount = 0;
                if (discountType === 'percentage') {
                    discountAmount = subtotal * (discountValue / 100);
                } else if (discountType === 'amount') {
                    discountAmount = Math.min(discountValue, subtotal);
                }

                const totalAfterDiscount = subtotal - discountAmount;

                // Item-level tax
                let taxAmount = 0;
                if (taxType === 'percentage') {
                    taxAmount = totalAfterDiscount * (taxValue / 100);
                } else if (taxType === 'amount') {
                    taxAmount = taxValue;
                }

                const totalAfterTax = totalAfterDiscount + taxAmount;
                const refundAmount  = totalAfterTax;

                totalSubtotal       += subtotal;
                totalDiscountAmount += discountAmount;
                totalTaxAmount      += taxAmount;
                totalRefund         += refundAmount;

                // Get cost price for this purchase
                const [[purchase]] = await conn.query(
                    `SELECT purchased_price FROM purchases WHERE id = ? LIMIT 1`,
                    [item.purchase_id]
                );
                const costPrice = (parseFloat(purchase?.purchased_price ?? 0)) * qty;

                lineItems.push({
                    purchase_id:          item.purchase_id,
                    quantity_returned:    qty,
                    unit_price:           unitPrice,
                    discount_type:        discountType,
                    discount_value:       discountValue,
                    discount_amount:      discountAmount,
                    tax_type:             taxType,
                    tax_value:            taxValue,
                    tax_amount:           taxAmount,
                    subtotal:             subtotal,
                    total_after_discount: totalAfterDiscount,
                    total_after_tax:      totalAfterTax,
                    refund_amount:        refundAmount,
                    _cost_price:          costPrice,  // temp, not saved to DB
                });
            }

            // ── STEP 2: Sale-level discount ────────────────────────────────
            let saleDiscAmount = 0;
            if (saleDiscType === 'percentage') {
                saleDiscAmount = totalRefund * (saleDiscValue / 100);
            } else if (saleDiscType === 'amount') {
                saleDiscAmount = Math.min(saleDiscValue, totalRefund);
            }
            totalRefund         -= saleDiscAmount;
            totalDiscountAmount += saleDiscAmount;

            // ── STEP 3: Sale-level tax ─────────────────────────────────────
            let saleTaxAmount = 0;
            if (saleTaxType === 'percentage') {
                saleTaxAmount = totalRefund * (saleTaxValue / 100);
            } else if (saleTaxType === 'amount') {
                saleTaxAmount = saleTaxValue;
            }
            totalRefund    += saleTaxAmount;
            totalTaxAmount += saleTaxAmount;

            // ── STEP 4: Session-level revenue & profit ─────────────────────
            const totalRevenueWithoutTax = totalSubtotal - totalDiscountAmount;
            const totalCost              = lineItems.reduce((sum, l) => sum + l._cost_price, 0);
            const totalProfitWithoutTax  = totalRevenueWithoutTax - totalCost;

            // ── STEP 5: Per-item revenue & profit (proportional sale disc) ─
            const grandTotalRefund = lineItems.reduce((sum, l) => sum + l.refund_amount, 0);

            for (const line of lineItems) {
                const share            = grandTotalRefund > 0
                    ? (line.refund_amount / grandTotalRefund)
                    : 0;
                const itemSaleDiscShare = saleDiscAmount * share;

                line.revenue_without_tax = line.subtotal
                    - line.discount_amount
                    - itemSaleDiscShare;

                line.profit_without_tax = line.revenue_without_tax - line._cost_price;
            }

                     // ── STEP 6: Save session ───────────────────────────────────────
                     const batchNo = await generateBatchNo();

                     // Name of the user performing this walk-in return
                     const returningUserId = req.session?.userId || req.user?.id;
                     const [[returningUserRow]] = await conn.query('SELECT name FROM users WHERE id = ?', [returningUserId]);
                     const returningUserName = returningUserRow?.name || null;
         
                     const [sessionResult] = await conn.query(
                         `INSERT INTO walk_in_return_sessions (
                             batch_no,
                             user_id,
                             seller_name,
                             total_subtotal,
                             discount_type,
                             discount_value,
                             sale_discount_amount,
                             tax_type,
                             tax_value,
                             sale_tax_amount,
                             total_discount_amount,
                             total_tax_amount,
                             total_refund_amount,
                             notes,
                             customer_name,
                             customer_city,
                             shop_name,
                             contact_no,
                             status,
                             total_revenue_without_tax,
                             total_profit_without_tax
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
                         [
                             batchNo,
                             returningUserId,
                             returningUserName,
                             totalSubtotal,
                             saleDiscType,
                             saleDiscValue,
                             saleDiscAmount,
                             saleTaxType,
                             saleTaxValue,
                             saleTaxAmount,
                             totalDiscountAmount,
                             totalTaxAmount,
                             totalRefund,
                             body.notes        ?? null,
                             body.customer_name ?? null,
                             body.customer_city ?? null,
                             body.shop_name    ?? null,
                             body.contact_no   ?? null,
                             totalRevenueWithoutTax,
                             totalProfitWithoutTax,
                         ]
                     );
         
                     const sessionId = sessionResult.insertId;

            // ── STEP 7: Save each line item + restore stock ────────────────
            for (const line of lineItems) {
                const { _cost_price, ...lineToSave } = line; // strip temp key

                await conn.query(
                    `INSERT INTO walk_in_returns (
                        session_id,
                        purchase_id,
                        quantity_returned,
                        unit_price,
                        discount_type,
                        discount_value,
                        discount_amount,
                        tax_type,
                        tax_value,
                        tax_amount,
                        subtotal,
                        total_after_discount,
                        total_after_tax,
                        refund_amount,
                        revenue_without_tax,
                        profit_without_tax
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        sessionId,
                        lineToSave.purchase_id,
                        lineToSave.quantity_returned,
                        lineToSave.unit_price,
                        lineToSave.discount_type,
                        lineToSave.discount_value,
                        lineToSave.discount_amount,
                        lineToSave.tax_type,
                        lineToSave.tax_value,
                        lineToSave.tax_amount,
                        lineToSave.subtotal,
                        lineToSave.total_after_discount,
                        lineToSave.total_after_tax,
                        lineToSave.refund_amount,
                        lineToSave.revenue_without_tax,
                        lineToSave.profit_without_tax,
                    ]
                );

                // Restore stock: reduce sold_quantity (mirrors Laravel's max(0, …))
                await conn.query(
                    `UPDATE purchases
                     SET sold_quantity = GREATEST(0, sold_quantity - ?)
                     WHERE id = ?`,
                    [lineToSave.quantity_returned, lineToSave.purchase_id]
                );
            }

            await conn.commit();

            return reply.send({
                success: true,
                message: 'Walk-in return processed successfully.',
                batch_no: batchNo,
                session_id: sessionId,
            });

        } catch (err) {
            await conn.rollback();
            fastify.log.error(err);
            return reply.status(500).send({ error: 'Failed to process walk-in return.', message: err.message });
        } finally {
            conn.release();
        }
    });

        // DELETE /api/walk-in-returns/:id — soft delete (default) or permanent (?permanent=true)
        fastify.delete('/api/walk-in-returns/:id', async (req, reply) => {
            const { id } = req.params;
            const isPermanent = req.query.permanent === 'true';
    
            const conn = await pool.getConnection();
            try {
                const [[session]] = await conn.query(
                    'SELECT id, batch_no, customer_name, total_refund_amount FROM walk_in_return_sessions WHERE id = ? AND deleted_at IS NULL',
                    [id]
                );
                if (!session) {
                    conn.release();
                    return reply.status(404).send({ success: false, message: 'Walk-in return not found.' });
                }
    
                await conn.beginTransaction();
    
                if (isPermanent) {
                    await conn.query('DELETE FROM walk_in_returns WHERE session_id = ?', [id]);
                    await conn.query('DELETE FROM walk_in_return_sessions WHERE id = ?', [id]);
                    await conn.commit();

                    await logActivity(req, {
                        action_type: 'permanent_delete',
                        description: `Permanently deleted walk-in return "${session.batch_no}"${session.customer_name ? ` for ${session.customer_name}` : ''} — Refund: Rs ${formatValue(session.total_refund_amount)}`,
                        entity_type: 'walk_in_return',
                        entity_id: id,
                        old_data: session,
                    });

                    return reply.send({ success: true, message: 'Walk-in return permanently deleted.' });
                } else {
                    await conn.query('UPDATE walk_in_returns SET deleted_at = NOW() WHERE session_id = ? AND deleted_at IS NULL', [id]);
                    await conn.query('UPDATE walk_in_return_sessions SET deleted_at = NOW() WHERE id = ?', [id]);
                    await conn.commit();

                    await logActivity(req, {
                        action_type: 'soft delete',
                        description: `Soft Deleted walk-in return "${session.batch_no}"${session.customer_name ? ` for ${session.customer_name}` : ''} — Refund: Rs ${formatValue(session.total_refund_amount)}`,
                        entity_type: 'walk_in_return',
                        entity_id: id,
                        old_data: session,
                    });

                    return reply.send({ success: true, message: 'Walk-in return deleted successfully.' });
                }
            } catch (err) {
                await conn.rollback();
                fastify.log.error(err);
                return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
            } finally {
                conn.release();
            }
        });
}