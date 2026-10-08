import pool from '../db.js';

export default async function advanceCustomerRoutes(fastify) {
  // Equivalent to Laravel getAdvanceData()
  fastify.get('/api/customers/advance/data', async (req, reply) => {
    const {
      page = 1,
      sort_column = 'id',
      sort_direction = 'desc',
      search,
      search_type = 'customer',
    } = req.query;

    const allowed = ['id', 'name', 'shop_name', 'contact', 'city', 'advance_sales_count', 'advance_payment', 'last_purchase_date'];
    const sortColumn = allowed.includes(sort_column) ? sort_column : 'id';
    const sortDirection = String(sort_direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderExpr = ['advance_sales_count', 'last_purchase_date'].includes(sortColumn) ? `IFNULL(sub.${sortColumn}, 0)` : `c.${sortColumn}`;

    const perPage = 10;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * perPage;

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

    const whereSql = whereClauses.length ? `AND ${whereClauses.join(' AND ')}` : '';

    const advanceJoin = `
      LEFT JOIN (
        SELECT customer_id, COUNT(*) AS advance_sales_count, MAX(sale_date) AS last_purchase_date
        FROM sales
        WHERE payment_type = 'advance' AND deleted_at IS NULL
        GROUP BY customer_id
      ) sub ON sub.customer_id = c.id
    `;

    const havingSql = `(c.advance_payment > 0 OR sub.advance_sales_count > 0)`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM customers c ${advanceJoin} WHERE ${havingSql} ${whereSql}`,
      whereParams
    );
    const total = countRows[0].total;
    const lastPage = Math.max(1, Math.ceil(total / perPage));

    const [customers] = await pool.query(
      `SELECT c.*, IFNULL(sub.advance_sales_count, 0) AS advance_sales_count, sub.last_purchase_date
       FROM customers c
       ${advanceJoin}
       WHERE ${havingSql} ${whereSql}
       ORDER BY ${orderExpr} ${sortDirection}
       LIMIT ? OFFSET ?`,
      [...whereParams, perPage, offset]
    );

    return reply.send({
      success: true,
      data: customers,
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
}