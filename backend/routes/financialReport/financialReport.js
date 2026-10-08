import pool from '../../db.js';
import {
  resolveDateRange,
  addDays,
  safeDiv,
  prorateExpensesByCategory,
} from './dateHelpers.js';
import {
  DISCOUNT_ALLOC_JOIN,
  REVENUE_EXPR,
  TAX_EXPR,
  GROSS_EXPR,
  COST_EXPR,
} from './revenueSql.js';

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

function parsePageSize(value, fallback = 10, max = 100) {
  const n = parseInt(value, 10);
  if (!n || n < 1) return fallback;
  return Math.min(n, max);
}

function parseLimit(value, fallback = 10, max = 50) {
  const n = parseInt(value, 10);
  if (!n || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Computes the full financial summary for a given range. Extracted so
 * the route can call this twice (current period + previous period, in
 * parallel) for period-over-period comparison, same pattern as
 * salesReport.js's fetchOverviewAggregate.
 */
async function computeFinancialSummary(range, userId) {
  const sellerClause = userId ? 'AND s.seller_id = ?' : '';
  const sellerParam = userId ? [userId] : [];

  const coreSql = `
    SELECT
      COALESCE(SUM(${GROSS_EXPR}), 0) AS gross_sales,
      COALESCE(SUM(${REVENUE_EXPR}), 0) AS net_before_returns,
      COALESCE(SUM(${TAX_EXPR}), 0) AS tax_collected,
      COALESCE(SUM(${COST_EXPR}), 0) AS total_cogs,
      COALESCE(SUM(CASE WHEN p.type != 'service' THEN si.quantity ELSE 0 END), 0) AS items_sold,
      COUNT(DISTINCT si.sale_id) AS sales_count
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN purchases p ON p.id = si.purchase_id
    ${DISCOUNT_ALLOC_JOIN}
   WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
  `;

  const returnsSql = `
    SELECT
      COALESCE(SUM(total_return_amount), 0) AS total_returns,
      COALESCE(SUM(total_tax), 0)           AS total_returns_tax
   FROM sale_returns
    WHERE status = 'completed'
      AND created_at BETWEEN ? AND ?
  `;

  const paymentSql = `
    SELECT s.payment_type,
      COALESCE(SUM(${REVENUE_EXPR}), 0) AS amount,
      COUNT(DISTINCT si.sale_id) AS cnt
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    ${DISCOUNT_ALLOC_JOIN}
    WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
    GROUP BY s.payment_type
  `;

  const paymentCreditSql = `
    SELECT
      COALESCE(SUM(received_amount), 0) AS paid,
      COALESCE(SUM(remaining_balance), 0) AS outstanding
    FROM sales s
    WHERE s.payment_type = 'credit'
      AND COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
  `;

  const expensesSql = `
    SELECT category, amount, date, days, start_date, end_date
   FROM expenses
    WHERE COALESCE(start_date, date) <= ?
      AND COALESCE(end_date, DATE_ADD(date, INTERVAL (days - 1) DAY)) >= ?
  `;

  const [
    [coreRows],
    [returnsRows],
    [paymentRows],
    [creditRows],
    [expenseRows],
  ] = await Promise.all([
    pool.query(coreSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
    pool.query(returnsSql, [range.startDateTime, range.endDateTime]),
    pool.query(paymentSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
    pool.query(paymentCreditSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
    pool.query(expensesSql, [range.endDate, range.startDate]),
  ]);

  const core = coreRows[0];
  const totalReturns = Number(returnsRows[0].total_returns);
  const totalReturnsTax = Number(returnsRows[0].total_returns_tax);
  const returnsRevenuePortion = totalReturns - totalReturnsTax;

  // sale_items rows are shrunk in place on return (see revenueSql.js),
  // so core.gross_sales / core.net_before_returns are already POST-return.
  // Add back the TAX-EXCLUDED portion of returns to reconstruct pre-return figures
  // (same pattern as dashboard.js's getCoreFinancials).
  const netSalesRevenueRaw = Number(core.net_before_returns);
  const netBeforeReturns = netSalesRevenueRaw + returnsRevenuePortion;

  // Pre-discount list-price total (before any discount), used only to
  // compute total_discounts as its own line item.
  const grossSalesListPrice = Number(core.gross_sales) + returnsRevenuePortion;
  const totalDiscountsRaw = grossSalesListPrice - netBeforeReturns;

  // "Gross Sales" card — post-discount, pre-tax, pre-return revenue.
  // Matches dashboard.js's grossRevenue exactly so both pages agree.
  const grossSalesRaw = netBeforeReturns;

  const salesCount = Number(core.sales_count);
  const totalCogsRaw = Number(core.total_cogs);

  // Walk-in return deductions — every figure here comes straight from
  // walk_in_return_sessions / walk_in_returns, already precalculated.
  const walkIn = await fetchWalkInFinancialAggregate(range, userId);

  const grossSales = grossSalesRaw;
  const totalDiscounts = totalDiscountsRaw - walkIn.discount_returned;
  const totalReturnsAdjusted = totalReturns + walkIn.refund_returned;
  const netSalesRevenue = netSalesRevenueRaw - walkIn.revenue_returned;
  const totalCogs = totalCogsRaw - walkIn.cost_returned;
  const grossProfitAmount = (netSalesRevenueRaw - totalCogsRaw) - walkIn.profit_returned;

  const { total: totalExpenses, breakdown: expenseBreakdown, expenseCount } =
    prorateExpensesByCategory(expenseRows, range.startObj, range.endObj);

  const operatingProfit = grossProfitAmount - totalExpenses;
  const netProfitAmount = operatingProfit;

  const taxCollected = Number(core.tax_collected) - walkIn.tax_returned;

  const paymentMap = new Map(paymentRows.map((r) => [String(r.payment_type).toLowerCase(), r]));
  const cashRow = paymentMap.get('cash');
  const cardRow = paymentMap.get('card');
  const creditRow = paymentMap.get('credit');
  const creditPaidOutstanding = creditRows[0];

  const periodDays = Math.round((range.endObj - range.startObj) / 86400000) + 1;

  return {
    period: { days: periodDays, start: range.startDate, end: range.endDate },
    sales_revenue: {
      gross_sales: grossSales,
      gross_sales_count: salesCount,
      sales_count: salesCount,
      items_sold: Number(core.items_sold) - walkIn.qty_returned,
      avg_transaction_value: safeDiv(netSalesRevenue, salesCount),
      total_discounts: totalDiscounts,
      total_returns: totalReturnsAdjusted,
      net_sales_revenue: netSalesRevenue,
    },
    cogs: { total_cogs: totalCogs },
    gross_profit: {
      amount: grossProfitAmount,
      margin_percentage: safeDiv(grossProfitAmount, netSalesRevenue) * 100,
    },
    operating_expenses: {
      total_expenses: totalExpenses,
      expense_count: expenseCount,
      breakdown: expenseBreakdown,
    },
    operating_profit: operatingProfit,
    net_profit: {
      amount: netProfitAmount,
      margin_percentage: safeDiv(netProfitAmount, netSalesRevenue) * 100,
    },
    financial_ratios: {
      gross_profit_margin: safeDiv(grossProfitAmount, netSalesRevenue) * 100,
      net_profit_margin: safeDiv(netProfitAmount, netSalesRevenue) * 100,
      expense_ratio: safeDiv(totalExpenses, netSalesRevenue) * 100,
      cogs_ratio: safeDiv(totalCogs, netSalesRevenue) * 100,
    },
       payment_breakdown: {
      cash: { amount: (cashRow ? Number(cashRow.amount) : 0) - walkIn.revenue_returned, count: cashRow ? Number(cashRow.cnt) : 0 },
      card: { amount: cardRow ? Number(cardRow.amount) : 0, count: cardRow ? Number(cardRow.cnt) : 0 },
      credit: {
        amount: creditRow ? Number(creditRow.amount) : 0,
        paid: Number(creditPaidOutstanding.paid),
        outstanding: Number(creditPaidOutstanding.outstanding),
        count: creditRow ? Number(creditRow.cnt) : 0,
      },
    },
    tax_info: {
      total_taxable_amount: netSalesRevenue,
      total_tax_collected: taxCollected,
      avg_tax_rate: safeDiv(taxCollected, netBeforeReturns) * 100,
    },
  };
}

async function fetchWalkInFinancialAggregate(range, userId) {
  const sellerClause = userId ? 'AND wirs.user_id = ?' : '';
  const sellerParam = userId ? [userId] : [];

  const sessionSql = `
    SELECT
      COALESCE(SUM(wirs.total_revenue_without_tax), 0) AS revenue_returned,
      COALESCE(SUM(wirs.total_profit_without_tax), 0) AS profit_returned,
      COALESCE(SUM(wirs.total_discount_amount), 0) AS discount_returned,
      COALESCE(SUM(wirs.total_refund_amount), 0) AS refund_returned,
      COALESCE(SUM(wirs.total_tax_amount), 0) AS tax_returned
    FROM walk_in_return_sessions wirs
    WHERE wirs.created_at BETWEEN ? AND ? ${sellerClause}
  `;

  const itemsSql = `
    SELECT
      COALESCE(SUM(wr.quantity_returned), 0) AS qty_returned,
      COALESCE(SUM(p2.purchased_price * wr.quantity_returned), 0) AS cost_returned
    FROM walk_in_returns wr
    INNER JOIN walk_in_return_sessions wirs ON wirs.id = wr.session_id
    INNER JOIN purchases p2 ON p2.id = wr.purchase_id
    WHERE wirs.created_at BETWEEN ? AND ? ${sellerClause}
  `;

  const [[sessionRows], [itemRows]] = await Promise.all([
    pool.query(sessionSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
    pool.query(itemsSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
  ]);

  return {
    revenue_returned: Number(sessionRows[0].revenue_returned),
    profit_returned: Number(sessionRows[0].profit_returned),
    discount_returned: Number(sessionRows[0].discount_returned),
    refund_returned: Number(sessionRows[0].refund_returned),
    tax_returned: Number(sessionRows[0].tax_returned),
    qty_returned: Number(itemRows[0].qty_returned),
    cost_returned: Number(itemRows[0].cost_returned),
  };
}

export default async function financialReportRoutes(fastify) {
  /* ============================================================
     GET /api/reports/financial/summary
     Drives the Summary, Revenue, Expenses, and Breakdown tabs — they're
     all different views of the same underlying P&L numbers, so one
     query set serves all four instead of four separate round trips.
     ============================================================ */
     fastify.get('/api/reports/financial/summary', async (req, reply) => {
      const t0 = Date.now();
      try {
        const { range, userId } = parseMainFilters(req.query);
        const data = await computeFinancialSummary(range, userId);
  
        return reply.send({
          success: true,
          data,
          meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
        });
      } catch (err) {
        req.log.error(err);
        return reply.status(500).send({ success: false, error: 'Failed to load financial summary' });
      }
    });

  /* ============================================================
     GET /api/reports/financial/top-products
     Profitability tab — sortable, capped at a limit (not paginated,
     matches the frontend's Top 5/10/20 selector).
     ============================================================ */
  fastify.get('/api/reports/financial/top-products', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const SORT_COLUMNS = { revenue: 'revenue', profit: 'profit', quantity: 'quantity_sold' };
      const sortColumn = SORT_COLUMNS[req.query.sort_by] || 'profit';
      const limit = parseLimit(req.query.limit, 10, 50);

      const sql = `
      SELECT
        p.id, p.product_name, p.unit, p.type,
        COALESCE(SUM(si.quantity), 0) AS quantity_sold,
        COALESCE(SUM(${REVENUE_EXPR}), 0) AS revenue,
        COALESCE(SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS cost,
        COALESCE(SUM(${REVENUE_EXPR}) - SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS profit
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id
      INNER JOIN purchases p ON p.id = si.purchase_id
      ${DISCOUNT_ALLOC_JOIN}
      WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
      GROUP BY p.id, p.product_name, p.unit, p.type
      ORDER BY ${sortColumn} DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [range.startDateTime, range.endDateTime, ...sellerParam, limit]);

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

    const data = rows.map((r) => {
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
      };
    });

      return reply.send({
        success: true,
        data,
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load top products' });
    }
  });

  /* ============================================================
     GET /api/reports/financial/category-performance
     Profitability tab — paginated, includes contribution_percentage
     (this category's share of total revenue across ALL categories).

     NOTE: like salesReport.js's categories endpoint, a category is not
     tagged with a single `type` here — it can legitimately contain both
     products and services. cost naturally comes out as 0 for a
     pure-service category. The frontend's `cat.type === 'service' ?
     '-' : ...` check should become a `cat.cost === 0` check once wired up.
     ============================================================ */
  fastify.get('/api/reports/financial/category-performance', async (req, reply) => {
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
        COALESCE(SUM(${REVENUE_EXPR}) - SUM(CASE WHEN p.type != 'service' THEN ${COST_EXPR} ELSE 0 END), 0) AS profit
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

    const totalRevenueSql = `SELECT COALESCE(SUM(${REVENUE_EXPR}), 0) AS total ${baseFrom}`;

    const [[dataRows], [countRows], [totalRows]] = await Promise.all([
      pool.query(dataSql, [...params, pageSize, offset]),
      pool.query(countSql, params),
      pool.query(totalRevenueSql, params),
    ]);

    const walkInSql = `
      SELECT
        COALESCE(c2.id, 0) AS category_id,
        COALESCE(SUM(wr.revenue_without_tax), 0) AS revenue_returned,
        COALESCE(SUM(wr.profit_without_tax), 0) AS profit_returned,
        COALESCE(SUM(p2.purchased_price * wr.quantity_returned), 0) AS cost_returned
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

    const totalWalkInRevenueReturned = walkInRows.reduce((sum, r) => sum + Number(r.revenue_returned), 0);
    const totalRevenue = Number(totalRows[0].total) - totalWalkInRevenueReturned;

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
        contribution_percentage: safeDiv(revenue, totalRevenue) * 100,
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
      return reply.status(500).send({ success: false, error: 'Failed to load category performance' });
    }
  });

  /* ============================================================
     GET /api/reports/financial/receivables-aging
     Snapshot of ALL currently outstanding credit sales, bucketed by how
     overdue they are — NOT scoped to date_range. "How much is owed right
     now" is a present-moment question, same rule as dashboard.js's
     Credit Pending card.
     ============================================================ */
     fastify.get('/api/reports/financial/receivables-aging', async (req, reply) => {
      const t0 = Date.now();
      try {
        const userId = parseUserId(req.query);
        const sellerClause = userId ? 'AND seller_id = ?' : '';
        const sellerParam = userId ? [userId] : [];
  
        const page = parsePage(req.query.page);
        const pageSize = parsePageSize(req.query.page_size, 15);
        const offset = (page - 1) * pageSize;
  
        const SORT_COLUMNS = {
          days_overdue: 'days_overdue',
          remaining_balance: 's.remaining_balance',
          voucher_no: 's.voucher_no',
        };
        const sortColumn = SORT_COLUMNS[req.query.sort_by] || 'days_overdue';
        const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';
  
        const bucket = (req.query.bucket || '').trim();
        let bucketClause = '';
        if (bucket === 'not_due') {
          bucketClause = 'AND DATEDIFF(CURDATE(), COALESCE(s.due_date, s.created_at)) < 0';
        } else if (bucket === '0_30') {
          bucketClause = 'AND DATEDIFF(CURDATE(), COALESCE(s.due_date, s.created_at)) BETWEEN 0 AND 30';
        } else if (bucket === '31_60') {
          bucketClause = 'AND DATEDIFF(CURDATE(), COALESCE(s.due_date, s.created_at)) BETWEEN 31 AND 60';
        } else if (bucket === '61_plus') {
          bucketClause = 'AND DATEDIFF(CURDATE(), COALESCE(s.due_date, s.created_at)) > 60';
        }
  
        const summarySql = `
          SELECT
            COALESCE(SUM(remaining_balance), 0) AS total_outstanding,
            COUNT(*) AS total_invoices,
            COALESCE(AVG(CASE WHEN days_overdue > 0 THEN days_overdue END), 0) AS avg_days_overdue,
            COALESCE(SUM(CASE WHEN days_overdue < 0 THEN remaining_balance ELSE 0 END), 0) AS not_due_amount,
            COALESCE(SUM(CASE WHEN days_overdue < 0 THEN 1 ELSE 0 END), 0) AS not_due_count,
            COALESCE(SUM(CASE WHEN days_overdue BETWEEN 0 AND 30 THEN remaining_balance ELSE 0 END), 0) AS due_0_30_amount,
            COALESCE(SUM(CASE WHEN days_overdue BETWEEN 0 AND 30 THEN 1 ELSE 0 END), 0) AS due_0_30_count,
            COALESCE(SUM(CASE WHEN days_overdue BETWEEN 31 AND 60 THEN remaining_balance ELSE 0 END), 0) AS due_31_60_amount,
            COALESCE(SUM(CASE WHEN days_overdue BETWEEN 31 AND 60 THEN 1 ELSE 0 END), 0) AS due_31_60_count,
            COALESCE(SUM(CASE WHEN days_overdue > 60 THEN remaining_balance ELSE 0 END), 0) AS due_61_plus_amount,
            COALESCE(SUM(CASE WHEN days_overdue > 60 THEN 1 ELSE 0 END), 0) AS due_61_plus_count
          FROM (
            SELECT remaining_balance,
              DATEDIFF(CURDATE(), COALESCE(due_date, created_at)) AS days_overdue
           FROM sales
            WHERE payment_type = 'credit'
              AND status IN ('unpaid', 'partial') AND remaining_balance > 0
              ${sellerClause}
          ) t
        `;
  
        const detailWhereClause = `
        WHERE s.payment_type = 'credit'
          AND s.status IN ('unpaid', 'partial') AND s.remaining_balance > 0
          ${sellerClause} ${bucketClause}
      `;
  
        const detailSql = `
          SELECT s.voucher_no, COALESCE(c.name, 'Walk-in Customer') AS customer,
            s.remaining_balance, s.due_date,
            DATEDIFF(CURDATE(), COALESCE(s.due_date, s.created_at)) AS days_overdue
          FROM sales s
          LEFT JOIN customers c ON c.id = s.customer_id
          ${detailWhereClause}
          ORDER BY ${sortColumn} ${sortOrder}
          LIMIT ? OFFSET ?
        `;
  
        const countSql = `SELECT COUNT(*) AS cnt FROM sales s ${detailWhereClause}`;
  
        const [[summaryRows], [detailRows], [countRows]] = await Promise.all([
          pool.query(summarySql, sellerParam),
          pool.query(detailSql, [...sellerParam, pageSize, offset]),
          pool.query(countSql, sellerParam),
        ]);
  
        const s = summaryRows[0];
        const total = Number(countRows[0].cnt);
        const lastPage = Math.max(1, Math.ceil(total / pageSize));
  
        return reply.send({
          success: true,
          data: {
            summary: {
              total_outstanding: Number(s.total_outstanding),
              total_invoices: Number(s.total_invoices),
              average_days_overdue: Number(s.avg_days_overdue),
              buckets: [
                { key: 'not_due', label: 'Not Yet Due', amount: Number(s.not_due_amount), count: Number(s.not_due_count) },
                { key: '0_30', label: '0-30 Days', amount: Number(s.due_0_30_amount), count: Number(s.due_0_30_count) },
                { key: '31_60', label: '31-60 Days', amount: Number(s.due_31_60_amount), count: Number(s.due_31_60_count) },
                { key: '61_plus', label: '61+ Days', amount: Number(s.due_61_plus_amount), count: Number(s.due_61_plus_count) },
              ],
            },
            invoices: detailRows.map((r) => ({
              voucher_no: r.voucher_no,
              customer: r.customer,
              remaining_balance: Number(r.remaining_balance),
              due_date: r.due_date,
              days_overdue: Number(r.days_overdue),
            })),
          },
          pagination: { current_page: page, last_page: lastPage, total },
          meta: { queryTimeMs: Date.now() - t0 },
        });
      } catch (err) {
        req.log.error(err);
        return reply.status(500).send({ success: false, error: 'Failed to load receivables aging' });
      }
    });
  }
