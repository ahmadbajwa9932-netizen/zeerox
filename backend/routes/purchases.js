import pool from '../db.js';
import path from 'path';
import fs from 'fs';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

export default async function purchaseRoutes(fastify) {

    // GET /api/purchases/form-data — categories + units for the Add form
    fastify.get('/api/purchases/form-data', async (req, reply) => {
        try {
            const [categories] = await pool.query(
                'SELECT id, name FROM categories WHERE status = 1 ORDER BY name ASC'
            );
            const [units] = await pool.query(
                'SELECT name, display_name FROM units WHERE is_active = 1 ORDER BY sort_order ASC'
            );
            return reply.send({ success: true, categories, units });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Server error' });
        }
    });

    // POST /api/purchases — create new purchase
    fastify.post('/api/purchases', async (req, reply) => {
        // Parse multipart form
        // AFTER
const body  = {};
let imageFile = null;

const parts = req.parts();
for await (const part of parts) {
    if (part.file) {
        // Must always consume the file stream, even if we don't use it
        const chunks = [];
        for await (const chunk of part.file) {
            chunks.push(chunk);
        }
        // Only store if it actually has content
        if (chunks.length > 0) {
            imageFile = {
                mimetype: part.mimetype,
                toBuffer: async () => Buffer.concat(chunks),
            };
        } else {
            // Empty file input — discard it
        }
    } else {
        body[part.fieldname] = part.value;
    }
}
    
        const {
            type = 'product',
            product_name,
            barcode,
            qr_code,
            product_code,
            purchased_price,
            sold_price,
            fix_sold_price,
            quantity,
            unit,
            purchase_date,
            expiry_date,
            low_inventory,
            category_id,
            tax_type,
            tax,
            fix_tax,
            discount_type,
            discount,
            fix_discount,
            supplier_name,
            company,
            address,
            contact_info,
        } = body;

        // ── Validation ────────────────────────────────────
        if (!product_name || !product_name.trim()) {
            return reply.status(422).send({ success: false, message: 'Product name is required.' });
        }
        if (!unit) {
            return reply.status(422).send({ success: false, message: 'Unit is required.' });
        }
        if (!purchase_date) {
            return reply.status(422).send({ success: false, message: 'Purchase date is required.' });
        }
        if (barcode && barcode.length > 255) {
            return reply.status(422).send({ success: false, message: 'Barcode is too long (max 100 characters).' });
        }
        if (qr_code && qr_code.length > 500) {
            return reply.status(422).send({ success: false, message: 'QR code is too long (max 500 characters).' });
        }

        // Check duplicate product name (case-insensitive)
        const [existing] = await pool.query(
            'SELECT id FROM purchases WHERE LOWER(product_name) = ? AND deleted_at IS NULL',
            [product_name.trim().toLowerCase()]
        );
        if (existing.length > 0) {
            return reply.status(422).send({
                success: false,
                message: 'Product with this name already exists! Please choose a different name.'
            });
        }

        // Price validation (not for services)
        if (type !== 'service') {
            const pp = parseFloat(purchased_price) || 0;
            const sp = parseFloat(sold_price) || 0;
            if (pp > sp) {
                return reply.status(422).send({
                    success: false,
                    message: 'Purchased price cannot be greater than sold price.'
                });
            }
        }

        try {
            // ── App settings fallback values ────────────────
            const [[appSettings]] = await pool.query('SELECT * FROM app_settings WHERE id = 1');

            const finalLowInventory = low_inventory || appSettings?.default_low_inventory || 2;

            let finalTaxType  = tax_type || 'amount';
            let finalTaxValue = parseFloat(tax) || 0;
            if ((tax === undefined || tax === null || tax === '') && appSettings?.enable_default_tax) {
                finalTaxType  = appSettings.default_tax_type;
                finalTaxValue = parseFloat(appSettings.default_tax_value) || 0;
            }

            let finalDiscountType  = discount_type || 'amount';
            let finalDiscountValue = parseFloat(discount) || 0;
            if ((discount === undefined || discount === null || discount === '') && appSettings?.enable_default_discount) {
                finalDiscountType  = appSettings.default_discount_type;
                finalDiscountValue = parseFloat(appSettings.default_discount_value) || 0;
            }

            // ── Service defaults ───────────────────────────
            let finalPurchasedPrice = parseFloat(purchased_price) || 0;
            let finalQuantity = Math.round(parseFloat(quantity)) || 0;
            let finalUnit           = unit;
            let finalCategoryId     = category_id || null;
            let finalSupplierId     = null;

            if (type === 'service') {
                finalPurchasedPrice = 0;
                finalQuantity       = 99999999;
                finalUnit           = 'srv';
                // Auto-assign Services category
                const [svcCat] = await pool.query(
                    "SELECT id FROM categories WHERE name = 'Services' LIMIT 1"
                );
                if (svcCat.length > 0) finalCategoryId = svcCat[0].id;
                else {
                    const [miscCat] = await pool.query(
                        "SELECT id FROM categories WHERE name = 'Misc' LIMIT 1"
                    );
                    if (miscCat.length > 0) finalCategoryId = miscCat[0].id;
                }
            } else {
                // ── Supplier (only for non-service) ───────
                const supplierFields = [supplier_name, company, address, contact_info].filter(Boolean);
                if (supplierFields.length > 0) {
                    // firstOrCreate supplier
                    const [existingSupplier] = await pool.query(
                        'SELECT id FROM suppliers WHERE name = ? AND deleted_at IS NULL LIMIT 1',
                        [supplier_name || null]
                    );
                    if (existingSupplier.length > 0) {
                        finalSupplierId = existingSupplier[0].id;
                    } else {
                        const [inserted] = await pool.query(
                            'INSERT INTO suppliers (name, company, address, contact_info) VALUES (?, ?, ?, ?)',
                            [supplier_name || null, company || null, address || null, contact_info || null]
                        );
                        finalSupplierId = inserted.insertId;
                    }
                }

                // Default category to Misc if not selected
                if (!finalCategoryId) {
                    const [miscCat] = await pool.query(
                        "SELECT id FROM categories WHERE name = 'Misc' LIMIT 1"
                    );
                    if (miscCat.length > 0) finalCategoryId = miscCat[0].id;
                }
            }
            let imagePath = null;
            if (imageFile) {
                const uploadDir = './public/products';
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                const ext      = imageFile.mimetype.split('/')[1];
                const fileName = `${Date.now()}-${product_name.replace(/\s+/g, '-')}.${ext}`;
                imagePath      = `products/${fileName}`;
                const buffer   = await imageFile.toBuffer();
                fs.writeFileSync(path.join(uploadDir, fileName), buffer);
            }

            await pool.query(
                `INSERT INTO purchases (
                    type, product_name, image, barcode, qr_code, product_code,
                    purchased_price, sold_price, fix_sold_price,
                    quantity, unit, purchase_date, expiry_date, low_inventory,
                    tax_type, tax, fix_tax,
                    discount_type, discount, fix_discount,
                    supplier_id, category_id,
                    created_at, updated_at
                ) VALUES (
                    ?, ?,?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?,
                    ?, ?,
                    NOW(), NOW()
                )`,
                [
                    type,
                    product_name.trim(),
                    imagePath,
                    barcode || null,
                    qr_code || null,
                    product_code || null,
                    finalPurchasedPrice,
                    parseFloat(sold_price) || 0,
                    fix_sold_price === '1' ? 1 : 0,
                    finalQuantity,
                    finalUnit,
                    purchase_date,
                    expiry_date || null,
                    finalLowInventory,
                    finalTaxType,
                    finalTaxValue,
                    fix_tax === '1' ? 1 : 0,
                    finalDiscountType,
                    finalDiscountValue,
                    fix_discount === '1' ? 1 : 0,
                    finalSupplierId,
                    finalCategoryId,
                ]
            );

            return reply.send({ success: true, message: 'Purchase added successfully!' });

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
        }
    });
    // GET /api/purchases — paginated list with search, sort, filter
    fastify.get('/api/purchases', async (req, reply) => {
        try {
            const page          = parseInt(req.query.page) || 1;
            const limit         = 10;
            const offset        = (page - 1) * limit;
            const sortColumn    = req.query.sort_column || 'purchase_date';
            const sortDirection = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';
            const typeFilter    = req.query.type_filter || 'all';
            const searchQuery   = req.query.search || '';
            const searchType    = req.query.search_type || 'product';

            // Allowed sort columns (whitelist to prevent SQL injection)
            const allowedSorts = ['product_name', 'product_code', 'category_id', 'unit', 'purchase_date', 'expiry_date'];
            const safeSort = allowedSorts.includes(sortColumn) ? sortColumn : 'purchase_date';

            // Build WHERE clauses
            const conditions = ['p.deleted_at IS NULL'];
            const params = [];

            // Type filter
            if (typeFilter === 'products') {
                conditions.push("p.type IN ('product', 'medicine')");
            } else if (typeFilter === 'services') {
                conditions.push("p.type = 'service'");
            }

            // Search
            if (searchQuery) {
                if (searchType === 'product') {
                    conditions.push("p.type IN ('product', 'medicine') AND p.product_name LIKE ?");
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'service') {
                    conditions.push("p.type = 'service' AND p.product_name LIKE ?");
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'category') {
                    conditions.push("c.name LIKE ?");
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'unit') {
                    conditions.push("p.unit LIKE ?");
                    params.push(`%${searchQuery}%`);
                } else if (searchType === 'product_code') {
                    conditions.push("p.product_code LIKE ?");
                    params.push(`%${searchQuery}%`);
                }
            }

            const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

            // Sort by remaining (computed) or normal column
            const orderBy = sortColumn === 'remaining'
                ? `ORDER BY (p.quantity - p.sold_quantity) ${sortDirection}`
                : `ORDER BY p.${safeSort} ${sortDirection}`;

            // Count query
            const [[{ total }]] = await pool.query(
                `SELECT COUNT(*) as total
                 FROM purchases p
                 LEFT JOIN categories c ON p.category_id = c.id
                 ${where}`,
                params
            );

            // Data query
            const [rows] = await pool.query(
                `SELECT p.id, p.product_name, p.product_code, p.type,
                        p.quantity, p.unit, p.purchase_date, p.expiry_date,
                        p.sold_quantity, p.category_id,
                        p.purchased_price, p.sold_price,
                        c.name as category_name
                 FROM purchases p
                 LEFT JOIN categories c ON p.category_id = c.id
                 ${where}
                 ${orderBy}
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const lastPage = Math.ceil(total / limit);

            return reply.send({
                success: true,
                data: rows.map(r => ({
                    id: r.id,
                    product_name: r.product_name,
                    product_code: r.product_code,
                    purchased_price: r.purchased_price,
                    sold_price: r.sold_price,
                    type: r.type,
                    quantity: r.quantity,
                    unit: r.unit,
                    purchase_date: r.purchase_date || null,
                    expiry_date: r.expiry_date || null,
                    sold_quantity: r.sold_quantity,
                    remaining: r.quantity - r.sold_quantity,
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

    // GET /api/purchases/low-inventory — paginated low inventory list
fastify.get('/api/purchases/low-inventory', async (req, reply) => {
    try {
        const page          = parseInt(req.query.page) || 1;
        const limit         = 10;
        const offset        = (page - 1) * limit;
        const sortColumn    = req.query.sort_column || 'remaining';
        const sortDirection = req.query.sort_direction === 'desc' ? 'DESC' : 'ASC';

        const allowedSorts = ['product_name', 'category_id', 'supplier_id', 'purchase_date'];

        let orderBy;
        if (sortColumn === 'remaining') {
            orderBy = `ORDER BY (p.quantity - p.sold_quantity) ${sortDirection}`;
        } else if (allowedSorts.includes(sortColumn)) {
            orderBy = `ORDER BY p.${sortColumn} ${sortDirection}`;
        } else {
            orderBy = `ORDER BY (p.quantity - p.sold_quantity) ASC`;
        }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total
             FROM purchases p
             WHERE p.deleted_at IS NULL
               AND (p.quantity - p.sold_quantity) <= p.low_inventory`,
        );

        const [rows] = await pool.query(
            `SELECT p.id, p.product_name, p.type,
                    p.quantity, p.sold_quantity, p.supplier_id, p.category_id,
                    p.purchase_date, p.expiry_date,
                    p.purchased_price, p.sold_price,
                    p.low_inventory,
                    (p.quantity - p.sold_quantity) as remaining,
                    c.name as category_name,
                    s.name as supplier_name
             FROM purchases p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.deleted_at IS NULL
               AND (p.quantity - p.sold_quantity) <= p.low_inventory
             ${orderBy}
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );

        const lastPage = Math.ceil(total / limit) || 1;

        return reply.send({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                product_name: r.product_name,
                type: r.type,
                quantity: r.quantity,
                sold_quantity: r.sold_quantity,
                purchased_price: r.purchased_price,
                sold_price: r.sold_price,
                remaining: r.remaining,
                purchase_date: r.purchase_date || null,
                expiry_date: r.expiry_date || null,
                category: r.category_name ? { name: r.category_name } : null,
                supplier: r.supplier_name ? { name: r.supplier_name } : null,
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

        // DELETE /api/purchases/:id — soft delete (default) or permanent delete (?permanent=true)
        fastify.delete('/api/purchases/:id', async (req, reply) => {
            try {
                const { id } = req.params;
                const isPermanent = req.query.permanent === 'true';

                const [[existingPurchase]] = await pool.query(
                    'SELECT id, product_name, type FROM purchases WHERE id = ?',
                    [id]
                );
    
                if (isPermanent) {
                    // Block permanent delete if this product is referenced anywhere —
                    // these tables CASCADE delete on purchase delete, which would
                    // silently wipe sales/return history.
                    const [[{ saleItemsCount }]] = await pool.query(
                        'SELECT COUNT(*) as saleItemsCount FROM sale_items WHERE purchase_id = ?',
                        [id]
                    );
                    const [[{ saleReturnItemsCount }]] = await pool.query(
                        'SELECT COUNT(*) as saleReturnItemsCount FROM sale_return_items WHERE purchase_id = ?',
                        [id]
                    );
                    const [[{ walkInReturnsCount }]] = await pool.query(
                        'SELECT COUNT(*) as walkInReturnsCount FROM walk_in_returns WHERE purchase_id = ?',
                        [id]
                    );
    
                    if (saleItemsCount > 0 || saleReturnItemsCount > 0 || walkInReturnsCount > 0) {
                        return reply.status(422).send({
                            success: false,
                            message: 'This product is linked to sales or return records and cannot be permanently deleted. Use soft delete instead.'
                        });
                    }
    
                    // Permanent delete — removes the row entirely
                    await pool.query('DELETE FROM purchases WHERE id = ?', [id]);
                } else {
                    // Soft delete
                    await pool.query(
                        'UPDATE purchases SET deleted_at = NOW() WHERE id = ?',
                        [id]
                    );
                }

                await logActivity(req, {
                    action_type: isPermanent ? 'permanent_delete' : 'soft_delete',
                    description: `${isPermanent ? 'Permanently deleted' : 'Soft Deleted'} ${existingPurchase?.type === 'service' ? 'service' : 'product'} "${existingPurchase?.product_name || id}"`,
                    entity_type: 'purchase',
                    entity_id: id,
                    old_data: existingPurchase,
                });

                return reply.send({
                    success: true,
                    message: isPermanent ? 'Purchase permanently deleted!' : 'Purchase Soft deleted successfully!'
                });
            } catch (err) {
                fastify.log.error(err);
                return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
            }
        });

// GET /api/purchases/stock-overview
fastify.get('/api/purchases/stock-overview', async (req, reply) => {
    try {
        const pageAvailable  = parseInt(req.query.page_available)  || 1;
        const pageSearch     = parseInt(req.query.page_search)     || 1;
        const pageOutOfStock = parseInt(req.query.page_out_of_stock) || 1;
        const searchQuantity  = req.query.search_quantity;
        const searchAvailable = req.query.search_available || '';
        const searchOutOfStock = req.query.search_out_of_stock || '';
        const limit = 10;

        // ── 1. Available Stock (remaining > 0) ────────
        const availableConditions = [
            "p.deleted_at IS NULL",
            "(p.quantity - p.sold_quantity) > 0",
            "p.type IN ('product','medicine')"
        ];
        const availableParams = [];
        if (searchAvailable) {
            availableConditions.push('p.product_name LIKE ?');
            availableParams.push(`%${searchAvailable}%`);
        }
        const availableWhere = 'WHERE ' + availableConditions.join(' AND ');

        const [[{ totalAvailable }]] = await pool.query(
            `SELECT COUNT(*) as totalAvailable FROM purchases p ${availableWhere}`,
            availableParams
        );
        const availableOffset = (pageAvailable - 1) * limit;
        const [availableRows] = await pool.query(
            `SELECT id, product_name, quantity, sold_quantity, purchased_price, type,
                    (quantity - sold_quantity) as available_stock
             FROM purchases p
             ${availableWhere}
             ORDER BY p.product_name ASC
             LIMIT ? OFFSET ?`,
            [...availableParams, limit, availableOffset]
        );

        // ── 2. Search by Quantity (only if provided) ──
        let searchResults = null;
        if (searchQuantity !== undefined && searchQuantity !== '') {
            const sqVal = parseFloat(searchQuantity);
            const [[{ totalSearch }]] = await pool.query(
                `SELECT COUNT(*) as totalSearch FROM purchases p
                 WHERE p.deleted_at IS NULL
                   AND (p.quantity - p.sold_quantity) <= ?
                   AND p.type IN ('product','medicine')`,
                [sqVal]
            );
            const searchOffset = (pageSearch - 1) * limit;
            const [searchRows] = await pool.query(
                `SELECT id, product_name, quantity, sold_quantity, purchased_price, type,
                        (quantity - sold_quantity) as available_stock
                 FROM purchases p
                 WHERE p.deleted_at IS NULL
                   AND (p.quantity - p.sold_quantity) <= ?
                   AND p.type IN ('product','medicine')
                 ORDER BY (quantity - sold_quantity) ASC
                 LIMIT ? OFFSET ?`,
                [sqVal, limit, searchOffset]
            );
            searchResults = {
                data: searchRows,
                pagination: {
                    current_page: pageSearch,
                    last_page: Math.ceil(totalSearch / limit) || 1,
                    per_page: limit,
                    total: totalSearch,
                }
            };
        }

        // ── 3. Out of Stock (remaining <= 0) ──────────
        const outConditions = [
            "p.deleted_at IS NULL",
            "(p.quantity - p.sold_quantity) <= 0",
            "p.type IN ('product','medicine')"
        ];
        const outParams = [];
        if (searchOutOfStock) {
            outConditions.push('p.product_name LIKE ?');
            outParams.push(`%${searchOutOfStock}%`);
        }
        const outWhere = 'WHERE ' + outConditions.join(' AND ');

        const [[{ totalOut }]] = await pool.query(
            `SELECT COUNT(*) as totalOut FROM purchases p ${outWhere}`,
            outParams
        );
        const outOffset = (pageOutOfStock - 1) * limit;
        const [outRows] = await pool.query(
            `SELECT id, product_name, quantity, sold_quantity, purchased_price, type,
                    (quantity - sold_quantity) as available_stock
             FROM purchases p
             ${outWhere}
             ORDER BY p.product_name ASC
             LIMIT ? OFFSET ?`,
            [...outParams, limit, outOffset]
        );

        return reply.send({
            success: true,
            available_stock: {
                data: availableRows,
                pagination: {
                    current_page: pageAvailable,
                    last_page: Math.ceil(totalAvailable / limit) || 1,
                    per_page: limit,
                    total: totalAvailable,
                }
            },
            search_results: searchResults,
            out_of_stock: {
                data: outRows,
                pagination: {
                    current_page: pageOutOfStock,
                    last_page: Math.ceil(totalOut / limit) || 1,
                    per_page: limit,
                    total: totalOut,
                }
            }
        });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Server error' });
    }
});

// GET /api/purchases/expired
fastify.get('/api/purchases/expired', async (req, reply) => {
    try {
        const page          = parseInt(req.query.page) || 1;
        const limit         = 10;
        const offset        = (page - 1) * limit;
        const sortColumn    = req.query.sort_column || 'expiry_date';
        const sortDirection = req.query.sort_direction === 'desc' ? 'DESC' : 'ASC';
        const daysFilter    = req.query.days_until_expiry !== undefined ? req.query.days_until_expiry : '10';

        const allowedSorts = ['product_name', 'category_id', 'expiry_date', 'purchase_date', 'remaining', 'days_left'];

        const conditions = [
            'p.deleted_at IS NULL',
            'p.expiry_date IS NOT NULL',
            "p.type IN ('product','medicine')"
        ];
        const params = [];

        if (daysFilter !== null && daysFilter !== '') {
            const days = parseInt(daysFilter);
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() + days);
            const targetDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
            conditions.push('p.expiry_date <= ?');
            params.push(targetDateStr);
        }

        const where = 'WHERE ' + conditions.join(' AND ');

        let orderBy;
        if (sortColumn === 'remaining') {
            orderBy = `ORDER BY (p.quantity - p.sold_quantity) ${sortDirection}`;
        } else if (sortColumn === 'days_left') {
            orderBy = `ORDER BY p.expiry_date ${sortDirection}`;
        } else if (allowedSorts.includes(sortColumn)) {
            orderBy = `ORDER BY p.${sortColumn} ${sortDirection}`;
        } else {
            orderBy = `ORDER BY p.expiry_date ASC`;
        }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM purchases p ${where}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT p.id, p.product_name, p.type, p.quantity, p.sold_quantity,
                    p.purchase_date, p.expiry_date, p.unit,
                    p.category_id, c.name as category_name,
                    (p.quantity - p.sold_quantity) as remaining
             FROM purchases p
             LEFT JOIN categories c ON p.category_id = c.id
             ${where}
             ${orderBy}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const lastPage = Math.ceil(total / limit) || 1;

        return reply.send({
            success: true,
            data: rows.map(r => {
                let daysLeft = null;
                if (r.expiry_date) {
                    const exp = new Date(r.expiry_date);
                    exp.setHours(0, 0, 0, 0);
                    daysLeft = Math.round((exp - today) / (1000 * 60 * 60 * 24));
                }
                return {
                    id:           r.id,
                    product_name: r.product_name,
                    type:         r.type,
                    quantity:     r.quantity,
                    sold_quantity: r.sold_quantity,
                    remaining:    r.remaining,
                    unit:         r.unit,
                    purchase_date: r.purchase_date || null,
                    expiry_date:   r.expiry_date   || null,
                    days_left:    daysLeft,
                    category:     r.category_name ? { name: r.category_name } : null,
                };
            }),
            pagination: {
                current_page:    page,
                last_page:       lastPage,
                per_page:        limit,
                total,
                first_item:      total === 0 ? 0 : offset + 1,
                last_item:       Math.min(offset + limit, total),
                has_more_pages:  page < lastPage,
                on_first_page:   page === 1,
            }
        });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Server error' });
    }
});

// GET /api/purchases/:id — get single purchase for edit
fastify.get('/api/purchases/:id', async (req, reply) => {
    try {
        const { id } = req.params;
        const [[purchase]] = await pool.query(
            `SELECT p.*, c.name as category_name, s.name as supplier_name,
                    s.company, s.address, s.contact_info
             FROM purchases p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.id = ? AND p.deleted_at IS NULL`,
            [id]
        );
        if (!purchase) {
            return reply.status(404).send({ success: false, message: 'Purchase not found.' });
        }

        const [categories] = await pool.query(
            'SELECT id, name FROM categories WHERE status = 1 ORDER BY name ASC'
        );
        const [units] = await pool.query(
            'SELECT name, display_name FROM units WHERE is_active = 1 ORDER BY sort_order ASC'
        );

        return reply.send({
            success: true,
            purchase: {
                ...purchase,
                purchase_date: purchase.purchase_date || null,
                expiry_date:   purchase.expiry_date   || null,
                category: purchase.category_name ? { name: purchase.category_name } : null,
                supplier: purchase.supplier_name ? {
                    name:         purchase.supplier_name,
                    company:      purchase.company,
                    address:      purchase.address,
                    contact_info: purchase.contact_info,
                } : null,
            },
            categories,
            units,
        });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Server error' });
    }
});

// GET /api/purchases/:id/detail-data — view detail page (revenue/profit included)
fastify.get('/api/purchases/:id/detail-data', async (req, reply) => {
    try {
        const { id } = req.params;

        const [[purchase]] = await pool.query(
            `SELECT p.*, c.name AS category_name,
                    s.name AS supplier_name, s.company AS supplier_company,
                    s.address AS supplier_address, s.contact_info AS supplier_contact
             FROM purchases p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN suppliers s ON p.supplier_id = s.id
             WHERE p.id = ? AND p.deleted_at IS NULL`,
            [id]
        );

        if (!purchase) {
            return reply.status(404).send({ success: false, message: 'Purchase not found.' });
        }

        // Revenue + cost for THIS product, all-time, tax excluded.
        // total_after_discount is already tax-excluded in sale_items.
        // We also subtract this item's proportional share of the sale-level
        // order discount (s.discount_amount) — same pattern as dashboard.js
        // category revenue query, so the numbers stay consistent across pages.
        const [[fin]] = await pool.query(
            `SELECT
                COALESCE(SUM(
                    si.total_after_discount -
                    (CASE WHEN sis.items_sum > 0
                          THEN si.total_after_discount / sis.items_sum * s.discount_amount
                          ELSE 0 END)
                ), 0) AS total_revenue,
                COALESCE(SUM(si.purchased_price * si.quantity), 0) AS total_cost
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             INNER JOIN (
                SELECT sale_id, SUM(total_after_discount) AS items_sum
                FROM sale_items
                GROUP BY sale_id
             ) sis ON sis.sale_id = si.sale_id
             WHERE si.purchase_id = ?`,
            [id]
        );

        // Walk-in returns for this product — already precalculated, just sum them.
        const [[walkInReturns]] = await pool.query(
            `SELECT
                COALESCE(SUM(wr.revenue_without_tax), 0) AS returned_revenue,
                COALESCE(SUM(wr.profit_without_tax), 0)  AS returned_profit,
                COALESCE(SUM(wr.quantity_returned), 0)   AS returned_quantity
             FROM walk_in_returns wr
             WHERE wr.purchase_id = ? AND wr.deleted_at IS NULL`,
            [id]
        );

        const returnedCost = Number(walkInReturns.returned_quantity) * Number(purchase.purchased_price);

        const adjustedRevenue = Number(fin.total_revenue) - Number(walkInReturns.returned_revenue);
        const adjustedCost    = Number(fin.total_cost) - returnedCost;
        const adjustedProfit  = (Number(fin.total_revenue) - Number(fin.total_cost)) - Number(walkInReturns.returned_profit);

        const remainingQuantity = Number(purchase.quantity) - Number(purchase.sold_quantity);
        const availableInventoryCost = remainingQuantity * Number(purchase.purchased_price);

        return reply.send({
            success: true,
            data: {
                type: purchase.type,
                product_name: purchase.product_name,
                product_code: purchase.product_code,
                category_name: purchase.category_name || 'N/A',

                // relative path only — frontend builds the full URL with API base
                image: purchase.image || null,
                has_image: !!purchase.image,

                purchased_price: Number(purchase.purchased_price),
                previous_sold_price: purchase.previous_sold_price !== null ? Number(purchase.previous_sold_price) : null,
                sold_price: Number(purchase.sold_price),
                fix_sold_price: !!purchase.fix_sold_price,

                quantity: Number(purchase.quantity),
                unit: purchase.unit,
                total_price: Number(purchase.purchased_price) * Number(purchase.quantity),
                sold_quantity: Number(purchase.sold_quantity),
                remaining_quantity: remainingQuantity,

                purchase_date: purchase.purchase_date,
                expiry_date: purchase.expiry_date,
                created_at: purchase.created_at,

                tax: Number(purchase.tax),
                tax_type: purchase.tax_type,
                fix_tax: !!purchase.fix_tax,
                discount: Number(purchase.discount),
                discount_type: purchase.discount_type,
                fix_discount: !!purchase.fix_discount,

                supplier_name: purchase.supplier_name,
                supplier_company: purchase.supplier_company,
                supplier_address: purchase.supplier_address,
                supplier_contact: purchase.supplier_contact,

                total_revenue: adjustedRevenue,
                total_cost: adjustedCost,
                profit_or_loss: adjustedProfit,
                available_inventory_cost: availableInventoryCost,
            },
        });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Server error' });
    }
});

// PUT /api/purchases/:id — update purchase
fastify.put('/api/purchases/:id', async (req, reply) => {
    try {
        const { id } = req.params;

        const body = {};
        let imageFile = null;
        let removeImage = false;

        const parts = req.parts();
        for await (const part of parts) {
            if (part.file) {
                const chunks = [];
                for await (const chunk of part.file) chunks.push(chunk);
                if (chunks.length > 0) {
                    imageFile = {
                        mimetype: part.mimetype,
                        toBuffer: async () => Buffer.concat(chunks),
                    };
                }
            } else {
                body[part.fieldname] = part.value;
            }
        }

        if (body.remove_image === '1') removeImage = true;

        const [[purchase]] = await pool.query(
            'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        if (!purchase) {
            return reply.status(404).send({ success: false, message: 'Purchase not found.' });
        }

        const {
            product_name, purchased_price, sold_price, fix_sold_price,
            quantity, unit, purchase_date, expiry_date, low_inventory,
            category_id, tax_type, tax, fix_tax,
            discount_type, discount, fix_discount,
            supplier_name, company, address, contact_info,
            barcode, qr_code, product_code,
        } = body;

        // Validation
        if (!product_name || !product_name.trim()) {
            return reply.status(422).send({ success: false, message: 'Product name is required.' });
        }
        if (!unit) {
            return reply.status(422).send({ success: false, message: 'Unit is required.' });
        }
        if (!purchase_date) {
            return reply.status(422).send({ success: false, message: 'Purchase date is required.' });
        }
        if (barcode && barcode.length > 255) {
            return reply.status(422).send({ success: false, message: 'Barcode is too long (max 100 characters).' });
        }
        if (qr_code && qr_code.length > 500) {
            return reply.status(422).send({ success: false, message: 'QR code is too long (max 500 characters).' });
        }

        // Duplicate name check (exclude self)
        const [existing] = await pool.query(
            'SELECT id FROM purchases WHERE LOWER(product_name) = ? AND deleted_at IS NULL AND id != ?',
            [product_name.trim().toLowerCase(), id]
        );
        if (existing.length > 0) {
            return reply.status(422).send({ success: false, message: 'Product with this name already exists!' });
        }

        // Price validation
        if (purchase.type !== 'service') {
            const pp = parseFloat(purchased_price) || 0;
            const sp = parseFloat(sold_price) || 0;
            if (pp > sp) {
                return reply.status(422).send({ success: false, message: 'Purchased price cannot be greater than sold price.' });
            }
        }

        // ── App settings fallback values ────────────────
        const [[appSettings]] = await pool.query('SELECT * FROM app_settings WHERE id = 1');

        const finalLowInventory = low_inventory || appSettings?.default_low_inventory || 2;

        let finalTaxType  = tax_type || 'amount';
        let finalTaxValue = parseFloat(tax) || 0;
        if ((tax === undefined || tax === null || tax === '') && appSettings?.enable_default_tax) {
            finalTaxType  = appSettings.default_tax_type;
            finalTaxValue = parseFloat(appSettings.default_tax_value) || 0;
        }

        let finalDiscountType  = discount_type || 'amount';
        let finalDiscountValue = parseFloat(discount) || 0;
        if ((discount === undefined || discount === null || discount === '') && appSettings?.enable_default_discount) {
            finalDiscountType  = appSettings.default_discount_type;
            finalDiscountValue = parseFloat(appSettings.default_discount_value) || 0;
        }

        // Supplier
        let finalSupplierId = purchase.supplier_id;
        const oldSupplierId = purchase.supplier_id;

        if (purchase.type !== 'service') {
            const supplierFields = [supplier_name, company, address, contact_info].filter(Boolean);
            if (supplierFields.length > 0) {
                // Replace the supplier block in PUT with:
const [existingSupplier] = await pool.query(
    'SELECT id FROM suppliers WHERE name = ? AND company = ? AND address = ? AND contact_info = ? AND deleted_at IS NULL LIMIT 1',
    [supplier_name || null, company || null, address || null, contact_info || null]
);
if (existingSupplier.length > 0) {
    finalSupplierId = existingSupplier[0].id;
} else {
    const [inserted] = await pool.query(
        'INSERT INTO suppliers (name, company, address, contact_info) VALUES (?, ?, ?, ?)',
        [supplier_name || null, company || null, address || null, contact_info || null]
    );
    finalSupplierId = inserted.insertId;
}
            } else {
                finalSupplierId = null;
            }
        }

        // Image handling
        let imagePath = purchase.image;
        const uploadDir = './public/products';

        if (removeImage && imagePath) {
            if (fs.existsSync(path.join(uploadDir, path.basename(imagePath)))) {
                fs.unlinkSync(path.join(uploadDir, path.basename(imagePath)));
            }
            imagePath = null;
        }

        if (imageFile) {
            if (imagePath && fs.existsSync(path.join(uploadDir, path.basename(imagePath)))) {
                fs.unlinkSync(path.join(uploadDir, path.basename(imagePath)));
            }
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            const ext      = imageFile.mimetype.split('/')[1];
            const fileName = `${Date.now()}-${product_name.replace(/\s+/g, '-')}.${ext}`;
            imagePath      = `products/${fileName}`;
            const buffer   = await imageFile.toBuffer();
            fs.writeFileSync(path.join(uploadDir, fileName), buffer);
        }

        // Service overrides
        let finalPurchasedPrice = parseFloat(purchased_price) || 0;
        let finalQuantity       = Math.round(parseFloat(quantity)) || 0;
        let finalUnit           = unit;
        let finalCategoryId     = category_id || null;

        if (purchase.type === 'service') {
            finalPurchasedPrice = 0;
            finalQuantity       = 99999999;
            finalUnit           = 'srv';
            finalSupplierId     = null;
            const [svcCat] = await pool.query("SELECT id FROM categories WHERE name = 'Services' LIMIT 1");
            if (svcCat.length > 0) finalCategoryId = svcCat[0].id;
        }

        await pool.query(
            `UPDATE purchases SET
                product_name = ?, purchased_price = ?, sold_price = ?, fix_sold_price = ?,
                quantity = ?, unit = ?, purchase_date = ?, expiry_date = ?, low_inventory = ?,
                category_id = ?, tax_type = ?, tax = ?, fix_tax = ?,
                discount_type = ?, discount = ?, fix_discount = ?,
                supplier_id = ?, image = ?,
                barcode = ?, qr_code = ?, product_code = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [
                product_name.trim(),
                finalPurchasedPrice,
                parseFloat(sold_price) || 0,
                fix_sold_price === '1' ? 1 : 0,
                finalQuantity,
                finalUnit,
                purchase_date,
                expiry_date || null,
                finalLowInventory,
                finalCategoryId,
                finalTaxType,
                finalTaxValue,
                fix_tax === '1' ? 1 : 0,
                finalDiscountType,
                finalDiscountValue,
                fix_discount === '1' ? 1 : 0,
                finalSupplierId,
                imagePath,
                barcode || null,
                qr_code || null,
                product_code || null,
                id,
            ]
        );

        // Cleanup old supplier if changed
        if (oldSupplierId && oldSupplierId !== finalSupplierId) {
            const [[{ count }]] = await pool.query(
                'SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ? AND deleted_at IS NULL',
                [oldSupplierId]
            );
            if (count === 0) {
                await pool.query('UPDATE suppliers SET deleted_at = NOW() WHERE id = ?', [oldSupplierId]);
            }
        }

        {
            const newDataForLog = {
                product_name: product_name.trim(),
                purchased_price: finalPurchasedPrice,
                sold_price: parseFloat(sold_price) || 0,
                quantity: finalQuantity,
                unit: finalUnit,
            };
            const changeLabels = {
                product_name: 'Name',
                purchased_price: 'Purchased Price',
                sold_price: 'Sold Price',
                quantity: 'Quantity',
                unit: 'Unit',
            };
            const changes = describeChanges(purchase, newDataForLog, changeLabels);
            const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

            await logActivity(req, {
                action_type: 'edit',
                description: `Updated ${purchase.type === 'service' ? 'service' : 'product'} "${product_name.trim()}" — ${changeText}`,
                entity_type: 'purchase',
                entity_id: id,
                old_data: purchase,
                new_data: { ...newDataForLog, category_id: finalCategoryId, supplier_id: finalSupplierId },
            });
        }

        return reply.send({ success: true, message: 'Product updated successfully!' });
    } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
    }
});

    // POST /api/purchases/:id/restock — restock a product or medicine
    fastify.post('/api/purchases/:id/restock', async (req, reply) => {
        try {
            const { id } = req.params;
            const body = req.body;
            const [[purchase]] = await pool.query(
                'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL',
                [id]
            );
            if (!purchase) {
                return reply.status(404).send({ success: false, message: 'Purchase not found.' });
            }

            // Check if expired
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = purchase.expiry_date
            ? (() => { const [y, m, dd] = String(purchase.expiry_date).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd); })()
            : null;        
            const isExpired = expiry && expiry <= today;

            let newQuantity = purchase.quantity;
            let newPurchasedPrice = purchase.purchased_price;
            let newSoldPrice = purchase.sold_price;

            if (purchase.type === 'medicine') {
                const netTablets = Math.round(parseFloat(body.medicine_quantity)) || 0;
                if (isExpired) {
                    newQuantity = netTablets;
                } else {
                    newQuantity = Math.round(parseFloat(purchase.quantity)) + netTablets;
                }
                if (body.restock_medicine_purchased_price && parseFloat(body.restock_medicine_purchased_price) > 0) {
                    newPurchasedPrice = parseFloat(body.restock_medicine_purchased_price);
                }
                if (body.restock_medicine_sold_price && parseFloat(body.restock_medicine_sold_price) > 0) {
                    newSoldPrice = parseFloat(body.restock_medicine_sold_price);
                }
            } else {
                const addQty = Math.round(parseFloat(body.quantity)) || 0;
                if (isExpired) {
                    newQuantity = addQty;
                } else {
                    newQuantity = Math.round(parseFloat(purchase.quantity)) + addQty;

                }
                if (body.restock_purchased_price && parseFloat(body.restock_purchased_price) > 0) {
                    newPurchasedPrice = parseFloat(body.restock_purchased_price);
                }
                if (body.restock_sold_price && parseFloat(body.restock_sold_price) > 0) {
                    newSoldPrice = parseFloat(body.restock_sold_price);
                }
            }

            const newExpiryDate = body.new_expiry_date || purchase.expiry_date || null;
            const newPurchaseDate = body.purchase_date || purchase.purchase_date;
            await pool.query(
                `UPDATE purchases SET
                    quantity = ?, purchased_price = ?, sold_price = ?,
                    purchase_date = ?, expiry_date = ?, updated_at = NOW()
                 WHERE id = ?`,
                [newQuantity, newPurchasedPrice, newSoldPrice, newPurchaseDate, newExpiryDate, id]
            );

            {
                const restockOldData = {
                    quantity: purchase.quantity,
                    purchased_price: purchase.purchased_price,
                    sold_price: purchase.sold_price,
                    expiry_date: purchase.expiry_date,
                    purchase_date: purchase.purchase_date,
                };
                const restockNewData = {
                    quantity: newQuantity,
                    purchased_price: newPurchasedPrice,
                    sold_price: newSoldPrice,
                    expiry_date: newExpiryDate,
                    purchase_date: newPurchaseDate,
                };
                const restockLabels = {
                    quantity: 'Stock',
                    purchased_price: 'Purchased Price',
                    sold_price: 'Sold Price',
                    expiry_date: 'Expiry Date',
                    purchase_date: 'Purchase Date',
                };
                const changes = describeChanges(restockOldData, restockNewData, restockLabels);
                const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

                await logActivity(req, {
                    action_type: 'restock',
                    description: `Restocked ${purchase.type === 'service' ? 'service' : 'product'} "${purchase.product_name}"${isExpired ? ' (expired stock replaced)' : ''} — ${changeText}`,
                    entity_type: 'purchase',
                    entity_id: id,
                    old_data: restockOldData,
                    new_data: restockNewData,
                });
            }

            return reply.send({
                success: true,
                message: isExpired
                    ? 'Expired stock replaced with new stock successfully!'
                    : 'Stock updated successfully!'
            });
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: 'Something went wrong. Please try again!' });
        }
    });
}