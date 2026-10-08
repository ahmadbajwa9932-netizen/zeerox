import pool from '../db.js';

// Whitelist of soft-deletable tables shown in the Recycle Bin.
// key = used in URLs, table = actual MySQL table, label = UI heading
const RECYCLE_TABLES = {
    purchases: {
        table: 'purchases',
        label: 'Purchases',
        listQuery: `
            SELECT p.id, p.product_name, p.barcode, p.purchased_price, p.sold_price,
                   p.quantity, p.unit, p.purchase_date, p.deleted_at,
                   c.name AS category_name, s.name AS supplier_name
            FROM purchases p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.deleted_at IS NOT NULL
            ORDER BY p.deleted_at DESC
        `,
    },
    categories: {
        table: 'categories',
        label: 'Categories',
        listQuery: `
            SELECT id, name, description, status, deleted_at
            FROM categories
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
    suppliers: {
        table: 'suppliers',
        label: 'Suppliers',
        listQuery: `
            SELECT id, name, company, address, contact_info, deleted_at
            FROM suppliers
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
    customers: {
        table: 'customers',
        label: 'Customers',
        listQuery: `
            SELECT id, name, customer_type, shop_name, city, contact,
                   current_balance, advance_payment, deleted_at
            FROM customers
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
    sales: {
        table: 'sales',
        label: 'Sales',
        listQuery: `
            SELECT s.id, s.voucher_no, s.payment_type, s.grand_total, s.status,
                   s.sale_date, s.deleted_at, c.name AS customer_name
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            WHERE s.deleted_at IS NOT NULL
            ORDER BY s.deleted_at DESC
        `,
    },
    expenses: {
        table: 'expenses',
        label: 'Expenses',
        listQuery: `
            SELECT id, category, description, amount, date, deleted_at
            FROM expenses
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
    manualNotes: {
        table: 'manual_notes',
        label: 'Manual Notes',
        listQuery: `
            SELECT id, heading, created_at, deleted_at
            FROM manual_notes
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
    saleReturns: {
        table: 'sale_returns',
        label: 'Sale Returns',
        listQuery: `
            SELECT sr.id, sr.voucher_no, sr.total_return_amount, sr.status,
                   sr.created_at, sr.deleted_at, c.name AS customer_name
            FROM sale_returns sr
            LEFT JOIN customers c ON c.id = sr.customer_id
            WHERE sr.deleted_at IS NOT NULL
            ORDER BY sr.deleted_at DESC
        `,
    },
    walkInReturns: {
        table: 'walk_in_return_sessions',
        label: 'Walk-in Returns',
        listQuery: `
            SELECT id, batch_no, total_refund_amount, customer_name,
                   shop_name, contact_no, created_at, deleted_at
            FROM walk_in_return_sessions
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
        `,
    },
};

export default async function recycleBinRoutes(fastify) {
    // Counts per table — used for tab badges
    fastify.get('/api/recycle-bin/summary', async (req, reply) => {
        const entries = Object.entries(RECYCLE_TABLES);
        const counts = {};

        for (const [key, cfg] of entries) {
            const [rows] = await pool.query(
                `SELECT COUNT(*) AS count FROM \`${cfg.table}\` WHERE deleted_at IS NOT NULL`
            );
            counts[key] = rows[0].count;
        }

        reply.send({
            counts,
            tables: entries.map(([key, cfg]) => ({ key, label: cfg.label })),
        });
    });

    // Deleted records for one table
    fastify.get('/api/recycle-bin/:tableKey', async (req, reply) => {
        const { tableKey } = req.params;
        const cfg = RECYCLE_TABLES[tableKey];

        if (!cfg) {
            return reply.status(404).send({ error: 'Unknown recycle bin table' });
        }

        const [rows] = await pool.query(cfg.listQuery);
        reply.send({ label: cfg.label, records: rows });
    });

     // Restore: deleted_at -> NULL
     fastify.post('/api/recycle-bin/:tableKey/:id/restore', async (req, reply) => {
        const { tableKey, id } = req.params;
        const cfg = RECYCLE_TABLES[tableKey];

        if (!cfg) {
            return reply.status(404).send({ error: 'Unknown recycle bin table' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.query(
                `UPDATE \`${cfg.table}\` SET deleted_at = NULL WHERE id = ?`,
                [id]
            );

            if (result.affectedRows === 0) {
                await conn.rollback();
                conn.release();
                return reply.status(404).send({ error: 'Record not found' });
            }

                          // Customer soft-delete cascades to sales, sale_returns and all their children — restore must too.
                          if (tableKey === 'customers') {
                            const [saleRows] = await conn.query(
                                'SELECT id FROM sales WHERE customer_id = ? AND deleted_at IS NOT NULL',
                                [id]
                            );
                            const saleIds = saleRows.map((r) => r.id);
            
                            const [returnRows] = await conn.query(
                                'SELECT id FROM sale_returns WHERE customer_id = ? AND deleted_at IS NOT NULL',
                                [id]
                            );
                            const returnIds = returnRows.map((r) => r.id);
            
                            if (saleIds.length) {
                                const salePlaceholders = saleIds.map(() => '?').join(',');
                                await conn.query(`UPDATE sales SET deleted_at = NULL WHERE id IN (${salePlaceholders})`, saleIds);
                                await conn.query(`UPDATE sale_items SET deleted_at = NULL WHERE sale_id IN (${salePlaceholders})`, saleIds);
                                await conn.query(`UPDATE payments SET deleted_at = NULL WHERE sale_id IN (${salePlaceholders})`, saleIds);
                                await conn.query(`UPDATE credit_sale_reminders SET deleted_at = NULL WHERE sale_id IN (${salePlaceholders})`, saleIds);
                            }
            
                            if (returnIds.length) {
                                const returnPlaceholders = returnIds.map(() => '?').join(',');
                                await conn.query(`UPDATE sale_returns SET deleted_at = NULL WHERE id IN (${returnPlaceholders})`, returnIds);
                                await conn.query(`UPDATE sale_return_items SET deleted_at = NULL WHERE sale_return_id IN (${returnPlaceholders})`, returnIds);
                            }
            
                            await conn.query('UPDATE customer_advance_logs SET deleted_at = NULL WHERE customer_id = ? AND deleted_at IS NOT NULL', [id]);
                            await conn.query('UPDATE advance_deposits SET deleted_at = NULL WHERE customer_id = ? AND deleted_at IS NOT NULL', [id]);
                        }
            
                         // Sales soft-delete cascades to related rows — restore must too.
                         if (tableKey === 'sales') {
                            await conn.query('UPDATE sale_items SET deleted_at = NULL WHERE sale_id = ? AND deleted_at IS NOT NULL', [id]);
                            await conn.query('UPDATE payments SET deleted_at = NULL WHERE sale_id = ? AND deleted_at IS NOT NULL', [id]);
                            await conn.query('UPDATE customer_advance_logs SET deleted_at = NULL WHERE sale_id = ? AND deleted_at IS NOT NULL', [id]);
                            await conn.query('UPDATE credit_sale_reminders SET deleted_at = NULL WHERE sale_id = ? AND deleted_at IS NOT NULL', [id]);
                        }

            // Invoice returns soft-delete cascades to sale_return_items — restore must too.
            if (tableKey === 'saleReturns') {
                await conn.query('UPDATE sale_return_items SET deleted_at = NULL WHERE sale_return_id = ? AND deleted_at IS NOT NULL', [id]);
            }

            // Walk-in returns soft-delete cascades to walk_in_returns — restore must too.
            if (tableKey === 'walkInReturns') {
                await conn.query('UPDATE walk_in_returns SET deleted_at = NULL WHERE session_id = ? AND deleted_at IS NOT NULL', [id]);
            }

            await conn.commit();
            reply.send({ success: true });
        } catch (err) {
            await conn.rollback();
            fastify.log.error(err);
            reply.status(500).send({ success: false, error: 'Failed to restore record' });
        } finally {
            conn.release();
        }
    });
}