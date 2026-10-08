import db from '../db.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

export default async function expenseRoutes(fastify) {

    // GET /api/expenses — paginated, sortable, searchable
    fastify.get('/api/expenses', async (request, reply) => {
        const {
            page = 1,
            per_page = 10,
            sort_column = 'id',
            sort_direction = 'desc',
            search = ''
        } = request.query;

        const allowedColumns = ['id', 'category', 'amount', 'date', 'start_date', 'end_date', 'days', 'created_at'];
        const allowedDirections = ['asc', 'desc'];

        const sortCol = allowedColumns.includes(sort_column) ? sort_column : 'id';
        const sortDir = allowedDirections.includes(sort_direction.toLowerCase()) ? sort_direction.toLowerCase() : 'desc';

        const offset = (parseInt(page) - 1) * parseInt(per_page);
        const limit = parseInt(per_page);

        try {
            let whereClause = 'WHERE deleted_at IS NULL';
            const params = [];

            if (search) {
                whereClause += ' AND category LIKE ?';
                params.push(`%${search}%`);
            }

            const [[{ total }]] = await db.query(
                `SELECT COUNT(*) as total FROM expenses ${whereClause}`,
                params
            );

            const [rows] = await db.query(
                `SELECT * FROM expenses ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const lastPage = Math.ceil(total / limit);
            const currentPage = parseInt(page);

            return reply.send({
                success: true,
                data: rows,
                pagination: {
                    current_page: currentPage,
                    last_page: lastPage,
                    per_page: limit,
                    total,
                    first_item: offset + 1,
                    last_item: offset + rows.length,
                    has_more_pages: currentPage < lastPage,
                    on_first_page: currentPage === 1,
                }
            });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to fetch expenses.' });
        }
    });

    // POST /api/expenses — store single expense
    fastify.post('/api/expenses', async (request, reply) => {
        const { category, description, amount, date, start_date, end_date } = request.body;

        if (!category || !amount || !date || !start_date || !end_date) {
            return reply.status(422).send({ success: false, message: 'category, amount, date, start_date and end_date are required.' });
        }

        if (isNaN(amount) || parseFloat(amount) < 0) {
            return reply.status(422).send({ success: false, message: 'Amount must be a non-negative number.' });
        }

        const days = Math.floor((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;

        if (!Number.isInteger(days) || days < 1 || days > 365) {
            return reply.status(422).send({ success: false, message: 'end_date must be on or after start_date, and the range must not exceed 365 days.' });
        }

        try {
            const [result] = await db.query(
                `INSERT INTO expenses (category, description, amount, date, start_date, end_date, days, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [category, description || null, parseFloat(amount), date, start_date, end_date, days]
            );

            const [[expense]] = await db.query('SELECT * FROM expenses WHERE id = ?', [result.insertId]);

            return reply.status(201).send({ success: true, message: 'Expense added successfully!', data: expense });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to save expense.' });
        }
    });

    // POST /api/expenses/multiple — store multiple expenses
    fastify.post('/api/expenses/multiple', async (request, reply) => {
        const { expenses } = request.body;

        if (!Array.isArray(expenses) || expenses.length === 0) {
            return reply.status(422).send({ success: false, message: 'expenses array is required and must not be empty.' });
        }

        const computedDays = [];

        for (let i = 0; i < expenses.length; i++) {
            const e = expenses[i];
            if (!e.category || !e.amount || !e.date || !e.start_date || !e.end_date) {
                return reply.status(422).send({ success: false, message: `Row ${i + 1}: category, amount, date, start_date and end_date are required.` });
            }
            if (isNaN(e.amount) || parseFloat(e.amount) < 0) {
                return reply.status(422).send({ success: false, message: `Row ${i + 1}: Amount must be a non-negative number.` });
            }

            const days = Math.floor((new Date(e.end_date) - new Date(e.start_date)) / (1000 * 60 * 60 * 24)) + 1;

            if (!Number.isInteger(days) || days < 1 || days > 365) {
                return reply.status(422).send({ success: false, message: `Row ${i + 1}: end_date must be on or after start_date, and the range must not exceed 365 days.` });
            }

            computedDays.push(days);
        }

        try {
            const values = expenses.map((e, i) => [
                e.category,
                e.description || null,
                parseFloat(e.amount),
                e.date,
                e.start_date,
                e.end_date,
                computedDays[i]
            ]);

            await db.query(
                `INSERT INTO expenses (category, description, amount, date, start_date, end_date, days, created_at, updated_at)
                 VALUES ?`,
                [values.map(v => [...v, new Date(), new Date()])]
            );

            return reply.send({ success: true, message: 'Multiple expenses added successfully!' });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to save expenses.' });
        }
    });

    // GET /api/expenses/:id — get single expense
    fastify.get('/api/expenses/:id', async (request, reply) => {
        const { id } = request.params;
        try {
            const [[expense]] = await db.query(
                'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!expense) {
                return reply.status(404).send({ success: false, message: 'Expense not found.' });
            }
            return reply.send({ success: true, data: expense });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to fetch expense.' });
        }
    });

    // PUT /api/expenses/:id — update expense
    fastify.put('/api/expenses/:id', async (request, reply) => {
        const { id } = request.params;
        const { category, description, amount, date, start_date, end_date } = request.body;

        if (!category || !amount || !date || !start_date || !end_date) {
            return reply.status(422).send({ success: false, message: 'category, amount, date, start_date and end_date are required.' });
        }

        const days = Math.floor((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;

        if (!Number.isInteger(days) || days < 1 || days > 365) {
            return reply.status(422).send({ success: false, message: 'end_date must be on or after start_date, and the range must not exceed 365 days.' });
        }

        try {
            const [[expense]] = await db.query(
                'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!expense) {
                return reply.status(404).send({ success: false, message: 'Expense not found.' });
            }

            await db.query(
                `UPDATE expenses SET category=?, description=?, amount=?, date=?, start_date=?, end_date=?, days=?, updated_at=NOW() WHERE id=?`,
                [category, description || null, parseFloat(amount), date, start_date, end_date, days, id]
            );

            const [[updated]] = await db.query('SELECT * FROM expenses WHERE id = ?', [id]);

            const changes = describeChanges(
                expense,
                { category, description: description || null, amount: parseFloat(amount), date, start_date, end_date, days },
                {
                    category: 'Category',
                    description: 'Description',
                    amount: 'Amount',
                    date: 'Date',
                    start_date: 'Start Date',
                    end_date: 'End Date',
                    days: 'Days',
                }
            );
            const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

            await logActivity(request, {
                action_type: 'edit',
                description: `Updated expense "${expense.category}" — ${changeText}`,
                entity_type: 'expense',
                entity_id: id,
                old_data: expense,
                new_data: updated,
            });

            return reply.send({ success: true, message: 'Expense updated successfully!', data: updated });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Failed to update expense.' });
        }
    });

        // DELETE /api/expenses/:id — soft delete (default) or permanent delete (?permanent=true)
        fastify.delete('/api/expenses/:id', async (request, reply) => {
            const { id } = request.params;
            const { permanent } = request.query;
    
            try {
                if (permanent === 'true') {
                    const [[expense]] = await db.query('SELECT * FROM expenses WHERE id = ?', [id]);
                    if (!expense) {
                        return reply.status(404).send({ success: false, message: 'Expense not found.' });
                    }
    
                    await db.query('DELETE FROM expenses WHERE id = ?', [id]);

                    await logActivity(request, {
                        action_type: 'permanent_delete',
                        description: `Permanently deleted expense "${expense.category}" (Rs ${parseFloat(expense.amount).toFixed(2)})`,
                        entity_type: 'expense',
                        entity_id: id,
                        old_data: expense,
                    });
    
                    return reply.send({ success: true, message: 'Expense permanently deleted!' });
                }
    
                const [[expense]] = await db.query(
                    'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
                    [id]
                );
                if (!expense) {
                    return reply.status(404).send({ success: false, message: 'Expense not found.' });
                }
    
                await db.query('UPDATE expenses SET deleted_at=NOW() WHERE id=?', [id]);

                await logActivity(request, {
                    action_type: 'delete',
                    description: `Deleted expense "${expense.category}" (Rs ${parseFloat(expense.amount).toFixed(2)})`,
                    entity_type: 'expense',
                    entity_id: id,
                    old_data: expense,
                });
    
                return reply.send({ success: true, message: 'Expense soft deleted successfully!' });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ success: false, message: 'Failed to delete expense.' });
            }
        });
}