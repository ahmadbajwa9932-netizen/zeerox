'use client';

/* ============================================================
   DASHBOARD V2 — BUSINESS OVERVIEW
   ------------------------------------------------------------
   Same backend, same visual language as the report pages
   (flat white cards, navy accent, no gradients). What is new
   is the STRUCTURE:

     - one continuous page instead of /dashboard's four tabs,
       so nothing is hidden behind a click
     - all four endpoints load together in one pass
     - a wider metric set (expenses, margins, collection ratio)
     - category profitability, not just category revenue
     - every chart carries a table view of the same numbers

   Backend is untouched. This page consumes the existing:
     GET /api/dashboard/users
     GET /api/dashboard/overview
     GET /api/dashboard/charts
     GET /api/dashboard/products
     GET /api/dashboard/detailed
   ============================================================ */

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
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import styles from './dashboardV2.module.css';
import { apiFetch } from '@/lib/api';
import { formatPrice, getCurrency } from '@/lib/currency-context';

/* `Legend` is intentionally not registered — legends here are plain HTML
   so they can show a value next to each key. */
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip
);

/* ============================================================
   CONSTANTS
   ============================================================ */

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

const RANGE_LABEL = DATE_RANGES.reduce((acc, r) => {
  acc[r.value] = r.label;
  return acc;
}, {});

const TOP_N = [5, 10, 15];

/* Report-page tokens, mirrored here so canvas drawing matches the CSS. */
const C = {
  text: '#1c1e21',
  muted: '#6b6f76',
  faint: '#9799a1',
  border: '#e4e5e9',
  borderStrong: '#d3d5da',
  surface: '#ffffff',
  accent: '#1b2a41',
  success: '#2f7a4d',
  danger: '#b3413a',
  warning: '#a86a1d',
  info: '#2f7a94',
};

/* Chart series — validated against a white surface.
   revenue/profit pass all-pairs; the four payment hues pass every
   adjacent gate. Re-validate the set before editing a hex. */
const SERIES = {
  revenue: '#2a78d6',
  profit: '#2f7a4d',
};

const PAYMENT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

const ENDPOINTS = {
  overview: '/api/dashboard/overview',
  charts: '/api/dashboard/charts',
  products: '/api/dashboard/products',
  detailed: '/api/dashboard/detailed',
};

/* ============================================================
   HELPERS
   ============================================================ */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => formatPrice(num(v));

function compactNum(v) {
  const n = num(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const pct = (v, digits = 1) => `${num(v).toFixed(digits)}%`;
const count = (v) => num(v).toLocaleString('en-US', { maximumFractionDigits: 0 });

/* Share of a base, clamped to 0–100 for bar widths. */
function share(part, whole) {
  const w = Math.abs(num(whole));
  if (!w) return 0;
  return Math.max(0, Math.min(100, (Math.abs(num(part)) / w) * 100));
}

function hexA(hex, alpha) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgba(${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(
    full.slice(4, 6),
    16
  )}, ${alpha})`;
}

const sum = (rows, key = 'total') => rows.reduce((acc, r) => acc + num(r[key]), 0);

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Mirrors the backend's 365-day clamp so the warning appears before the call. */
function clampCustomRange(start, end) {
  if (!start || !end) return { start, warning: '' };
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { start, warning: '' };
  if ((e - s) / 86400000 <= 365) return { start, warning: '' };
  const corrected = new Date(e);
  corrected.setFullYear(corrected.getFullYear() - 1);
  corrected.setDate(corrected.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return {
    start: `${corrected.getFullYear()}-${p(corrected.getMonth() + 1)}-${p(corrected.getDate())}`,
    warning: 'Custom range is limited to 1 year. Start date adjusted automatically.',
  };
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  params.set('date_range', filters.dateRange);
  if (filters.dateRange === 'custom') {
    if (filters.startDate) params.set('start_date', filters.startDate);
    if (filters.endDate) params.set('end_date', filters.endDate);
  }
  if (filters.userFilter) params.set('user_id', filters.userFilter);
  params.set('products_limit', filters.topN);
  params.set('customers_limit', filters.topN);
  params.set('credits_limit', filters.topN);
  return params.toString();
}

async function getJson(path, signal) {
  const res = await apiFetch(path, { signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request was not successful');
  return json;
}

/* ============================================================
   SHARED CHART CHROME
   ============================================================ */

const TOOLTIP = {
  backgroundColor: '#ffffff',
  titleColor: C.muted,
  bodyColor: C.text,
  borderColor: C.borderStrong,
  borderWidth: 1,
  cornerRadius: 4,
  padding: 10,
  boxWidth: 12,
  boxHeight: 2,
  boxPadding: 6,
  titleFont: { size: 11, weight: '600' },
  bodyFont: { size: 12.5, weight: '600' },
};

const MONEY_AXIS = {
  beginAtZero: true,
  grid: { color: C.border, drawTicks: false },
  border: { display: false },
  ticks: { color: C.muted, padding: 8, callback: (v) => compactNum(v) },
};

const CATEGORY_AXIS = {
  grid: { display: false },
  border: { color: C.borderStrong },
  ticks: { color: C.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 9 },
};

/* Vertical hairline that follows the pointer on the trend chart. */
const crosshairPlugin = {
  id: 'dv2Crosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length || !chart.chartArea) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.borderStrong;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/* ============================================================
   SMALL PIECES
   ============================================================ */

function MetricCard({ icon, iconColor, label, value, valueClass, note, badge, badgeClass }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricHead}>
        <i className={`fas ${icon} ${styles.metricIcon}`} style={{ color: iconColor }} aria-hidden="true" />
        <span className={styles.metricLabel}>{label}</span>
      </div>
      <p className={`${styles.metricValue} ${valueClass || ''}`}>{value}</p>
      {badge ? (
        <span className={`${styles.metricBadge} ${badgeClass || styles.badgeNeutral}`}>{badge}</span>
      ) : note ? (
        <span className={styles.metricNote}>{note}</span>
      ) : null}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className={styles.empty}>
      <i className="fas fa-chart-bar" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

/* A chart card and the table view of the same numbers. */
function ChartCard({ title, subtitle, col, isEmpty, emptyText, chart, table, legend, footnote }) {
  const [view, setView] = useState('chart');

  return (
    <div className={`${styles.contentCard} ${col ? styles[col] : ''}`}>
      <div className={styles.cardHeader}>
        <div>
          <h5 className={styles.cardHeaderTitle}>{title}</h5>
          {subtitle && <p className={styles.cardHeaderSub}>{subtitle}</p>}
        </div>
        {!isEmpty && (
          <div className={styles.headerControls}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${view === 'chart' ? styles.toggleBtnActive : ''}`}
              onClick={() => setView('chart')}
              aria-pressed={view === 'chart'}
              title="Chart view"
            >
              <i className="fas fa-chart-column" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${view === 'table' ? styles.toggleBtnActive : ''}`}
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              title="Table view"
            >
              <i className="fas fa-table" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className={styles.cardBody}>
        {isEmpty ? (
          <Empty text={emptyText} />
        ) : view === 'chart' ? (
          <>
            {chart}
            {legend}
            {footnote && <p className={styles.chartFootnote}>{footnote}</p>}
          </>
        ) : (
          <div className={styles.tableWrap}>{table}</div>
        )}
      </div>
    </div>
  );
}

function LegendItem({ color, label, value, shape }) {
  return (
    <span className={styles.legendItem}>
      <span
        className={shape === 'line' ? styles.legendKeyLine : styles.legendKey}
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className={styles.legendLabel}>{label}</span>
      {value !== undefined && <span className={styles.legendValue}>{value}</span>}
    </span>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>
        <i className={`fas ${icon}`} aria-hidden="true" />
        {label}
      </span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className={styles.metricGrid}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${styles.skeleton} ${styles.skelMetric}`} />
        ))}
      </div>
      <div className={styles.metricGrid}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${styles.skeleton} ${styles.skelMetric}`} />
        ))}
      </div>
      <div className={styles.chartRow}>
        <div className={`${styles.skeleton} ${styles.skelCard} ${styles.col7}`} />
        <div className={`${styles.skeleton} ${styles.skelCard} ${styles.col5}`} />
      </div>
    </>
  );
}

/* ============================================================
   PAGE
   ============================================================ */

export default function DashboardV2Page() {
  const [dateRange, setDateRange] = useState('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [topN, setTopN] = useState(5);

  const [users, setUsers] = useState([]);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState('');
  const [rangeWarning, setRangeWarning] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const firstLoadRef = useRef(true);

  const currencySymbol = getCurrency().currency_symbol;

  const filters = useMemo(
    () => ({ dateRange, startDate, endDate, userFilter, topN }),
    [dateRange, startDate, endDate, userFilter, topN]
  );

  /* ---------- data ---------- */

  const load = useCallback(async (nextFilters) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (firstLoadRef.current) setLoading(true);
    else setRefetching(true);
    setError('');

    const query = buildQuery(nextFilters);

    try {
      const results = await Promise.all(
        Object.entries(ENDPOINTS).map(async ([key, path]) => [
          key,
          await getJson(`${path}?${query}`, controller.signal),
        ])
      );

      if (controller.signal.aborted) return;

      const next = {};
      let slowest = 0;
      let warning = '';
      for (const [key, json] of results) {
        next[key] = json.data;
        slowest = Math.max(slowest, num(json.meta?.queryTimeMs));
        if (json.meta?.rangeWarning) warning = json.meta.rangeWarning;
      }

      setData(next);
      setMeta({ queryTimeMs: slowest });
      setRangeWarning(warning);
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || 'Failed to load dashboard data');
    } finally {
      if (!controller.signal.aborted) {
        firstLoadRef.current = false;
        setLoading(false);
        setRefetching(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getJson('/api/dashboard/users', controller.signal)
      .then((json) => setUsers(json.data || []))
      .catch(() => setUsers([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (dateRange === 'custom' && (!startDate || !endDate)) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(filters), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, dateRange, startDate, endDate, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---------- filter handlers ---------- */

  const handleRangeChange = (value) => {
    setDateRange(value);
    if (value === 'custom' && !startDate && !endDate) {
      const t = todayISO();
      setStartDate(t);
      setEndDate(t);
    }
  };

  const handleCustomDate = (which, value) => {
    const nextStart = which === 'start' ? value : startDate;
    const nextEnd = which === 'end' ? value : endDate;
    const { start, warning } = clampCustomRange(nextStart, nextEnd);
    setStartDate(start);
    setEndDate(nextEnd);
    setRangeWarning(warning);
  };

  /* ---------- derived ---------- */

  const overview = data?.overview;
  const charts = data?.charts;
  const products = data?.products;
  const detailed = data?.detailed;

  const dailyRevenue = charts?.dailyRevenue || [];
  const monthlyRevenue = charts?.monthlyRevenue || [];
  const paymentTypes = charts?.salesByPaymentType || [];
  const revenueByCategory = charts?.revenueByCategory || [];
  const profitByCategory = charts?.profitByCategory || [];

  /* Exact identity exposed by the API: netProfit = totalProfit − expenses. */
  const operatingExpenses = detailed ? num(detailed.totalProfit) - num(detailed.netProfit) : 0;

  const categoryRows = useMemo(() => {
    const profitByName = new Map(profitByCategory.map((r) => [r.category, num(r.profit)]));
    const rows = revenueByCategory.map((r) => ({
      category: r.category,
      revenue: num(r.total),
      profit: num(profitByName.get(r.category)),
    }));
    rows.sort((a, b) => b.revenue - a.revenue);
    if (rows.length <= 8) return rows;
    const head = rows.slice(0, 7);
    const tail = rows.slice(7);
    head.push({
      category: `Other (${tail.length})`,
      revenue: tail.reduce((a, r) => a + r.revenue, 0),
      profit: tail.reduce((a, r) => a + r.profit, 0),
    });
    return head;
  }, [revenueByCategory, profitByCategory]);

  const paymentTotal = useMemo(() => sum(paymentTypes), [paymentTypes]);
  const paymentHasNegative = useMemo(() => paymentTypes.some((p) => num(p.total) < 0), [paymentTypes]);

  const topProducts = products?.topProducts || [];
  const topCustomers = products?.topCustomers || [];
  const outstandingCredits = products?.outstandingCredits || [];
  const customerTypes = products?.customerTypes;

  const maxProductQty = Math.max(1, ...topProducts.map((p) => num(p.total_qty)));
  const maxCustomerSpend = Math.max(1, ...topCustomers.map((c) => num(c.total_spent)));
  const maxCredit = Math.max(1, ...outstandingCredits.map((c) => num(c.outstanding)));

  /* new/repeat count buyers inside the period; credit/advance/total are
     all-time account counts, so only new vs repeat share one bar. */
  const periodBuyers = customerTypes ? num(customerTypes.new) + num(customerTypes.repeat) : 0;

  /* ---------- chart configs ---------- */

  const dailyData = useMemo(
    () => ({
      labels: dailyRevenue.map((r) => r.date),
      datasets: [
        {
          label: 'Net Revenue',
          data: dailyRevenue.map((r) => num(r.total)),
          borderColor: SERIES.revenue,
          backgroundColor: hexA(SERIES.revenue, 0.1),
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: SERIES.revenue,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          fill: true,
        },
      ],
    }),
    [dailyRevenue]
  );

  const dailyOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { x: CATEGORY_AXIS, y: MONEY_AXIS },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: (ctx) => ` ${money(ctx.parsed.y)}` } },
      },
    }),
    []
  );

  const monthlyData = useMemo(
    () => ({
      labels: monthlyRevenue.map((r) => r.month),
      datasets: [
        {
          label: 'Net Revenue',
          data: monthlyRevenue.map((r) => num(r.total)),
          backgroundColor: SERIES.revenue,
          borderRadius: 3,
          borderSkipped: 'bottom',
          maxBarThickness: 26,
          categoryPercentage: 0.8,
          barPercentage: 0.85,
        },
      ],
    }),
    [monthlyRevenue]
  );

  const monthlyOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { x: CATEGORY_AXIS, y: MONEY_AXIS },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: (ctx) => ` ${money(ctx.parsed.y)}` } },
      },
    }),
    []
  );

  /* A doughnut cannot draw a negative arc (cash nets off walk-in returns and
     can go below zero), so the ring uses the positive part while the legend
     and table always carry the true signed figure. */
  const donutData = useMemo(
    () => ({
      labels: paymentTypes.map((p) => p.payment_type),
      datasets: [
        {
          data: paymentTypes.map((p) => Math.max(0, num(p.total))),
          backgroundColor: PAYMENT_COLORS,
          borderColor: '#ffffff',
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    }),
    [paymentTypes]
  );

  const donutOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '66%',
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => ` ${money(paymentTypes[ctx.dataIndex]?.total)} · ${ctx.label}`,
          },
        },
      },
    }),
    [paymentTypes]
  );

  const categoryData = useMemo(
    () => ({
      labels: categoryRows.map((r) => r.category),
      datasets: [
        {
          label: 'Revenue',
          data: categoryRows.map((r) => r.revenue),
          backgroundColor: SERIES.revenue,
          borderRadius: 3,
          borderSkipped: 'start',
          maxBarThickness: 14,
          categoryPercentage: 0.72,
          barPercentage: 0.9,
        },
        {
          label: 'Profit',
          data: categoryRows.map((r) => r.profit),
          backgroundColor: SERIES.profit,
          borderRadius: 3,
          borderSkipped: 'start',
          maxBarThickness: 14,
          categoryPercentage: 0.72,
          barPercentage: 0.9,
        },
      ],
    }),
    [categoryRows]
  );

  const categoryOptions = useMemo(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: C.border, drawTicks: false },
          border: { display: false },
          ticks: { color: C.muted, callback: (v) => compactNum(v) },
        },
        y: {
          grid: { display: false },
          border: { color: C.borderStrong },
          ticks: { color: C.text, crossAlign: 'far', font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: { label: (ctx) => ` ${money(ctx.parsed.x)} · ${ctx.dataset.label}` },
        },
      },
    }),
    []
  );

  /* ---------- revenue-to-profit stages ---------- */

  const stages = useMemo(() => {
    if (!overview) return [];
    const base = Math.abs(num(overview.grossRevenue)) || 1;
    return [
      { label: 'Gross Revenue', value: overview.grossRevenue, color: SERIES.revenue },
      { label: 'Net Revenue', value: overview.totalRevenue, color: SERIES.revenue },
      { label: 'Gross Profit', value: overview.totalProfit, color: SERIES.profit },
      { label: 'Operating Expenses', value: operatingExpenses, color: C.warning },
      { label: 'Net Profit', value: overview.netProfit, color: SERIES.profit, final: true },
    ].map((s) => ({ ...s, ratio: Math.max(3, share(s.value, base)) }));
  }, [overview, operatingExpenses]);

  const staleClass = refetching ? styles.stale : '';
  const netProfitPositive = num(overview?.netProfit) >= 0;

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <div className="container">
      <div className={styles.page}>
        {/* Header — same pattern as the report pages */}
        <div className="main-text">
          <h2><i className="fas fa-gauge-high" /> Business Overview</h2>
          <p className="sub-text">
            Complete performance summary in one view
            <span className={styles.headerMeta}>
              {updatedAt && (
                <span>
                  <i className="fas fa-clock" />
                  {refetching ? 'Updating…' : `Updated ${updatedAt}`}
                </span>
              )}
              {meta?.queryTimeMs > 0 && (
                <span>
                  <i className="fas fa-bolt" />
                  {meta.queryTimeMs} ms
                </span>
              )}
              <span>
                <i className="fas fa-coins" />
                Amounts in {currencySymbol}
              </span>
            </span>
          </p>
        </div>

        {/* Filters */}
        <div className={styles.filterCard}>
          <div className={styles.filterRow}>
            <div className={styles.filterCol}>
              <label className={styles.filterLabel} htmlFor="dv2Range">Date Range</label>
              <select
                id="dv2Range"
                className={styles.filterSelect}
                value={dateRange}
                onChange={(e) => handleRangeChange(e.target.value)}
              >
                {DATE_RANGES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterCol}>
              <label className={styles.filterLabel} htmlFor="dv2Seller">Seller</label>
              <select
                id="dv2Seller"
                className={styles.filterSelect}
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Sellers</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.role ? ` (${u.role})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {dateRange === 'custom' ? (
              <div className={styles.filterCol}>
                <label className={styles.filterLabel}>Custom Dates</label>
                <div className={styles.dateSplit}>
                  <input
                    type="date"
                    className={styles.filterInput}
                    value={startDate}
                    max={endDate || todayISO()}
                    onChange={(e) => handleCustomDate('start', e.target.value)}
                    aria-label="Start date"
                  />
                  <input
                    type="date"
                    className={styles.filterInput}
                    value={endDate}
                    max={todayISO()}
                    onChange={(e) => handleCustomDate('end', e.target.value)}
                    aria-label="End date"
                  />
                </div>
              </div>
            ) : null}

            <div className={styles.filterCol}>
              <label className={styles.filterLabel} htmlFor="dv2Top">Top Lists</label>
              <select
                id="dv2Top"
                className={styles.filterSelect}
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
              >
                {TOP_N.map((n) => (
                  <option key={n} value={n}>Top {n}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterCol}>
              <label className={styles.filterLabel}>&nbsp;</label>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => load(filters)}
                disabled={loading || refetching}
              >
                <i className={`fas fa-rotate ${refetching ? styles.spinning : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {rangeWarning && (
          <div className={styles.notice}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{rangeWarning}</span>
          </div>
        )}

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className={styles.noticeBtn} onClick={() => load(filters)}>
              Try Again
            </button>
          </div>
        )}

        {loading && <LoadingSkeleton />}

        {!loading && data && (
          <div className={staleClass}>
            {/* ---------- Performance summary ---------- */}
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-chart-line" /> Performance Summary
              <span className={styles.sectionNote}>{RANGE_LABEL[dateRange]}</span>
            </h3>

            <div className={styles.metricGrid}>
              <MetricCard
                icon="fa-dollar-sign"
                iconColor={C.accent}
                label="Net Revenue"
                value={money(overview?.totalRevenue)}
                note="After discounts and returns"
              />
              <MetricCard
                icon="fa-sack-dollar"
                iconColor={C.success}
                label="Gross Profit"
                value={money(overview?.totalProfit)}
                badge={`${pct(detailed?.grossMargin)} margin`}
                badgeClass={styles.badgeSuccess}
              />
              <MetricCard
                icon="fa-chart-pie"
                iconColor={netProfitPositive ? C.success : C.danger}
                label="Net Profit"
                value={money(overview?.netProfit)}
                valueClass={netProfitPositive ? '' : styles.metricValueDanger}
                badge={`${pct(detailed?.netMargin)} margin`}
                badgeClass={netProfitPositive ? styles.badgeSuccess : styles.badgeDanger}
              />
              <MetricCard
                icon="fa-file-invoice"
                iconColor={C.info}
                label="Invoices"
                value={count(detailed?.totalInvoices)}
                note={`${count(detailed?.totalItemsSold)} items sold`}
              />
              <MetricCard
                icon="fa-cart-shopping"
                iconColor={C.accent}
                label="Avg Order Value"
                value={money(detailed?.averageOrderValue)}
                note={`${pct(detailed?.paymentCollectionRatio)} collected`}
              />
            </div>

            {/* ---------- Financial breakdown ---------- */}
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-scale-balanced" /> Financial Breakdown
              <span className={styles.sectionNote}>Each figure shown against its own base</span>
            </h3>

            <div className={styles.metricGrid}>
              <MetricCard
                icon="fa-arrow-trend-up"
                iconColor={C.accent}
                label="Gross Revenue"
                value={money(overview?.grossRevenue)}
                note="Before returns"
              />
              <MetricCard
                icon="fa-rotate-left"
                iconColor={C.danger}
                label="Returns"
                value={money(overview?.totalReturnsAmount)}
                note={`${pct(share(overview?.totalReturnsAmount, overview?.grossRevenue))} of gross revenue`}
              />
              <MetricCard
                icon="fa-boxes-stacked"
                iconColor={C.warning}
                label="Cost of Goods Sold"
                value={money(overview?.totalPurchaseCost)}
                note={`${pct(share(overview?.totalPurchaseCost, overview?.totalRevenue))} of net revenue`}
              />
              <MetricCard
                icon="fa-receipt"
                iconColor={C.warning}
                label="Operating Expenses"
                value={money(operatingExpenses)}
                note="Gross profit less net profit"
              />
              <MetricCard
                icon="fa-percent"
                iconColor={C.info}
                label="Tax Collected"
                value={money(overview?.totalTaxCollected)}
                note="Within the period"
              />
              <MetricCard
                icon="fa-cash-register"
                iconColor={C.accent}
                label="Revenue Excl. Credit"
                value={money(overview?.revenueExcludingCredit)}
                note="Settled at point of sale"
              />
              <MetricCard
                icon="fa-screwdriver-wrench"
                iconColor={C.info}
                label="Service Revenue"
                value={money(overview?.serviceRevenue)}
                note="Non-inventory service lines"
              />
              <MetricCard
                icon="fa-hand-holding-dollar"
                iconColor={C.danger}
                label="Credit Outstanding"
                value={money(overview?.totalCredit)}
                note="Receivable, all time"
              />
              <MetricCard
                icon="fa-piggy-bank"
                iconColor={C.success}
                label="Advance Held"
                value={money(detailed?.totalAdvance)}
                note="Customer advances, all time"
              />
              <MetricCard
                icon="fa-warehouse"
                iconColor={C.accent}
                label="Inventory On Hand"
                value={money(detailed?.availableInventoryCost)}
                note="At purchase cost"
              />
            </div>

            {/* ---------- Revenue to profit ---------- */}
            <div className={styles.contentCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h5 className={styles.cardHeaderTitle}>Revenue To Profit</h5>
                  <p className={styles.cardHeaderSub}>
                    Reported stage totals, each bar scaled against gross revenue
                  </p>
                </div>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.flowRow}>
                  {stages.map((s) => (
                    <div
                      key={s.label}
                      className={`${styles.flowStep} ${s.final ? styles.flowStepFinal : ''}`}
                    >
                      <p className={styles.flowLabel}>{s.label}</p>
                      <p className={styles.flowValue}>{money(s.value)}</p>
                      <div
                        className={styles.flowBar}
                        style={{ width: `${s.ratio}%`, background: s.color }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ---------- Charts ---------- */}
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-chart-area" /> Sales Analysis
              <span className={styles.sectionNote}>Every chart has a table view</span>
            </h3>

            <div className={styles.chartRow}>
              <ChartCard
                title="Daily Net Revenue"
                subtitle={`Revenue after discounts and returns, in ${currencySymbol}`}
                col="col7"
                isEmpty={dailyRevenue.length === 0}
                emptyText="No daily revenue in this period."
                chart={
                  <div className={styles.canvasWrap}>
                    <Line data={dailyData} options={dailyOptions} plugins={[crosshairPlugin]} />
                  </div>
                }
                table={
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col" className={styles.num}>Net Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRevenue.map((r) => (
                        <tr key={r.date}>
                          <td>{r.date}</td>
                          <td className={styles.num}>{money(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />

              <ChartCard
                title="Payment Methods"
                subtitle="How this period's revenue was tendered"
                col="col5"
                isEmpty={paymentTypes.length === 0}
                emptyText="No payments recorded in this period."
                chart={
                  <div className={styles.donutWrap}>
                    <Doughnut data={donutData} options={donutOptions} />
                    <div className={styles.donutCenter}>
                      <p className={styles.donutCenterLabel}>Total</p>
                      <p className={styles.donutCenterValue}>{money(paymentTotal)}</p>
                    </div>
                  </div>
                }
                legend={
                  <div className={styles.legend}>
                    {paymentTypes.map((p, i) => (
                      <LegendItem
                        key={p.payment_type}
                        color={PAYMENT_COLORS[i % PAYMENT_COLORS.length]}
                        label={p.payment_type}
                        value={money(p.total)}
                      />
                    ))}
                  </div>
                }
                footnote={
                  paymentHasNegative
                    ? 'A negative total means returns exceeded sales for that method. The ring shows only the positive part; the figures above are exact.'
                    : null
                }
                table={
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th scope="col">Payment Method</th>
                        <th scope="col" className={styles.num}>Amount</th>
                        <th scope="col" className={styles.num}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentTypes.map((p, i) => (
                        <tr key={p.payment_type}>
                          <td>
                            <span
                              className={styles.swatch}
                              style={{ background: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }}
                              aria-hidden="true"
                            />
                            {p.payment_type}
                          </td>
                          <td className={styles.num}>{money(p.total)}</td>
                          <td className={styles.num}>{pct(share(p.total, paymentTotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />
            </div>

            <div className={styles.chartRow}>
              <ChartCard
                title="Revenue And Profit By Category"
                subtitle={`Leading categories, in ${currencySymbol}`}
                col="col7"
                isEmpty={categoryRows.length === 0}
                emptyText="No category activity in this period."
                chart={
                  <div className={styles.canvasWrapTall}>
                    <Bar data={categoryData} options={categoryOptions} />
                  </div>
                }
                legend={
                  <div className={styles.legend}>
                    <LegendItem color={SERIES.revenue} label="Revenue" />
                    <LegendItem color={SERIES.profit} label="Profit" />
                  </div>
                }
                table={
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th scope="col">Category</th>
                        <th scope="col" className={styles.num}>Revenue</th>
                        <th scope="col" className={styles.num}>Profit</th>
                        <th scope="col" className={styles.num}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryRows.map((r) => (
                        <tr key={r.category}>
                          <td className={styles.nameCell}>{r.category}</td>
                          <td className={styles.num}>{money(r.revenue)}</td>
                          <td className={styles.num}>{money(r.profit)}</td>
                          <td className={styles.num}>
                            {r.revenue ? pct((r.profit / r.revenue) * 100) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />

              <ChartCard
                title="Monthly Net Revenue"
                subtitle={`Months covered by the selected range, in ${currencySymbol}`}
                col="col5"
                isEmpty={monthlyRevenue.length === 0}
                emptyText="No monthly revenue in this period."
                chart={
                  <div className={styles.canvasWrapTall}>
                    <Bar data={monthlyData} options={monthlyOptions} />
                  </div>
                }
                table={
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col" className={styles.num}>Net Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyRevenue.map((r) => (
                        <tr key={r.month}>
                          <td>{r.month}</td>
                          <td className={styles.num}>{money(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />
            </div>

            {/* ---------- Products & customers ---------- */}
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-store" /> Products &amp; Customers
              <span className={styles.sectionNote}>Top {topN} in the selected period</span>
            </h3>

            <div className={styles.chartRow}>
              <div className={`${styles.contentCard} ${styles.col6}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h5 className={styles.cardHeaderTitle}>Best Selling Products</h5>
                    <p className={styles.cardHeaderSub}>By quantity sold</p>
                  </div>
                </div>
                <div className={styles.cardBody}>
                  {topProducts.length === 0 ? (
                    <Empty text="No products sold in this period." />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Product</th>
                            <th scope="col">Share</th>
                            <th scope="col" className={styles.num}>Quantity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topProducts.map((p, i) => (
                            <tr key={`${p.product_name}-${i}`}>
                              <td className={styles.rankCell}>{i + 1}</td>
                              <td className={styles.nameCell} title={p.product_name}>
                                {p.product_name}
                              </td>
                              <td className={styles.barCell}>
                                <div className={styles.barTrack}>
                                  <div
                                    className={styles.barFill}
                                    style={{
                                      width: `${Math.max(3, share(p.total_qty, maxProductQty))}%`,
                                      background: SERIES.revenue,
                                    }}
                                  />
                                </div>
                              </td>
                              <td className={styles.num}>
                                {count(p.total_qty)}{' '}
                                <span className={styles.unitCell}>{p.unit || 'pcs'}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className={`${styles.contentCard} ${styles.col6}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h5 className={styles.cardHeaderTitle}>Top Customers</h5>
                    <p className={styles.cardHeaderSub}>By spend in this period</p>
                  </div>
                </div>
                <div className={styles.cardBody}>
                  {topCustomers.length === 0 ? (
                    <Empty text="No customer sales in this period." />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Customer</th>
                            <th scope="col">Share</th>
                            <th scope="col" className={styles.num}>Total Spent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topCustomers.map((c, i) => {
                            const name = c.customer?.name || 'Walk-in Customer';
                            return (
                              <tr key={`${name}-${i}`}>
                                <td className={styles.rankCell}>{i + 1}</td>
                                <td className={styles.nameCell} title={name}>{name}</td>
                                <td className={styles.barCell}>
                                  <div className={styles.barTrack}>
                                    <div
                                      className={styles.barFill}
                                      style={{
                                        width: `${Math.max(3, share(c.total_spent, maxCustomerSpend))}%`,
                                        background: SERIES.profit,
                                      }}
                                    />
                                  </div>
                                </td>
                                <td className={styles.num}>{money(c.total_spent)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.chartRow}>
              <div className={`${styles.contentCard} ${styles.col6}`}>
                <div className={styles.cardHeader}>
                  <div>
                    <h5 className={styles.cardHeaderTitle}>Outstanding Credit</h5>
                    <p className={styles.cardHeaderSub}>Highest balances owed, all time</p>
                  </div>
                </div>
                <div className={styles.cardBody}>
                  {outstandingCredits.length === 0 ? (
                    <Empty text="No outstanding credit balances." />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">Customer</th>
                            <th scope="col">Share</th>
                            <th scope="col" className={styles.num}>Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outstandingCredits.map((c, i) => (
                            <tr key={`${c.customer?.name}-${i}`}>
                              <td className={styles.rankCell}>{i + 1}</td>
                              <td className={styles.nameCell}>
                                {c.customer?.name || 'Unnamed Account'}
                              </td>
                              <td className={styles.barCell}>
                                <div className={styles.barTrack}>
                                  <div
                                    className={styles.barFill}
                                    style={{
                                      width: `${Math.max(3, share(c.outstanding, maxCredit))}%`,
                                      background: C.danger,
                                    }}
                                  />
                                </div>
                              </td>
                              <td className={styles.num}>{money(c.outstanding)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {customerTypes && (
                <div className={`${styles.contentCard} ${styles.col6}`}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h5 className={styles.cardHeaderTitle}>Customer Base</h5>
                      <p className={styles.cardHeaderSub}>
                        New versus returning buyers in this period
                      </p>
                    </div>
                  </div>
                  <div className={styles.cardBody}>
                    {periodBuyers === 0 ? (
                      <Empty text="No identified customers bought in this period." />
                    ) : (
                      <>
                        <div className={styles.splitBar}>
                          <span
                            className={styles.splitSeg}
                            style={{
                              flexGrow: Math.max(0.001, num(customerTypes.new)),
                              background: SERIES.revenue,
                            }}
                          />
                          <span
                            className={styles.splitSeg}
                            style={{
                              flexGrow: Math.max(0.001, num(customerTypes.repeat)),
                              background: SERIES.profit,
                            }}
                          />
                        </div>
                        <div className={styles.legend} style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
                          <LegendItem
                            color={SERIES.revenue}
                            label="New buyers"
                            value={`${count(customerTypes.new)} · ${pct(share(customerTypes.new, periodBuyers), 0)}`}
                          />
                          <LegendItem
                            color={SERIES.profit}
                            label="Returning buyers"
                            value={`${count(customerTypes.repeat)} · ${pct(share(customerTypes.repeat, periodBuyers), 0)}`}
                          />
                        </div>
                      </>
                    )}

                    <div style={{ marginTop: '1rem' }}>
                      <DetailRow
                        icon="fa-users"
                        label="Total customers (all time)"
                        value={count(customerTypes.totalAll)}
                      />
                      <DetailRow
                        icon="fa-hand-holding-dollar"
                        label="Credit accounts"
                        value={count(customerTypes.credit)}
                      />
                      <DetailRow
                        icon="fa-piggy-bank"
                        label="Advance accounts"
                        value={count(customerTypes.advance)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ---------- Operating detail ---------- */}
            {detailed && (
              <div className={styles.contentCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <h5 className={styles.cardHeaderTitle}>Operating Detail</h5>
                    <p className={styles.cardHeaderSub}>Inventory and trading metrics</p>
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.detailGrid}>
                    <DetailRow
                      icon="fa-truck-ramp-box"
                      label="Purchases (all time)"
                      value={money(detailed.totalAllPurchases)}
                    />
                    <DetailRow
                      icon="fa-warehouse"
                      label="Inventory on hand (cost)"
                      value={money(detailed.availableInventoryCost)}
                    />
                    <DetailRow
                      icon="fa-tags"
                      label="Cost of items sold"
                      value={money(detailed.soldItemsCost)}
                    />
                    <DetailRow
                      icon="fa-file-invoice"
                      label="Invoices"
                      value={count(detailed.totalInvoices)}
                    />
                    <DetailRow
                      icon="fa-cubes"
                      label="Items sold (net of returns)"
                      value={count(detailed.totalItemsSold)}
                    />
                    <DetailRow
                      icon="fa-cart-shopping"
                      label="Average order value"
                      value={money(detailed.averageOrderValue)}
                    />
                    <DetailRow
                      icon="fa-chart-pie"
                      label="Gross margin"
                      value={pct(detailed.grossMargin)}
                    />
                    <DetailRow
                      icon="fa-chart-area"
                      label="Net margin"
                      value={pct(detailed.netMargin)}
                    />
                    <DetailRow
                      icon="fa-money-check-dollar"
                      label="Payment collection ratio"
                      value={pct(detailed.paymentCollectionRatio)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
