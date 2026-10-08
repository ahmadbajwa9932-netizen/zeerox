import pool from '../db.js';
import { logActivity } from '../helpers/activityLogger.js';
export default async function customerRoutes(fastify) {
  // Equivalent to Laravel index() — Next.js page fetches data itself, nothing needed here.
  // (Route omitted — frontend hits /api/customers/data directly.)

  // Equivalent to Laravel getData()
  fastify.get('/api/customers/data', async (req, reply) => {
    const {
      page = 1,
      sort_column = 'id',
      sort_direction = 'desc',
      search,
      search_type = 'customer',
      customer_type,
      start_date,
      end_date,
    } = req.query;

    // Allowed columns (mirrors Laravel's $allowed)
    const allowed = ['id', 'name', 'shop_name', 'contact', 'city', 'sales_count', 'last_purchase_date', 'created_at'];
    const sortColumn = allowed.includes(sort_column) ? sort_column : 'id';
    const sortDirection = String(sort_direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Default to current month if no dates provided (mirrors Laravel)
    let startDate = start_date;
    let endDate = end_date;
    if (!startDate && !endDate) {
      const now = new Date();
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endDate = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;      
    }

    const perPage = 10;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * perPage;

    // ── Build WHERE clauses ──────────────────────────────
    const whereClauses = [];
    const whereParams = [];

    if (search) {
      if (search_type === 'customer') {
        whereClauses.push('c.name LIKE ?');
        whereParams.push(`%${search}%`);
      } else if (search_type === 'shop_name') {
        whereClauses.push('c.shop_name LIKE ?');
        whereParams.push(`%${search}%`);
      } else if (search_type === 'contact') {
        whereClauses.push('c.contact LIKE ?');
        whereParams.push(`%${search}%`);
      }
    }

    // customer_type filter -> whereHas('sales', payment_type = ...)
    if (customer_type && customer_type !== 'all') {
      whereClauses.push(`EXISTS (
        SELECT 1 FROM sales s
        WHERE s.customer_id = c.id
          AND s.payment_type = ?
          AND s.deleted_at IS NULL
      )`);
      whereParams.push(customer_type);
    }

    // date filter -> whereHas('sales', created_at between start/end)
    if (startDate || endDate) {
      const dateConds = ['s2f.customer_id = c.id', 's2f.deleted_at IS NULL'];
      const dateParams = [];
      if (startDate) {
        dateConds.push('DATE(s2f.created_at) >= ?');
        dateParams.push(startDate);
      }
      if (endDate) {
        dateConds.push('DATE(s2f.created_at) <= ?');
        dateParams.push(endDate);
      }
      whereClauses.push(`EXISTS (SELECT 1 FROM sales s2f WHERE ${dateConds.join(' AND ')})`);
      whereParams.push(...dateParams);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // ── Total count (for pagination) ─────────────────────
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM customers c ${whereSql}`,
      whereParams
    );
    const total = countRows[0].total;
    const lastPage = Math.max(1, Math.ceil(total / perPage));

    // ── Main paginated query ─────────────────────────────
    let dataSql;
    if (sortColumn === 'last_purchase_date') {
      dataSql = `
        SELECT c.*, MAX(s3.created_at) AS last_purchase_date
        FROM customers c
        LEFT JOIN sales s3 ON s3.customer_id = c.id AND s3.deleted_at IS NULL
        ${whereSql}
        GROUP BY c.id
        ORDER BY last_purchase_date ${sortDirection}
        LIMIT ? OFFSET ?
      `;
    } else {
      dataSql = `
        SELECT c.*
        FROM customers c
        ${whereSql}
        ORDER BY c.${sortColumn} ${sortDirection}
        LIMIT ? OFFSET ?
      `;
    }

    const [customers] = await pool.query(dataSql, [...whereParams, perPage, offset]);

    let salesBreakdown = {};
    if (customers.length) {
      const customerIds = customers.map((c) => c.id);
      const placeholders = customerIds.map(() => '?').join(',');

      // sales_count + attached sales (mirrors withCount + with(sales latest))
      const [salesRows] = await pool.query(
        `SELECT * FROM sales
         WHERE customer_id IN (${placeholders}) AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        customerIds
      );

      const salesByCustomer = {};
      for (const sale of salesRows) {
        if (!salesByCustomer[sale.customer_id]) salesByCustomer[sale.customer_id] = [];
        salesByCustomer[sale.customer_id].push(sale);
      }

      for (const c of customers) {
        c.sales = salesByCustomer[c.id] || [];
        c.sales_count = c.sales.length;
      }

      // salesBreakdown per customer, grouped by payment_type (mirrors the foreach loop)
      const [breakdownRows] = await pool.query(
        `SELECT customer_id, payment_type, COUNT(*) AS count
         FROM sales
         WHERE customer_id IN (${placeholders}) AND deleted_at IS NULL
         GROUP BY customer_id, payment_type`,
        customerIds
      );

      for (const c of customers) salesBreakdown[c.id] = {};
      for (const row of breakdownRows) {
        salesBreakdown[row.customer_id][row.payment_type] = { payment_type: row.payment_type, count: row.count };
      }
    }

    return reply.send({
      success: true,
      data: customers,
      salesBreakdown,
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

    // Account ledger details — every invoice of one customer with full details
  // (items, payments, credit/advance status), 10 invoices per page
  fastify.get('/api/customers/:id/ledger-details', async (req, reply) => {
    try {
      const { id } = req.params;
      const { page = 1, search, payment_type } = req.query;

      const perPage = 10;
      const currentPage = Math.max(1, parseInt(page, 10) || 1);
      const offset = (currentPage - 1) * perPage;

      // 1. Customer header info
      const [customerRows] = await pool.query(
        `SELECT id, name, shop_name, contact, city, customer_type, current_balance, advance_payment
         FROM customers WHERE id = ? AND deleted_at IS NULL`,
        [id]
      );
      if (!customerRows.length) {
        return reply.code(404).send({ success: false, message: 'Customer not found' });
      }
      const customer = customerRows[0];

      // 2. Filters — search is invoice no only
      const whereClauses = ['s.customer_id = ?', 's.deleted_at IS NULL'];
      const whereParams = [id];

      if (search) {
        whereClauses.push('s.voucher_no LIKE ?');
        whereParams.push(`%${search}%`);
      }

      const allowedTypes = ['cash', 'card', 'credit', 'advance'];
      if (payment_type && allowedTypes.includes(payment_type)) {
        whereClauses.push('s.payment_type = ?');
        whereParams.push(payment_type);
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      // 3. Count + summary over the whole filtered set (not just this page)
      const [summaryRows] = await pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(s.grand_total), 0) AS total_amount
         FROM sales s ${whereSql}`,
        whereParams
      );
      const total = Number(summaryRows[0].total);
      const totalAmount = Number(summaryRows[0].total_amount);
      const lastPage = Math.max(1, Math.ceil(total / perPage));

      // 4. This page's invoices
      const [sales] = await pool.query(
        `SELECT s.*
         FROM sales s
         ${whereSql}
         ORDER BY s.sale_date DESC, s.id DESC
         LIMIT ? OFFSET ?`,
        [...whereParams, perPage, offset]
      );

      // 5. Items, payments and advance logs for all invoices on this page (3 queries total)
      if (sales.length) {
        const saleIds = sales.map((s) => s.id);
        const placeholders = saleIds.map(() => '?').join(',');

        const [itemRows] = await pool.query(
          `SELECT
              sale_items.id,
              sale_items.sale_id,
              sale_items.quantity,
              sale_items.price,
              sale_items.discount_type,
              sale_items.discount_value,
              sale_items.discount_amount,
              sale_items.tax_type,
              sale_items.tax_value,
              sale_items.tax_amount,
              sale_items.total_after_tax,
              purchases.product_name,
              purchases.type AS product_type
           FROM sale_items
           JOIN purchases ON sale_items.purchase_id = purchases.id
           WHERE sale_items.sale_id IN (${placeholders}) AND sale_items.deleted_at IS NULL
           ORDER BY sale_items.id ASC`,
          saleIds
        );

        const [paymentRows] = await pool.query(
          `SELECT id, sale_id, amount, method, payment_date
           FROM payments
           WHERE sale_id IN (${placeholders}) AND deleted_at IS NULL
           ORDER BY payment_date ASC`,
          saleIds
        );

        const [advanceRows] = await pool.query(
          `SELECT sale_id, previous_balance, used_amount, remaining_balance
           FROM customer_advance_logs
           WHERE sale_id IN (${placeholders}) AND customer_id = ?`,
          [...saleIds, id]
        );

        const itemsBySale = {};
        for (const item of itemRows) (itemsBySale[item.sale_id] ||= []).push(item);

        const paymentsBySale = {};
        for (const p of paymentRows) (paymentsBySale[p.sale_id] ||= []).push(p);

        const advanceBySale = {};
        for (const a of advanceRows) if (!advanceBySale[a.sale_id]) advanceBySale[a.sale_id] = a;

        for (const sale of sales) {
          sale.items = itemsBySale[sale.id] || [];
          sale.payments = paymentsBySale[sale.id] || [];

          if (sale.payment_type === 'credit') {
            const totalPaid = sale.payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
            const remaining = parseFloat(sale.grand_total) - totalPaid;
            sale.credit = {
              total_paid: totalPaid,
              remaining_balance: remaining,
              is_fully_paid: remaining <= 0,
            };
          }

          if (sale.payment_type === 'advance') {
            const log = advanceBySale[sale.id];
            sale.advance = {
              previous_advance: log ? Number(log.previous_balance) : 0,
              advance_used: log ? Number(log.used_amount) : 0,
              remaining_advance: log ? Number(log.remaining_balance) : 0,
            };
          }
        }
      }

      return reply.send({
        success: true,
        customer,
        summary: {
          total_invoices: total,
          total_amount: totalAmount,
          credit_balance: Number(customer.current_balance) || 0,
          advance_balance: Number(customer.advance_payment) || 0,
        },
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
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ success: false, message: err.message });
    }
  });

  // Soft delete / permanent delete a customer + full history
  fastify.delete('/api/customers/:id/delete', async (req, reply) => {

    const { id } = req.params;
    const permanent = req.query.permanent === 'true';

    const conn = await pool.getConnection();
    try {
      const [[customer]] = await conn.query(
        `SELECT id, name, contact, current_balance, advance_payment FROM customers WHERE id = ?`,
        [id]
      );
      if (!customer) {
        conn.release();
        return reply.status(404).send({ success: false, message: 'Customer not found.' });
      }

      await conn.beginTransaction();

      if (permanent) {
        // FKs are all ON DELETE CASCADE now — one delete wipes the full chain
        await conn.query(`DELETE FROM customers WHERE id = ?`, [id]);
      } else {
        const [saleRows] = await conn.query(
          `SELECT id FROM sales WHERE customer_id = ? AND deleted_at IS NULL`,
          [id]
        );
        const saleIds = saleRows.map((r) => r.id);

        const [returnRows] = await conn.query(
          `SELECT id FROM sale_returns WHERE customer_id = ? AND deleted_at IS NULL`,
          [id]
        );
        const returnIds = returnRows.map((r) => r.id);

        await conn.query(`UPDATE customers SET deleted_at = NOW() WHERE id = ?`, [id]);

        if (saleIds.length) {
          await conn.query(
            `UPDATE sales SET deleted_at = NOW() WHERE id IN (${saleIds.map(() => '?').join(',')})`,
            saleIds
          );
          await conn.query(
            `UPDATE sale_items SET deleted_at = NOW() WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`,
            saleIds
          );
          await conn.query(
            `UPDATE payments SET deleted_at = NOW() WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`,
            saleIds
          );
          await conn.query(
            `UPDATE credit_sale_reminders SET deleted_at = NOW() WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`,
            saleIds
          );
        }

        if (returnIds.length) {
          await conn.query(
            `UPDATE sale_returns SET deleted_at = NOW() WHERE id IN (${returnIds.map(() => '?').join(',')})`,
            returnIds
          );
          await conn.query(
            `UPDATE sale_return_items SET deleted_at = NOW() WHERE sale_return_id IN (${returnIds.map(() => '?').join(',')})`,
            returnIds
          );
        }

        await conn.query(
          `UPDATE customer_advance_logs SET deleted_at = NOW() WHERE customer_id = ?`,
          [id]
        );
        await conn.query(
          `UPDATE advance_deposits SET deleted_at = NOW() WHERE customer_id = ?`,
          [id]
        );
      }

      await conn.commit();

      await logActivity(req, {
        action_type: permanent ? 'permanent_delete' : 'soft_delete',
        description: permanent
          ? `Permanently deleted customer "${customer.name}"${customer.contact ? ` (${customer.contact})` : ''} — full history removed (sales, payments, returns, advance logs)`
          : `Soft Deleted customer "${customer.name}"${customer.contact ? ` (${customer.contact})` : ''} — associated sales, payments and returns also removed`,
        entity_type: 'customer',
        entity_id: id,
        old_data: customer,
      });

      return reply.send({ success: true });
    } catch (err) {
      await conn.rollback();
      req.log.error(err);
      return reply.code(500).send({ success: false, error: 'Delete failed' });
    } finally {
      conn.release();
    }
  });
}