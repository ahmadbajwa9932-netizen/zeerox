'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Pie, Doughnut } from 'react-chartjs-2';
import styles from './dashboard.module.css';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend
);

/* ============================================================
   CONSTANTS
   ============================================================ */

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'fa-chart-bar' },
  { id: 'charts', label: 'Charts', icon: 'fa-chart-line' },
  { id: 'products', label: 'Products & Customers', icon: 'fa-store' },
  { id: 'detailed', label: 'Detailed Metrics', icon: 'fa-list-alt' },
];

const DATE_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

const CATEGORY_COLORS = [
  '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40',
  '#FF6384', '#C9CBCF', '#20B2AA', '#DDA0DD', '#00CED1',
];

const PAYMENT_COLORS = {
  cash: '#007bff',
  card: '#ffc107',
  credit: '#28a745',
  advance: '#dc3545',
};

/* ============================================================
   HELPERS
   ============================================================ */

function formatNumber(value, decimals = 2) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function categoryColor(index) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

function paymentColor(type) {
  return PAYMENT_COLORS[(type || '').toLowerCase()] || '#6c757d';
}

function darken(hex, factor = 0.7) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
}

// Drops leading/trailing zero-value days (e.g. a 1-year filter applied
// to a shop that only opened in July) so the line chart doesn't render
// a flat dead stretch at the start/end.
function trimLeadingTrailingZeros(rows, valueKey) {
  let start = 0;
  let end = rows.length - 1;
  while (start < rows.length && Number(rows[start][valueKey]) === 0) start++;
  while (end >= 0 && Number(rows[end][valueKey]) === 0) end--;
  if (start > end) return [];
  return rows.slice(start, end + 1);
}

// Evenly samples down to at most maxPoints for the inline chart. The
// expand modal always gets the untouched full array instead.
function downsampleToMax(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(rows[Math.floor(i * step)]);
  }
  return result;
}

const DASHBOARD_ENDPOINTS = {
  overview: '/api/dashboard/overview',
  charts: '/api/dashboard/charts',
  products: '/api/dashboard/products',
  detailed: '/api/dashboard/detailed',
};

function buildDashboardQuery(filters) {
  const params = new URLSearchParams();
  params.set('date_range', filters.dateRange);
  if (filters.dateRange === 'custom') {
    if (filters.startDate) params.set('start_date', filters.startDate);
    if (filters.endDate) params.set('end_date', filters.endDate);
  }
  if (filters.userFilter) params.set('user_id', filters.userFilter);
  if (filters.limits) {
    if (filters.limits.products) params.set('products_limit', filters.limits.products);
    if (filters.limits.customers) params.set('customers_limit', filters.limits.customers);
    if (filters.limits.credits) params.set('credits_limit', filters.limits.credits);
  }
  return params.toString();
}

// Real call to your Fastify dashboard.js routes. `apiFetch`/rewrite proxy
// can replace this fetch() call directly if you want cookie-based auth,
// same (tab, filters, signal) signature is preserved.
async function fetchDashboardData(tab, filters, signal) {
  const endpoint = DASHBOARD_ENDPOINTS[tab];
  const query = buildDashboardQuery(filters);

  const res = await apiFetch(`${endpoint}?${query}`, { signal });

  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to load dashboard data');
  }

  return json; // { success, data, meta }
}

async function fetchUsers(signal) {
  const res = await apiFetch('/api/dashboard/users', { signal });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to load users');
  }
  return json.data; // [{ id, name, role }]
}

/* ============================================================
   SMALL PRESENTATIONAL PIECES
   ============================================================ */

function KpiCard({ id, label, value, revealed, onToggle, negative = false, note, maskable = true }) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{label}</span>
        {maskable && (
          <button
            type="button"
            className={styles.eyeBtn}
            onClick={() => onToggle(id)}
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          >
            <i className={`fa ${revealed ? 'fa-eye-slash' : 'fa-eye'}`} />
          </button>
        )}
      </div>
      <div className={`${styles.kpiValue} ${negative ? styles.kpiValueNegative : ''}`}>
        {maskable ? (revealed ? value : '\u2022\u2022\u2022\u2022\u2022\u2022') : value}
      </div>
      {note && <div className={styles.kpiNote}>{note}</div>}
    </div>
  );
}

function KpiSkeleton({ count = 6 }) {
  return (
    <div className={styles.skeletonGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.skeletonCard}>
          <div className={`${styles.skeletonLine} ${styles.skelLabel}`} />
          <div className={`${styles.skeletonLine} ${styles.skelValue}`} />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton({ count = 5 }) {
  return (
    <div className={styles.chartGrid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.chartCard}>
          <div className={`${styles.skeletonLine} ${styles.skeletonChart}`} />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className={styles.tableGrid}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={styles.tableCard}>
          <div className={`${styles.skeletonLine} ${styles.skelLabel}`} style={{ marginBottom: 16 }} />
          {Array.from({ length: 4 }).map((__, j) => (
            <div
              key={j}
              className={styles.skeletonLine}
              style={{ height: 14, marginBottom: 10, width: `${90 - j * 8}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className={styles.errorBox}>
      <span><i className="fa fa-triangle-exclamation" style={{ marginRight: 8 }} />{message}</span>
      <button type="button" className={styles.retryBtn} onClick={onRetry}>Retry</button>
    </div>
  );
}

/* ============================================================
   TAB: OVERVIEW
   ============================================================ */

   function OverviewTab({ data, revealed, onToggle }) {
    const hasReturns = data.totalReturnsAmount > 0;
    const hasCreditPending = data.totalCredit > 0 ;
  
    return (
    <div className={styles.kpiGrid}>
      <KpiCard
        id="ov-total-revenue"
        label={hasReturns ? 'Net Revenue' : 'Total Revenue'}
        value={formatPrice(data.totalRevenue)}
        revealed={revealed.has('ov-total-revenue')}
        onToggle={onToggle}
        note={hasReturns ? (
          <span className={styles.kpiNoteReturns}>
            After Returns: {revealed.has('ov-total-revenue') ? formatPrice(data.totalReturnsAmount) : '\u2022\u2022\u2022\u2022'}
          </span>
        ) : null}
      />
      {hasReturns && (
        <KpiCard
          id="ov-gross-revenue"
          label="Gross Revenue"
          value={formatPrice(data.grossRevenue)}
          revealed={revealed.has('ov-gross-revenue')}
          onToggle={onToggle}
          note="Before Returns"
        />
      )}
{hasCreditPending && (
      <KpiCard
  id="ov-revenue-no-credit"
  label="Revenue (Excl. Credit)"
  value={formatPrice(data.revenueExcludingCredit)}
  revealed={revealed.has('ov-revenue-no-credit')}
  onToggle={onToggle}
  note="Cash + Card + Advance only"
/>
)}
      <KpiCard
        id="ov-gross-profit"
        label={data.totalProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}
        value={formatPrice(Math.abs(data.totalProfit))}
        revealed={revealed.has('ov-gross-profit')}
        onToggle={onToggle}
        negative={data.totalProfit < 0}
        note="Revenue - Purchase Cost"
      />
      <KpiCard
        id="ov-net-profit"
        label={data.netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
        value={formatPrice(Math.abs(data.netProfit))}
        revealed={revealed.has('ov-net-profit')}
        onToggle={onToggle}
        negative={data.netProfit < 0}
        note="Revenue - COGS - Expenses"
      />
<KpiCard
        id="ov-service-revenue"
        label="Service Revenue"
        value={formatPrice(data.serviceRevenue)}
        revealed={revealed.has('ov-service-revenue')}
        onToggle={onToggle}
        note="From Service Category"
      />
      <KpiCard
        id="ov-tax"
        label="Tax Collected"
        value={formatPrice(data.totalTaxCollected)}
        revealed={revealed.has('ov-tax')}
        onToggle={onToggle}
        note="Total Tax Amount"
      />
      <KpiCard
        id="ov-credit"
        label={hasReturns ? 'Net Credit Pending' : 'Credit Pending'}
        value={formatPrice(data.totalCredit)}
        revealed={revealed.has('ov-credit')}
        onToggle={onToggle}
        note={hasReturns ? 'Adjusted for Returns' : null}
      />
    </div>
  );
}

/* ============================================================
   TAB: CHARTS
   ============================================================ */

   const baseChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: typeof window !== 'undefined' ? Math.max(2, window.devicePixelRatio || 1) : 2,
    plugins: { legend: { display: true, position: 'top' } },
    layout: { padding: 8 },
  };

function xTicks() {
  return { ticks: { maxRotation: 60, minRotation: 30, autoSkip: true, maxTicksLimit: 12 } };
}

function ChartsTab({ data, onExpand }) {
  // /api/dashboard/charts already returns ALL categories unpaginated —
  // we just weren't capping it for the inline view. Slice here for the
  // small chart; expand buttons below use data.revenueByCategory /
  // data.profitByCategory directly (the full list).
  const topCategories = useMemo(() => data.revenueByCategory.slice(0, 10), [data.revenueByCategory]);
  const topProfitCategories = useMemo(() => data.profitByCategory.slice(0, 10), [data.profitByCategory]);

  const categoryColors = useMemo(
    () => data.revenueByCategory.map((_, i) => categoryColor(i)),
    [data.revenueByCategory]
  );
  const categoryColorMap = useMemo(() => {
    const map = {};
    data.revenueByCategory.forEach((c, i) => { map[c.category] = categoryColors[i]; });
    return map;
  }, [data.revenueByCategory, categoryColors]);

  // Trim the no-sales padding at both ends of a wide date_range filter
  // before charting, then cap the inline chart at 20 points. Expand
  // gets the trimmed-but-full array; horizontal scroll kicks in past 30.
  const dailyTrimmed = useMemo(() => trimLeadingTrailingZeros(data.dailyRevenue, 'total'), [data.dailyRevenue]);
  const dailyDownsampled = useMemo(() => downsampleToMax(dailyTrimmed, 20), [dailyTrimmed]);

  function buildLineChart(rows, needsScroll) {
    const labels = rows.map((d) => d.date);
    return {
      data: {
        labels,
        datasets: [{
          label: 'Daily Revenue',
          data: rows.map((d) => d.total),
          borderColor: '#14b8a6',
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { ctx: canvasCtx, chartArea } = chart;
            if (!chartArea) return 'rgba(20,184,166,0.2)';
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(20,184,166,0.45)');
            gradient.addColorStop(1, 'rgba(20,184,166,0)');
            return gradient;
          },
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#14b8a6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
        }],
      },
      options: {
        ...baseChartOptions,
        responsive: !needsScroll,
        scales: {
          y: { beginAtZero: true },
          x: {
            ticks: {
              maxRotation: 60,
              minRotation: 30,
              autoSkip: needsScroll ? false : true,
              maxTicksLimit: needsScroll ? undefined : 20,
            },
          },
        },
        plugins: {
          ...baseChartOptions.plugins,
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}` } },
        },
      },
      needsScroll,
      chartWidth: needsScroll ? Math.max(labels.length * 50, 800) : undefined,
      chartHeight: 500,
    };
  }

  const dailyRevenueChart = useMemo(() => buildLineChart(dailyDownsampled, false), [dailyDownsampled]);
  const dailyRevenueExpandChart = useMemo(
    () => buildLineChart(dailyTrimmed, dailyTrimmed.length > 30),
    [dailyTrimmed]
  );

  const monthlyRevenueChart = useMemo(() => ({
    data: {
      labels: data.monthlyRevenue.map((m) => m.month),
      datasets: [{
        label: 'Monthly Revenue',
        data: data.monthlyRevenue.map((m) => m.total),
        backgroundColor: data.monthlyRevenue.map((_, i) => categoryColor(i + 3)),
      }],
    },
    options: {
      ...baseChartOptions,
      scales: { y: { beginAtZero: true }, x: xTicks() },
      plugins: {
        ...baseChartOptions.plugins,
        tooltip: { callbacks: { label: (ctx) => `Revenue: ${formatPrice(ctx.parsed.y)}` } },
      },
    },
    needsScroll: false,
    chartHeight: 500,
  }), [data.monthlyRevenue]);

  const paymentTypeChart = useMemo(() => ({
    data: {
      labels: data.salesByPaymentType.map((p) => p.payment_type),
      datasets: [{
        data: data.salesByPaymentType.map((p) => p.total),
        backgroundColor: data.salesByPaymentType.map((p) => paymentColor(p.payment_type)),
      }],
    },
    options: {
      ...baseChartOptions,
      plugins: {
        ...baseChartOptions.plugins,
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } },
      },
    },
  }), [data.salesByPaymentType]);

  function buildCategoryDoughnut(rows, needsScroll) {
    const labels = rows.map((c) => c.category);
    const colors = labels.map((name) => categoryColorMap[name] || '#cccccc');
    return {
      data: {
        labels,
        datasets: [{
          data: rows.map((c) => c.total),
          backgroundColor: colors,
        }],
      },
      options: {
        ...baseChartOptions,
        plugins: {
          ...baseChartOptions.plugins,
          legend: { display: !needsScroll, position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } },
        },
      },
      needsScroll,
      chartWidth: needsScroll ? Math.max(labels.length * 50, 800) : undefined,
      chartHeight: 500,
    };
  }

  function buildCategoryBar(rows, needsScroll) {
    const labels = rows.map((c) => c.category);
    const colors = labels.map((c) => categoryColorMap[c] || '#cccccc');
    return {
      data: {
        labels,
        datasets: [{
          label: 'Revenue',
          data: rows.map((c) => c.total),
          backgroundColor: colors,
          borderColor: colors.map((c) => darken(c)),
          borderWidth: 1,
        }],
      },
      options: {
        ...baseChartOptions,
        responsive: !needsScroll,
        scales: {
          y: { beginAtZero: true },
          x: {
            ticks: {
              maxRotation: 60,
              minRotation: 30,
              autoSkip: needsScroll ? false : true,
              maxTicksLimit: needsScroll ? undefined : 12,
            },
          },
        },
        plugins: {
          ...baseChartOptions.plugins,
          tooltip: { callbacks: { label: (ctx) => `Revenue: ${formatPrice(ctx.parsed.y)}` } },
        },
      },
      needsScroll,
      chartWidth: needsScroll ? Math.max(labels.length * 50, 800) : undefined,
      chartHeight: 500,
    };
  }

  const categoryChart = useMemo(
    () => buildCategoryDoughnut(topCategories, false),
    [topCategories, categoryColorMap]
  );
  const categoryExpandChart = useMemo(
    () => buildCategoryBar(data.revenueByCategory, data.revenueByCategory.length > 30),
    [data.revenueByCategory, categoryColorMap]
  );

  function buildProfitBar(rows, needsScroll) {
    const labels = rows.map((p) => p.category);
    const colors = labels.map((c) => categoryColorMap[c] || '#cccccc');
    return {
      data: {
        labels,
        datasets: [{
          label: 'Profit',
          data: rows.map((p) => p.profit),
          backgroundColor: colors,
          borderColor: colors.map((c) => darken(c)),
          borderWidth: 1,
        }],
      },
      options: {
        ...baseChartOptions,
        responsive: !needsScroll,
        scales: {
          y: { beginAtZero: true },
          x: {
            ticks: {
              maxRotation: 60,
              minRotation: 30,
              autoSkip: needsScroll ? false : true,
              maxTicksLimit: needsScroll ? undefined : 12,
            },
          },
        },
        plugins: {
          ...baseChartOptions.plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                return `${v < 0 ? 'Loss' : 'Profit'}: ${formatPrice(Math.abs(v))}`;
              },
            },
          },
        },
      },
      needsScroll,
      chartWidth: needsScroll ? Math.max(labels.length * 50, 800) : undefined,
      chartHeight: 500,
    };
  }

  const profitCategoryChart = useMemo(
    () => buildProfitBar(topProfitCategories, false),
    [topProfitCategories, categoryColorMap]
  );
  const profitCategoryExpandChart = useMemo(
    () => buildProfitBar(data.profitByCategory, data.profitByCategory.length > 30),
    [data.profitByCategory, categoryColorMap]
  );

  const charts = [
    { id: 'daily', title: 'Daily Revenue', cfg: dailyRevenueChart, expandCfg: dailyRevenueExpandChart, Comp: Line, expandComp: Line, expandable: true },
    { id: 'monthly', title: 'Monthly Revenue', cfg: monthlyRevenueChart, expandCfg: monthlyRevenueChart, Comp: Bar, expandComp: Bar, expandable: true },
    { id: 'payment', title: 'Revenue by Payment Type', cfg: paymentTypeChart, Comp: Pie, expandable: false },
    { id: 'category', title: 'Revenue by Category', cfg: categoryChart, expandCfg: categoryExpandChart, Comp: Doughnut, expandComp: Bar, expandable: true },
    { id: 'profitCategory', title: 'Profit by Category', cfg: profitCategoryChart, expandCfg: profitCategoryExpandChart, Comp: Bar, expandComp: Bar, expandable: true },
  ];

  return (
    <div className={styles.chartGrid}>
           {charts.map(({ id, title, cfg, expandCfg, Comp, expandComp, expandable }) => (
        <div className={styles.chartCard} key={id}>
          <div className={styles.chartCardHead}>
            <h4 className={styles.chartTitle}>{title}</h4>
            {expandable && (
              <button
                type="button"
                className={styles.expandBtn}
                onClick={() => onExpand({ id, title, cfg: expandCfg || cfg, Comp: expandComp || Comp })}
                aria-label={`Expand ${title}`}
              >
                <i className="fa fa-search-plus" />
              </button>
            )}
          </div>
          <div className={styles.chartContainer}>
            <Comp data={cfg.data} options={cfg.options} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartModal({ chart, onClose }) {
  if (!chart) return null;
  const { title, cfg, Comp } = chart;
  const needsScroll = !!cfg.needsScroll;
  const expandedOptions = {
    ...cfg.options,
    plugins: {
      ...cfg.options.plugins,
      legend: {
        ...(cfg.options.plugins?.legend || {}),
        position: cfg.options.plugins?.legend?.position || 'top',
      },
    },
  };
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
          <i className="fa fa-times" />
        </button>
        <h3 className={styles.modalTitle}>{title}</h3>
        <div className={styles.modalChartWrap} style={{ overflowX: needsScroll ? 'auto' : 'hidden' }}>
        <Comp
            data={cfg.data}
            options={{ ...expandedOptions, maintainAspectRatio: false, responsive: !needsScroll }}
            width={cfg.chartWidth}
            height={cfg.chartHeight}
            redraw
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TAB: PRODUCTS & CUSTOMERS
   ============================================================ */

function ProductsTab({ data, limits, onLimitChange }) {
  const products = data.topProducts.slice(0, limits.products);
  const customers = data.topCustomers.slice(0, limits.customers);
  const credits = data.outstandingCredits.slice(0, limits.credits);
  const { new: newCustomers, repeat: repeatCustomers, credit: creditCustomers, advance: advanceCustomers, totalAll: totalCustomersAll } = data.customerTypes;
  const totalCustomers = newCustomers + repeatCustomers;
  const newPct = totalCustomers ? ((newCustomers / totalCustomers) * 100).toFixed(1) : '0.0';
  const repeatPct = totalCustomers ? ((repeatCustomers / totalCustomers) * 100).toFixed(1) : '0.0';
  const creditPct = totalCustomersAll ? ((creditCustomers / totalCustomersAll) * 100).toFixed(1) : '0.0';
  const advancePct = totalCustomersAll ? ((advanceCustomers / totalCustomersAll) * 100).toFixed(1) : '0.0';

  return (
    <div className={styles.tableGrid}>
      <div className={styles.tableCard}>
        <div className={styles.tableCardHead}>
          <h4 className={styles.chartTitle}>Top Selling Products</h4>
          <select
            className={styles.limitSelect}
            value={limits.products}
            onChange={(e) => onLimitChange('products', Number(e.target.value))}
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={15}>Top 15</option>
          </select>
        </div>
        <table className={styles.dashTable}>
          <thead>
            <tr ><th>Product</th><th>Quantity Sold</th><th>Unit</th></tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={3} className={styles.emptyRow}>No product data for this period</td></tr>
            ) : products.map((p, i) => (
              <tr key={i}>
                <td title={p.product_name}>{p.product_name}</td>
                <td>{formatNumber(p.total_qty, 0)}</td>
                <td>{p.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableCardHead}>
          <h4 className={styles.chartTitle}>Top Customers</h4>
          <select
            className={styles.limitSelect}
            value={limits.customers}
            onChange={(e) => onLimitChange('customers', Number(e.target.value))}
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={15}>Top 15</option>
          </select>
        </div>
        <table className={styles.dashTable}>
          <thead>
            <tr><th>Customer</th><th>Total Spent</th></tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr><td colSpan={2} className={styles.emptyRow}>No customer data for this period</td></tr>
            ) : customers.map((c, i) => (
              <tr key={i}>
                <td>{c.customer ? c.customer.name : 'Walk-in Customer'}</td>
                <td>{formatPrice(c.total_spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableCardHead}>
          <h4 className={styles.chartTitle}>Outstanding Credits</h4>
          <select
            className={styles.limitSelect}
            value={limits.credits}
            onChange={(e) => onLimitChange('credits', Number(e.target.value))}
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={15}>Top 15</option>
          </select>
        </div>
        <table className={styles.dashTable}>
          <thead>
            <tr><th>Customer</th><th>Outstanding Amount</th></tr>
          </thead>
          <tbody>
            {credits.length === 0 ? (
              <tr><td colSpan={2} className={styles.emptyRow}>No outstanding credit</td></tr>
            ) : credits.map((c, i) => (
              <tr key={i}>
                <td>{c.customer ? c.customer.name : 'Walk-in Customer'}</td>
                <td>{formatPrice(c.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.tableCard}>
        <h4 className={styles.chartTitle} style={{ marginBottom: 12 }}>Customer Analysis</h4>
        <table className={styles.dashTable}>
          <thead>
            <tr><th>Customer Type</th><th>Count</th><th>Percentage</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className={styles.dotCell}>
                  <span className={styles.dot} style={{ background: '#28a745' }} />
                  New Customers
                </span>
              </td>
              <td>{newCustomers}</td>
              <td>
                {newPct}%
                <div className={styles.analysisBarTrack}>
                  <div className={styles.analysisBarFill} style={{ width: `${newPct}%`, background: '#28a745' }} />
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <span className={styles.dotCell}>
                  <span className={styles.dot} style={{ background: '#ffc107' }} />
                  Repeat Customers
                </span>
              </td>
              <td>{repeatCustomers}</td>
              <td>
                {repeatPct}%
                <div className={styles.analysisBarTrack}>
                  <div className={styles.analysisBarFill} style={{ width: `${repeatPct}%`, background: '#ffc107' }} />
                </div>
              </td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total Customers</td>
              <td>{totalCustomers}</td>
              <td>100%</td>
            </tr>
            <tr>
              <td>
                <span className={styles.dotCell}>
                  <span className={styles.dot} style={{ background: '#17a2b8' }} />
                  Credit Customers
                </span>
              </td>
              <td>{creditCustomers}</td>
              <td>
                {creditPct}%
                <div className={styles.analysisBarTrack}>
                  <div className={styles.analysisBarFill} style={{ width: `${creditPct}%`, background: '#17a2b8' }} />
                </div>
              </td>
            </tr>
            <tr>
              <td>
                <span className={styles.dotCell}>
                  <span className={styles.dot} style={{ background: '#6f42c1' }} />
                  Advance Customers
                </span>
              </td>
              <td>{advanceCustomers}</td>
              <td>
                {advancePct}%
                <div className={styles.analysisBarTrack}>
                  <div className={styles.analysisBarFill} style={{ width: `${advancePct}%`, background: '#6f42c1' }} />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
   TAB: DETAILED METRICS
   ============================================================ */

function DetailedTab({ data, revealed, onToggle }) {
  const hasReturns = data.totalReturnsAmount > 0;

  return (
    <div className={styles.kpiGrid}>
      <KpiCard
        id="dt-total-revenue"
        label={hasReturns ? 'Net Revenue' : 'Total Revenue'}
        value={formatPrice(data.totalRevenue)}
        revealed={revealed.has('dt-total-revenue')}
        onToggle={onToggle}
      />
      {hasReturns && (
        <KpiCard
          id="dt-gross-revenue"
          label="Gross Revenue"
          value={formatPrice(data.grossRevenue)}
          revealed={revealed.has('dt-gross-revenue')}
          onToggle={onToggle}
          note="Before Returns"
        />
      )}
      <KpiCard
        id="dt-gross-profit"
        label={data.totalProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}
        value={formatPrice(Math.abs(data.totalProfit))}
        revealed={revealed.has('dt-gross-profit')}
        onToggle={onToggle}
        negative={data.totalProfit < 0}
      />
      <KpiCard
        id="dt-net-profit"
        label={data.netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
        value={formatPrice(Math.abs(data.netProfit))}
        revealed={revealed.has('dt-net-profit')}
        onToggle={onToggle}
        negative={data.netProfit < 0}
      />
      <KpiCard
        id="dt-total-all-purchases"
        label="Total All Purchases"
        value={formatPrice(data.totalAllPurchases)}
        revealed={revealed.has('dt-total-all-purchases')}
        onToggle={onToggle}
        note="All Items (Sold + Unsold)"
      />
      <KpiCard
        id="dt-inventory-cost"
        label="Available Inventory Cost"
        value={formatPrice(data.availableInventoryCost)}
        revealed={revealed.has('dt-inventory-cost')}
        onToggle={onToggle}
        note="Unsold + Returned Items"
      />
       <KpiCard
        id="dt-sold-cost"
        label="Sold Items Cost"
        value={formatPrice(data.soldItemsCost)}
        revealed={revealed.has('dt-sold-cost')}
        onToggle={onToggle}
        note="Cost of Revenue-Generated Items"
      />

      <KpiCard id="gross-margin" maskable={false} label="Gross Margin" value={`${formatNumber(data.grossMargin, 1)}%`} note="(Revenue - COGS) / Revenue" />
      <KpiCard id="net-margin" maskable={false} label="Net Margin" value={`${formatNumber(data.netMargin, 1)}%`} note="Net Profit / Revenue" />
      <KpiCard id="total-invoices" maskable={false} label="Total Transactions" value={formatNumber(data.totalInvoices, 0)} note="Revenue-Generating Sales" />
      <KpiCard id="aov" maskable={false} label="Average Order Value" value={formatPrice(data.averageOrderValue)} note="Revenue per Transaction" />
      <KpiCard id="items-sold" maskable={false} label="Items Sold" value={formatNumber(data.totalItemsSold, 0)} note="Total Quantity Sold" />
      <KpiCard id="returns" maskable={false} label="Returns/Refunds" value={formatPrice(data.totalReturnsAmount)} note="Value of Returns" />
      <KpiCard id="collection-ratio" maskable={false} label="Collection Ratio" value={`${formatNumber(data.paymentCollectionRatio, 1)}%`} note="Cash Flow Health" />
      <KpiCard id="tax" maskable={false} label="Tax Collected" value={formatPrice(data.totalTaxCollected)} note="Total Tax Amount" />
      <KpiCard id="advance" maskable={false} label="Advance Amount" value={formatPrice(data.totalAdvance)} note="After Returns & Discounts" />
    </div>
  );
}

/* ============================================================
   MAIN PAGE
   ============================================================ */

export default function RevenueDashboardPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [mountedTabs, setMountedTabs] = useState({ overview: true, charts: false, products: false, detailed: false });
  const [loadedTabs, setLoadedTabs] = useState({ overview: false, charts: false, products: false, detailed: false });
  const [loadingTabs, setLoadingTabs] = useState({ overview: true, charts: false, products: false, detailed: false });
  const [errorTabs, setErrorTabs] = useState({ overview: null, charts: null, products: null, detailed: null });
  const [tabData, setTabData] = useState({ overview: null, charts: null, products: null, detailed: null });

  const [dateRange, setDateRange] = useState('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [rangeWarning, setRangeWarning] = useState('');

  const [limits, setLimits] = useState({ products: 5, customers: 5, credits: 5 });
  const [users, setUsers] = useState([]);
  const [revealed, setRevealed] = useState(() => new Set());
  const [expandedChart, setExpandedChart] = useState(null);

  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  const filters = useMemo(
    () => ({ dateRange, startDate, endDate, userFilter, limits }),
    [dateRange, startDate, endDate, userFilter, limits]
  );

  const loadTab = useCallback(async (tabId, currentFilters) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, [tabId]: true }));
    setErrorTabs((prev) => ({ ...prev, [tabId]: null }));

    try {
      const result = await fetchDashboardData(tabId, currentFilters, controller.signal);
      setTabData((prev) => ({ ...prev, [tabId]: result.data }));
      setLoadedTabs((prev) => ({ ...prev, [tabId]: true }));
      setMountedTabs((prev) => ({ ...prev, [tabId]: true }));
      if (result.meta?.rangeWarning) setRangeWarning(result.meta.rangeWarning);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setErrorTabs((prev) => ({ ...prev, [tabId]: 'Could not load this data. Please try again.' }));
    } finally {
      setLoadingTabs((prev) => ({ ...prev, [tabId]: false }));
    }
  }, []);

  // Initial load
useEffect(() => {
  loadTab('overview', filters);
  return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

// Load real users for the filter dropdown
useEffect(() => {
  const controller = new AbortController();
  fetchUsers(controller.signal)
    .then(setUsers)
    .catch((err) => {
      if (err?.name !== 'AbortError') {
        console.error('Failed to load users', err);
      }
    });
  return () => controller.abort();
}, []);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setMountedTabs((prev) => ({ ...prev, [tabId]: true }));
    if (!loadedTabs[tabId]) {
      loadTab(tabId, filters);
    }
  };

  const validateCustomRange = (start, end) => {
    if (!start || !end) return { start, warning: '' };
    const s = new Date(start);
    const e = new Date(end);
    const diffDays = (e - s) / (1000 * 60 * 60 * 24);
    if (diffDays > 365) {
      const corrected = new Date(e);
      corrected.setFullYear(corrected.getFullYear() - 1);
      corrected.setDate(corrected.getDate() + 1);
      return {
        start: `${corrected.getFullYear()}-${String(corrected.getMonth() + 1).padStart(2, '0')}-${String(corrected.getDate()).padStart(2, '0')}`,
        warning: 'Custom range is limited to 1 year. Start date adjusted automatically.',
      };
    }
    return { start, warning: '' };
  };

  const applyFilters = useCallback((nextFilters) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoadedTabs({ overview: false, charts: false, products: false, detailed: false });
      setTabData({ overview: null, charts: null, products: null, detailed: null });
      loadTab(activeTab, nextFilters);
    }, 300);
  }, [activeTab, loadTab]);

  const handleDateRangeChange = (value) => {
    setDateRange(value);
    if (value !== 'custom') {
      applyFilters({ ...filters, dateRange: value });
    }
  };

  const handleCustomDateChange = (which, value) => {
    if (which === 'start') setStartDate(value);
    else setEndDate(value);

    const nextStart = which === 'start' ? value : startDate;
    const nextEnd = which === 'end' ? value : endDate;
    const { start: correctedStart, warning } = validateCustomRange(nextStart, nextEnd);
    if (correctedStart !== nextStart) setStartDate(correctedStart);
    setRangeWarning(warning);

    if (correctedStart && nextEnd) {
      applyFilters({ ...filters, dateRange: 'custom', startDate: correctedStart, endDate: nextEnd });
    }
  };

  const handleUserFilterChange = (value) => {
    setUserFilter(value);
    applyFilters({ ...filters, userFilter: value });
  };

  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLimitChange = (which, value) => {
    const nextLimits = { ...limits, [which]: value };
    setLimits(nextLimits);
    applyFilters({ ...filters, limits: nextLimits });
  };

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const retryTab = (tabId) => loadTab(tabId, filters);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <i className={`fa fa-tachometer-alt ${styles.titleIcon}`} />
          <h2 className={styles.title}>Revenue Dashboard</h2>
        </div>
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterCol}>
          <label className={styles.filterLabel} htmlFor="dateRange">Date Range</label>
          <select
            id="dateRange"
            className={styles.filterSelect}
            value={dateRange}
            onChange={(e) => handleDateRangeChange(e.target.value)}
          >
            {DATE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {dateRange === 'custom' && (
          <>
            <div className={styles.filterCol}>
              <label className={styles.filterLabel} htmlFor="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                className={styles.filterInput}
                value={startDate}
                max={todayStr}
                onChange={(e) => handleCustomDateChange('start', e.target.value)}
              />
            </div>
            <div className={styles.filterCol}>
              <label className={styles.filterLabel} htmlFor="endDate">End Date</label>
              <input
                id="endDate"
                type="date"
                className={styles.filterInput}
                value={endDate}
                max={todayStr}
                onChange={(e) => handleCustomDateChange('end', e.target.value)}
              />
            </div>
          </>
        )}

        <div className={styles.filterCol}>
          <label className={styles.filterLabel} htmlFor="userFilter">User</label>
          <select
  id="userFilter"
  className={styles.filterSelect}
  value={userFilter}
  onChange={(e) => handleUserFilterChange(e.target.value)}
>
  <option value="">All Users</option>
  {users.map((u) => (
    <option key={u.id} value={u.id}>
      {u.name}{u.role ? ` (${u.role.charAt(0).toUpperCase() + u.role.slice(1)})` : ''}
    </option>
  ))}
</select>
        </div>

        {rangeWarning && <div className={styles.rangeWarning}>{rangeWarning}</div>}
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <i className={`fa ${tab.icon}`} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {mountedTabs.overview && (
        <div className={styles.tabPanel} style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
          {loadingTabs.overview && !tabData.overview && <KpiSkeleton count={7} />}
          {errorTabs.overview && <ErrorState message={errorTabs.overview} onRetry={() => retryTab('overview')} />}
          {tabData.overview && !errorTabs.overview && (
            <OverviewTab data={tabData.overview} revealed={revealed} onToggle={toggleReveal} />
          )}
        </div>
      )}

      {/* Charts */}
      {mountedTabs.charts && (
        <div className={styles.tabPanel} style={{ display: activeTab === 'charts' ? 'block' : 'none' }}>
          {loadingTabs.charts && !tabData.charts && <ChartSkeleton />}
          {errorTabs.charts && <ErrorState message={errorTabs.charts} onRetry={() => retryTab('charts')} />}
          {tabData.charts && !errorTabs.charts && (
            <ChartsTab data={tabData.charts} onExpand={setExpandedChart} />
          )}
        </div>
      )}

      {/* Products & Customers */}
      {mountedTabs.products && (
        <div className={styles.tabPanel} style={{ display: activeTab === 'products' ? 'block' : 'none' }}>
          {loadingTabs.products && !tabData.products && <TableSkeleton />}
          {errorTabs.products && <ErrorState message={errorTabs.products} onRetry={() => retryTab('products')} />}
          {tabData.products && !errorTabs.products && (
            <ProductsTab data={tabData.products} limits={limits} onLimitChange={handleLimitChange} />
          )}
        </div>
      )}

      {/* Detailed Metrics */}
      {mountedTabs.detailed && (
        <div className={styles.tabPanel} style={{ display: activeTab === 'detailed' ? 'block' : 'none' }}>
          {loadingTabs.detailed && !tabData.detailed && <KpiSkeleton count={17} />}
          {errorTabs.detailed && <ErrorState message={errorTabs.detailed} onRetry={() => retryTab('detailed')} />}
          {tabData.detailed && !errorTabs.detailed && (
            <DetailedTab data={tabData.detailed} revealed={revealed} onToggle={toggleReveal} />
          )}
        </div>
      )}

      <ChartModal chart={expandedChart} onClose={() => setExpandedChart(null)} />
    </div>
  );
}