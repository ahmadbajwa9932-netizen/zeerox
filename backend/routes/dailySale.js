import db from '../db.js';
// Safe numeric coercion (mysql2 can return DECIMAL columns as strings)
const num = (v) => Number(v) || 0;

// ─────────────────────────────────────────────────────────
// SALES ROUTES (Daily / General / Credit)
// Ported 1:1 from Laravel SalesReportController logic.
// All filtering, sorting, and pagination (10 per page) are
// done server-side, matching the original query exactly.
// ─────────────────────────────────────────────────────────

const ALLOWED_SORT_COLUMNS = [
    'voucher_no',
    'sales.voucher_no',
    'sale_date',
    'created_at',
    'sales.sale_date',
    'grand_total',
    'sales.grand_total',
    'payment_type',
    'sales.payment_type',
];

const ALLOWED_SEARCH_TYPES = ['voucher', 'customer', 'product'];

export default async function dailySale(fastify) {

    // ── DAILY SALES DATA (AJAX) ────────────────────────────
    fastify.get('/api/sales/daily/data', async (req, reply) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const perPage = 10;
            const offset = (page - 1) * perPage;

            let sortColumn = req.query.sort_column || 'voucher_no';
            let sortDirection = (req.query.sort_direction || 'desc').toLowerCase();
            if (!ALLOWED_SORT_COLUMNS.includes(sortColumn)) sortColumn = 'voucher_no';
            if (!['asc', 'desc'].includes(sortDirection)) sortDirection = 'desc';

            const searchQuery = req.query.search || '';
            let searchType = req.query.search_type || 'voucher';
            if (!ALLOWED_SEARCH_TYPES.includes(searchType)) searchType = 'voucher';

            const filterDate = req.query.filter_date || null;
const filterPayment = req.query.filter_payment || '';

const baseWhere = [
    `sales.deleted_at IS NULL`,
];
const baseParams = [];

// Date filter — created_at and NOW() are already PKT wall-clock time (SYSTEM tz)
if (filterDate) {
    baseWhere.push(`DATE(sales.created_at) = ?`);
    baseParams.push(filterDate);
} else {
    baseWhere.push(`DATE(sales.created_at) = DATE(NOW())`);
}

// Payment type filter
const ALLOWED_PAYMENT_TYPES = ['cash', 'card', 'credit', 'advance'];
if (filterPayment && ALLOWED_PAYMENT_TYPES.includes(filterPayment)) {
    baseWhere.push(`sales.payment_type = ?`);
    baseParams.push(filterPayment);
} else {
    baseWhere.push(`sales.payment_type IN ('cash','card','credit','advance')`);
}

            // ── Search filter (mirrors Laravel switch) ──
            if (searchQuery) {
                switch (searchType) {
                    case 'voucher':
                        baseWhere.push(`sales.voucher_no LIKE ?`);
                        baseParams.push(`%${searchQuery}%`);
                        break;
                    case 'customer':
                        baseWhere.push(`customers.name LIKE ?`);
                        baseParams.push(`%${searchQuery}%`);
                        break;
                    case 'product':
                        baseWhere.push(`EXISTS (
                            SELECT 1 FROM sale_items si2
                            JOIN purchases p2 ON si2.purchase_id = p2.id
                            WHERE si2.sale_id = sales.id
                              AND p2.product_name LIKE ?
                              AND si2.deleted_at IS NULL
                        )`);
                        baseParams.push(`%${searchQuery}%`);
                        break;
                }
            }

            const whereSql = baseWhere.join(' AND ');

// ── Core aggregated query (sales-level) ──
const coreSelectSql = `
SELECT
    sales.id as sale_id,
    sales.voucher_no,
    sales.sale_date as sale_date,
    sales.created_at as created_at,
    sales.payment_type,
    sales.grand_total,
    customers.name as customer_name,
    sales.seller_name,
    COUNT(sale_items.id) as total_items,
    SUM(sale_items.total_after_discount) as total_amount,
    GROUP_CONCAT(
        purchases.product_name
        ORDER BY purchases.id ASC
        SEPARATOR ', '
    ) as products
FROM sales
JOIN sale_items ON sales.id = sale_items.sale_id AND sale_items.deleted_at IS NULL
JOIN purchases ON sale_items.purchase_id = purchases.id
LEFT JOIN customers ON sales.customer_id = customers.id
WHERE ${whereSql}
GROUP BY sales.id, sales.voucher_no, sales.sale_date, sales.created_at, sales.payment_type, customers.name, sales.grand_total, sales.seller_name
HAVING total_items > 0
`;

            // ── Count total (wrap core query as derived table) ──
            const countSql = `SELECT COUNT(*) as total FROM (${coreSelectSql}) as t`;
            const [countRows] = await db.query(countSql, baseParams);
            const total = countRows[0]?.total || 0;

            // ── Sort handling (special numeric-suffix sort for voucher_no) ──
            let orderSql;
            if (sortColumn === 'voucher_no' || sortColumn === 'sales.voucher_no') {
                orderSql = `ORDER BY CAST(SUBSTRING_INDEX(voucher_no, '-', -1) AS UNSIGNED) ${sortDirection}`;
            } else {
                const colMap = {
                    'sale_date': 'sale_date',
                    'sales.sale_date': 'sale_date',
                    'created_at': 'created_at',
                    'sales.created_at': 'created_at',
                    'grand_total': 'grand_total',
                    'sales.grand_total': 'grand_total',
                    'payment_type': 'payment_type',
                    'sales.payment_type': 'payment_type',
                };
                orderSql = `ORDER BY ${colMap[sortColumn] || 'voucher_no'} ${sortDirection}`;
            }

            const dataSql = `SELECT * FROM (${coreSelectSql}) as t ${orderSql} LIMIT ? OFFSET ?`;
            const [salesRows] = await db.query(dataSql, [...baseParams, perPage, offset]);

            // ── Detailed sale items (adjusted discount/tax for remaining qty) ──
            const saleIds = salesRows.map(s => s.sale_id);
            let saleItemsGrouped = {};

            if (saleIds.length > 0) {
                const placeholders = saleIds.map(() => '?').join(',');
                const itemsSql = `
                    SELECT
                        sale_items.sale_id,
                        purchases.type,
                        purchases.product_name,
                        sale_items.price,
                        sale_items.quantity,
                        sale_items.discount_type,
                        sale_items.discount_value,
                        sale_items.discount_amount,
                        sale_items.tax_type,
                        sale_items.tax_value,
                        sale_items.tax_amount,
                        sale_items.total_after_tax
                    FROM sale_items
                    JOIN purchases ON sale_items.purchase_id = purchases.id
                    WHERE sale_items.sale_id IN (${placeholders})
                    AND sale_items.deleted_at IS NULL
                `;
                const [itemRows] = await db.query(itemsSql, saleIds);

                // Group by sale_id (mirrors Laravel's ->groupBy('sale_id'))
                saleItemsGrouped = itemRows.reduce((acc, row) => {
                    if (!acc[row.sale_id]) acc[row.sale_id] = [];
                    acc[row.sale_id].push(row);
                    return acc;
                }, {});
            }

            const lastPage = Math.max(Math.ceil(total / perPage), 1);

            return reply.send({
                success: true,
                data: salesRows,
                saleItems: saleItemsGrouped,
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: perPage,
                    total,
                    first_item: total === 0 ? 0 : offset + 1,
                    last_item: Math.min(offset + perPage, total),
                    has_more_pages: page < lastPage,
                    on_first_page: page <= 1,
                },
            });
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ success: false, error: err.message });
        }
    });

    // ── SALE DETAILS DATA (AJAX) — shared by Daily Sale & General Sale ──
    // Ported 1:1 from Laravel SalesController@getSaleDetailsData
    fastify.get('/api/sales/details/:voucher_no/data', async (req, reply) => {
        try {
            const { voucher_no } = req.params;
            // 1. Sale + customer
            const [saleRows] = await db.query(`
                SELECT
                    sales.*,
                    customers.name as customer_name,
                    customers.shop_name as customer_shop_name,
                    customers.contact as customer_contact,
                    customers.city as customer_city,
                    customers.customer_type as customer_type
                FROM sales
                LEFT JOIN customers ON sales.customer_id = customers.id
                WHERE sales.voucher_no = ?
                AND sales.deleted_at IS NULL
                LIMIT 1
            `, [voucher_no]);

            if (saleRows.length === 0) {
                return reply.code(404).send({ success: false, error: 'Sale not found' });
            }

            const sale = saleRows[0];

            // 2. Advance details (only if payment_type === 'advance')
            let previousAdvance = 0;
            let advanceUsed = 0;
            let remainingAdvance = 0;

            if (sale.payment_type === 'advance') {
                const advanceWhere = sale.customer_id === null
                    ? `sale_id = ? AND customer_id IS NULL`
                    : `sale_id = ? AND customer_id = ?`;
                const advanceParams = sale.customer_id === null
                    ? [sale.id]
                    : [sale.id, sale.customer_id];

                const [advRows] = await db.query(`
                    SELECT previous_balance, used_amount, remaining_balance
                    FROM customer_advance_logs
                    WHERE ${advanceWhere}
                    LIMIT 1
                `, advanceParams);

                if (advRows.length > 0) {
                    previousAdvance = num(advRows[0].previous_balance);
                    advanceUsed = num(advRows[0].used_amount);
                    remainingAdvance = num(advRows[0].remaining_balance);
                }
            }

 // 3. Sale items for this sale
 const [saleItems] = await db.query(`
    SELECT
        sale_items.id,
        sale_items.quantity,
        sale_items.price,
        sale_items.discount_type,
        sale_items.discount_value,
        sale_items.discount_amount,
        sale_items.tax_type,
        sale_items.tax_value,
        sale_items.tax_amount,
        sale_items.total_after_discount,
        sale_items.total_after_tax,
        sale_items.total,
        purchases.product_name
    FROM sale_items
    JOIN purchases ON sale_items.purchase_id = purchases.id
    WHERE sale_items.sale_id = ?
    AND sale_items.deleted_at IS NULL
    ORDER BY sale_items.id ASC
`, [sale.id]);

// 4. Payments for this sale
const [payments] = await db.query(`
    SELECT
        id,
        amount,
        method,
        payment_date,
        transaction_group_id
    FROM payments
    WHERE sale_id = ?
    AND deleted_at IS NULL
    ORDER BY payment_date ASC
`, [sale.id]);

const saleData = {
    sale: {
        ...sale,
        customer: {
            name: sale.customer_name,
            shop_name: sale.customer_shop_name,
            contact: sale.customer_contact,
            city: sale.customer_city,
            customer_type: sale.customer_type,
        },
    },
    is_advance_sale: sale.payment_type === 'advance',
    previous_advance: previousAdvance,
    advance_used: advanceUsed,
    remaining_advance: remainingAdvance,
    sale_items: saleItems,
    payments,
};

            return reply.send({ success: true, data: saleData });
        } catch (err) {
            fastify.log.error(err);
            return reply.code(500).send({ success: false, error: err.message });
        }
    });
}