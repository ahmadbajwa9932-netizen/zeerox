import pool from '../db.js';
import { logActivity, formatValue } from '../helpers/activityLogger.js';
export default async function returnedSaleRoutes(fastify) {

    // GET /api/sales/returned/data  ->  mirrors getReturnedSalesData()
// GET /api/sales/returned/data  ->  fully self-contained on sale_returns/sale_return_items
fastify.get('/api/sales/returned/data', async (req, reply) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = 10;
    const offset = (page - 1) * perPage;

    const allowedSortColumns = {
        'id': 'sale_returns.voucher_no',
        'voucher_no': 'sale_returns.voucher_no',
        'sale_date': 'last_return_date',
        'original_amount': 'original_amount',
        'total_refunded': 'total_refunded',
        'last_return_date': 'last_return_date',
        'return_count': 'return_count',
    };

    const sortColumnRaw = req.query.sort_column || 'last_return_date';
    const sortColumn = allowedSortColumns[sortColumnRaw] || 'last_return_date';
    const sortDirection = (req.query.sort_direction || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const searchQuery = req.query.search || null;
    const searchType = req.query.search_type || 'voucher';

    try {
        // Build WHERE clause (no dependency on sales table existing)
        let where = `sale_returns.deleted_at IS NULL AND sale_returns.voucher_no IS NOT NULL`;
        const params = [];

        if (searchQuery) {
            if (searchType === 'voucher') {
                where += ` AND sale_returns.voucher_no LIKE ?`;
                params.push(`%${searchQuery}%`);
            }
            // customer search dropped — customer info no longer guaranteed to exist after full return
        }

        // Count total distinct voucher groups with returns
        const [countRows] = await pool.query(
            `SELECT COUNT(DISTINCT sale_returns.voucher_no) as total
             FROM sale_returns
             WHERE ${where}`,
            params
        );
        const total = countRows[0].total;

                              // Main grouped query — grouped purely by voucher_no
                              const [rows] = await pool.query(
                                `SELECT
                                        sale_returns.voucher_no as voucher_no,
                                        MAX(sale_returns.sale_date) as sale_date,
                                        MAX(customers.name) as customer_name,
                                        MAX(sale_returns.seller_name) as seller_name,
                                        MAX(sale_returns.original_grand_total) as original_amount,
                                        COUNT(sale_returns.id) as return_count,
                                        SUM(sale_returns.total_return_amount) as total_refunded,
                                        SUM((
                                            SELECT COUNT(*) FROM sale_return_items
                                            WHERE sale_return_items.sale_return_id = sale_returns.id
                                        )) as total_items_returned,
                                        MAX(sale_returns.created_at) as last_return_date,
                                        GROUP_CONCAT(sale_returns.status) as return_statuses
                                     FROM sale_returns
                                     LEFT JOIN customers ON sale_returns.customer_id = customers.id
                                     WHERE ${where}
                                     GROUP BY sale_returns.voucher_no
                                     ORDER BY ${sortColumn} ${sortDirection}
                                     LIMIT ? OFFSET ?`,
                                    [...params, perPage, offset]
                            );

        // Fetch return details for each voucher group
        const voucherNos = rows.map(r => r.voucher_no);
        let returnDetails = {};

        if (voucherNos.length > 0) {
            const placeholders = voucherNos.map(() => '?').join(',');

            const [detailRows] = await pool.query(
                `SELECT
                    sale_returns.id as return_id,
                    sale_returns.voucher_no,
                    sale_returns.total_return_amount,
                    sale_returns.status,
                    sale_returns.notes,
                    sale_returns.created_at as return_date,
                    sale_return_items.id as item_id,
                    sale_return_items.quantity_returned,
                    sale_return_items.amount_refunded,
                    sale_return_items.unit_net_after_discount,
                    sale_return_items.product_name
                 FROM sale_returns
                 LEFT JOIN sale_return_items ON sale_return_items.sale_return_id = sale_returns.id
                 WHERE sale_returns.voucher_no IN (${placeholders})
                   AND sale_returns.deleted_at IS NULL`,
                voucherNos
            );

            // Group by voucher_no, then by return_id
            detailRows.forEach(row => {
                if (!returnDetails[row.voucher_no]) returnDetails[row.voucher_no] = {};
                if (!returnDetails[row.voucher_no][row.return_id]) {
                    returnDetails[row.voucher_no][row.return_id] = {
                        id: row.return_id,
                        voucher_no: row.voucher_no,
                        total_return_amount: row.total_return_amount,
                        status: row.status,
                        notes: row.notes,
                        return_date: row.return_date,
                        items: []
                    };
                }
                if (row.item_id) {
                    returnDetails[row.voucher_no][row.return_id].items.push({
                        id: row.item_id,
                        quantity_returned: row.quantity_returned,
                        amount_refunded: row.amount_refunded,
                        unit_net_after_discount: row.unit_net_after_discount,
                        product_name: row.product_name,
                    });
                }
            });

            Object.keys(returnDetails).forEach(voucherNo => {
                returnDetails[voucherNo] = Object.values(returnDetails[voucherNo]);
            });
        }

        const lastPage = Math.max(Math.ceil(total / perPage), 1);

        return reply.send({
            success: true,
            data: rows,
            returnDetails,
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
        return reply.status(500).send({ success: false, message: 'Failed to load returned sales: ' + err.message });
    }
});

    // GET /api/walk-in-returns/list
fastify.get('/api/walk-in-returns/list', async (req, reply) => {
    const page      = parseInt(req.query.page) || 1;
    const perPage   = 10;
    const offset    = (page - 1) * perPage;
    const search     = req.query.search || null;
    const searchType = req.query.search_type || 'customer';

    try {
        // Build WHERE clause
        let where = `wirs.deleted_at IS NULL`;
        const params = [];

        if (search && searchType === 'customer') {
            where += ` AND (wirs.customer_name LIKE ? OR wirs.shop_name LIKE ? OR wirs.contact_no LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // Count
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM walk_in_return_sessions wirs WHERE ${where}`,
            params
        );
        const total = countRows[0].total;

                               // Main query + item_count (mirrors withCount('items'))
                               const [sessions] = await pool.query(
                                `SELECT
                                    wirs.*,
                                    COUNT(wir.id) as item_count
                                 FROM walk_in_return_sessions wirs
                                 LEFT JOIN walk_in_returns wir ON wir.session_id = wirs.id AND wir.deleted_at IS NULL
                                 WHERE ${where}
                                 GROUP BY wirs.id
                                 ORDER BY wirs.created_at DESC
                                 LIMIT ? OFFSET ?`,
                                [...params, perPage, offset]
                            );

        // Fetch items with purchase for each session (mirrors with(['items.purchase']))
        const sessionIds = sessions.map(s => s.id);
        let itemsBySession = {};

        if (sessionIds.length > 0) {
            const placeholders = sessionIds.map(() => '?').join(',');

            const [itemRows] = await pool.query(
                `SELECT
                    wir.*,
                    p.product_name,
                    p.type       as product_type,
                    p.sold_price as purchase_sold_price,
                    p.purchased_price
                 FROM walk_in_returns wir
                 LEFT JOIN purchases p ON p.id = wir.purchase_id
                 WHERE wir.session_id IN (${placeholders})
                   AND wir.deleted_at IS NULL`,
                sessionIds
            );

            // Group by session_id (mirrors ->items->purchase eager load)
            itemRows.forEach(row => {
                if (!itemsBySession[row.session_id]) itemsBySession[row.session_id] = [];
                itemsBySession[row.session_id].push({
                    ...row,
                    purchase: {
                        id:              row.purchase_id,
                        product_name:    row.product_name,
                        type:            row.product_type,
                        sold_price:      row.purchase_sold_price,
                        purchased_price: row.purchased_price,
                    }
                });
            });
        }

        // Attach items to each session
        const data = sessions.map(s => ({
            ...s,
            items: itemsBySession[s.id] || []
        }));

        const lastPage = Math.max(Math.ceil(total / perPage), 1);

        return reply.send({
            success: true,
            data,
            pagination: {
                current_page:   page,
                last_page:      lastPage,
                per_page:       perPage,
                total,
                has_more_pages: page < lastPage,
on_first_page:  page === 1,
first_item:     total === 0 ? 0 : offset + 1,
last_item:      Math.min(offset + perPage, total),
            }
        });

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Failed to load walk-in returns: ' + err.message });
    }
});

// GET /api/sales/returned/:voucherNo/details
fastify.get('/api/sales/returned/:voucherNo/details', async (req, reply) => {
    const voucherNo = req.params.voucherNo;

    if (!voucherNo) {
        return reply.status(400).send({ success: false, message: 'Invalid voucher number.' });
    }

    try {
        // Get all returns for this voucher, oldest first (needed to find true original values)
        const [returnRows] = await pool.query(
            `SELECT sr.*, customers.name as customer_name, customers.contact, customers.shop_name,
                    customers.city, customers.customer_type, customers.current_balance, customers.advance_payment
             FROM sale_returns sr
             LEFT JOIN customers ON sr.customer_id = customers.id
             WHERE sr.voucher_no = ? AND sr.deleted_at IS NULL
             ORDER BY sr.created_at ASC`,
            [voucherNo]
        );

        if (!returnRows.length) {
            return reply.status(404).send({ success: false, message: 'No returns found for this voucher.' });
        }

        const firstReturn = returnRows[0];              // holds the TRUE original sale values
        const lastReturn  = returnRows[returnRows.length - 1]; // holds the latest updated values

        // Try to enrich with the live sale row if it still exists (survives partial returns)
        const [saleRows] = await pool.query(
            `SELECT * FROM sales WHERE voucher_no = ? AND deleted_at IS NULL LIMIT 1`,
            [voucherNo]
        );
        const liveSale = saleRows.length ? saleRows[0] : null;

        // Get items for each return
        const [itemRows] = await pool.query(
            `SELECT sri.*
             FROM sale_return_items sri
             JOIN sale_returns sr ON sri.sale_return_id = sr.id
             WHERE sr.voucher_no = ? AND sr.deleted_at IS NULL AND sri.deleted_at IS NULL
             ORDER BY sr.created_at ASC`,
            [voucherNo]
        );

        const itemsByReturnId = {};
        itemRows.forEach(item => {
            if (!itemsByReturnId[item.sale_return_id]) itemsByReturnId[item.sale_return_id] = [];
            itemsByReturnId[item.sale_return_id].push({
                id: item.id,
                sale_item_id: item.sale_item_id,
                quantity_returned: item.quantity_returned,
                unit_net_after_discount: parseFloat(item.unit_net_after_discount),
                amount_refunded: parseFloat(item.amount_refunded),
                purchase: { product_name: item.product_name }
            });
        });

        const returns = returnRows.map(r => ({
            id: r.id,
            total_return_amount: parseFloat(r.total_return_amount),
            status: r.status,
            notes: r.notes,
            created_at: r.created_at,
            updated_at: r.updated_at,
            items: itemsByReturnId[r.id] || []
        }));

        const totalReturnedAmount     = returns.reduce((sum, r) => sum + r.total_return_amount, 0);
        const totalReturnTransactions = returns.length;
        const totalItemsReturned      = returns.reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.quantity_returned, 0), 0);

        // "Original sale items" table — rebuilt purely from sale_return_items across ALL
        // returns for this voucher, since sale_items may no longer exist after a full return.
        // If the sale is still alive (only partial returns so far), merge in whatever's
        // still sitting in sale_items (never-yet-returned items won't have any sale_return_items row).
        const productMap = {}; // keyed by purchase_id

        itemRows.forEach(item => {
            if (!productMap[item.purchase_id]) {
                productMap[item.purchase_id] = {
                    id: item.purchase_id,
                    product_name: item.product_name,
                    price: parseFloat(item.price),
                    original_quantity: 0,
                    returned_quantity: 0,
                    original_total: 0,
                };
            }
            const p = productMap[item.purchase_id];
            // earliest original_quantity we see for this product is the true original
            p.original_quantity = Math.max(p.original_quantity, item.original_quantity);
            p.returned_quantity += item.quantity_returned;
        });

        // If the sale still exists, pull in items that haven't been returned at all yet
        // (they won't appear in sale_return_items, so productMap would miss them entirely)
        if (liveSale) {
            const [remainingRows] = await pool.query(
                `SELECT si.purchase_id, si.quantity, si.price, si.total_after_discount, p.product_name
                 FROM sale_items si
                 JOIN purchases p ON si.purchase_id = p.id
                 WHERE si.sale_id = ? AND p.type IN ('product', 'medicine')`,
                [liveSale.id]
            );
            remainingRows.forEach(row => {
                if (!productMap[row.purchase_id]) {
                    productMap[row.purchase_id] = {
                        id: row.purchase_id,
                        product_name: row.product_name,
                        price: parseFloat(row.price),
                        original_quantity: row.quantity, // no returns yet -> current qty IS the original
                        returned_quantity: 0,
                        original_total: parseFloat(row.total_after_discount),
                    };
                }
            });
        }

        const originalSaleItems = Object.values(productMap).map(p => {
            const remaining_quantity = p.original_quantity - p.returned_quantity;
            const unitTotal = p.original_quantity > 0 ? (p.original_total || (p.price * p.original_quantity)) / p.original_quantity : 0;
            return {
                id: p.id,
                product_name: p.product_name,
                price: p.price,
                original_quantity: p.original_quantity,
                returned_quantity: p.returned_quantity,
                remaining_quantity,
                original_total: unitTotal * p.original_quantity,
                remaining_total: unitTotal * remaining_quantity,
            };
        });

        const clamp = v => Math.max(0, v);

        return reply.send({
            success: true,
            data: {
                sale: {
                    voucher_no: voucherNo,
                    subtotal: firstReturn.original_subtotal,
                    discount_type: firstReturn.discount_type,
                    discount: firstReturn.original_discount_value,
                    discount_amount: firstReturn.original_discount_amount,
                    tax_type: firstReturn.tax_type,
                    tax: firstReturn.original_tax_value,
                    tax_amount: firstReturn.original_tax_amount,
                    grand_total: firstReturn.original_grand_total,
                    received_amount: firstReturn.original_received_amount,
                    change_amount: firstReturn.original_change_amount,
                    payment_type: firstReturn.payment_type,
                    sale_date: firstReturn.sale_date,
                    customer: firstReturn.customer_id ? {
                        id: firstReturn.customer_id,
                        name: firstReturn.customer_name,
                        contact: firstReturn.contact,
                        shop_name: firstReturn.shop_name,
                        city: firstReturn.city,
                        customer_type: firstReturn.customer_type,
                    } : null,
                },
                returns,
                has_returns: true,
                total_returned_amount: totalReturnedAmount,
                adjusted_subtotal: clamp(lastReturn.updated_subtotal),
                adjusted_discount_amount: clamp(lastReturn.updated_discount_amount),
                adjusted_tax: clamp(lastReturn.updated_tax_amount),
                adjusted_grand_total: clamp(lastReturn.updated_grand_total),
                original_sale_items: originalSaleItems,
                total_return_transactions: totalReturnTransactions,
                total_items_returned: totalItemsReturned,
                return_percentage: firstReturn.original_grand_total > 0
                    ? (totalReturnedAmount / firstReturn.original_grand_total)
                    : 0,
            }
        });

    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Failed to load return details: ' + err.message });
    }
});

    // DELETE /api/sales/returned/:voucherNo — soft delete (default) or permanent (?permanent=true)
    // Deletes/restores all sale_returns rows for this voucher_no + their sale_return_items.
    fastify.delete('/api/sales/returned/:voucherNo', async (req, reply) => {
        const { voucherNo } = req.params;
        const isPermanent = req.query.permanent === 'true';

        const conn = await pool.getConnection();
        try {
            const [returns] = await conn.query(
                'SELECT id, total_return_amount FROM sale_returns WHERE voucher_no = ? AND deleted_at IS NULL',
                [voucherNo]
            );
            if (returns.length === 0) {
                conn.release();
                return reply.status(404).send({ success: false, message: 'No returns found for this voucher.' });
            }
            const returnIds = returns.map(r => r.id);
            const totalRefund = returns.reduce((sum, r) => sum + (parseFloat(r.total_return_amount) || 0), 0);

            await conn.beginTransaction();

            if (isPermanent) {
                await conn.query(
                    `DELETE FROM sale_return_items WHERE sale_return_id IN (?)`,
                    [returnIds]
                );
                await conn.query(
                    `DELETE FROM sale_returns WHERE id IN (?)`,
                    [returnIds]
                );
                await conn.commit();

                await logActivity(req, {
                    action_type: 'permanent_delete',
                    description: `Permanently deleted ${returnIds.length} return record(s) for sale "${voucherNo}" — Total refund: Rs ${totalRefund.toFixed(2)}`,
                    entity_type: 'sale_return',
                    entity_id: returnIds[0],
                    old_data: { voucher_no: voucherNo, returns_count: returnIds.length, total_refund: totalRefund },
                });

                return reply.send({ success: true, message: 'Return permanently deleted.' });
            } else {
                await conn.query(
                    `UPDATE sale_return_items SET deleted_at = NOW() WHERE sale_return_id IN (?) AND deleted_at IS NULL`,
                    [returnIds]
                );
                await conn.query(
                    `UPDATE sale_returns SET deleted_at = NOW() WHERE id IN (?)`,
                    [returnIds]
                );
                await conn.commit();

                await logActivity(req, {
                    action_type: 'soft delete',
                    description: `Soft Deleted ${returnIds.length} return record(s) for sale "${voucherNo}" — Total refund: Rs ${totalRefund.toFixed(2)}`,
                    entity_type: 'sale_return',
                    entity_id: returnIds[0],
                    old_data: { voucher_no: voucherNo, returns_count: returnIds.length, total_refund: totalRefund },
                });

                return reply.send({ success: true, message: 'Return deleted successfully.' });
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