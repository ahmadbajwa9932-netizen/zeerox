import pool from '../db.js';
import { logActivity, formatDateValue  } from '../helpers/activityLogger.js';

export default async function navbarRoutes(fastify) {
    // Credit sale notifications (due within 7 days or overdue)
    fastify.get('/api/navbar/credit-sales-notifications', async (req, reply) => {
        const [rows] = await pool.query(
            `SELECT 
                sales.id AS sale_id,
                sales.voucher_no,
                customers.name AS customer_name,
                customers.contact,
                customers.city,
                customers.shop_name,
                sales.grand_total,
                sales.due_date,
                sales.remaining_balance,
                DATEDIFF(sales.due_date, CURDATE()) AS days_difference
            FROM sales
            JOIN customers ON sales.customer_id = customers.id
            WHERE sales.payment_type = 'credit'
              AND sales.status != 'paid'
              AND sales.due_date IS NOT NULL
              AND sales.deleted_at IS NULL
              AND sales.due_date <= DATE_ADD(NOW(), INTERVAL 7 DAY)
            ORDER BY sales.due_date ASC`
        );
        return reply.send(rows);
    });

    // Create a reminder
    fastify.post('/api/navbar/credit-sale-reminders', async (req, reply) => {
        const { sale_id, voucher_no, customer_name, contact, remaining_balance, reminder_datetime } = req.body;

        if (!sale_id || !voucher_no || !customer_name || remaining_balance === undefined || !reminder_datetime) {
            return reply.status(422).send({ success: false, message: 'Missing required fields' });
        }
        if (new Date(reminder_datetime) <= new Date()) {
            return reply.status(422).send({ success: false, message: 'reminder_datetime must be in the future' });
        }

        const [result] = await pool.query(
            `INSERT INTO credit_sale_reminders 
                (sale_id, voucher_no, customer_name, contact, remaining_balance, reminder_datetime, is_triggered)
             VALUES (?, ?, ?, ?, ?, ?, false)`,
            [sale_id, voucher_no, customer_name, contact || null, remaining_balance, reminder_datetime]
        );

        return reply.send({
            success: true,
            message: 'Reminder set successfully!',
            reminder: {
                id: result.insertId, sale_id, voucher_no, customer_name,
                contact, remaining_balance, reminder_datetime, is_triggered: false
            }
        });
    });

    // Check + trigger due reminders
    fastify.get('/api/navbar/check-reminders', async (req, reply) => {
        const [reminders] = await pool.query(
            `SELECT * FROM credit_sale_reminders WHERE is_triggered = false AND reminder_datetime <= NOW()`
        );

        if (reminders.length > 0) {
            const ids = reminders.map(r => r.id);
            await pool.query(`UPDATE credit_sale_reminders SET is_triggered = true WHERE id IN (?)`, [ids]);
        }

        return reply.send({ success: true, reminders });
    });

    // Delete a reminder
    fastify.delete('/api/navbar/credit-sale-reminders/:id', async (req, reply) => {
        const { id } = req.params;
        const [result] = await pool.query(`DELETE FROM credit_sale_reminders WHERE id = ?`, [id]);
        if (result.affectedRows === 0) {
            return reply.status(404).send({ success: false, message: 'Reminder not found' });
        }
        return reply.send({ success: true, message: 'Reminder deleted successfully!' });
    });

   // Update due date
   fastify.post('/api/sales/:id/update-due-date', async (req, reply) => {
    const { id } = req.params;
    const { new_due_date } = req.body;

    if (!new_due_date || new Date(new_due_date) <= new Date()) {
        return reply.status(422).send({ success: false, message: 'new_due_date must be a future date' });
    }

    // TODO: plug in your permission check here (matches Laravel's sales.credit.edit gate).
    // Depends on what checkAuth.js attaches to req.user — share that file and I'll wire it in.

    const [[sale]] = await pool.query(`SELECT id, voucher_no, due_date FROM sales WHERE id = ?`, [id]);
    if (!sale) {
        return reply.status(404).send({ success: false, message: 'Sale not found' });
    }

    const [result] = await pool.query(`UPDATE sales SET due_date = ? WHERE id = ?`, [new_due_date, id]);
    if (result.affectedRows === 0) {
        return reply.status(404).send({ success: false, message: 'Sale not found' });
    }

    await logActivity(req, {
        action_type: 'edit',
        description: `Updated due date for credit sale "${sale.voucher_no}" (via navbar reminder) — ${formatDateValue(sale.due_date)} → ${formatDateValue(new_due_date)}`,
        entity_type: 'sale',
        entity_id: id,
        old_data: { due_date: sale.due_date },
        new_data: { due_date: new_due_date },
    });

    return reply.send({ success: true, message: 'Due date updated successfully!' });
});
}