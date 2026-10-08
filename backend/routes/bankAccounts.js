import pool from '../db.js';

export default async function bankAccountRoutes(fastify, opts) {

    // GET /api/bank-accounts — list all active accounts
    fastify.get('/api/bank-accounts', async (req, reply) => {
        const { search = '', active_only } = req.query;

        let query = `
            SELECT id, bank_name, account_title, account_number, branch_name,
                   balance, status, created_at
            FROM bank_accounts
            WHERE deleted_at IS NULL
        `;
        const params = [];

        if (active_only === 'true') {
            query += ` AND status = 1`;
        }

        if (search.trim()) {
            query += ` AND (bank_name LIKE ? OR account_title LIKE ? OR account_number LIKE ?)`;
            const like = `%${search.trim()}%`;
            params.push(like, like, like);
        }

        query += ` ORDER BY created_at DESC`;

        const [rows] = await pool.query(query, params);
        return reply.send({ success: true, data: rows });
    });

    // POST /api/bank-accounts — create
    fastify.post('/api/bank-accounts', async (req, reply) => {
        const { bank_name, account_title, account_number, branch_name, balance } = req.body;

        if (!bank_name || !bank_name.trim()) {
            return reply.code(400).send({ success: false, message: 'Bank name is required' });
        }

        const [result] = await pool.query(
            `INSERT INTO bank_accounts
                (bank_name, account_title, account_number, branch_name, balance)
             VALUES (?, ?, ?, ?, ?)`,
            [
                bank_name.trim(),
                account_title?.trim() || null,
                account_number?.trim() || null,
                branch_name?.trim() || null,
                Number(balance) || 0,
            ]
        );

        return reply.send({ success: true, id: result.insertId });
    });

 // GET /api/bank-accounts/:id — single account details (for the payments page header)
 fastify.get('/api/bank-accounts/:id', async (req, reply) => {
    const { id } = req.params;
    const [[account]] = await pool.query(
        `SELECT id, bank_name, account_title, account_number, branch_name, balance, status, created_at
         FROM bank_accounts WHERE id = ? AND deleted_at IS NULL`,
        [id]
    );
    if (!account) {
        return reply.code(404).send({ success: false, message: 'Bank account not found' });
    }
    return reply.send({ success: true, data: account });
});

// GET /api/bank-accounts/:id/payments — payments linked to this account
    fastify.get('/api/bank-accounts/:id/payments', async (req, reply) => {
        const { id } = req.params;

        const [rows] = await pool.query(
            `SELECT p.id, p.amount, p.method, p.payment_date, s.voucher_no
             FROM payments p
             JOIN sales s ON s.id = p.sale_id
             WHERE p.bank_account_id = ? AND p.deleted_at IS NULL
             ORDER BY p.payment_date DESC`,
            [id]
        );

        return reply.send({ success: true, data: rows });
    });

     // DELETE /api/bank-accounts/:id — soft delete
     fastify.delete('/api/bank-accounts/:id', async (req, reply) => {
        const { id } = req.params;
        await pool.query(`UPDATE bank_accounts SET deleted_at = NOW() WHERE id = ?`, [id]);
        return reply.send({ success: true });
    });

    // PATCH /api/bank-accounts/:id/status — activate/deactivate
    fastify.patch('/api/bank-accounts/:id/status', async (req, reply) => {
        const { id } = req.params;
        const { status } = req.body; // 1 or 0

        await pool.query(
            `UPDATE bank_accounts SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status ? 1 : 0, id]
        );

        return reply.send({ success: true });
    });

    // called from the sale-creation logic when payment_type = 'card'
    fastify.post('/api/bank-accounts/:id/credit', async (req, reply) => {
        const { id } = req.params;
        const { amount } = req.body;
        await pool.query(`UPDATE bank_accounts SET balance = balance + ? WHERE id = ?`, [amount, id]);
        return reply.send({ success: true });
    });

}