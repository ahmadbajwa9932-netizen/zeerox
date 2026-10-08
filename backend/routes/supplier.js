import pool from '../db.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

export default async function supplierRoutes(fastify) {

    // GET /api/suppliers
    fastify.get('/api/suppliers', async (req, reply) => {
        try {
            const page          = parseInt(req.query.page) || 1;
            const limit         = 10;
            const offset        = (page - 1) * limit;
            const sortColumn    = req.query.sort_column || 'name';
            const sortDirection = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';
            const searchQuery   = req.query.search || '';

            const allowedSorts = ['name', 'company', 'address', 'contact_info'];
            const safeSort = allowedSorts.includes(sortColumn) ? sortColumn : 'name';

            const conditions = ['s.deleted_at IS NULL'];
            const params = [];

            if (searchQuery) {
                conditions.push('(s.name LIKE ? OR s.company LIKE ?)');
                params.push(`%${searchQuery}%`, `%${searchQuery}%`);
            }

            const where = 'WHERE ' + conditions.join(' AND ');

            const [[{ total }]] = await pool.query(
                `SELECT COUNT(*) as total FROM suppliers s ${where}`,
                params
            );

            const [rows] = await pool.query(
                `SELECT s.id, s.name, s.company, s.address, s.contact_info,
                        COUNT(p.id) as purchases_count,
                        SUM(p.purchased_price * p.quantity) as total_purchase_amount
                 FROM suppliers s
                 LEFT JOIN purchases p 
                    ON s.id = p.supplier_id 
                    AND p.type IN ('product','medicine') 
                    AND p.deleted_at IS NULL
                 ${where}
                 GROUP BY s.id, s.name, s.company, s.address, s.contact_info
                 ORDER BY s.${safeSort} ${sortDirection}
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const lastPage = Math.ceil(total / limit) || 1;

            return reply.send({
                success: true,
                data: rows,
                pagination: {
                    current_page: page,
                    last_page: lastPage,
                    per_page: limit,
                    total,
                    first_item: total === 0 ? 0 : offset + 1,
                    last_item: Math.min(offset + limit, total),
                    has_more_pages: page < lastPage,
                    on_first_page: page === 1,
                }
            });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    // GET /api/suppliers/:id
    fastify.get('/api/suppliers/:id', async (req, reply) => {
        try {
            const { id } = req.params;
            const [[supplier]] = await pool.query(
                'SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!supplier) {
                return reply.status(404).send({ success: false, message: 'Supplier not found.' });
            }
            return reply.send({ success: true, supplier });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    // PUT /api/suppliers/:id
    fastify.put('/api/suppliers/:id', async (req, reply) => {
        try {
            const { id } = req.params;
            const { supplier_name, company, address, contact_info } = req.body;

            if (!supplier_name || !supplier_name.trim()) {
                return reply.status(422).send({ success: false, message: 'Supplier name is required.' });
            }

            const [[supplier]] = await pool.query(
                'SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!supplier) {
                return reply.status(404).send({ success: false, message: 'Supplier not found.' });
            }

            // Check for exact duplicate (all 4 fields match, different id) → merge
            const [exactMatch] = await pool.query(
                `SELECT id FROM suppliers 
                 WHERE id != ? AND deleted_at IS NULL
                   AND name = ? AND company <=> ? AND address <=> ? AND contact_info <=> ?
                 LIMIT 1`,
                [id, supplier_name.trim(), company || null, address || null, contact_info || null]
            );

            if (exactMatch.length > 0) {
                // Merge: transfer purchases to existing supplier, delete this one
                await pool.query(
                    'UPDATE purchases SET supplier_id = ? WHERE supplier_id = ? AND deleted_at IS NULL',
                    [exactMatch[0].id, id]
                );
                await pool.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'edit',
                    description: `Merged supplier "${supplier.name}" into an existing matching supplier record`,
                    entity_type: 'supplier',
                    entity_id: id,
                    old_data: supplier,
                });

                return reply.send({ success: true, message: 'Supplier merged with existing record successfully!' });
            }

            // Normal update
            await pool.query(
                `UPDATE suppliers SET name = ?, company = ?, address = ?, contact_info = ?, updated_at = NOW()
                 WHERE id = ?`,
                [supplier_name.trim(), company || null, address || null, contact_info || null, id]
            );

            {
                const newDataForLog = {
                    name: supplier_name.trim(),
                    company: company || null,
                    address: address || null,
                    contact_info: contact_info || null,
                };
                const changeLabels = {
                    name: 'Name',
                    company: 'Company',
                    address: 'Address',
                    contact_info: 'Contact Info',
                };
                const changes = describeChanges(supplier, newDataForLog, changeLabels);
                const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

                await logActivity(req, {
                    action_type: 'edit',
                    description: `Updated supplier "${supplier.name}" — ${changeText}`,
                    entity_type: 'supplier',
                    entity_id: id,
                    old_data: supplier,
                    new_data: newDataForLog,
                });
            }

            return reply.send({ success: true, message: 'Supplier updated successfully!' });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
        }
    });

       // DELETE /api/suppliers/:id — soft delete (default) or permanent delete (?permanent=true)
       fastify.delete('/api/suppliers/:id', async (req, reply) => {
        try {
            const { id } = req.params;
            const { delete_option } = req.body || {};
            const isPermanent = req.query.permanent === 'true';

            const [[supplier]] = await pool.query(
                'SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!supplier) {
                return reply.status(404).send({ success: false, message: 'Supplier not found.' });
            }

            if (!isPermanent) {
                // ── Soft delete (unchanged behavior) ──────────
                if (delete_option === 'with_purchases') {
                    await pool.query(
                        'UPDATE purchases SET deleted_at = NOW() WHERE supplier_id = ? AND deleted_at IS NULL',
                        [id]
                    );
                    await pool.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = ?', [id]);

                    await logActivity(req, {
                        action_type: 'soft delete',
                        description: `Soft Deleted supplier "${supplier.name}" along with all related purchases`,
                        entity_type: 'supplier',
                        entity_id: id,
                        old_data: supplier,
                    });

                    return reply.send({ success: true, message: 'Supplier and all related purchases deleted successfully!' });
                } else {
                    await pool.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = ?', [id]);

                    await logActivity(req, {
                        action_type: 'soft delete',
                        description: `Soft Deleted supplier "${supplier.name}" (purchases kept)`,
                        entity_type: 'supplier',
                        entity_id: id,
                        old_data: supplier,
                    });

                    return reply.send({ success: true, message: 'Supplier deleted successfully (purchases kept).' });
                }
            }

                        // ── Permanent delete ───────────────────────────────
                        if (delete_option === 'with_purchases') {
                            const { confirm_partial } = req.body || {};
            
                            // Find which of this supplier's purchases are referenced in
                            // sale_items, sale_return_items, or walk_in_returns — deleting
                            // those would cascade-wipe sales/return history, so they must be kept.
                            const [linkedRows] = await pool.query(
                                `SELECT p.id
                                 FROM purchases p
                                 WHERE p.supplier_id = ?
                                   AND (
                                        EXISTS (SELECT 1 FROM sale_items si WHERE si.purchase_id = p.id)
                                     OR EXISTS (SELECT 1 FROM sale_return_items sri WHERE sri.purchase_id = p.id)
                                     OR EXISTS (SELECT 1 FROM walk_in_returns wir WHERE wir.purchase_id = p.id)
                                   )`,
                                [id]
                            );
                            const linkedIds = linkedRows.map(r => r.id);
            
                            const [[{ totalCount }]] = await pool.query(
                                'SELECT COUNT(*) as totalCount FROM purchases WHERE supplier_id = ?',
                                [id]
                            );
            
                            if (linkedIds.length > 0 && !confirm_partial) {
                                // Don't delete yet — warn the user and ask for confirmation
                                const deletableCount = totalCount - linkedIds.length;
                                return reply.status(422).send({
                                    success: false,
                                    needs_confirmation: true,
                                    linked_count: linkedIds.length,
                                    deletable_count: deletableCount,
                                    message: `${linkedIds.length} of ${totalCount} purchase(s) from this supplier are linked to sales or return records and will be kept (unlinked from the supplier). Only ${deletableCount} unlinked purchase(s) will be permanently deleted. Continue?`
                                });
                            }
            
                            // Proceed: delete unlinked purchases permanently, unlink the linked ones, then delete supplier
                            if (linkedIds.length > 0) {
                                await pool.query(
                                    `DELETE FROM purchases WHERE supplier_id = ? AND id NOT IN (?)`,
                                    [id, linkedIds]
                                );
                                await pool.query(
                                    `UPDATE purchases SET supplier_id = NULL WHERE id IN (?)`,
                                    [linkedIds]
                                );
                            } else {
                                await pool.query('DELETE FROM purchases WHERE supplier_id = ?', [id]);
                            }
            
                            await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);

                            await logActivity(req, {
                                action_type: 'permanent_delete',
                                description: linkedIds.length > 0
                                    ? `Permanently deleted supplier "${supplier.name}" — ${totalCount - linkedIds.length} purchase(s) deleted, ${linkedIds.length} purchase(s) with sales history kept and unlinked`
                                    : `Permanently deleted supplier "${supplier.name}" and all related purchases`,
                                entity_type: 'supplier',
                                entity_id: id,
                                old_data: supplier,
                            });
            
                            return reply.send({
                                success: true,
                                message: linkedIds.length > 0
                                    ? `Supplier permanently deleted. ${totalCount - linkedIds.length} purchase(s) deleted; ${linkedIds.length} purchase(s) with sales history were kept and unlinked.`
                                    : 'Supplier and all related purchases permanently deleted!'
                            });
                        } else {
                // "Only Supplier" — unlink purchases first so the FK CASCADE
                // doesn't take the purchases down with the supplier
                await pool.query('UPDATE purchases SET supplier_id = NULL WHERE supplier_id = ?', [id]);
                await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);

                await logActivity(req, {
                    action_type: 'permanent_delete',
                    description: `Permanently deleted supplier "${supplier.name}" (purchases kept, unlinked)`,
                    entity_type: 'supplier',
                    entity_id: id,
                    old_data: supplier,
                });

                return reply.send({ success: true, message: 'Supplier permanently deleted (purchases kept).' });
            }
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
        }
    });

// GET /api/suppliers/:id/purchases
fastify.get('/api/suppliers/:id/purchases', async (req, reply) => {
    try {
        const { id } = req.params;
        const page          = parseInt(req.query.page) || 1;
        const limit         = 10;
        const offset        = (page - 1) * limit;
        const sortColumn    = req.query.sort_column || 'purchase_date';
        const sortDirection = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';
        const searchQuery   = req.query.search || '';

        const allowedSorts = ['product_name', 'category_id', 'purchased_price', 'quantity', 'unit', 'purchase_date'];
        const safeSort = allowedSorts.includes(sortColumn) ? sortColumn : 'purchase_date';

        const [[supplier]] = await pool.query(
            'SELECT id, name, company, address, contact_info FROM suppliers WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        if (!supplier) {
            return reply.status(404).send({ success: false, message: 'Supplier not found.' });
        }

        const conditions = ['p.supplier_id = ?', "p.type IN ('product','medicine')", 'p.deleted_at IS NULL'];
        const params = [id];

        if (searchQuery) {
            conditions.push('p.product_name LIKE ?');
            params.push(`%${searchQuery}%`);
        }

        const where = 'WHERE ' + conditions.join(' AND ');

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM purchases p ${where}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT p.id, p.product_name, p.purchased_price, p.quantity, p.unit,
                    p.purchase_date, c.name as category_name
             FROM purchases p
             LEFT JOIN categories c ON p.category_id = c.id
             ${where}
             ORDER BY p.${safeSort} ${sortDirection}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const lastPage = Math.ceil(total / limit) || 1;

        return reply.send({
            success: true,
            supplier,
            data: rows.map(r => ({
                id: r.id,
                product_name: r.product_name,
                purchased_price: r.purchased_price,
                quantity: r.quantity,
                unit: r.unit,
                purchase_date: r.purchase_date || null,
                total: r.purchased_price * r.quantity,
                category: r.category_name ? { name: r.category_name } : null,
            })),
            pagination: {
                current_page: page,
                last_page: lastPage,
                per_page: limit,
                total,
                first_item: total === 0 ? 0 : offset + 1,
                last_item: Math.min(offset + limit, total),
                has_more_pages: page < lastPage,
                on_first_page: page === 1,
            }
        });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Server error' });
    }
});

}