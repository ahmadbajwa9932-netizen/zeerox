import db from '../db.js';

export default async function salesFilterRoutes(fastify) {

  // ── Load all products for POS (called once on page load or category change)
  fastify.get('/api/salesfilter/pos-data', async (req, reply) => {
    const raw = req.query['category_ids[]'];
    const ids = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

    let sql = `
      SELECT
        p.id, p.type,
        p.product_name   AS name,
        p.sold_price     AS price,
        p.purchased_price,
        p.unit,
        p.barcode,
        p.qr_code,
        p.product_code,
        p.expiry_date,
        p.category_id,
        p.fix_sold_price,
        p.discount_type,  p.discount,  p.fix_discount,
        p.tax_type,       p.tax,       p.fix_tax,
        (p.quantity - p.sold_quantity) AS available_stock
      FROM purchases p
      WHERE p.deleted_at IS NULL
    `;

    const params = [];
    if (ids.length > 0) {
      sql += ` AND p.category_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }

    const [rows] = await db.query(sql, params);
    return reply.send({ success: true, purchases: rows });
  });

  fastify.get('/api/salesfilter/search-categories', async (req, reply) => {
    try {
      const q = `%${req.query.q || ''}%`;
      const [rows] = await db.query(
        `SELECT id, name
         FROM categories
         WHERE name LIKE ?
           AND deleted_at IS NULL
         LIMIT 10`,
        [q]
      );
      return reply.send({ categories: rows });
    } catch (err) {
      console.error('search-categories error:', err);
      return reply.code(500).send({ categories: [], error: err.message });
    }
  });

  // ── Next voucher number
  fastify.get('/api/salesfilter/next-voucher-no', async (req, reply) => {
    const d = new Date();
    const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;    

    // Use invoice_counters table (same as your schema)
    const [existing] = await db.query(
      `SELECT last_number FROM invoice_counters WHERE date = ?`,
      [today]
    );

    let nextNum;
    if (existing.length > 0) {
      nextNum = existing[0].last_number + 1;
    } else {
      nextNum = 1;
    }

    const seq = nextNum.toString().padStart(3, '0');
    return reply.send({ voucher_no: `INV-${today}-${seq}` });
  });

  // ── Customer search (by name / city / contact / shop_name)
  fastify.get('/api/salesfilter/search-customers', async (req, reply) => {
    const q = `%${req.query.q || ''}%`;
    const field = req.query.field || 'name';
    const allowed = ['name', 'city', 'contact', 'shop_name'];
    const col = allowed.includes(field) ? field : 'name';

    const [rows] = await db.query(
      `SELECT id, name, city, contact, shop_name
       FROM customers
       WHERE \`${col}\` LIKE ?
         AND deleted_at IS NULL
       LIMIT 20`,
      [q]
    );
    return reply.send({ customers: rows });
  });

  // ── Customer balance (credit + advance)
  fastify.get('/api/customer-balance/:id', async (req, reply) => {
    const [rows] = await db.query(
      `SELECT current_balance, advance_payment
       FROM customers
       WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return reply.send({ success: false });
    return reply.send({
      success: true,
      current_balance:  parseFloat(rows[0].current_balance)  || 0,
      advance_payment:  parseFloat(rows[0].advance_payment)  || 0,
      raw_current_balance: parseFloat(rows[0].current_balance) || 0,
      raw_advance_payment: parseFloat(rows[0].advance_payment) || 0,
    });
  });

  // ── Check stock for a product
  fastify.get('/api/check-stock/:id', async (req, reply) => {
    const qty = parseInt(req.query.quantity) || 0;
    const [rows] = await db.query(
      `SELECT (quantity - sold_quantity) AS available FROM purchases WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return reply.send({ status: 'not_found', available: 0 });
    const available = parseFloat(rows[0].available) || 0;
    return reply.send({
      status: qty <= available ? 'ok' : 'insufficient',
      available,
    });
  });
}