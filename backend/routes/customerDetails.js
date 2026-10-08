import pool from '../db.js';

export default async function customerDetailsRoutes(fastify) {
  // Basic customer info for the page header
  fastify.get('/api/customers/:id/info', async (req, reply) => {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id, name, shop_name, contact, city, current_balance, advance_payment
       FROM customers WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (!rows.length) {
      return reply.code(404).send({ success: false, message: 'Customer not found' });
    }
    return reply.send({ success: true, data: rows[0] });
  });

  // Paginated sales list for one customer
  fastify.get('/api/customers/:id/sales', async (req, reply) => {
    const { id } = req.params;
    const { page = 1, search, payment_type } = req.query;

    const perPage = 10;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * perPage;

    const whereClauses = ['s.customer_id = ?', 's.deleted_at IS NULL'];
    const whereParams = [id];

    if (search) {
      whereClauses.push('s.voucher_no LIKE ?');
      whereParams.push(`%${search}%`);
    }

    if (payment_type && payment_type !== 'all') {
      whereClauses.push('s.payment_type = ?');
      whereParams.push(payment_type);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM sales s ${whereSql}`,
      whereParams
    );
    const total = countRows[0].total;
    const lastPage = Math.max(1, Math.ceil(total / perPage));

    const [sales] = await pool.query(
      `SELECT s.id, s.voucher_no, s.sale_date, s.payment_type, s.grand_total, s.status,
              s.seller_name
       FROM sales s
       ${whereSql}
       ORDER BY s.sale_date DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      [...whereParams, perPage, offset]
    );

    return reply.send({
      success: true,
      data: sales,
      pagination: {
        current_page: currentPage,
        last_page: lastPage,
        per_page: perPage,
        total,
        first_item: total ? offset + 1 : null,
        last_item: total ? Math.min(offset + perPage, total) : null,
        has_more_pages: currentPage < lastPage,
        on_first_page: currentPage === 1,
      },
    });
  });

// Unified sale detail — works for cash/card/credit/advance sales
fastify.get('/api/customers/:id/sales/:saleId/data', async (req, reply) => {
  try {
    const { id, saleId } = req.params;

    // 1. Sale + customer — scoped to this customer so one customer can't view another's sale by guessing id
    const [saleRows] = await pool.query(
      `SELECT
          sales.*,
          customers.name AS customer_name,
          customers.shop_name AS customer_shop_name,
          customers.contact AS customer_contact,
          customers.city AS customer_city,
          customers.customer_type AS customer_type
       FROM sales
       LEFT JOIN customers ON sales.customer_id = customers.id
       WHERE sales.id = ? AND sales.customer_id = ? AND sales.deleted_at IS NULL
       LIMIT 1`,
      [saleId, id]
    );

    if (saleRows.length === 0) {
      return reply.code(404).send({ success: false, message: 'Sale not found' });
    }

    const sale = saleRows[0];

    // 2. Sale items
    const [saleItems] = await pool.query(
      `SELECT
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
          purchases.product_name,
          purchases.type AS product_type
       FROM sale_items
       JOIN purchases ON sale_items.purchase_id = purchases.id
       WHERE sale_items.sale_id = ? AND sale_items.deleted_at IS NULL
       ORDER BY sale_items.id ASC`,
      [sale.id]
    );

    // 3. Payments
    const [payments] = await pool.query(
      `SELECT id, amount, method, payment_date, transaction_group_id
       FROM payments
       WHERE sale_id = ? AND deleted_at IS NULL
       ORDER BY payment_date ASC`,
      [sale.id]
    );

    // 4. Advance-specific data
    let previousAdvance = 0;
    let advanceUsed = 0;
    let remainingAdvance = 0;

    if (sale.payment_type === 'advance') {
      const advanceWhere = sale.customer_id === null
        ? 'sale_id = ? AND customer_id IS NULL'
        : 'sale_id = ? AND customer_id = ?';
      const advanceParams = sale.customer_id === null
        ? [sale.id]
        : [sale.id, sale.customer_id];

      const [advRows] = await pool.query(
        `SELECT previous_balance, used_amount, remaining_balance
         FROM customer_advance_logs
         WHERE ${advanceWhere}
         LIMIT 1`,
        advanceParams
      );

      if (advRows.length > 0) {
        previousAdvance = Number(advRows[0].previous_balance);
        advanceUsed = Number(advRows[0].used_amount);
        remainingAdvance = Number(advRows[0].remaining_balance);
      }
    }

    // 5. Credit-specific data
    let totalPaid = 0;
    let remainingBalance = 0;
    let isFullyPaid = false;

    if (sale.payment_type === 'credit') {
      totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
      remainingBalance = parseFloat(sale.grand_total) - totalPaid;
      isFullyPaid = remainingBalance <= 0;
    }

    return reply.send({
      success: true,
      data: {
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
        sale_items: saleItems,
        payments,
        is_advance_sale: sale.payment_type === 'advance',
        previous_advance: previousAdvance,
        advance_used: advanceUsed,
        remaining_advance: remainingAdvance,
        is_credit_sale: sale.payment_type === 'credit',
        total_paid: totalPaid,
        remaining_balance: remainingBalance,
        is_fully_paid: isFullyPaid,
      },
    });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ success: false, message: err.message });
  }
});

}