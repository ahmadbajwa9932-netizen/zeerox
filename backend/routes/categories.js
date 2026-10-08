import pool from '../db.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

export default async function categoryRoutes(fastify) {

    // GET /api/categories - list with pagination, search, sort
    fastify.get('/api/categories', async (req, reply) => {
        const page = parseInt(req.query.page) || 1;
        const perPage = 10;
        const offset = (page - 1) * perPage;
        const sortColumn = ['name', 'status', 'created_at', 'purchases_count'].includes(req.query.sort_column)
            ? req.query.sort_column : 'created_at';
        const sortDirection = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';
        const search = req.query.search ? `%${req.query.search}%` : null;

        try {
            // Build WHERE clause
            let where = search ? 'WHERE c.deleted_at IS NULL AND c.name LIKE ?' : 'WHERE c.deleted_at IS NULL';
            let params = search ? [search] : [];

            // Count total
            const [countRows] = await pool.query(
                `SELECT COUNT(*) as total FROM categories c ${where}`,
                params
            );
            const total = countRows[0].total;
            const lastPage = Math.ceil(total / perPage);

            // Sort by purchases_count requires subquery
            let orderBy = sortColumn === 'purchases_count'
                ? `(SELECT COUNT(*) FROM purchases p WHERE p.category_id = c.id AND p.deleted_at IS NULL) ${sortDirection}`
                : `c.${sortColumn} ${sortDirection}`;

            const [rows] = await pool.query(
                `SELECT c.*, 
                    (SELECT COUNT(*) FROM purchases p WHERE p.category_id = c.id AND p.deleted_at IS NULL) as purchases_count
                FROM categories c
                ${where}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?`,
                [...params, perPage, offset]
            );

            return reply.send({
                success: true,
                data: rows,
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
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    // POST /api/categories - create
    fastify.post('/api/categories', async (req, reply) => {
        const { name, description } = req.body;

        if (!name || !name.trim()) {
            return reply.status(422).send({ success: false, message: 'Category name is required.' });
        }

        try {
            const [existing] = await pool.query(
                'SELECT id FROM categories WHERE name = ? AND deleted_at IS NULL',
                [name.trim()]
            );
            if (existing.length > 0) {
                return reply.status(422).send({ success: false, message: 'Category name already exists!' });
            }

            await pool.query(
                'INSERT INTO categories (name, description, status, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())',
                [name.trim(), description || null]
            );

            return reply.send({ success: true, message: 'Category created successfully!' });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong.' });
        }
    });

    // GET /api/categories/:id - fetch one for edit modal
    fastify.get('/api/categories/:id', async (req, reply) => {
        const { id } = req.params;
        try {
            const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
            if (rows.length === 0) return reply.status(404).send({ success: false, message: 'Not found' });
            return reply.send({ success: true, category: rows[0] });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    // PUT /api/categories/:id - update
    fastify.put('/api/categories/:id', async (req, reply) => {
        const { id } = req.params;
        const { name, description } = req.body;

        try {
            const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
            if (rows.length === 0) return reply.status(404).send({ success: false, message: 'Not found' });

            const category = rows[0];
            if (category.name === 'Misc') {
                return reply.status(403).send({ success: false, message: 'The default category cannot be edited.' });
            }

            const finalName = name?.trim() || category.name;
            const finalDescription = description ?? category.description;

            await pool.query(
                'UPDATE categories SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
                [finalName, finalDescription, id]
            );

            const changes = describeChanges(
                category,
                { name: finalName, description: finalDescription },
                { name: 'Name', description: 'Description' }
            );
            const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

            await logActivity(req, {
                action_type: 'edit',
                description: `Updated category "${category.name}" — ${changeText}`,
                entity_type: 'category',
                entity_id: id,
                old_data: category,
                new_data: { name: finalName, description: finalDescription },
            });

            return reply.send({ success: true, message: 'Category updated successfully!' });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong.' });
        }
    });

    // PATCH /api/categories/:id/toggle-status
    fastify.patch('/api/categories/:id/toggle-status', async (req, reply) => {
        const { id } = req.params;
        try {
            const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
            if (rows.length === 0) return reply.status(404).send({ success: false, message: 'Not found' });

            const category = rows[0];
            if (category.name === 'Misc' || category.name === 'Services') {
                return reply.status(403).send({ success: false, message: 'This category cannot be deactivated.' });
            }

            const newStatus = category.status ? 0 : 1;
            await pool.query('UPDATE categories SET status = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);

            return reply.send({ success: true, status: newStatus, message: 'Status updated successfully!' });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    fastify.get('/api/categories/:id/products', async (req, reply) => {
        const { id } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = 10;
        const offset = (page - 1) * perPage;

        // Allowed sort columns (matches Laravel whitelist logic)
        const allowedColumns = [
            'product_name',
            'unit',
            'purchased_price',
            'purchase_date',
            'total_stock',       // maps to quantity
            'available_stock',   // computed: quantity - sold_quantity
            'available_stock_rs',// computed: (quantity - sold_quantity) * purchased_price
            'total',             // computed: quantity * purchased_price
        ];
        const sortColumn = allowedColumns.includes(req.query.sort_column)
            ? req.query.sort_column
            : 'purchase_date';
        const sortDirection = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';
        const search = req.query.search ? `%${req.query.search}%` : null;

        try {
            // Verify category exists (mirrors Laravel Category::findOrFail)
            const [catRows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
            if (catRows.length === 0) {
                return reply.status(404).send({ success: false, message: 'Category not found' });
            }
            const category = catRows[0];

            // Build WHERE clause - mirrors Laravel: where('category_id', $category->id)
            let where = 'WHERE p.category_id = ? AND p.deleted_at IS NULL';
            let params = [id];

            // Search - mirrors Laravel: where('product_name', 'LIKE', "%{$searchQuery}%")
            if (search) {
                where += ' AND p.product_name LIKE ?';
                params.push(search);
            }

            // Count total for pagination
            const [countRows] = await pool.query(
                `SELECT COUNT(*) as total FROM purchases p ${where}`,
                params
            );
            const total = countRows[0].total;
            const lastPage = Math.ceil(total / perPage) || 1;

            // Sorting - mirrors Laravel's if/elseif chain exactly
            let orderBy;
            if (sortColumn === 'total_stock') {
                // Laravel: orderBy('quantity', $sortDirection)
                orderBy = `p.quantity ${sortDirection}`;
            } else if (sortColumn === 'available_stock') {
                // Laravel: orderByRaw('(quantity - sold_quantity) '.$sortDirection)
                orderBy = `(p.quantity - p.sold_quantity) ${sortDirection}`;
            } else if (sortColumn === 'available_stock_rs') {
                // Laravel: orderByRaw('(quantity - sold_quantity) * purchased_price '.$sortDirection)
                orderBy = `(p.quantity - p.sold_quantity) * p.purchased_price ${sortDirection}`;
            } else if (sortColumn === 'total') {
                // Laravel: orderByRaw('(quantity * purchased_price) '.$sortDirection)
                orderBy = `(p.quantity * p.purchased_price) ${sortDirection}`;
            } else {
                // Laravel: orderBy($sortColumn, $sortDirection) — normal DB column
                orderBy = `p.${sortColumn} ${sortDirection}`;
            }

            const [rows] = await pool.query(
                `SELECT p.* FROM purchases p
                ${where}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?`,
                [...params, perPage, offset]
            );

            // Mirrors Laravel $purchases->items() + pagination meta
            const firstItem = total === 0 ? 0 : offset + 1;
            const lastItem  = Math.min(offset + perPage, total);

            return reply.send({
                success: true,
                category,
                data: rows,
                pagination: {
                    current_page:  page,
                    last_page:     lastPage,
                    per_page:      perPage,
                    total,
                    first_item:    firstItem,
                    last_item:     lastItem,
                    has_more_pages: page < lastPage,
                    on_first_page:  page === 1,
                }
            });

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

        // GET /api/categories/options — simple list for "move purchases to" dropdown
        fastify.get('/api/categories/options', async (req, reply) => {
            const excludeId = req.query.exclude_id;
            try {
                let query = 'SELECT id, name FROM categories WHERE deleted_at IS NULL';
                const params = [];
                if (excludeId) {
                    query += ' AND id != ?';
                    params.push(excludeId);
                }
                query += ' ORDER BY name ASC';
                const [rows] = await pool.query(query, params);
                return reply.send({ success: true, categories: rows });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ success: false, message: 'Server error' });
            }
        });

        // DELETE /api/categories/:id — soft delete (default) or permanent delete (?permanent=true)
    // Purchases in this category are always moved to target_category_id first.
    fastify.delete('/api/categories/:id', async (req, reply) => {
        const { id } = req.params;
        const isPermanent = req.query.permanent === 'true';
        const { target_category_id } = req.body || {};

        try {
            const [rows] = await pool.query('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id]);
            if (rows.length === 0) return reply.status(404).send({ success: false, message: 'Not found' });

            const category = rows[0];
            if (category.name === 'Misc' || category.name === 'Services') {
                return reply.status(403).send({ success: false, message: 'The default category cannot be deleted.' });
            }

            const [[{ purchaseCount }]] = await pool.query(
                'SELECT COUNT(*) as purchaseCount FROM purchases WHERE category_id = ? AND deleted_at IS NULL',
                [id]
            );

            let targetCategory = null;
            if (purchaseCount > 0) {
                if (!target_category_id) {
                    return reply.status(422).send({ success: false, message: 'Please select a category to move purchases into.' });
                }
                if (String(target_category_id) === String(id)) {
                    return reply.status(422).send({ success: false, message: 'Target category must be different from the category being deleted.' });
                }

                [[targetCategory]] = await pool.query(
                    'SELECT id, name FROM categories WHERE id = ? AND deleted_at IS NULL',
                    [target_category_id]
                );
                if (!targetCategory) {
                    return reply.status(404).send({ success: false, message: 'Target category not found.' });
                }

                // Move all purchases in this category to the target category
                await pool.query(
                    'UPDATE purchases SET category_id = ? WHERE category_id = ?',
                    [target_category_id, id]
                );
            }

            const moveText = targetCategory ? ` — purchases moved to "${targetCategory.name}"` : '';

            if (isPermanent) {
                await pool.query('DELETE FROM categories WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'permanent_delete',
                    description: `Permanently deleted category "${category.name}"${moveText}`,
                    entity_type: 'category',
                    entity_id: id,
                    old_data: category,
                });

                return reply.send({ success: true, message: 'Category permanently deleted.' + (targetCategory ? ' Purchases moved successfully.' : '') });
            } else {
                await pool.query('UPDATE categories SET deleted_at = NOW() WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'soft_delete',
                    description: `Soft Deleted category "${category.name}"${moveText}`,
                    entity_type: 'category',
                    entity_id: id,
                    old_data: category,
                });

                return reply.send({ success: true, message: 'Category deleted.' + (targetCategory ? ' Purchases moved successfully.' : '') });
            }
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong.' });
        }
    });
}