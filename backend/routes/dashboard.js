import pool from '../db.js';

/* ============================================================
   ============  DATE RANGE UTILITIES (from dateRange.js)  =====
   ============================================================

   IMPORTANT — timezone discipline:
   This section NEVER calls .toISOString() or Date.UTC(). All boundaries are
   built from local Date getters/setters (getFullYear/getMonth/getDate) and
   formatted manually. That is what prevents the classic UTC+5 shift bug
   (constructing a local midnight, then calling toISOString(), which rolls
   it back to the previous day). Every date that leaves this section is a
   plain 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss' string — never a Date object.
   ============================================================ */

const MAX_CUSTOM_RANGE_DAYS = 365;

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(d, endOfDay = false) {
  return `${fmtDate(d)} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function getMonday(d) {
  const copy = startOfDay(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(copy, diff);
}

function parseDateOnly(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function resolveRangeObjects(rangeKey, customStart, customEnd) {
  const today = startOfDay(new Date());

  switch (rangeKey) {
    case 'today':
      return { startObj: today, endObj: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { startObj: y, endObj: y };
    }
    case 'this_week': {
      const monday = getMonday(today);
      return { startObj: monday, endObj: addDays(monday, 6) };
    }
    case 'last_week': {
      const thisMonday = getMonday(today);
      const lastMonday = addDays(thisMonday, -7);
      return { startObj: lastMonday, endObj: addDays(lastMonday, 6) };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { startObj: start, endObj: end };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startObj: start, endObj: end };
    }
    case 'this_quarter': {
      const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
      const start = new Date(today.getFullYear(), qStartMonth, 1);
      const end = new Date(today.getFullYear(), qStartMonth + 3, 0);
      return { startObj: start, endObj: end };
    }
    case 'this_year': {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 11, 31);
      return { startObj: start, endObj: end };
    }
    case 'custom': {
      if (!customStart || !customEnd) {
        return { startObj: today, endObj: today };
      }
      let start = parseDateOnly(customStart);
      let end = parseDateOnly(customEnd);
      if (start > end) [start, end] = [end, start];
      const diffDays = Math.round((end - start) / 86400000);
      let warning = null;
      if (diffDays > MAX_CUSTOM_RANGE_DAYS) {
        start = addDays(end, -MAX_CUSTOM_RANGE_DAYS);
        warning = `Custom range exceeded ${MAX_CUSTOM_RANGE_DAYS} days and was clamped.`;
      }
      return { startObj: start, endObj: end, warning };
    }
    default:
      return { startObj: today, endObj: today };
  }
}

function resolveDateRange(rangeKey, customStart, customEnd) {
  const { startObj, endObj, warning } = resolveRangeObjects(rangeKey, customStart, customEnd);
  return {
    startDateTime: fmtDateTime(startObj, false),
    endDateTime: fmtDateTime(endObj, true),
    startDate: fmtDate(startObj),
    endDate: fmtDate(endObj),
    startObj,
    endObj,
    warning: warning || null,
  };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(d) {
  return `${pad(d.getDate())} ${MONTH_ABBR[d.getMonth()]}`;
}

function formatMonthLabel(d) {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

/* ============================================================
   ============  CORE FINANCIALS (from financials.js)  =========
   ============================================================ */

   function prorateExpenses(expenseRows, rangeStartObj, rangeEndObj) {
    let total = 0;
    for (const row of expenseRows) {
      const expStart = row.start_date
        ? parseDateOnly(String(row.start_date).slice(0, 10))
        : parseDateOnly(String(row.date).slice(0, 10));
      const expEnd = row.end_date
        ? parseDateOnly(String(row.end_date).slice(0, 10))
        : addDays(expStart, Math.max(1, Number(row.days) || 1) - 1);
  
      const totalSpanDays = Math.floor((expEnd - expStart) / 86400000) + 1;
      const dailyShare = Number(row.amount) / Math.max(1, totalSpanDays);
  
      const overlapStart = expStart > rangeStartObj ? expStart : rangeStartObj;
      const overlapEnd = expEnd < rangeEndObj ? expEnd : rangeEndObj;
      const overlapDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  
      if (overlapDays > 0) {
        total += dailyShare * overlapDays;
      }
    }
    return total;
  }

function safeDiv(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

async function getCoreFinancials(pool, range) {
  const { startDateTime, endDateTime, startDate, endDate, startObj, endObj, userId } = range;

  const sellerClause = userId ? 'AND s.seller_id = ?' : '';
  const sellerParam = userId ? [userId] : [];
  // sale_returns and walk_in_return_sessions are queried directly (no `s.` alias),
  // so they filter on their own user_id column instead of sellerClause.
  const returnsSellerClause = userId ? 'AND user_id = ?' : '';
  const wirSellerClause = userId ? 'AND user_id = ?' : '';
  // walk_in_returns has no user_id of its own — it reaches it via the
  // wirs (walk_in_return_sessions) join already present in wirItemsSql.
  const wirItemsSellerClause = userId ? 'AND wirs.user_id = ?' : '';

  const salesSql = `
  SELECT
    COALESCE(SUM(received_amount), 0) AS received_sum,
    COUNT(*)                          AS invoice_count,
COALESCE(SUM(discount_amount), 0) AS order_discount_sum,
COALESCE(SUM(CASE WHEN payment_type != 'credit' THEN discount_amount ELSE 0 END), 0) AS order_discount_excl_credit,
    COALESCE(SUM(tax_amount), 0)      AS order_tax_sum,
    COALESCE(SUM(grand_total), 0)     AS order_grand_total_sum
  FROM sales s
   WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ?
    ${sellerClause}
`;

  // Revenue, tax, and the grand-total-equivalent are computed from
  // sale_items — NOT from sales.subtotal/discount_amount/tax_amount.
  // Those header columns aren't reliably populated by the create-sale
  // route, but sale_items.total_after_discount / tax_amount /
  // total_after_tax are always computed correctly server-side inside
  // storeSaleItems(), so they're the trustworthy source.
  const itemsSql = `
    SELECT
COALESCE(SUM(si.total_after_discount), 0)           AS revenue_excl_tax,
COALESCE(SUM(CASE WHEN s.payment_type != 'credit' THEN si.total_after_discount ELSE 0 END), 0) AS revenue_excl_credit,
      COALESCE(SUM(si.tax_amount), 0)                     AS tax_collected,
      COALESCE(SUM(si.total_after_tax), 0)                AS grand_total_sum,
      COALESCE(SUM(si.purchased_price * si.quantity), 0)  AS purchase_cost,
      COALESCE(SUM(CASE WHEN p.type != 'service' THEN si.quantity ELSE 0 END), 0) AS items_sold
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN purchases p ON p.id = si.purchase_id
    WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ?
      ${sellerClause}
  `;

  const serviceSql = `
    SELECT COALESCE(SUM(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)), 0) AS service_revenue
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    INNER JOIN purchases p ON p.id = si.purchase_id
    INNER JOIN (
      SELECT sale_id, SUM(total_after_discount) AS items_sum
      FROM sale_items
      GROUP BY sale_id
    ) sis ON sis.sale_id = si.sale_id
    WHERE p.type = 'service'
      AND COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ?
      ${sellerClause}
  `;

  const returnsSql = `
  SELECT
    COALESCE(SUM(total_return_amount), 0) AS returns_amount,
    COALESCE(SUM(total_tax), 0)           AS returns_tax_amount
  FROM sale_returns
   WHERE status = 'completed'
    AND created_at BETWEEN ? AND ?
    ${returnsSellerClause}
`;

  const customerSnapshotSql = `
    SELECT
      COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0) AS credit_pending,
      COALESCE(SUM(CASE WHEN advance_payment > 0 THEN advance_payment ELSE 0 END), 0) AS total_advance
    FROM customers
  `;

  const expensesSql = `
    SELECT amount, date, days, start_date, end_date
   FROM expenses
    WHERE COALESCE(start_date, date) <= ?
      AND COALESCE(end_date, DATE_ADD(date, INTERVAL (days - 1) DAY)) >= ?
  `;

  const wirSessionSql = `
  SELECT
    COALESCE(SUM(total_revenue_without_tax), 0) AS revenue,
    COALESCE(SUM(total_profit_without_tax), 0) AS profit,
    COALESCE(SUM(total_tax_amount), 0) AS tax,
    COALESCE(SUM(total_refund_amount), 0) AS refund
  FROM walk_in_return_sessions
  WHERE status = 'completed' AND deleted_at IS NULL
    AND created_at BETWEEN ? AND ?
    ${wirSellerClause}
`;

const wirItemsSql = `
SELECT
  COALESCE(SUM(p.purchased_price * wir.quantity_returned), 0) AS purchase_cost,
  COALESCE(SUM(wir.quantity_returned), 0) AS qty_returned
FROM walk_in_returns wir
INNER JOIN walk_in_return_sessions wirs ON wirs.id = wir.session_id
INNER JOIN purchases p ON p.id = wir.purchase_id
WHERE wirs.status = 'completed' AND wirs.deleted_at IS NULL AND wir.deleted_at IS NULL
  AND wirs.created_at BETWEEN ? AND ?
  ${wirItemsSellerClause}
`;

  const [
    [salesRows],
    [itemsRows],
    [serviceRows],
    [returnsRows],
    [customerRows],
    [expenseRows],
    [wirSessionRows],
    [wirItemsRows],
  ] = await Promise.all([
    pool.query(salesSql, [startDateTime, endDateTime, ...sellerParam]),
    pool.query(itemsSql, [startDateTime, endDateTime, ...sellerParam]),
    pool.query(serviceSql, [startDateTime, endDateTime, ...sellerParam]),
    pool.query(returnsSql, [startDateTime, endDateTime, ...sellerParam]),
    pool.query(customerSnapshotSql),
    pool.query(expensesSql, [endDate, startDate]),
    pool.query(wirSessionSql, [startDateTime, endDateTime, ...sellerParam]),
    pool.query(wirItemsSql, [startDateTime, endDateTime, ...sellerParam]),
  ]);

   const sales = salesRows[0];
  const items = itemsRows[0];
  const service = serviceRows[0];
  const returns = returnsRows[0];
  const customerSnap = customerRows[0];
  const wirSession = wirSessionRows[0];
  const wirItems = wirItemsRows[0];

  const orderLevelDiscount = Number(sales.order_discount_sum);
  const orderLevelTax = Number(sales.order_tax_sum);

  const revenueBeforeWalkInReturns = Number(items.revenue_excl_tax) - orderLevelDiscount;
  const totalRevenue = revenueBeforeWalkInReturns - Number(wirSession.revenue);
  const totalReturnsAmount = Number(returns.returns_amount) + Number(wirSession.refund);
  const returnsRevenuePortion = Number(returns.returns_amount) - Number(returns.returns_tax_amount);
  const grossRevenue = totalRevenue + returnsRevenuePortion + Number(wirSession.revenue);
const revenueExcludingCredit = Number(items.revenue_excl_credit) - Number(sales.order_discount_excl_credit);

  const totalPurchaseCost = Number(items.purchase_cost);
  const totalProfit = (revenueBeforeWalkInReturns - totalPurchaseCost) - Number(wirSession.profit);

  const totalExpenses = prorateExpenses(expenseRows, startObj, endObj);
  const netProfit = totalProfit - totalExpenses;

  const totalInvoices = Number(sales.invoice_count);
  const averageOrderValue = safeDiv(totalRevenue, totalInvoices);
  const grossMargin = safeDiv(totalProfit, totalRevenue) * 100;
  const netMargin = safeDiv(netProfit, totalRevenue) * 100;
  const paymentCollectionRatio = safeDiv(Number(sales.received_sum), Number(sales.order_grand_total_sum)) * 100;

  return {
    totalRevenue,
    grossRevenue,
    revenueExcludingCredit,
    totalReturnsAmount,
    totalPurchaseCost,
    soldItemsCost: totalPurchaseCost - Number(wirItems.purchase_cost),
    totalProfit,
    totalExpenses,
    netProfit,
    totalTaxCollected: Number(items.tax_collected) + orderLevelTax - Number(wirSession.tax),
    serviceRevenue: Number(service.service_revenue),
    totalCredit: Number(customerSnap.credit_pending),
    totalAdvance: Number(customerSnap.total_advance),
    totalInvoices,
    totalItemsSold: Number(items.items_sold) - Number(wirItems.qty_returned),
    averageOrderValue,
    grossMargin,
    netMargin,
    paymentCollectionRatio,
  };
}

/* ============================================================
   ============  DASHBOARD ROUTES (from dashboard.js)  ==========
   ============================================================ */

const MONTHLY_ALLOWED = ['this_month', 'last_month', 'this_quarter', 'this_year', 'custom'];
const PAYMENT_TYPES = ['cash', 'card', 'credit', 'advance'];

function clampLimit(value, fallback = 5) {
  const n = parseInt(value, 10);
  if (!n || n < 1) return fallback;
  return Math.min(n, 15);
}

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

function fillDailyGaps(rows, startObj, endObj, wirRows = []) {
  const map = new Map(rows.map((r) => [String(r.d).slice(0, 10), Number(r.total)]));
  const wirMap = new Map(wirRows.map((r) => [String(r.d).slice(0, 10), Number(r.total)]));
  const result = [];
  let cursor = new Date(startObj);
  while (cursor <= endObj) {
    const key = fmtDate(cursor);
    result.push({ date: formatDayLabel(cursor), total: (map.get(key) || 0) - (wirMap.get(key) || 0) });
    cursor = addDays(cursor, 1);
  }
  return result;
}

function fillMonthlyGaps(rows, startObj, endObj, wirRows = []) {
  const map = new Map(rows.map((r) => [String(r.ym), Number(r.total)]));
  const wirMap = new Map(wirRows.map((r) => [String(r.ym), Number(r.total)]));
  const result = [];
  let cursor = new Date(startObj.getFullYear(), startObj.getMonth(), 1);
  const last = new Date(endObj.getFullYear(), endObj.getMonth(), 1);
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
    result.push({ month: formatMonthLabel(cursor), total: (map.get(key) || 0) - (wirMap.get(key) || 0) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return result;
}

export default async function dashboardRoutes(fastify) {

  fastify.get('/api/dashboard/users', async (req, reply) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, role FROM users ORDER BY name ASC`
      );
      return reply.send({ success: true, data: rows });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load users' });
    }
  });

  fastify.get('/api/dashboard/overview', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const core = await getCoreFinancials(pool, { ...range, userId });

      return reply.send({
        success: true,
        data: {
          totalRevenue: core.totalRevenue,
          grossRevenue: core.grossRevenue,
          revenueExcludingCredit: core.revenueExcludingCredit,
          totalReturnsAmount: core.totalReturnsAmount,
          totalPurchaseCost: core.totalPurchaseCost,
          totalProfit: core.totalProfit,
          netProfit: core.netProfit,
          serviceRevenue: core.serviceRevenue,
          totalTaxCollected: core.totalTaxCollected,
          totalCredit: core.totalCredit,
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load overview data' });
    }
  });

  fastify.get('/api/dashboard/charts', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range: mainRange, userId } = parseMainFilters(req.query);

         // The frontend never actually sends monthly_range/monthly_start/
      // monthly_end — it only filters by the main date_range. This used
      // to silently fall back to 'this_month' regardless of the main
      // filter, so a 1-year selection always showed only September.
      // Reuse mainRange unless a monthly-specific override is explicitly
      // passed by a future caller.
      const monthlyRangeKey = req.query.monthly_range
      ? (MONTHLY_ALLOWED.includes(req.query.monthly_range) ? req.query.monthly_range : 'this_month')
      : req.query.date_range || 'today';

    const monthlyRange = req.query.monthly_range
      ? resolveDateRange(monthlyRangeKey, req.query.monthly_start, req.query.monthly_end)
      : mainRange;

      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];
      // walk_in_return_sessions is queried directly (no `s.` alias) in the
      // wir-specific queries below, so they filter on their own user_id.
      const wirSellerClause = userId ? 'AND user_id = ?' : '';
      const wirCategorySellerClause = userId ? 'AND wirs.user_id = ?' : '';

      const dailySql = `
SELECT DATE(COALESCE(s.sale_date, s.created_at)) AS d,
  COALESCE(SUM(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)), 0) AS total
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN (
          SELECT sale_id, SUM(total_after_discount) AS items_sum
          FROM sale_items
          GROUP BY sale_id
        ) sis ON sis.sale_id = si.sale_id
        WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
        GROUP BY DATE(COALESCE(s.sale_date, s.created_at))
      `;

      const monthlySql = `
SELECT DATE_FORMAT(COALESCE(s.sale_date, s.created_at), '%Y-%m') AS ym,
          COALESCE(SUM(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)), 0) AS total
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        INNER JOIN (
          SELECT sale_id, SUM(total_after_discount) AS items_sum
          FROM sale_items
          GROUP BY sale_id
        ) sis ON sis.sale_id = si.sale_id
                WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
        GROUP BY DATE_FORMAT(COALESCE(s.sale_date, s.created_at), '%Y-%m')
      `;

      const paymentTypeSql = `
SELECT s.payment_type,
  COALESCE(SUM(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)), 0) AS total
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        INNER JOIN (
          SELECT sale_id, SUM(total_after_discount) AS items_sum
          FROM sale_items
          GROUP BY sale_id
        ) sis ON sis.sale_id = si.sale_id
                WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
        GROUP BY s.payment_type
      `;

      const categorySql = `
      SELECT
 COALESCE(c.name, 'Uncategorized') AS category,
 COALESCE(SUM(si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)), 0) AS revenue,
 COALESCE(SUM((si.total_after_discount - (CASE WHEN sis.items_sum > 0 THEN si.total_after_discount / sis.items_sum * s.discount_amount ELSE 0 END)) - (si.purchased_price * si.quantity)), 0) AS profit
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       INNER JOIN purchases p ON p.id = si.purchase_id
       LEFT JOIN categories c ON c.id = p.category_id
       INNER JOIN (
         SELECT sale_id, SUM(total_after_discount) AS items_sum
         FROM sale_items
         GROUP BY sale_id
       ) sis ON sis.sale_id = si.sale_id
          WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
       GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Uncategorized')
       ORDER BY revenue DESC
     `;

     const dailyWirSql = `
     SELECT DATE(created_at) AS d, COALESCE(SUM(total_revenue_without_tax), 0) AS total
     FROM walk_in_return_sessions
     WHERE status = 'completed' AND deleted_at IS NULL
       AND created_at BETWEEN ? AND ?
       ${wirSellerClause}
     GROUP BY DATE(created_at)
   `;

   const monthlyWirSql = `
   SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COALESCE(SUM(total_revenue_without_tax), 0) AS total
   FROM walk_in_return_sessions
   WHERE status = 'completed' AND deleted_at IS NULL
     AND created_at BETWEEN ? AND ?
     ${wirSellerClause}
   GROUP BY DATE_FORMAT(created_at, '%Y-%m')
 `;

 const wirRangeRevenueSql = `
 SELECT COALESCE(SUM(total_revenue_without_tax), 0) AS total
 FROM walk_in_return_sessions
 WHERE status = 'completed' AND deleted_at IS NULL
   AND created_at BETWEEN ? AND ?
   ${wirSellerClause}
`;

const categoryWirSql = `
SELECT
  COALESCE(c.name, 'Uncategorized') AS category,
  COALESCE(SUM(wir.revenue_without_tax), 0) AS revenue,
  COALESCE(SUM(wir.profit_without_tax), 0) AS profit
FROM walk_in_returns wir
INNER JOIN walk_in_return_sessions wirs ON wirs.id = wir.session_id
INNER JOIN purchases p ON p.id = wir.purchase_id
LEFT JOIN categories c ON c.id = p.category_id
WHERE wirs.status = 'completed' AND wirs.deleted_at IS NULL AND wir.deleted_at IS NULL
  AND wirs.created_at BETWEEN ? AND ?
  ${wirCategorySellerClause}
GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Uncategorized')
`;

   const [
     [dailyRows],
     [monthlyRows],
     [paymentRows],
     [categoryRows],
     [dailyWirRows],
     [monthlyWirRows],
     [wirRangeRevenueRows],
     [categoryWirRows],
   ] = await Promise.all([
     pool.query(dailySql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
     pool.query(monthlySql, [monthlyRange.startDateTime, monthlyRange.endDateTime, ...sellerParam]),
     pool.query(paymentTypeSql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
     pool.query(categorySql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
     pool.query(dailyWirSql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
     pool.query(monthlyWirSql, [monthlyRange.startDateTime, monthlyRange.endDateTime, ...sellerParam]),
     pool.query(wirRangeRevenueSql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
     pool.query(categoryWirSql, [mainRange.startDateTime, mainRange.endDateTime, ...sellerParam]),
   ]);

   const dailyRevenue = fillDailyGaps(dailyRows, mainRange.startObj, mainRange.endObj, dailyWirRows);
   const monthlyRevenue = fillMonthlyGaps(monthlyRows, monthlyRange.startObj, monthlyRange.endObj, monthlyWirRows);

   const paymentMap = new Map(paymentRows.map((r) => [String(r.payment_type).toLowerCase(), Number(r.total)]));
   const wirCashDeduction = Number(wirRangeRevenueRows[0].total);
   const salesByPaymentType = PAYMENT_TYPES.map((type) => ({
     payment_type: type.charAt(0).toUpperCase() + type.slice(1),
     total: (paymentMap.get(type) || 0) - (type === 'cash' ? wirCashDeduction : 0),
   }));

   const categoryWirMap = new Map(categoryWirRows.map((r) => [r.category, { revenue: Number(r.revenue), profit: Number(r.profit) }]));
   const revenueByCategory = categoryRows.map((r) => ({
     category: r.category,
     total: Number(r.revenue) - (categoryWirMap.get(r.category)?.revenue || 0),
   }));
   const profitByCategory = categoryRows.map((r) => ({
     category: r.category,
     profit: Number(r.profit) - (categoryWirMap.get(r.category)?.profit || 0),
   }));

      return reply.send({
        success: true,
        data: { dailyRevenue, monthlyRevenue, salesByPaymentType, revenueByCategory, profitByCategory },
        meta: {
          queryTimeMs: Date.now() - t0,
          monthlyRangeApplied: monthlyRangeKey,
          rangeWarning: mainRange.warning || monthlyRange.warning,
        },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load charts data' });
    }
  });

  fastify.get('/api/dashboard/products', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const sellerClause = userId ? 'AND s.seller_id = ?' : '';
      const sellerParam = userId ? [userId] : [];

      const productsLimit = clampLimit(req.query.products_limit || req.query.top_limit, 5);
      const customersLimit = clampLimit(req.query.customers_limit || req.query.top_limit, 5);
      const creditsLimit = clampLimit(req.query.credits_limit || req.query.top_limit, 5);

      const topProductsSql = `
        SELECT p.product_name,
          SUM(si.quantity) - COALESCE((
            SELECT SUM(wir.quantity_returned)
            FROM walk_in_returns wir
            INNER JOIN walk_in_return_sessions wirs ON wirs.id = wir.session_id
            WHERE wir.purchase_id = p.id
              AND wirs.status = 'completed'
              AND wirs.deleted_at IS NULL
              AND wir.deleted_at IS NULL
              AND wirs.created_at BETWEEN ? AND ?
          ), 0) AS total_qty,
          p.unit
        FROM sale_items si
        INNER JOIN sales s ON s.id = si.sale_id
        INNER JOIN purchases p ON p.id = si.purchase_id
        WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
        GROUP BY p.id, p.product_name, p.unit
        ORDER BY total_qty DESC
        LIMIT ?
      `;

      const topCustomersSql = `
        SELECT c.name AS customer_name, COALESCE(SUM(s.grand_total), 0) AS total_spent
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
        GROUP BY s.customer_id, c.name
        ORDER BY total_spent DESC
        LIMIT ?
      `;

      const outstandingCreditsSql = `
        SELECT name AS customer_name, current_balance
        FROM customers
        WHERE current_balance > 0
        ORDER BY current_balance DESC
        LIMIT ?
      `;

      const customerTypesSql = `
  SELECT MIN(COALESCE(sale_date, created_at)) AS first_sale
  FROM sales
  WHERE customer_id IN (
      SELECT DISTINCT s.customer_id FROM sales s
      WHERE s.customer_id IS NOT NULL
        AND COALESCE(s.sale_date, s.created_at) BETWEEN ? AND ? ${sellerClause}
    )
  GROUP BY customer_id
`;

      const customerCategorySql = `
        SELECT
          COALESCE(SUM(CASE WHEN current_balance > 0 THEN 1 ELSE 0 END), 0) AS credit_customers,
          COALESCE(SUM(CASE WHEN advance_payment > 0 THEN 1 ELSE 0 END), 0) AS advance_customers,
          COUNT(*) AS total_customers_all
         FROM customers
      `;

      const [[productRows], [customerRows], [creditRows], [typeRows], [categoryCountRows]] = await Promise.all([
        pool.query(topProductsSql, [range.startDateTime, range.endDateTime, range.startDateTime, range.endDateTime, ...sellerParam, productsLimit]),
        pool.query(topCustomersSql, [range.startDateTime, range.endDateTime, ...sellerParam, customersLimit]),
        pool.query(outstandingCreditsSql, [creditsLimit]),
        pool.query(customerTypesSql, [range.startDateTime, range.endDateTime, ...sellerParam]),
        pool.query(customerCategorySql),
      ]);

      const topProducts = productRows.map((r) => ({
        product_name: r.product_name,
        total_qty: Number(r.total_qty),
        unit: r.unit,
      }));

      const topCustomers = customerRows.map((r) => ({
        customer: r.customer_name ? { name: r.customer_name } : null,
        total_spent: Number(r.total_spent),
      }));

      const outstandingCredits = creditRows.map((r) => ({
        customer: { name: r.customer_name },
        outstanding: Number(r.current_balance),
      }));

      let newCount = 0;
      let repeatCount = 0;
      for (const row of typeRows) {
        const firstSale = String(row.first_sale);
        if (firstSale >= range.startDateTime && firstSale <= range.endDateTime) {
          newCount += 1;
        } else {
          repeatCount += 1;
        }
      }

      return reply.send({
        success: true,
        data: {
          topProducts,
          topCustomers,
          outstandingCredits,
          customerTypes: {
            new: newCount,
            repeat: repeatCount,
            credit: Number(categoryCountRows[0].credit_customers),
            advance: Number(categoryCountRows[0].advance_customers),
            totalAll: Number(categoryCountRows[0].total_customers_all),
          },
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load products data' });
    }
  });

  fastify.get('/api/dashboard/detailed', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range, userId } = parseMainFilters(req.query);
      const core = await getCoreFinancials(pool, { ...range, userId });

      const [inventoryRows] = await pool.query(`
        SELECT
          COALESCE(SUM(purchased_price * quantity), 0) AS total_all_purchases,
          COALESCE(SUM((quantity - sold_quantity) * purchased_price), 0) AS available_inventory_cost
        FROM purchases
        WHERE deleted_at IS NULL
      `);

      return reply.send({
        success: true,
        data: {
          totalRevenue: core.totalRevenue,
          grossRevenue: core.grossRevenue,
          totalReturnsAmount: core.totalReturnsAmount,
          totalPurchaseCost: core.totalPurchaseCost,
          totalProfit: core.totalProfit,
          netProfit: core.netProfit,
          totalTaxCollected: core.totalTaxCollected,
          totalCredit: core.totalCredit,
          totalAdvance: core.totalAdvance,
          totalAllPurchases: Number(inventoryRows[0].total_all_purchases),
          availableInventoryCost: Number(inventoryRows[0].available_inventory_cost),
          soldItemsCost: core.soldItemsCost,
          grossMargin: core.grossMargin,
          netMargin: core.netMargin,
          totalInvoices: core.totalInvoices,
          averageOrderValue: core.averageOrderValue,
          totalItemsSold: core.totalItemsSold,
          paymentCollectionRatio: core.paymentCollectionRatio,
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load detailed metrics' });
    }
  });
}