import pool from '../../db.js';
import {
  resolveDateRange,
  resolvePreviousPeriod,
  formatDayLabel,
  formatMonthLabel,
  addDays,
  fmtDate,
  safeDiv,
  computeChange,
} from './dateHelpers.js';

/* ============================================================
   SHARED SQL FRAGMENTS
   Same corrected accounting logic as dashboard.js:
   - Revenue comes from sale_items.total_after_discount (NOT the
     unreliable sales.subtotal/discount_amount header), with the
     sale-level discount proportionally allocated back per item.
   - Tax follows the same allocation pattern.
   - Cost is purchased_price * quantity, item-specific (no allocation
     needed).
   - Nothing here touches sale_returns — returns already mutate
     sale_items/sales directly, so these sums are automatically
     post-return.
   ============================================================ */

   const DISCOUNT_ALLOC_JOIN = `
   INNER JOIN (
     SELECT sale_id, SUM(total_after_discount) AS items_sum
     FROM sale_items
     GROUP BY sale_id
   ) sis ON sis.sale_id = si.sale_id
 `;

const REVENUE_EXPR = `(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END))`;
const TAX_EXPR = `(si.tax_amount + (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.tax_amount ELSE 0 END))`;
const COST_EXPR = `(si.purchased_price * si.quantity)`;

/* ============================================================
   SHARED HELPERS
   ============================================================ */

function parseUserId(query) {
  const raw = query.user_id;
  if (!raw || raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

function parseMainFilters(query) {
  const rangeKey = query.date_range || 'today';
  const range = resolveDateRange(rangeKey, query.start_date, query.end_date);
  return { range, userId: parseUserId(query) };
}

function parsePage(value) {
  const n = parseInt(value, 10);
  return !n || n < 1 ? 1 : n;
}

function parsePageSize(value, fallback = 15, max = 100) {
  const n = parseInt(value, 10);
  if (!n || n < 1) return fallback;
  return Math.min(n, max);
}

function fillDailyGaps(rows, startObj, endObj, valueKey) {
  const map = new Map(rows.map((r) => [String(r.d).slice(0, 10), Number(r.total)]));
  const result = [];
  let cursor = new Date(startObj);
  while (cursor <= endObj) {
    const key = fmtDate(cursor);
    result.push({ date: formatDayLabel(cursor), [valueKey]: map.get(key) || 0 });
    cursor = addDays(cursor, 1);
  }
  return result;
}

function fillMonthlyGaps(rows, startObj, endObj, valueKey) {
  const map = new Map(rows.map((r) => [String(r.ym), Number(r.total)]));
  const result = [];
  let cursor = new Date(startObj.getFullYear(), startObj.getMonth(), 1);
  const last = new Date(endObj.getFullYear(), endObj.getMonth(), 1);
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    result.push({ month: formatMonthLabel(cursor), [valueKey]: map.get(key) || 0 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return result;
}

/**
 * One aggregate query for the Overview tab's core numbers over a given
 * range. Used twice per request (current period + previous period),
 * run in parallel by the caller.
 */
async function fetchOverviewAggregate(range, userId) {
  const sellerClause = userId ? 'AND s.seller_id = ?' : '';
  const sellerParam = userId ? [userId] : [];

  const sql = `
    SELECT
      COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
      COALESCE(SUM(${COST_EXPR}), 0) AS cost,
      COALESCE(SUM(CASE WHEN p.type != 'service' THEN si.quantity ELSE 0 END), 0) AS items_sold,
      COUNT(DISTINCT si.sale_id) AS transactions
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN purchases p ON p.id = si.purchase_id
    ${DISCOUNT_ALLOC_JOIN}
     WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ?
      ${sellerClause}
  `;

  const [rows] = await pool.query(sql, [range.startDateTime, range.endDateTime, ...sellerParam]);
  const row = rows[0];

  const rawRevenue = Number(row.revenue);
  const cost = Number(row.cost);
  const transactions = Number(row.transactions);
  const rawProfit = rawRevenue - cost;

  const walkIn = await fetchWalkInReturnOverviewAggregate(range, userId);

  const revenue = rawRevenue - walkIn.revenue_returned;
  const profit = rawProfit - walkIn.profit_returned;
  const items_sold = Number(row.items_sold) - walkIn.items_returned;

  return {
    revenue,
    transactions,
    items_sold,
    avg_order_value: safeDiv(revenue, transactions),
    profit,
  };
}

async function fetchWalkInReturnOverviewAggregate(range, userId) {
  const sellerClause = userId ? 'AND wirs.user_id = ?' : '';
  const sellerParam = userId ? [userId] : [];

  const sessionSql = `
    SELECT
      COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS revenue_returned,
      COALESCE(SUM(wirs.total_profit_without_tax), 0) AS profit_returned
    FROM walk_in_return_sessions wirs
    WHERE wirs.created_at BETWEEN ? AND ? ${sellerClause}
  `;
  const itemsSql = `
    SELECT COALESCE(SUM(wr.quantity_returned), 0) AS items_returned
    FROM walk_in_returns wr
    INNER JOIN walk_in_return_sessions wirs ON wirs.id = wr.session_id
    WHERE wirs.created_at BETWEEN ? AND ? ${sellerClause}
  `;

  const [[sessionRows], [itemRows]] = await Promise.all([
    pool.query(sessionSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
    pool.query(itemsSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
  ]);

  return {
    revenue_returned: Number(sessionRows[0].revenue_returned),
    profit_returned: Number(sessionRows[0].profit_returned),
    items_returned: Number(itemRows[0].items_returned),
  };
}

/* ============================================================
   ROUTES
   ============================================================ */

export default async function salesReportRoutes(fastify) {
  /* ------------------------------------------------------------
     GET /api/reports/sales/date-range
     Overview tab: current period vs. previous period of equal length.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/date-range', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const previousRange = resolvePreviousPeriod(range);

      const [current, previous] = await Promise.all([
        fetchOverviewAggregate(range, userId),
        fetchOverviewAggregate(previousRange, userId),
      ]);

      const changes = {
        revenue: computeChange(current.revenue, previous.revenue),
        transactions: computeChange(current.transactions, previous.transactions),
        items_sold: computeChange(current.items_sold, previous.items_sold),
        avg_order_value: computeChange(current.avg_order_value, previous.avg_order_value),
        profit: computeChange(current.profit, previous.profit),
      };

      return reply.send({
        success: true,
        data: {
          current,
          previous,
          changes,
          period: {
            current: { start: range.startDate, end: range.endDate },
            previous: { start: previousRange.startDate, end: previousRange.endDate },
          },
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load sales overview' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/sales/products
     Product-wise breakdown, sortable + paginated.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/products', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const SORT_COLUMNS = { revenue: 'revenue', quantity: 'quantity_sold', profit: 'profit' };
      const sortColumn = SORT_COLUMNS[req.query.sort_by] || 'revenue';
      const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.page_size, 10);
      const offset = (page - 1) * pageSize;

      const baseFrom = `
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        INNER JOIN purchases p ON p.id = si.purchase_id
        ${DISCOUNT_ALLOC_JOIN}
       WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
      `;
      const params = [range.startDateTime, range.endDateTime, ...sellerParam];

      const dataSql = `
        SELECT
          p.id, p.product_name, p.unit, p.type,
          COALESCE(SUM(si.quantity), 0) AS quantity_sold,
          COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
          COALESCE(SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS cost,
          COALESCE(SUM(${REVENUE_EXPR}) - SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS profit
        ${baseFrom}
        GROUP BY p.id, p.product_name, p.unit, p.type
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT ? OFFSET ?
      `;

      const countSql = `
        SELECT COUNT(*) AS cnt FROM (
          SELECT p.id ${baseFrom} GROUP BY p.id
        ) t
      `;

      const [[dataRows], [countRows]] = await Promise.all([
        pool.query(dataSql, [...params, pageSize, offset]),
        pool.query(countSql, params),
      ]);

      const walkInSql = `
      SELECT
        wr.purchase_id,
        COALESCE(SUM(wr.quantity_returned), 0) AS qty_returned,
        COALESCE(SUM(wr.revenue_without_tax), 0) AS revenue_returned,
        COALESCE(SUM(wr.profit_without_tax), 0) AS profit_returned,
        COALESCE(SUM(p2.purchased_price * wr.quantity_returned), 0) AS cost_returned
      FROM walk_in_returns wr
      INNER JOIN walk_in_return_sessions wirs ON wirs.id = wr.session_id
      INNER JOIN purchases p2 ON p2.id = wr.purchase_id
      WHERE wirs.created_at BETWEEN ? AND ? ${userId ? 'AND wirs.user_id = ?' : ''}
      GROUP BY wr.purchase_id
    `;
    const [walkInRows] = await pool.query(
      walkInSql,
      [range.startDateTime, range.endDateTime, ...(userId ? [userId] : [])]
    );
    const walkInByProduct = new Map(walkInRows.map((r) => [r.purchase_id, r]));

    const data = dataRows.map((r) => {
      const wIn = walkInByProduct.get(r.id);
      const revenue = Number(r.revenue) - (wIn ? Number(wIn.revenue_returned) : 0);
      const cost = Number(r.cost) - (wIn ? Number(wIn.cost_returned) : 0);
      const quantity = Number(r.quantity_sold) - (wIn ? Number(wIn.qty_returned) : 0);
      const profit = Number(r.profit) - (wIn ? Number(wIn.profit_returned) : 0);
      return {
        product_name: r.product_name,
        unit: r.unit,
        type: r.type,
        quantity_sold: quantity,
        revenue,
        cost,
        profit,
        profit_margin: safeDiv(profit, revenue) * 100,
        avg_selling_price: safeDiv(revenue, quantity),
      };
    });

      const total = Number(countRows[0].cnt);
      const lastPage = Math.max(1, Math.ceil(total / pageSize));

      return reply.send({
        success: true,
        data,
        pagination: { current_page: page, last_page: lastPage, total },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load product report' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/sales/categories
     Category-wise breakdown, paginated.

     NOTE: unlike the frontend placeholder, a category is not tagged
     with a single `type` here — a category can legitimately contain
     both products and services. `cost` and `items_sold` naturally
     come out as 0 for a pure-service category, so the frontend's
     `cat.type === 'service' ? '-' : ...` check needs to become a
     `cost === 0` check (or similar) once we wire this up.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/categories', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.page_size, 10);
      const offset = (page - 1) * pageSize;

      const baseFrom = `
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        INNER JOIN purchases p ON p.id = si.purchase_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${DISCOUNT_ALLOC_JOIN}
       WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
      `;
      const params = [range.startDateTime, range.endDateTime, ...sellerParam];

      const dataSql = `
      SELECT
        COALESCE(c.id, 0) AS category_id,
        COALESCE(c.name, 'Uncategorized') AS category,
        COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
        COALESCE(SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS cost,
        COALESCE(SUM(${REVENUE_EXPR}) - SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS profit,
        COUNT(DISTINCT si.sale_id) AS transactions,
        COALESCE(SUM(CASE WHEN p.type != 'service' THEN si.quantity ELSE 0 END), 0) AS items_sold
      ${baseFrom}
      GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Uncategorized')
      ORDER BY revenue DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(*) AS cnt FROM (
        SELECT COALESCE(c.id, 0) ${baseFrom} GROUP BY COALESCE(c.id, 0)
      ) t
    `;

    const [[dataRows], [countRows]] = await Promise.all([
      pool.query(dataSql, [...params, pageSize, offset]),
      pool.query(countSql, params),
    ]);

    const walkInSql = `
      SELECT
        COALESCE(c2.id, 0) AS category_id,
        COALESCE(SUM(wr.revenue_without_tax), 0) AS revenue_returned,
        COALESCE(SUM(wr.profit_without_tax), 0) AS profit_returned,
        COALESCE(SUM(p2.purchased_price * wr.quantity_returned), 0) AS cost_returned,
        COALESCE(SUM(wr.quantity_returned), 0) AS qty_returned
      FROM walk_in_returns wr
      INNER JOIN walk_in_return_sessions wirs ON wirs.id = wr.session_id
      INNER JOIN purchases p2 ON p2.id = wr.purchase_id
      LEFT JOIN categories c2 ON c2.id = p2.category_id
      WHERE wirs.created_at BETWEEN ? AND ? ${userId ? 'AND wirs.user_id = ?' : ''}
      GROUP BY COALESCE(c2.id, 0)
    `;
    const [walkInRows] = await pool.query(
      walkInSql,
      [range.startDateTime, range.endDateTime, ...(userId ? [userId] : [])]
    );
    const walkInByCategory = new Map(walkInRows.map((r) => [r.category_id, r]));

    const data = dataRows.map((r) => {
      const wIn = walkInByCategory.get(r.category_id);
      const revenue = Number(r.revenue) - (wIn ? Number(wIn.revenue_returned) : 0);
      const cost = Number(r.cost) - (wIn ? Number(wIn.cost_returned) : 0);
      const profit = Number(r.profit) - (wIn ? Number(wIn.profit_returned) : 0);
      return {
        category: r.category,
        revenue,
        cost,
        profit,
        profit_margin: safeDiv(profit, revenue) * 100,
        transactions: Number(r.transactions),
        items_sold: Number(r.items_sold) - (wIn ? Number(wIn.qty_returned) : 0),
      };
    });

      const total = Number(countRows[0].cnt);
      const lastPage = Math.max(1, Math.ceil(total / pageSize));

      return reply.send({
        success: true,
        data,
        pagination: { current_page: page, last_page: lastPage, total },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load category report' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/sales/transactions
     Paginated invoice list with items embedded (2 queries total,
     never N+1 — items for the whole page are fetched in one batch).

     NOTE on return_status: a FULL return DELETEs the sales row
     entirely (per your saleReturnProcess.js), so a fully-returned
     invoice can never appear in this list — only 'None' or
     'Partial Return' are possible here. If you want fully-returned
     invoices to still show up historically, that needs a different
     query against sale_returns (where sale_id IS NULL, voucher_no
     preserved) — flag if you want that as a separate view.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/transactions', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const paymentType = (req.query.payment_type || '').trim();
      const paymentClause = paymentType ? 'AND s.payment_type = ?' : '';
      const paymentParam = paymentType ? [paymentType] : [];

      const customerId = parseInt(req.query.customer_id, 10);
      const customerClause = customerId ? 'AND s.customer_id = ?' : '';
      const customerParam = customerId ? [customerId] : [];

      const invoiceSearch = (req.query.invoice_no || '').trim();
      const invoiceClause = invoiceSearch ? 'AND s.voucher_no LIKE ?' : '';
      const invoiceParam = invoiceSearch ? [`%${invoiceSearch}%`] : [];

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.page_size, 15);
      const offset = (page - 1) * pageSize;

      const whereClause = `
        WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ?
        ${sellerClause} ${paymentClause} ${customerClause} ${invoiceClause}
      `;
      const whereParams = [
        range.startDateTime, range.endDateTime,
        ...sellerParam, ...paymentParam, ...customerParam, ...invoiceParam,
      ];

      const headerSql = `
        SELECT
          s.id, s.voucher_no, COALESCE(s.sale_date, s.created_at) AS date, s.payment_type,
          s.subtotal,
          s.discount_type, s.discount AS discount_value, s.discount_amount AS discount,
          s.tax_type, s.tax AS tax_value, s.tax_amount AS tax,
         s.grand_total, s.received_amount AS paid_amount, s.remaining_balance,
          s.status,
          COALESCE(c.name, 'Walk-in Customer') AS customer
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        ${whereClause}
        ORDER BY COALESCE(s.sale_date, s.created_at) DESC
        LIMIT ? OFFSET ?
      `;

      const countSql = `SELECT COUNT(*) AS cnt FROM sales s ${whereClause}`;

      const [[headerRows], [countRows]] = await Promise.all([
        pool.query(headerSql, [...whereParams, pageSize, offset]),
        pool.query(countSql, whereParams),
      ]);

      let items = [];
      if (headerRows.length > 0) {
        const saleIds = headerRows.map((r) => r.id);
        const placeholders = saleIds.map(() => '?').join(',');
        const itemsSql = `
          SELECT
            si.id, si.sale_id, si.quantity, si.price,
            si.discount_type, si.discount_value, si.discount_amount,
            si.tax_type, si.tax_value, si.tax_amount,
            si.total_after_discount, si.total_after_tax, si.purchased_price,
            p.product_name, p.type,
            COALESCE((
              SELECT SUM(sri.quantity_returned)
              FROM sale_return_items sri
              WHERE sri.sale_item_id = si.id
            ), 0) AS returned_quantity
          FROM sale_items si
          INNER JOIN purchases p ON p.id = si.purchase_id
          WHERE si.sale_id IN (${placeholders})
        `;
        const [itemRows] = await pool.query(itemsSql, saleIds);
        items = itemRows;
      }

      const itemsBySale = new Map();
      for (const it of items) {
        if (!itemsBySale.has(it.sale_id)) itemsBySale.set(it.sale_id, []);
        itemsBySale.get(it.sale_id).push(it);
      }

      const data = headerRows.map((row) => {
        const saleItems = itemsBySale.get(row.id) || [];
        const itemsSum = saleItems.reduce((sum, it) => sum + Number(it.total_after_discount), 0);
        const discountAmt = Number(row.discount);
        const taxAmt = Number(row.tax);

        let saleProfit = 0;
        const mappedItems = saleItems.map((it) => {
          const itemRevenueRaw = Number(it.total_after_discount);
          const allocatedDiscount = itemsSum > 0 ? (itemRevenueRaw / itemsSum) * discountAmt : 0;
          const itemRevenue = itemRevenueRaw - allocatedDiscount;
          const itemCost = it.type !== 'service' ? Number(it.purchased_price) * Number(it.quantity) : 0;
          const itemProfit = itemRevenue - itemCost;
          saleProfit += itemProfit;

          return {
            product: it.product_name,
            type: it.type,
            net_quantity: Number(it.quantity),
            returned_quantity: Number(it.returned_quantity),
            price: Number(it.price),
            discount_type: it.discount_type,
            discount_value: Number(it.discount_value),
            discount: Number(it.discount_amount),
            tax_type: it.tax_type,
            tax_value: Number(it.tax_value),
            tax: Number(it.tax_amount),
            total: Number(it.total_after_tax),
            profit: itemProfit,
          };
        });

        return {
          id: row.id,
          voucher_no: row.voucher_no,
          date: row.date,
          customer: row.customer,
          payment_type: row.payment_type,
          subtotal: Number(row.subtotal),
          discount_type: row.discount_type,
          discount_value: Number(row.discount_value),
          discount: discountAmt,
          tax_type: row.tax_type,
          tax_value: Number(row.tax_value),
          tax: taxAmt,
          grand_total: Number(row.grand_total),
          net_amount: Number(row.grand_total),
          paid_amount: Number(row.paid_amount),
          remaining_balance: Number(row.remaining_balance),
          return_status: row.status,
          profit: saleProfit,
          items: mappedItems,
        };
      });

      const total = Number(countRows[0].cnt);
      const lastPage = Math.max(1, Math.ceil(total / pageSize));

      return reply.send({
        success: true,
        data,
        pagination: { current_page: page, last_page: lastPage, total },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load transactions' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/sales/tax
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/tax', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const groupBy = req.query.group_by === 'monthly' ? 'monthly' : 'daily';

      const summarySql = `
        SELECT
          COALESCE(SUM(${REVENUE_EXPR}), 0) AS total_taxable_amount,
          COALESCE(SUM(${TAX_EXPR}), 0) AS total_tax_collected
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        ${DISCOUNT_ALLOC_JOIN}
        WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
      `;

      const chartSql = groupBy === 'monthly'
        ? `
          SELECT DATE_FORMAT(COALESCE(s.sale_date, s.created_at), '%Y-%m') AS ym, COALESCE(SUM(${TAX_EXPR}), 0) AS total
          FROM sale_items si
          INNER JOIN sales s ON s.id = si.sale_id
          ${DISCOUNT_ALLOC_JOIN}
         WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
          GROUP BY DATE_FORMAT(COALESCE(s.sale_date, s.created_at), '%Y-%m')
        `
        : `
          SELECT DATE(COALESCE(s.sale_date, s.created_at)) AS d, COALESCE(SUM(${TAX_EXPR}), 0) AS total
          FROM sale_items si
          INNER JOIN sales s ON s.id = si.sale_id
          ${DISCOUNT_ALLOC_JOIN}
           WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
          GROUP BY DATE(COALESCE(s.sale_date, s.created_at))
        `;

           const [[summaryRows], [chartRows]] = await Promise.all([
        pool.query(summarySql, [range.startDateTime, range.endDateTime, ...sellerParam]),
        pool.query(chartSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
      ]);

      const walkInSellerClause = userId ? 'AND wirs.user_id = ?' : '';
      const walkInSummarySql = `
        SELECT
          COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS taxable_returned,
          COALESCE(SUM(wirs.total_tax_amount), 0) AS tax_returned
        FROM walk_in_return_sessions wirs
        WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
      `;
      const walkInChartSql = groupBy === 'monthly'
        ? `
          SELECT DATE_FORMAT(wirs.created_at, '%Y-%m') AS ym, COALESCE(SUM(wirs.total_tax_amount), 0) AS total
          FROM walk_in_return_sessions wirs
          WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
          GROUP BY DATE_FORMAT(wirs.created_at, '%Y-%m')
        `
        : `
          SELECT DATE(wirs.created_at) AS d, COALESCE(SUM(wirs.total_tax_amount), 0) AS total
          FROM walk_in_return_sessions wirs
          WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
          GROUP BY DATE(wirs.created_at)
        `;
      const walkInParams = [range.startDateTime, range.endDateTime, ...sellerParam];
      const [[walkInSummaryRows], [walkInChartRows]] = await Promise.all([
        pool.query(walkInSummarySql, walkInParams),
        pool.query(walkInChartSql, walkInParams),
      ]);

      const taxable = Number(summaryRows[0].total_taxable_amount) - Number(walkInSummaryRows[0].taxable_returned);
      const collected = Number(summaryRows[0].total_tax_collected) - Number(walkInSummaryRows[0].tax_returned);

      const baseData = groupBy === 'monthly'
        ? fillMonthlyGaps(chartRows, range.startObj, range.endObj, 'tax_collected')
        : fillDailyGaps(chartRows, range.startObj, range.endObj, 'tax_collected');
      const walkInChartData = groupBy === 'monthly'
        ? fillMonthlyGaps(walkInChartRows, range.startObj, range.endObj, 'tax_collected')
        : fillDailyGaps(walkInChartRows, range.startObj, range.endObj, 'tax_collected');
      const data = baseData.map((d, i) => ({
        ...d,
        tax_collected: d.tax_collected - walkInChartData[i].tax_collected,
      }));

      return reply.send({
        success: true,
        data: {
          summary: {
            total_taxable_amount: taxable,
            total_tax_collected: collected,
            avg_tax_rate: safeDiv(collected, taxable) * 100,
          },
          data,
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load tax report' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/sales/time-analysis
     analysis_type: hourly | daily (day-of-week) | weekly
     ------------------------------------------------------------ */
  fastify.get('/api/reports/sales/time-analysis', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];
      const walkInSellerClause = userId ? 'AND wirs.user_id = ?' : '';

      const analysisType = ['hourly', 'daily', 'weekly'].includes(req.query.analysis_type)
        ? req.query.analysis_type
        : 'daily';

        const baseFrom = `
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        ${DISCOUNT_ALLOC_JOIN}
       WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
      `;
      const params = [range.startDateTime, range.endDateTime, ...sellerParam];

      let rows;
      let labelKey;

      if (analysisType === 'hourly') {
        const sql = `
          SELECT HOUR(COALESCE(s.sale_date, s.created_at)) AS bucket,
            COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
            COUNT(DISTINCT si.sale_id) AS transactions
          ${baseFrom}
          GROUP BY HOUR(COALESCE(s.sale_date, s.created_at))
          ORDER BY bucket ASC
        `;
        const [r] = await pool.query(sql, params);
        const map = new Map(r.map((row) => [Number(row.bucket), row]));

        const walkInSql = `
          SELECT HOUR(wirs.created_at) AS bucket,
            COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS revenue
          FROM walk_in_return_sessions wirs
          WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
          GROUP BY HOUR(wirs.created_at)
        `;
        const [wr] = await pool.query(walkInSql, [range.startDateTime, range.endDateTime, ...sellerParam]);
        const walkInMap = new Map(wr.map((row) => [Number(row.bucket), Number(row.revenue)]));

        rows = Array.from({ length: 24 }).map((_, hour) => {
          const row = map.get(hour);
          const label = `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
          return {
            time_label: label,
            revenue: (row ? Number(row.revenue) : 0) - (walkInMap.get(hour) || 0),
            transactions: row ? Number(row.transactions) : 0,
          };
        });
        labelKey = 'time_label';
      } else if (analysisType === 'weekly') {
        const sql = `
          SELECT FLOOR(DATEDIFF(COALESCE(s.sale_date, s.created_at), ?) / 7) AS bucket,
            COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
            COUNT(DISTINCT si.sale_id) AS transactions
          ${baseFrom}
          GROUP BY FLOOR(DATEDIFF(COALESCE(s.sale_date, s.created_at), ?) / 7)
          ORDER BY bucket ASC
        `;
        const [r] = await pool.query(sql, [range.startDate, ...params, range.startDate]);

        const walkInSql = `
          SELECT FLOOR(DATEDIFF(wirs.created_at, ?) / 7) AS bucket,
            COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS revenue
          FROM walk_in_return_sessions wirs
          WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
          GROUP BY FLOOR(DATEDIFF(wirs.created_at, ?) / 7)
        `;
        const [wr] = await pool.query(walkInSql, [
          range.startDate, range.startDateTime, range.endDateTime, ...sellerParam, range.startDate,
        ]);
        const walkInMap = new Map(wr.map((row) => [Number(row.bucket), Number(row.revenue)]));

        rows = r.map((row) => {
          const weekStartDate = addDays(range.startObj, Number(row.bucket) * 7);
          return {
            week_label: `Week ${Number(row.bucket) + 1}`,
            week_month: weekStartDate.toLocaleString('en-US', { month: 'short' }),
            revenue: Number(row.revenue) - (walkInMap.get(Number(row.bucket)) || 0),
            transactions: Number(row.transactions),
          };
        });
        labelKey = 'week_label';
      } else {
        const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const sql = `
          SELECT DAYNAME(COALESCE(s.sale_date, s.created_at)) AS day_name,
            COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
            COUNT(DISTINCT si.sale_id) AS transactions
          ${baseFrom}
          GROUP BY DAYNAME(COALESCE(s.sale_date, s.created_at))
        `;
        const [r] = await pool.query(sql, params);
        const map = new Map(r.map((row) => [row.day_name, row]));

        const walkInSql = `
          SELECT DAYNAME(wirs.created_at) AS day_name,
            COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS revenue
          FROM walk_in_return_sessions wirs
          WHERE wirs.created_at BETWEEN ? AND ? ${walkInSellerClause}
          GROUP BY DAYNAME(wirs.created_at)
        `;
        const [wr] = await pool.query(walkInSql, [range.startDateTime, range.endDateTime, ...sellerParam]);
        const walkInMap = new Map(wr.map((row) => [row.day_name, Number(row.revenue)]));

        rows = WEEKDAYS.map((day) => {
          const row = map.get(day);
          return {
            day_name: day,
            revenue: (row ? Number(row.revenue) : 0) - (walkInMap.get(day) || 0),
            transactions: row ? Number(row.transactions) : 0,
          };
        });
        labelKey = 'day_name';
      }

      const peakRevenue = rows.reduce((best, r) => (r.revenue > (best?.revenue ?? -1) ? r : best), null);
      const peakTransactions = rows.reduce((best, r) => (r.transactions > (best?.transactions ?? -1) ? r : best), null);

      return reply.send({
        success: true,
        data: {
          data: rows,
          peak_revenue_time: peakRevenue,
          peak_transactions_time: peakTransactions,
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning, labelKey },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load time analysis' });
    }
  });
}