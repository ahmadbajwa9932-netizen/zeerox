import pool from '../db.js';
import bcrypt from 'bcrypt';
import cron from 'node-cron';

export default async function settingsRoutes(fastify) {
    // GET current receipt settings
    fastify.get('/settings/receipt', async (req, reply) => {
        const [rows] = await pool.query('SELECT * FROM receipt_settings WHERE id = 1');
        return reply.send(rows[0] || null);
    });

    // Update receipt settings
        fastify.post('/settings/receipt/update', async (req, reply) => {
            const { paper_size, design_type, language, show_signature, show_stamp, show_paid_overlay } = req.body;
    
            await pool.query(
                `UPDATE receipt_settings
                 SET paper_size = ?, design_type = ?, language = ?, show_signature = ?, show_stamp = ?, show_paid_overlay = ?
                 WHERE id = 1`,
                [
                    paper_size,
                    design_type,
                    language || 'en',
                    show_signature ? 1 : 0,
                    show_stamp ? 1 : 0,
                    show_paid_overlay ? 1 : 0,
                ]
            );

        const [rows] = await pool.query('SELECT * FROM receipt_settings WHERE id = 1');
        return reply.send({ success: true, settings: rows[0] });
    });

    // Mock cash-sale data for the settings page's live iframe preview
    fastify.get('/settings/receipt/preview', async (req, reply) => {
        const {
            paper_size = '80mm',
            design_type = 'design1',
            language = 'en',
            show_signature = '1',
            show_stamp = '1',
            show_paid_overlay = '1',
            scenario = 'full',
        } = req.query;

        const [shopRows] = await pool.query('SELECT * FROM admin_settings LIMIT 1');
        const shop = shopRows[0] || {};

        const scenarios = {
            full: {
                sale: {
                    voucher_no: 'PREVIEW-0001',
                    payment_type: 'cash',
                    subtotal: 5000,
                    discount_type: 'percentage',
                    discount: 10,
                    discount_amount: 500,
                    tax_type: 'percentage',
                    tax: 5,
                    tax_amount: 225,
                    grand_total: 4725,
                    received_amount: 5000,
                    change_amount: 275,
                    remaining_balance: 0,
                    due_date: null,
                    status: 'paid',
                },
                customer: {
                    name: 'Ahmed Khan',
                    contact: '+92 300 7854321',
                    shop_name: 'Ahmed Traders',
                    city: 'Karachi',
                    customer_type: 'regular',
                    current_balance: 0,
                    advance_payment: 0,
                },
                items: [
                    {
                        id: 1, product_name: 'Product A', type: 'product', quantity: 2, price: 1500, unit: 'pcs',
                        discount_type: 'percentage', discount_value: 5, discount_amount: 150,
                        tax_type: 'amount', tax_value: 0, tax_amount: 0,
                        total_after_discount: 2850,
                    },
                    {
                        id: 2, product_name: 'Product B', type: 'product', quantity: 1, price: 2000, unit: 'pcs',
                        discount_type: 'amount', discount_value: 0, discount_amount: 0,
                        tax_type: 'amount', tax_value: 0, tax_amount: 0,
                        total_after_discount: 2000,
                    },
                    {
                        id: 3, product_name: 'Service Item', type: 'service', quantity: 1, price: 450, unit: 'srv',
                        discount_type: 'amount', discount_value: 50, discount_amount: 50,
                        tax_type: 'percentage', tax_value: 10, tax_amount: 40,
                        total_after_discount: 440,
                    },
                ],
                previous_balance: 0,
                total_payable: 4725,
                advance_used: 0,
                advance_deposit_info: null,
                total_paid: 0,
                was_previous_balance_cleared: false,
                invoice_payment_breakdown: [],
            },
            partial_with_balance: {
                sale: {
                    voucher_no: 'PREVIEW-0002',
                    payment_type: 'card',
                    subtotal: 3000,
                    discount_type: 'amount', discount: 0, discount_amount: 0,
                    tax_type: 'amount', tax: 0, tax_amount: 0,
                    grand_total: 3000,
                    received_amount: 1500,
                    change_amount: 0,
                    remaining_balance: 2500,
                    due_date: new Date(Date.now() + 7 * 86400000),
                    status: 'partial',
                },
                customer: {
                    name: 'Sara Malik', contact: '+92 321 1234567', shop_name: '', city: 'Lahore',
                    customer_type: 'wholesale', current_balance: 3500, advance_payment: 0,
                },
                items: [
                    { id: 1, product_name: 'Bulk Item X', type: 'product', quantity: 10, price: 300, unit: 'box',
                      discount_type: 'amount', discount_value: 0, discount_amount: 0,
                      tax_type: 'amount', tax_value: 0, tax_amount: 0, total_after_discount: 3000 },
                ],
                previous_balance: 1000,
                total_payable: 4000,
                advance_used: 0,
                advance_deposit_info: null,
                total_paid: 1500,
                was_previous_balance_cleared: false,
                invoice_payment_breakdown: [],
            },
            advance_applied: {
                sale: {
                    voucher_no: 'PREVIEW-0003',
                    payment_type: 'cash',
                    subtotal: 1200, discount_type: 'amount', discount: 0, discount_amount: 0,
                    tax_type: 'amount', tax: 0, tax_amount: 0,
                    grand_total: 1200, received_amount: 0, change_amount: 0, remaining_balance: 0,
                    due_date: null, status: 'paid',
                },
                customer: {
                    name: 'Bilal Traders', contact: '+92 333 9988776', shop_name: 'Bilal Store', city: 'Islamabad',
                    customer_type: 'regular', current_balance: 0, advance_payment: 300,
                },
                items: [
                    { id: 1, product_name: 'Item Z', type: 'product', quantity: 4, price: 300, unit: 'pcs',
                      discount_type: 'amount', discount_value: 0, discount_amount: 0,
                      tax_type: 'amount', tax_value: 0, tax_amount: 0, total_after_discount: 1200 },
                ],
                previous_balance: 0,
                total_payable: 1200,
                advance_used: 900,
                advance_deposit_info: {
                    was_advance_involved: true,
                    total_deposited: 1200,
                    used_for_current_sale: 900,
                    used_for_old_balance: 0,
                    old_invoices_paid: [],
                    remaining: 300,
                },
                total_paid: 0,
                was_previous_balance_cleared: false,
                invoice_payment_breakdown: [],
            },
            unpaid_credit: {
                sale: {
                    voucher_no: 'PREVIEW-0004',
                    payment_type: 'credit',
                    subtotal: 800, discount_type: 'amount', discount: 0, discount_amount: 0,
                    tax_type: 'amount', tax: 0, tax_amount: 0,
                    grand_total: 800, received_amount: 0, change_amount: 0, remaining_balance: 800,
                    due_date: new Date(Date.now() + 14 * 86400000), status: 'unpaid',
                },
                customer: {
                    name: 'Usman Retail', contact: '+92 345 5566778', shop_name: 'Usman Mart', city: 'Faisalabad',
                    customer_type: 'wholesale', current_balance: 800, advance_payment: 0,
                },
                items: [
                    { id: 1, product_name: 'Item Q', type: 'product', quantity: 2, price: 400, unit: 'pcs',
                      discount_type: 'amount', discount_value: 0, discount_amount: 0,
                      tax_type: 'amount', tax_value: 0, tax_amount: 0, total_after_discount: 800 },
                ],
                previous_balance: 0,
                total_payable: 800,
                advance_used: 0,
                advance_deposit_info: null,
                total_paid: 0,
                was_previous_balance_cleared: false,
                invoice_payment_breakdown: [],
            },
        };

        const chosen = scenarios[scenario] || scenarios.full;

        const mockReceipt = {
            shop: {
                shop_name: shop.shop_name || 'Your Shop Name',
                address: shop.address || '123 Main Street',
                phone: shop.phone || '0300-0000000',
            },
            seller_name: 'Demo Cashier',
            sale: { ...chosen.sale, sale_date: new Date() },
            customer: chosen.customer,
            items: chosen.items,
            previous_balance: chosen.previous_balance,
            total_payable: chosen.total_payable,
            advance_used: chosen.advance_used,
            advance_deposit_info: chosen.advance_deposit_info,
            total_paid: chosen.total_paid,
            was_previous_balance_cleared: chosen.was_previous_balance_cleared,
            invoice_payment_breakdown: chosen.invoice_payment_breakdown,
            receiptSettings: {
                paper_size,
                design_type,
                language,
                show_signature: show_signature === '1' || show_signature === 'true',
                show_stamp: show_stamp === '1' || show_stamp === 'true',
                show_paid_overlay: show_paid_overlay === '1' || show_paid_overlay === 'true',
            },
        };

        return reply.send(mockReceipt);
    });

        // GET current app settings (inventory + purchase defaults)
        fastify.get('/settings/app', async (req, reply) => {
            const [rows] = await pool.query('SELECT * FROM app_settings WHERE id = 1');
            return reply.send(rows[0] || null);
        });
    
        // Update inventory settings
        fastify.post('/settings/app/inventory', async (req, reply) => {
            const { default_low_inventory } = req.body;
    
            await pool.query(
                `UPDATE app_settings SET default_low_inventory = ? WHERE id = 1`,
                [default_low_inventory]
            );
    
            const [rows] = await pool.query('SELECT * FROM app_settings WHERE id = 1');
            return reply.send({ success: true, settings: rows[0] });
        });
    
        // Update default purchase settings (discount + tax)
        fastify.post('/settings/app/purchase', async (req, reply) => {
            const {
                enable_default_discount,
                default_discount_type,
                default_discount_value,
                enable_default_tax,
                default_tax_type,
                default_tax_value,
            } = req.body;
    
            await pool.query(
                `UPDATE app_settings
                 SET enable_default_discount = ?, default_discount_type = ?, default_discount_value = ?,
                     enable_default_tax = ?, default_tax_type = ?, default_tax_value = ?
                 WHERE id = 1`,
                [
                    enable_default_discount ? 1 : 0,
                    default_discount_type,
                    default_discount_value,
                    enable_default_tax ? 1 : 0,
                    default_tax_type,
                    default_tax_value,
                ]
            );
    
            const [rows] = await pool.query('SELECT * FROM app_settings WHERE id = 1');
            return reply.send({ success: true, settings: rows[0] });
        });

    // GET all units
    fastify.get('/settings/units', async (req, reply) => {
        const [rows] = await pool.query('SELECT * FROM units ORDER BY sort_order ASC, id ASC');
        return reply.send(rows);
    });

    // Create a new (non-default) unit
    fastify.post('/settings/units', async (req, reply) => {
        const { name, display_name } = req.body;

        if (!name || !display_name) {
            return reply.status(422).send({ success: false, message: 'Name and display name are required.' });
        }

        const [existing] = await pool.query('SELECT id FROM units WHERE name = ?', [name]);
        if (existing.length > 0) {
            return reply.status(422).send({ success: false, message: 'A unit with this name already exists.' });
        }

        const [[{ maxSort }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM units');

        const [inserted] = await pool.query(
            `INSERT INTO units (name, display_name, is_active, is_default, sort_order)
             VALUES (?, ?, 1, 0, ?)`,
            [name, display_name, maxSort + 1]
        );

        const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [inserted.insertId]);
        return reply.send({ success: true, unit: rows[0] });
    });

    // Toggle a unit's active state
    fastify.post('/settings/units/:id/toggle', async (req, reply) => {
        const { id } = req.params;

        await pool.query('UPDATE units SET is_active = NOT is_active WHERE id = ?', [id]);

        const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [id]);
        return reply.send({ success: true, unit: rows[0] });
    });

    // Delete a unit — only allowed for non-default (user-added) units
    fastify.delete('/settings/units/:id', async (req, reply) => {
        const { id } = req.params;

        const [rows] = await pool.query('SELECT * FROM units WHERE id = ?', [id]);
        if (rows.length === 0) {
            return reply.status(404).send({ success: false, message: 'Unit not found.' });
        }
        if (rows[0].is_default) {
            return reply.status(422).send({ success: false, message: 'Default units cannot be deleted.' });
        }

        await pool.query('DELETE FROM units WHERE id = ?', [id]);
        return reply.send({ success: true, message: 'Unit deleted successfully.' });
    });

        // GET current currency settings
        fastify.get('/settings/currency', async (req, reply) => {
            const [rows] = await pool.query('SELECT * FROM currency_settings WHERE id = 1');
            return reply.send(rows[0] || null);
        });
    
        // Update currency settings
        fastify.post('/settings/currency/update', async (req, reply) => {
            const { currency_symbol, currency_locale, currency_position } = req.body;
    
            await pool.query(
                `UPDATE currency_settings
                 SET currency_symbol = ?, currency_locale = ?, currency_position = ?
                 WHERE id = 1`,
                [currency_symbol, currency_locale, currency_position]
            );
    
            const [rows] = await pool.query('SELECT * FROM currency_settings WHERE id = 1');
            return reply.send({ success: true, settings: rows[0] });
        });

        // ─────────────────────────────────────────────────
    // AUTO DELETE SETTINGS
    // ─────────────────────────────────────────────────
    const AUTO_DELETE_PERIODS = {
        never: null,
        '1year': 365,
        '2years': 730,
        '3years': 1095,
        '4years': 1460,
        '5years': 1825,
        '10years': 3650,
    };
    const AUTO_DELETE_LABELS = {
        never: 'Never',
        '1year': '1 year',
        '2years': '2 years',
        '3years': '3 years',
        '4years': '4 years',
        '5years': '5 years',
        '10years': '10 years',
    };

    // Shared deletion logic — used by both the Save Settings route and the daily cron job
    async function runAutoDelete(period) {
        const days = AUTO_DELETE_PERIODS[period];
        if (!days) {
            return { success: false, message: 'Auto delete is disabled' };
        }

        const periodName = AUTO_DELETE_LABELS[period];
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const cutoff = new Date(Date.now() - days * 86400000)
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');

            const [[{ totalOldSales }]] = await connection.query(
                'SELECT COUNT(*) as totalOldSales FROM sales WHERE sale_date < ?',
                [cutoff]
            );
            const [[{ totalOldCustomers }]] = await connection.query(
                'SELECT COUNT(*) as totalOldCustomers FROM customers WHERE created_at < ?',
                [cutoff]
            );

            if (totalOldSales === 0 && totalOldCustomers === 0) {
                await connection.rollback();
                connection.release();
                return {
                    success: true,
                    no_records: true,
                    message: `No sales or customers found older than ${periodName}`,
                    sales_deleted: 0,
                    customers_deleted: 0,
                    details: {
                        period: periodName,
                        cutoff_date: cutoff,
                        total_old_sales: 0,
                        total_old_customers: 0,
                        protected_sales: 0,
                        protected_customers: 0,
                    },
                };
            }

            const [salesToDelete] = await connection.query(
                `SELECT id FROM sales
                 WHERE sale_date < ?
                   AND (payment_type != 'credit' OR remaining_balance <= 0)`,
                [cutoff]
            );
            const saleIds = salesToDelete.map((s) => s.id);
            const salesDeletedCount = saleIds.length;
            const protectedSales = totalOldSales - salesDeletedCount;

            if (salesDeletedCount > 0) {
                await connection.query(
                    `DELETE FROM customer_advance_logs WHERE sale_id IN (?) AND is_new_advance = 0`,
                    [saleIds]
                );
                await connection.query(
                    `DELETE sri FROM sale_return_items sri
                     JOIN sale_returns sr ON sr.id = sri.sale_return_id
                     WHERE sr.sale_id IN (?)`,
                    [saleIds]
                );
                await connection.query(`DELETE FROM sale_returns WHERE sale_id IN (?)`, [saleIds]);
                await connection.query(`DELETE FROM sales WHERE id IN (?)`, [saleIds]);
            }

            const [customersToDelete] = await connection.query(
                `SELECT c.id FROM customers c
                 WHERE c.created_at < ?
                   AND c.current_balance <= 0
                   AND c.advance_payment <= 0
                   AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id)`,
                [cutoff]
            );
            const customerIds = customersToDelete.map((c) => c.id);
            const customersDeletedCount = customerIds.length;
            const protectedCustomers = totalOldCustomers - customersDeletedCount;

            if (customersDeletedCount > 0) {
                await connection.query(`DELETE FROM customers WHERE id IN (?)`, [customerIds]);
            }

            await connection.commit();
            connection.release();

            return {
                success: true,
                no_records: false,
                message: `Successfully processed records older than ${periodName}`,
                sales_deleted: salesDeletedCount,
                customers_deleted: customersDeletedCount,
                details: {
                    period: periodName,
                    cutoff_date: cutoff,
                    total_old_sales: totalOldSales,
                    total_old_customers: totalOldCustomers,
                    protected_sales: protectedSales,
                    protected_customers: protectedCustomers,
                },
            };
        } catch (err) {
            await connection.rollback();
            connection.release();
            return { success: false, message: 'Error during deletion: ' + err.message };
        }
    }

    fastify.get('/settings/auto-delete/get', async (req, reply) => {
        const [rows] = await pool.query('SELECT auto_delete_period FROM app_settings WHERE id = 1');
        return reply.send({ auto_delete_period: rows[0]?.auto_delete_period || 'never' });
    });

    // Save the period AND run deletion immediately, once, using the newly saved period
    fastify.post('/settings/auto-delete/update', async (req, reply) => {
        const { auto_delete_period } = req.body;

        if (!Object.prototype.hasOwnProperty.call(AUTO_DELETE_PERIODS, auto_delete_period)) {
            return reply.status(422).send({ success: false, message: 'Invalid auto delete period.' });
        }

        await pool.query('UPDATE app_settings SET auto_delete_period = ? WHERE id = 1', [auto_delete_period]);

        let deleteResult = null;
        if (auto_delete_period !== 'never') {
            deleteResult = await runAutoDelete(auto_delete_period);
        }

        return reply.send({
            success: true,
            message: 'Auto delete settings updated successfully!',
            delete_result: deleteResult,
        });
    });

    // Re-verifies the logged-in admin's own password (step-up auth before entering this settings page).
    fastify.post('/settings/verify-admin-password', async (req, reply) => {
        const { admin_password } = req.body;

        if (!req.user?.id) {
            return reply.status(401).send({ success: false, message: 'Not authenticated.' });
        }

        const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(admin_password || '', user.password))) {
            return reply.status(401).send({ success: false, message: 'Incorrect password.' });
        }

        return reply.send({ success: true });
    });

    // Daily cron job — re-checks the saved period and re-runs deletion, independent of any browser
    cron.schedule('0 0 * * *', async () => {
        try {
            const [rows] = await pool.query('SELECT auto_delete_period FROM app_settings WHERE id = 1');
            const period = rows[0]?.auto_delete_period || 'never';
            if (period !== 'never') {
                const result = await runAutoDelete(period);
                fastify.log.info(`[auto-delete cron] ${result.message}`);
            }
        } catch (err) {
            fastify.log.error('[auto-delete cron] failed: ' + err.message);
        }
    });

}