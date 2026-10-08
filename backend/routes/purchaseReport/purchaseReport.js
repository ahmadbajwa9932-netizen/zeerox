// backend/routes/reports/purchaseReport.js
import pool from '../../db.js';
import {
  resolveDateRange,
  formatMonthLabel,
  safeDiv,
} from './dateHelpers.js';

/* ============================================================
   SHARED SQL FRAGMENTS
   Single source of truth for "remaining stock" / "stock value" /
   "total amount" math — every query below reuses these instead of
   recomputing quantity - sold_quantity in five different places.
   ============================================================ */

const REMAINING_EXPR = `(p.quantity - p.sold_quantity)`;
const TOTAL_AMOUNT_EXPR = `(p.purchased_price * p.quantity)`;
const STOCK_VALUE_EXPR = `(p.purchased_price * ${REMAINING_EXPR})`;

/* ============================================================
   SHARED HELPERS (self-contained — not pulled from salesReport.js)
   ============================================================ */

function parseMainFilters(query) {
  const rangeKey = query.date_range || 'this_month';
  const range = resolveDateRange(rangeKey, query.start_date, query.end_date);
  return { range };
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

/**
 * Fills gaps in a monthly purchase-trend result set, same gap-filling
 * principle as salesReport.js's fillMonthlyGaps, but carries several
 * value columns per month instead of one.
 */
function fillMonthlyTrendGaps(rows, startObj, endObj) {
  const map = new Map(rows.map((r) => [String(r.ym), r]));
  const result = [];
  let cursor = new Date(startObj.getFullYear(), startObj.getMonth(), 1);
  const last = new Date(endObj.getFullYear(), endObj.getMonth(), 1);

  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const row = map.get(key);
    const totalPurchases = row ? Number(row.total_purchases) : 0;
    const totalAmount = row ? Number(row.total_amount) : 0;

    result.push({
      month: formatMonthLabel(cursor),
      total_purchases: totalPurchases,
      suppliers_count: row ? Number(row.suppliers_count) : 0,
      total_amount: totalAmount,
      total_quantity: row ? Number(row.total_quantity) : 0,
      avg_purchase_value: safeDiv(totalAmount, totalPurchases),
    });

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return result;
}

/* ============================================================
   ROUTES
   ============================================================ */

export default async function purchaseReportRoutes(fastify) {
  /* ------------------------------------------------------------
     GET /api/reports/purchase/summary
     Summary cards. Purchase-count/amount/suppliers/products are
     date-filtered; stock/inventory numbers are a live snapshot
     (deliberately NOT date-filtered — "stock in hand" means right
     now, not "stock purchased in this window").
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/summary', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range } = parseMainFilters(req.query);

      const periodSql = `
        SELECT
          COUNT(*) AS total_purchases,
          COALESCE(SUM(${TOTAL_AMOUNT_EXPR}), 0) AS total_purchase_amount,
          COUNT(DISTINCT p.supplier_id) AS total_suppliers,
          COUNT(DISTINCT p.product_name) AS total_products
        FROM purchases p
        WHERE p.deleted_at IS NULL
          AND p.purchase_date BETWEEN ? AND ?
      `;

      const snapshotSql = `
        SELECT
          COALESCE(SUM(CASE WHEN ${REMAINING_EXPR} > 0 THEN ${REMAINING_EXPR} ELSE 0 END), 0) AS stock_in_hand,
          COALESCE(SUM(CASE WHEN ${REMAINING_EXPR} > 0 THEN ${STOCK_VALUE_EXPR} ELSE 0 END), 0) AS available_purchase_amount,
          COALESCE(SUM(CASE WHEN ${REMAINING_EXPR} < 0 THEN 1 ELSE 0 END), 0) AS negative_stock
        FROM purchases p
        WHERE p.deleted_at IS NULL
      `;

      const [[periodRows], [snapshotRows]] = await Promise.all([
        pool.query(periodSql, [range.startDate, range.endDate]),
        pool.query(snapshotSql),
      ]);

      const period = periodRows[0];
      const snapshot = snapshotRows[0];

      return reply.send({
        success: true,
        data: {
          total_purchases: Number(period.total_purchases),
          total_purchase_amount: Number(period.total_purchase_amount),
          total_suppliers: Number(period.total_suppliers),
          total_products: Number(period.total_products),
          stock_in_hand: Number(snapshot.stock_in_hand),
          available_purchase_amount: Number(snapshot.available_purchase_amount),
          negative_stock: Number(snapshot.negative_stock),
        },
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load purchase summary' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/purchases
     Purchase List tab — filterable, sortable, paginated.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/purchases', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range } = parseMainFilters(req.query);

      const supplierId = parseInt(req.query.supplier_id, 10);
      const supplierClause = supplierId ? 'AND p.supplier_id = ?' : '';
      const supplierParam = supplierId ? [supplierId] : [];

      const categoryId = parseInt(req.query.category_id, 10);
      const categoryClause = categoryId ? 'AND p.category_id = ?' : '';
      const categoryParam = categoryId ? [categoryId] : [];

      const search = (req.query.search || '').trim();
      const searchClause = search ? 'AND p.product_name LIKE ?' : '';
      const searchParam = search ? [`%${search}%`] : [];

      const SORT_COLUMNS = {
        purchase_date: 'p.purchase_date',
        product_name: 'p.product_name',
        purchased_price: 'p.purchased_price',
        quantity: 'p.quantity',
      };
      const sortColumn = SORT_COLUMNS[req.query.sort_by] || 'p.purchase_date';
      const sortOrder = req.query.sort_order === 'asc' ? 'ASC' : 'DESC';

      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.page_size, 10);
      const offset = (page - 1) * pageSize;

      const whereClause = `
        WHERE p.deleted_at IS NULL
          AND p.purchase_date BETWEEN ? AND ?
          ${supplierClause} ${categoryClause} ${searchClause}
      `;
      const whereParams = [
        range.startDate, range.endDate,
        ...supplierParam, ...categoryParam, ...searchParam,
      ];

      const dataSql = `
        SELECT
          p.purchase_date, p.type, p.product_name, p.unit,
          p.quantity, p.sold_quantity, p.purchased_price,
          ${REMAINING_EXPR} AS remaining_stock,
          ${TOTAL_AMOUNT_EXPR} AS total_amount,
          ${STOCK_VALUE_EXPR} AS stock_value,
          s.name AS supplier_name, s.company AS supplier_company,
          COALESCE(c.name, 'Uncategorized') AS category
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${whereClause}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT ? OFFSET ?
      `;

      const countSql = `SELECT COUNT(*) AS cnt FROM purchases p ${whereClause}`;

      const [[dataRows], [countRows]] = await Promise.all([
        pool.query(dataSql, [...whereParams, pageSize, offset]),
        pool.query(countSql, whereParams),
      ]);

      const data = dataRows.map((r) => ({
        purchase_date: r.purchase_date,
        type: r.type,
        product_name: r.product_name,
        category: r.category,
        unit: r.unit,
        quantity: Number(r.quantity),
        sold_quantity: Number(r.sold_quantity),
        remaining_stock: Number(r.remaining_stock),
        purchased_price: Number(r.purchased_price),
        total_amount: Number(r.total_amount),
        stock_value: Number(r.stock_value),
        supplier_name: r.supplier_name,
        supplier_company: r.supplier_company,
      }));

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
      return reply.status(500).send({ success: false, error: 'Failed to load purchase list' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/supplier-summary
     Suppliers tab — aggregate + chart data (frontend slices top 10
     itself, so this returns the full paginated set like salesReport
     does for categories).
     ------------------------------------------------------------ */
     fastify.get('/api/reports/purchase/supplier-summary', async (req, reply) => {
      const t0 = Date.now();
      try {
        const { range } = parseMainFilters(req.query);
        const wantsAll = req.query.all === '1' || req.query.all === 'true';
        const page = parsePage(req.query.page);
        const pageSize = parsePageSize(req.query.page_size, 10);
        const offset = (page - 1) * pageSize;

      const baseFrom = `
        FROM purchases p
        INNER JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.deleted_at IS NULL
          AND p.purchase_date BETWEEN ? AND ?
      `;
      const params = [range.startDate, range.endDate];

      const dataSql = `
        SELECT
          s.name, s.company, s.contact_info,
          COUNT(*) AS total_purchases,
          COUNT(DISTINCT p.product_name) AS total_products,
          COALESCE(SUM(${TOTAL_AMOUNT_EXPR}), 0) AS total_amount,
          MAX(p.purchase_date) AS last_purchase_date
        ${baseFrom}
            GROUP BY s.id, s.name, s.company, s.contact_info
        ORDER BY total_amount DESC
        ${wantsAll ? '' : 'LIMIT ? OFFSET ?'}
      `;

      const countSql = `
        SELECT COUNT(*) AS cnt FROM (
          SELECT s.id ${baseFrom} GROUP BY s.id
        ) t
      `;

      const [[dataRows], [countRows]] = await Promise.all([
        pool.query(dataSql, wantsAll ? params : [...params, pageSize, offset]),
        pool.query(countSql, params),
      ]);

      const data = dataRows.map((r) => {
        const totalAmount = Number(r.total_amount);
        const totalPurchases = Number(r.total_purchases);
        return {
          name: r.name,
          company: r.company,
          contact_info: r.contact_info,
          total_purchases: totalPurchases,
          total_products: Number(r.total_products),
          total_amount: totalAmount,
          avg_purchase_value: safeDiv(totalAmount, totalPurchases),
          last_purchase_date: r.last_purchase_date,
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
      return reply.status(500).send({ success: false, error: 'Failed to load supplier summary' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/category-analysis
     NOTE: same caveat as salesReport.js's categories route — a
     category can hold both products and services, so it's not
     tagged with a single `type`. cost/quantity naturally come out
     0 for pure-service rows; frontend's `cat.type === 'service'`
     check should become a `cat.total_products === 0` check (or
     similar) once wired up — flagging for when we integrate.
     ------------------------------------------------------------ */
     fastify.get('/api/reports/purchase/category-analysis', async (req, reply) => {
      const t0 = Date.now();
      try {
        const { range } = parseMainFilters(req.query);
        const wantsAll = req.query.all === '1' || req.query.all === 'true';
        const page = parsePage(req.query.page);
        const pageSize = parsePageSize(req.query.page_size, 10);
        const offset = (page - 1) * pageSize;

      const baseFrom = `
        FROM purchases p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.deleted_at IS NULL
          AND p.purchase_date BETWEEN ? AND ?
      `;
      const params = [range.startDate, range.endDate];

      const dataSql = `
        SELECT
          COALESCE(c.name, 'Uncategorized') AS category,
          COUNT(DISTINCT p.product_name) AS total_products,
          COUNT(*) AS total_purchases,
          COALESCE(SUM(p.quantity), 0) AS total_quantity,
          COALESCE(SUM(${TOTAL_AMOUNT_EXPR}), 0) AS total_cost,
          COALESCE(SUM(${REMAINING_EXPR}), 0) AS remaining_quantity,
          COALESCE(SUM(CASE WHEN ${REMAINING_EXPR} > 0 THEN ${STOCK_VALUE_EXPR} ELSE 0 END), 0) AS stock_value
        ${baseFrom}
               GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Uncategorized')
        ORDER BY total_cost DESC
        ${wantsAll ? '' : 'LIMIT ? OFFSET ?'}
      `;

      const countSql = `
        SELECT COUNT(*) AS cnt FROM (
          SELECT COALESCE(c.id, 0) ${baseFrom} GROUP BY COALESCE(c.id, 0)
        ) t
      `;

      const [[dataRows], [countRows]] = await Promise.all([
        pool.query(dataSql, wantsAll ? params : [...params, pageSize, offset]),
        pool.query(countSql, params),
      ]);

      const data = dataRows.map((r) => ({
        category: r.category,
        total_products: Number(r.total_products),
        total_purchases: Number(r.total_purchases),
        total_quantity: Number(r.total_quantity),
        total_cost: Number(r.total_cost),
        remaining_quantity: Number(r.remaining_quantity),
        stock_value: Number(r.stock_value),
      }));

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
      return reply.status(500).send({ success: false, error: 'Failed to load category analysis' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/monthly-trend
     Trends tab (top chart + table).
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/monthly-trend', async (req, reply) => {
    const t0 = Date.now();
    try {
      const { range } = parseMainFilters(req.query);

      const sql = `
        SELECT
          DATE_FORMAT(p.purchase_date, '%Y-%m') AS ym,
          COUNT(*) AS total_purchases,
          COUNT(DISTINCT p.supplier_id) AS suppliers_count,
          COALESCE(SUM(${TOTAL_AMOUNT_EXPR}), 0) AS total_amount,
          COALESCE(SUM(p.quantity), 0) AS total_quantity
        FROM purchases p
        WHERE p.deleted_at IS NULL
          AND p.purchase_date BETWEEN ? AND ?
        GROUP BY DATE_FORMAT(p.purchase_date, '%Y-%m')
      `;

      const [rows] = await pool.query(sql, [range.startDate, range.endDate]);
      const data = fillMonthlyTrendGaps(rows, range.startObj, range.endObj);

      return reply.send({
        success: true,
        data,
        meta: { queryTimeMs: Date.now() - t0, rangeWarning: range.warning },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load monthly trend' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/reorder-suggestions
     Lives inside the Trends tab on the frontend, but its own
     query/route — same "one query per concern" principle as the
     rest of this file. Not date-range filtered: reorder decisions
     are about current stock state, not the selected period.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/reorder-suggestions', async (req, reply) => {
    const t0 = Date.now();
    try {
      const sql = `
        SELECT
          p.product_name, p.sold_quantity, p.purchase_date,
          ${REMAINING_EXPR} AS current_stock,
          p.low_inventory,
          COALESCE(c.name, 'Uncategorized') AS category,
          s.name AS supplier_name,
          DATEDIFF(CURDATE(), p.purchase_date) AS days_since_purchase
        FROM purchases p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.deleted_at IS NULL
          AND p.low_inventory IS NOT NULL
          AND ${REMAINING_EXPR} <= p.low_inventory
        ORDER BY ${REMAINING_EXPR} ASC
        LIMIT 30
      `;

      const [rows] = await pool.query(sql);

      const data = rows.map((r) => {
        const daysSincePurchase = Math.max(Number(r.days_since_purchase), 1);
        const avgMonthlySold = (Number(r.sold_quantity) / daysSincePurchase) * 30;
        const suggestedReorderQty = Math.max(
          Math.ceil(avgMonthlySold * 2) - Number(r.current_stock),
          Math.ceil(avgMonthlySold) || 10
        );

        return {
          product_name: r.product_name,
          category: r.category,
          current_stock: Number(r.current_stock),
          avg_monthly_sold: Math.round(avgMonthlySold),
          suggested_reorder_qty: suggestedReorderQty,
          supplier_name: r.supplier_name || 'N/A',
        };
      });

      return reply.send({
        success: true,
        data,
        meta: { queryTimeMs: Date.now() - t0 },
      });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load reorder suggestions' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/stock-alerts
     Stock Alerts tab — 3 independently paginated tables (expiring /
     low stock / dead stock). Each has its own page param and its own
     COUNT query, so switching pages on one table never touches the
     other two's data. Not date-range filtered — these are all
     live-state alerts.
     ------------------------------------------------------------ */
     fastify.get('/api/reports/purchase/stock-alerts', async (req, reply) => {
        const t0 = Date.now();
        try {
          const expiringPage = parsePage(req.query.expiring_page);
          const expiringPageSize = parsePageSize(req.query.expiring_page_size, 10);
          const expiringOffset = (expiringPage - 1) * expiringPageSize;
    
          const lowStockPage = parsePage(req.query.low_stock_page);
          const lowStockPageSize = parsePageSize(req.query.low_stock_page_size, 10);
          const lowStockOffset = (lowStockPage - 1) * lowStockPageSize;
    
          const deadStockPage = parsePage(req.query.dead_stock_page);
          const deadStockPageSize = parsePageSize(req.query.dead_stock_page_size, 10);
          const deadStockOffset = (deadStockPage - 1) * deadStockPageSize;
    
          const expiringFrom = `
            FROM purchases p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.deleted_at IS NULL
              AND p.expiry_date IS NOT NULL
              AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
              AND ${REMAINING_EXPR} > 0
          `;
          const expiringDataSql = `
            SELECT
              p.product_name, p.expiry_date,
              ${REMAINING_EXPR} AS quantity,
              ${STOCK_VALUE_EXPR} AS stock_value,
              DATEDIFF(p.expiry_date, CURDATE()) AS days_left,
              COALESCE(c.name, 'Uncategorized') AS category
            ${expiringFrom}
            ORDER BY p.expiry_date ASC
            LIMIT ? OFFSET ?
          `;
          const expiringCountSql = `SELECT COUNT(*) AS cnt ${expiringFrom}`;
    
          const lowStockFrom = `
            FROM purchases p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.deleted_at IS NULL
              AND p.low_inventory IS NOT NULL
              AND ${REMAINING_EXPR} <= p.low_inventory
          `;
          const lowStockDataSql = `
            SELECT
              p.product_name, p.low_inventory,
              ${REMAINING_EXPR} AS current_stock,
              COALESCE(c.name, 'Uncategorized') AS category,
              s.name AS supplier_name
            ${lowStockFrom}
            ORDER BY ${REMAINING_EXPR} ASC
            LIMIT ? OFFSET ?
          `;
          const lowStockCountSql = `SELECT COUNT(*) AS cnt ${lowStockFrom}`;
    
          const deadStockFrom = `
            FROM purchases p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.deleted_at IS NULL
              AND p.sold_quantity = 0
              AND p.purchase_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
              AND ${REMAINING_EXPR} > 0
          `;
          const deadStockDataSql = `
            SELECT
              p.product_name, p.purchase_date, p.sold_quantity, p.quantity,
              ${STOCK_VALUE_EXPR} AS stock_value,
              DATEDIFF(CURDATE(), p.purchase_date) AS days_since_purchase,
              COALESCE(c.name, 'Uncategorized') AS category
            ${deadStockFrom}
            ORDER BY p.purchase_date ASC
            LIMIT ? OFFSET ?
          `;
          const deadStockCountSql = `SELECT COUNT(*) AS cnt ${deadStockFrom}`;
    
          const [
            [expiringRows], [expiringCountRows],
            [lowStockRows], [lowStockCountRows],
            [deadStockRows], [deadStockCountRows],
          ] = await Promise.all([
            pool.query(expiringDataSql, [expiringPageSize, expiringOffset]),
            pool.query(expiringCountSql),
            pool.query(lowStockDataSql, [lowStockPageSize, lowStockOffset]),
            pool.query(lowStockCountSql),
            pool.query(deadStockDataSql, [deadStockPageSize, deadStockOffset]),
            pool.query(deadStockCountSql),
          ]);
    
          const expiring = expiringRows.map((r) => ({
            product_name: r.product_name,
            category: r.category,
            expiry_date: r.expiry_date,
            days_left: Number(r.days_left),
            quantity: Number(r.quantity),
            stock_value: Number(r.stock_value),
          }));
    
          const lowStock = lowStockRows.map((r) => ({
            product_name: r.product_name,
            category: r.category,
            current_stock: Number(r.current_stock),
            low_inventory: Number(r.low_inventory),
            supplier_name: r.supplier_name || 'N/A',
          }));
    
          const deadStock = deadStockRows.map((r) => ({
            product_name: r.product_name,
            category: r.category,
            purchase_date: r.purchase_date,
            days_since_purchase: Number(r.days_since_purchase),
            quantity: Number(r.quantity),
            sold_quantity: Number(r.sold_quantity),
            stock_value: Number(r.stock_value),
          }));
    
          const expiringTotal = Number(expiringCountRows[0].cnt);
          const lowStockTotal = Number(lowStockCountRows[0].cnt);
          const deadStockTotal = Number(deadStockCountRows[0].cnt);
    
          return reply.send({
            success: true,
            data: {
              expiring,
              expiringPagination: {
                current_page: expiringPage,
                last_page: Math.max(1, Math.ceil(expiringTotal / expiringPageSize)),
                total: expiringTotal,
              },
              lowStock,
              lowStockPagination: {
                current_page: lowStockPage,
                last_page: Math.max(1, Math.ceil(lowStockTotal / lowStockPageSize)),
                total: lowStockTotal,
              },
              deadStock,
              deadStockPagination: {
                current_page: deadStockPage,
                last_page: Math.max(1, Math.ceil(deadStockTotal / deadStockPageSize)),
                total: deadStockTotal,
              },
            },
            meta: { queryTimeMs: Date.now() - t0 },
          });
        } catch (err) {
          req.log.error(err);
          return reply.status(500).send({ success: false, error: 'Failed to load stock alerts' });
        }
      });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/suppliers-list
     Filter dropdown source for the Purchases tab.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/suppliers-list', async (req, reply) => {
    try {
      const [rows] = await pool.query(`
        SELECT id, name, company
        FROM suppliers
        WHERE deleted_at IS NULL
        ORDER BY name ASC
      `);

      const data = rows.map((r) => ({
        id: r.id,
        label: r.company ? `${r.name} (${r.company})` : r.name,
      }));

      return reply.send({ success: true, data });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load suppliers list' });
    }
  });

  /* ------------------------------------------------------------
     GET /api/reports/purchase/categories-list
     Filter dropdown source for the Purchases tab.
     ------------------------------------------------------------ */
  fastify.get('/api/reports/purchase/categories-list', async (req, reply) => {
    try {
      const [rows] = await pool.query(`
        SELECT id, name
        FROM categories
        WHERE deleted_at IS NULL
        ORDER BY name ASC
      `);

      return reply.send({ success: true, data: rows });
    } catch (err) {
      req.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to load categories list' });
    }
  });
}