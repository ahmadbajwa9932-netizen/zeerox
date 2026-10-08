// app/reports/financial/page.js
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import styles from './financialReport.module.css';
import { formatPrice } from "@/lib/currency-context";
import { apiFetch } from '@/lib/api';


ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

/* ============================================================
   CONFIG / HELPERS
   TODO: move formatPrice to a shared currency util once the
   Fastify /settings endpoint (currency symbol/locale) is wired up.
   ============================================================ */

const CATEGORY_COLORS = [
  '#DDA0DD', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40',
  '#FF6384', '#C9CBCF', '#20B2AA', '#FF1493', '#00CED1', '#FFD700',
  '#ADFF2F', '#FF69B4', '#BA55D3', '#CD5C5C', '#40E0D0', '#F0E68C',
];

function generateDynamicColors(count) {
  const colors = [];
  for (let i = 0; i < count; i++) colors.push(CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
  return colors;
}

function darkenColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.floor(r * 0.7).toString(16).padStart(2, '0');
  const dg = Math.floor(g * 0.7).toString(16).padStart(2, '0');
  const db = Math.floor(b * 0.7).toString(16).padStart(2, '0');
  return `#${dr}${dg}${db}`;
}

const TABS = [
  { id: 'summary', label: 'Summary', icon: 'fa-chart-pie' },
  { id: 'revenue', label: 'Revenue', icon: 'fa-dollar-sign' },
  { id: 'expenses', label: 'Expenses', icon: 'fa-money-bill-wave' },
  { id: 'profitability', label: 'Profitability', icon: 'fa-chart-line' },
  { id: 'receivables', label: 'Receivables Aging', icon: 'fa-hourglass-half' },
  { id: 'breakdown', label: 'Breakdown', icon: 'fa-list-ul' },
];


/* ============================================================
   SMALL REUSABLE PIECES
   ============================================================ */

function Spinner() {
  return <div className={styles['spinner']} />;
}

function CardsSkeleton({ count = 6 }) {
  return (
    <div className={styles['key-metrics-grid']}>
      {Array.from({ length: count }).map((_, i) => (
        <div className={`${styles['metric-card']} skeleton-card`} key={i}>
          <div className={`${styles['skeleton-line']} ${styles['skeleton-label']}`} />
          <div className={`${styles['skeleton-line']} ${styles['skeleton-value']}`} />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6 }) {
  return (
    <div className={styles['table-container']}>
      <div className={`${styles['skeleton-line']} ${styles['skeleton-label']}`} style={{ marginBottom: 16, width: 220 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={styles['skeleton-line']}
          style={{ height: 16, marginBottom: 10, width: `${92 - i * 6}%` }}
        />
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return <div className={`${styles['chart-canvas-lg']} ${styles['skeleton-line']} ${styles['skeleton-chart']}`} />;
}

function ErrorState({ message, onRetry }) {
  return (
    <div className={styles['error-box']}>
      <span><i className="fa fa-triangle-exclamation" /> {message}</span>
      <button type="button" className={`btn ${styles['btn-primary']}`} onClick={onRetry}>Retry</button>
    </div>
  );
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.last_page <= 1) return null;

  const currentPage = Number(pagination.current_page);
  const lastPage = Number(pagination.last_page);
  const maxVisible = 4;
  let startPage, endPage;

  if (lastPage <= maxVisible) {
    startPage = 1;
    endPage = lastPage;
  } else if (currentPage <= 2) {
    startPage = 1;
    endPage = maxVisible;
  } else if (currentPage >= lastPage - 1) {
    startPage = lastPage - maxVisible + 1;
    endPage = lastPage;
  } else {
    startPage = currentPage - 1;
    endPage = currentPage + 2;
  }

  const pages = [];
  for (let i = startPage; i <= endPage; i++) pages.push(i);

  return (
    <div className={styles['pagination-container']}>
      <div className={styles['pagination']}>
        {currentPage > 1 && (
          <button className={styles['page-btn']} onClick={() => onPageChange(1)}>First</button>
        )}
        {pages.map((p) => (
          <button
            key={p}
            className={`${styles['page-btn']} ${p === currentPage ? styles['active'] : ''}`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}
        {currentPage < lastPage && (
          <button className={styles['page-btn']} onClick={() => onPageChange(lastPage)}>Last</button>
        )}
      </div>
    </div>
  );
}

const EyeToggle = ({ visible, onClick }) => (
  <button
    type="button"
    className={styles['eye-btn']}
    onClick={onClick}
    aria-label={visible ? 'Hide value' : 'Reveal value'}
  >
    <i className={`fas ${visible ? 'fa-eye' : 'fa-eye-slash'}`} />
  </button>
);

/* ============================================================
   CHART EXPAND MODAL
   Mirrors the sales report behaviour: doughnut -> bar on expand.
   ============================================================ */

function ChartExpandModal({ expanded, onClose }) {
  if (!expanded) return null;

  const { title, type, labels, values, datasets: multiDatasets } = expanded;
  const colors = expanded.colors || generateDynamicColors(labels.length);
  const chartType = type === 'doughnut' ? 'bar' : type;

  const data = {
    labels,
    datasets: multiDatasets
      ? multiDatasets.map((ds) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: ds.backgroundColor,
          borderColor: ds.borderColor,
          borderWidth: 1,
        }))
      : [
          {
            label: title,
            data: values,
            backgroundColor: colors,
            borderColor: colors.map(darkenColor),
            borderWidth: 1,
          },
        ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: !!multiDatasets, position: 'bottom' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label ?? ctx.label}: ${formatPrice(ctx.parsed.y ?? ctx.parsed)}` } },
    },
    scales: {
      y: { beginAtZero: true },
      x: { ticks: { maxRotation: 65, minRotation: 45, autoSkip: true } },
    },
  };

  return (
    <div
      style={{
        display: 'block', position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'rgba(0,0,0,0.8)', zIndex: 9999, padding: 20,
      }}
    >
      <div style={{
        position: 'relative', background: 'white', borderRadius: 8, maxWidth: '95%',
        maxHeight: '95%', margin: 'auto', padding: 20, overflow: 'auto',
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 10, right: 10, background: '#dc3545', color: 'white',
            border: 'none', padding: '8px 15px', borderRadius: 4, cursor: 'pointer', fontSize: 18, zIndex: 10000,
          }}
        >
          ✕
        </button>
        <h3 style={{ marginBottom: 20 }}>{title}</h3>
        <div style={{ width: '100%', height: '70vh' }}>
          {chartType === 'bar' && <Bar data={data} options={options} />}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN PAGE
   ============================================================ */

export default function FinancialReportPage() {
  const [activeTab, setActiveTab] = useState('summary');

  // Filters
  const [dateRange, setDateRange] = useState('today');
  // Local-date formatting (not toISOString) — toISOString() converts to UTC
  // first, which rolls the date back a day for any PKT time before 5 AM.
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Per-tab loading / mount state (mirrors sales report's pattern)
  const [mountedTabs, setMountedTabs] = useState({
    summary: true, revenue: false, expenses: false, profitability: false, receivables: false, breakdown: false,
  });
  const [loadingReport, setLoadingReport] = useState(true);
  const [errorReport, setErrorReport] = useState(null);
  const [reportLoaded, setReportLoaded] = useState(false);

  const [loadingProfitability, setLoadingProfitability] = useState(false);
  const [errorProfitability, setErrorProfitability] = useState(null);
  const [profitabilityLoaded, setProfitabilityLoaded] = useState(false);

  const reportAbortRef = useRef(null);
  const profitAbortRef = useRef(null);

  // Report data (drives summary / revenue / expenses / breakdown tabs)
  const [report, setReport] = useState(null);
  const [hiddenValues, setHiddenValues] = useState({});

  // Profitability tab
  const [topProducts, setTopProducts] = useState([]);
  const [topProductsSortBy, setTopProductsSortBy] = useState('profit');
  const [topProductsLimit, setTopProductsLimit] = useState(10);
  const [categoryPerf, setCategoryPerf] = useState({ data: [], pagination: null });
  const [categoryPage, setCategoryPage] = useState(1);

  // Receivables Aging tab — a live snapshot, NOT scoped to dateRange
  // (same rule as dashboard's Credit Pending card: "how much is owed
  // right now" is a present-moment question).
  const [loadingReceivables, setLoadingReceivables] = useState(false);
  const [errorReceivables, setErrorReceivables] = useState(null);
  const [receivablesLoaded, setReceivablesLoaded] = useState(false);
  const receivablesAbortRef = useRef(null);
  const [receivables, setReceivables] = useState({ summary: null, invoices: [], pagination: null });
  const [receivablesBucket, setReceivablesBucket] = useState('');
  const [receivablesSortBy, setReceivablesSortBy] = useState('days_overdue');
  const [receivablesSortOrder, setReceivablesSortOrder] = useState('desc');
  const [receivablesPage, setReceivablesPage] = useState(1);

  const loadReceivables = useCallback(() => {
    receivablesAbortRef.current?.abort();
    const controller = new AbortController();
    receivablesAbortRef.current = controller;

    setLoadingReceivables(true);
    setErrorReceivables(null);

    const params = new URLSearchParams();
    if (receivablesBucket) params.set('bucket', receivablesBucket);
    params.set('sort_by', receivablesSortBy);
    params.set('sort_order', receivablesSortOrder);
    params.set('page', receivablesPage);

    apiFetch(`/api/reports/financial/receivables-aging?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load receivables aging');
        setReceivables({ summary: json.data.summary, invoices: json.data.invoices, pagination: json.pagination });
        setReceivablesLoaded(true);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorReceivables('Could not load receivables aging. Please try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReceivables(false);
      });
  }, [receivablesBucket, receivablesSortBy, receivablesSortOrder, receivablesPage]);

  useEffect(() => {
    if (activeTab === 'receivables' && receivablesLoaded) loadReceivables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivablesBucket, receivablesSortBy, receivablesSortOrder, receivablesPage]);

  // Charts
  const [expandedChart, setExpandedChart] = useState(null);
  const expenseChartRef = useRef(null);
  const categoryChartRef = useRef(null);

 /* ---------- data loaders ---------- */

 function buildDateParams() {
  const params = new URLSearchParams();
  params.set('date_range', dateRange);
  if (dateRange === 'custom') {
    params.set('start_date', startDate);
    params.set('end_date', endDate);
  }
  return params;
}

const loadReport = useCallback(() => {
  reportAbortRef.current?.abort();
  const controller = new AbortController();
  reportAbortRef.current = controller;

  setLoadingReport(true);
  setErrorReport(null);

  const params = buildDateParams();

    apiFetch(`/api/reports/financial/summary?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load financial summary');
        setReport(json.data);
        setReportLoaded(true);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorReport('Could not load the financial summary. Please try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingReport(false);
      });
  }, [dateRange, startDate, endDate]);

const loadProfitability = useCallback(() => {
  profitAbortRef.current?.abort();
  const controller = new AbortController();
  profitAbortRef.current = controller;

  setLoadingProfitability(true);
  setErrorProfitability(null);

  const productParams = buildDateParams();
  productParams.set('sort_by', topProductsSortBy);
  productParams.set('limit', topProductsLimit);

  const categoryParams = buildDateParams();
  categoryParams.set('page', categoryPage);

  Promise.all([
    apiFetch(`/api/reports/financial/top-products?${productParams.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      }),
    apiFetch(`/api/reports/financial/category-performance?${categoryParams.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      }),
  ])
    .then(([productsJson, categoryJson]) => {
      if (!productsJson.success) throw new Error(productsJson.error || 'Failed to load top products');
      if (!categoryJson.success) throw new Error(categoryJson.error || 'Failed to load category performance');
      setTopProducts(productsJson.data);
      setCategoryPerf({ data: categoryJson.data, pagination: categoryJson.pagination });
      setProfitabilityLoaded(true);
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      setErrorProfitability('Could not load profitability data. Please try again.');
    })
    .finally(() => {
      if (!controller.signal.aborted) setLoadingProfitability(false);
    });
}, [topProductsSortBy, topProductsLimit, categoryPage, dateRange, startDate, endDate]);

  // Initial load — mirrors dashboard's mount-once effect
  useEffect(() => {
    loadReport();
    return () => reportAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setMountedTabs((prev) => ({ ...prev, [tabId]: true }));
    if (tabId === 'profitability') {
      if (!profitabilityLoaded) loadProfitability();
    } else if (tabId === 'receivables') {
      if (!receivablesLoaded) loadReceivables();
    } else if (!reportLoaded) {
      // summary / revenue / expenses / breakdown all share `report`
      loadReport();
    }
  };

  useEffect(() => {
    if (activeTab === 'profitability' && profitabilityLoaded) loadProfitability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topProductsSortBy, topProductsLimit, categoryPage]);

  function handleGenerate() {
    // Filters changed — both data groups are now stale. Only the active
    // tab's group fetches right now; the other fetches lazily the moment
    // you click into a tab that belongs to it (same fix as Sales Report).
    setReportLoaded(false);
    setProfitabilityLoaded(false);
    if (activeTab === 'profitability') {
      loadProfitability();
    } else {
      loadReport();
    }
  }

  function toggleHidden(key) {
    setHiddenValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /* ---------- derived chart data ---------- */

  const expenseColors = useMemo(
    () => (report ? generateDynamicColors(report.operating_expenses.breakdown.length) : []),
    [report]
  );

  const expenseChartData = report ? {
    labels: report.operating_expenses.breakdown.map((e) => e.category),
    datasets: [{
      data: report.operating_expenses.breakdown.map((e) => e.amount),
      backgroundColor: expenseColors,
    }],
  } : null;

  const categoryColors = useMemo(
    () => generateDynamicColors(categoryPerf.data.length),
    [categoryPerf.data.length]
  );

  const categoryChartData = {
    labels: categoryPerf.data.map((c) => c.category),
    datasets: [
      {
        label: 'Revenue',
        data: categoryPerf.data.map((c) => c.revenue),
        backgroundColor: categoryColors,
        borderColor: categoryColors.map(darkenColor),
        borderWidth: 1,
      },
      {
        label: 'Profit',
        data: categoryPerf.data.map((c) => c.profit),
        backgroundColor: categoryColors.map((c) => `${c}99`),
        borderColor: categoryColors.map(darkenColor),
        borderWidth: 1,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
  };

  const axisChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true },
      x: { ticks: { maxRotation: 65, minRotation: 45, autoSkip: true } },
    },
  };

  /* ---------- key metrics config ---------- */

  const metricCards = report ? [
    { key: 'netSales', label: 'Net Sales Revenue', icon: 'fa-cash-register', color: 'primary', value: report.sales_revenue.net_sales_revenue, detail: `Gross: ${formatPrice(report.sales_revenue.gross_sales)}` },
    { key: 'cogs', label: 'Cost of Goods Sold', icon: 'fa-box-open', color: 'danger', value: report.cogs.total_cogs, detail: `${report.financial_ratios.cogs_ratio.toFixed(1)}% of revenue` },
    { key: 'grossProfit', label: 'Gross Profit', icon: 'fa-chart-bar', color: 'success', value: report.gross_profit.amount, detail: `Margin: ${report.gross_profit.margin_percentage.toFixed(1)}%` },
    { key: 'opExpenses', label: 'Operating Expenses', icon: 'fa-file-invoice-dollar', color: 'warning', value: report.operating_expenses.total_expenses, detail: `${report.financial_ratios.expense_ratio.toFixed(1)}% of revenue` },
    { key: 'opProfit', label: 'Operating Profit', icon: 'fa-balance-scale', color: 'info', value: report.operating_profit, detail: 'EBIT' },
    { key: 'netProfit', label: 'Net Profit', icon: 'fa-trophy', color: 'success', value: report.net_profit.amount, detail: `Margin: ${report.net_profit.margin_percentage.toFixed(1)}%` },
  ] : [];

  const ratioItems = report ? [
    { key: 'gross', label: 'Gross Profit Margin', value: report.financial_ratios.gross_profit_margin, fill: 'primary' },
    { key: 'net', label: 'Net Profit Margin', value: report.financial_ratios.net_profit_margin, fill: 'success' },
    { key: 'expense', label: 'Expense Ratio', value: report.financial_ratios.expense_ratio, fill: 'warning' },
    { key: 'cogs', label: 'COGS Ratio', value: report.financial_ratios.cogs_ratio, fill: 'danger' },
  ] : [];

  return (
    <div className="container">
      {/* Header */}
      <div className="main-text">
        <h2><i className="fas fa-money-bill-wave" /> Financial Summary Report</h2>
        <p className="sub-text">Comprehensive profit &amp; loss analysis</p>
      </div>

      {/* Date Range Filter */}
      <div className={styles['filter-card']}>
        <div className={styles['filter-row']}>
          <div className={styles['filter-col']}>
            <label className={styles['filter-label']}>Date Range</label>
            <select className={styles['filter-select']} value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="this_year">This Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {dateRange === 'custom' && (
            <>
              <div className={styles['filter-col']}>
                <label className={styles['filter-label']}>Start Date</label>
                <input type="date" className={styles['filter-input']} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className={styles['filter-col']}>
                <label className={styles['filter-label']}>End Date</label>
                <input type="date" className={styles['filter-input']} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </>
          )}
          <div className={styles['filter-col']}>
            <label className={styles['filter-label']}>&nbsp;</label>
            <button className={`btn ${styles['btn-primary']} ${styles['btn-block']}`} onClick={handleGenerate}>
              <i className="fas fa-search" /> Generate
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles['tabs-container']}>
        <div className={styles['tabs-nav']}>
          {TABS.map((tab) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              className={`${styles['tab-link']} ${activeTab === tab.id ? styles['active'] : ''}`}
              onClick={(e) => { e.preventDefault(); handleTabClick(tab.id); }}
            >
              <i className={`fas ${tab.icon}`} /> {tab.label}
            </a>
          ))}
        </div>

        <div className={styles['tabs-content']} style={{ position: 'relative' }}>
          {/* 1. SUMMARY */}
          {mountedTabs.summary && (
            <div className={styles['tab-pane']} id="summary" style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
              {loadingReport && !report && <CardsSkeleton count={6} />}
              {errorReport && <ErrorState message={errorReport} onRetry={loadReport} />}
              {!errorReport && report && (
                <>
                  <div className={styles['key-metrics-grid']}>
                    {metricCards.map((m) => {
                      const hidden = hiddenValues[m.key];
                      return (
                        <div className={`${styles['metric-card']} ${styles[`metric-${m.color}`]}`} key={m.key}>
                          <div className={styles['metric-head']}>
                            <div className={styles['metric-head-left']}>
                              <i className={`fas ${m.icon} ${styles['metric-icon']}`} />
                              <span className={styles['metric-label']}>{m.label}</span>
                            </div>
                            <EyeToggle visible={!hidden} onClick={() => toggleHidden(m.key)} />
                          </div>
                          <div className={styles['metric-value']}>{hidden ? '••••••' : formatPrice(m.value)}</div>
                          <div className={styles['metric-detail']}>{m.detail}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header-primary']}><h5>Key Financial Ratios</h5></div>
                    <div className={styles['card-body']}>
                      <div className={styles['ratios-grid']}>
                        {ratioItems.map((r) => (
                          <div className={styles['ratio-item']} key={r.key}>
                            <div className={styles['ratio-label']}>{r.label}</div>
                            <div className={styles['ratio-value']}>{r.value.toFixed(1)}%</div>
                            <div className={styles['ratio-bar']}>
                              <div
                                className={`${styles['ratio-fill']} ${styles[`ratio-fill-${r.fill}`]}`}
                                style={{ width: `${Math.min(r.value, 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}><h5>Profit &amp; Loss Statement</h5></div>
                    <div className={styles['card-body']}>
                      <table className={styles['pl-statement-table']}>
                        <tbody>
                          <tr className={styles['pl-section-header']}><td colSpan={2}><strong>REVENUE</strong></td></tr>
                          <tr><td className={styles['pl-item-indent']}>Gross Sales</td><td className={styles['text-right']}>{formatPrice(report.sales_revenue.gross_sales)}</td></tr>
                          <tr><td className={styles['pl-item-indent']}>Less: Discounts</td><td className={`${styles['text-right']} ${styles['text-danger']}`}>({formatPrice(report.sales_revenue.total_discounts)})</td></tr>
                          <tr><td className={styles['pl-item-indent']}>Less: Returns</td><td className={`${styles['text-right']} ${styles['text-danger']}`}>({formatPrice(report.sales_revenue.total_returns)})</td></tr>
                          <tr className={styles['pl-subtotal']}><td><strong>Net Sales Revenue</strong></td><td className={styles['text-right']}><strong>{formatPrice(report.sales_revenue.net_sales_revenue)}</strong></td></tr>
                          <tr className={styles['pl-spacer']}><td colSpan={2} /></tr>
                          <tr className={styles['pl-section-header']}><td colSpan={2}><strong>COST OF GOODS SOLD</strong></td></tr>
                          <tr><td className={styles['pl-item-indent']}>Total COGS</td><td className={`${styles['text-right']} ${styles['text-danger']}`}>({formatPrice(report.cogs.total_cogs)})</td></tr>
                          <tr className={styles['pl-subtotal']}><td><strong>Gross Profit</strong></td><td className={styles['text-right']}><strong>{formatPrice(report.gross_profit.amount)}</strong></td></tr>
                          <tr className={styles['pl-spacer']}><td colSpan={2} /></tr>
                          <tr className={styles['pl-section-header']}><td colSpan={2}><strong>OPERATING EXPENSES</strong></td></tr>
                          <tr><td className={styles['pl-item-indent']}>Total Operating Expenses</td><td className={`${styles['text-right']} ${styles['text-danger']}`}>({formatPrice(report.operating_expenses.total_expenses)})</td></tr>
                          <tr className={styles['pl-subtotal']}><td><strong>Operating Profit (EBIT)</strong></td><td className={styles['text-right']}><strong>{formatPrice(report.operating_profit)}</strong></td></tr>
                          <tr className={styles['pl-spacer']}><td colSpan={2} /></tr>
                          <tr className={styles['pl-section-header']}><td colSpan={2}><strong>TAX</strong></td></tr>
                          <tr><td className={styles['pl-item-indent']}>Tax Collected</td><td className={styles['text-right']}>{formatPrice(report.tax_info.total_tax_collected)}</td></tr>
                          <tr className={styles['pl-spacer']}><td colSpan={2} /></tr>
                          <tr className={styles['pl-total']}><td><strong>NET PROFIT</strong></td><td className={styles['text-right']}><strong>{formatPrice(report.net_profit.amount)}</strong></td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 2. REVENUE */}
          {mountedTabs.revenue && (
            <div className={styles['tab-pane']} id="revenue" style={{ display: activeTab === 'revenue' ? 'block' : 'none' }}>
              {loadingReport && !report && <TableSkeleton />}
              {errorReport && <ErrorState message={errorReport} onRetry={loadReport} />}
              {!errorReport && report && (
                <>
                  <div className={styles['grid-three-col']}>
                    <div className={`${styles['stat-card']} ${styles['stat-primary']}`}>
                      <div className={styles['stat-label']}>Gross Sales</div>
                      <div className={styles['stat-value']}>{formatPrice(report.sales_revenue.gross_sales)}</div>
                      <div className={styles['stat-detail']}>{report.sales_revenue.gross_sales_count} transactions</div>
                    </div>
                    <div className={`${styles['stat-card']} ${styles['stat-warning']}`}>
                      <div className={styles['stat-label']}>Total Discounts</div>
                      <div className={styles['stat-value']}>{formatPrice(report.sales_revenue.total_discounts)}</div>
                      <div className={styles['stat-detail']}>Given to customers</div>
                    </div>
                    <div className={`${styles['stat-card']} ${styles['stat-danger']}`}>
                      <div className={styles['stat-label']}>Total Returns</div>
                      <div className={styles['stat-value']}>{formatPrice(report.sales_revenue.total_returns)}</div>
                      <div className={styles['stat-detail']}>Refunded amount</div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}><h5>Payment Type Breakdown</h5></div>
                    <div className={styles['card-body']}>
                      <div className={styles['payment-grid']}>
                        <div className={`${styles['payment-card']} ${styles['payment-cash']}`}>
                          <div className={styles['payment-icon']}><i className="fas fa-money-bill-wave" /></div>
                          <div className={styles['payment-info']}>
                            <div className={styles['payment-label']}>Cash Sales</div>
                            <div className={styles['payment-amount']}>{formatPrice(report.payment_breakdown.cash.amount)}</div>
                            <div className={styles['payment-count']}>{report.payment_breakdown.cash.count} transactions</div>
                          </div>
                        </div>
                        <div className={`${styles['payment-card']} ${styles['payment-card-type']}`}>
                          <div className={styles['payment-icon']}><i className="fas fa-credit-card" /></div>
                          <div className={styles['payment-info']}>
                            <div className={styles['payment-label']}>Card Sales</div>
                            <div className={styles['payment-amount']}>{formatPrice(report.payment_breakdown.card.amount)}</div>
                            <div className={styles['payment-count']}>{report.payment_breakdown.card.count} transactions</div>
                          </div>
                        </div>
                        <div className={`${styles['payment-card']} ${styles['payment-credit']}`}>
                          <div className={styles['payment-icon']}><i className="fas fa-file-invoice" /></div>
                          <div className={styles['payment-info']}>
                            <div className={styles['payment-label']}>Credit Sales</div>
                            <div className={styles['payment-amount']}>{formatPrice(report.payment_breakdown.credit.amount)}</div>
                            <div className={styles['payment-detail']}>
                              <span>Paid: {formatPrice(report.payment_breakdown.credit.paid)}</span>{' '}|{' '}
                              <span className={styles['text-danger']}>Outstanding: {formatPrice(report.payment_breakdown.credit.outstanding)}</span>
                            </div>
                            <div className={styles['payment-count']}>{report.payment_breakdown.credit.count} transactions</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}><h5>Revenue Breakdown Details</h5></div>
                    <div className={styles['card-body']}>
                    <table className={`${styles['data-table']} ${styles['kv-table']}`}>
                        <tbody>
                          <tr><td><strong style={{fontSize:'17px'}}>Gross Sales Revenue</strong></td><td className={styles['text-right']}><strong style={{fontSize:'17px'}}>{formatPrice(report.sales_revenue.gross_sales)}</strong></td></tr>
                          <tr><td style={{fontSize:'14px'}}>Total Sales Count</td><td className={styles['text-right']} style={{fontSize:'14px'}}>{report.sales_revenue.sales_count}</td></tr>
                          <tr><td style={{fontSize:'14px'}}>Total Items Sold</td><td className={styles['text-right']} style={{fontSize:'14px'}}>{Number(report.sales_revenue.items_sold).toFixed(2)}</td></tr>
                          <tr><td style={{fontSize:'14px'}}>Average Transaction Value</td><td className={styles['text-right']} style={{fontSize:'14px'}}>{formatPrice(report.sales_revenue.avg_transaction_value)}</td></tr>
                          <tr><td style={{fontSize:'14px'}}>Total Discounts Given</td><td className={`${styles['text-right']} ${styles['text-danger']}`} style={{fontSize:'14px'}}>({formatPrice(report.sales_revenue.total_discounts)})</td></tr>
                          <tr><td style={{fontSize:'14px'}}>Total Returns</td><td className={`${styles['text-right']} ${styles['text-danger']}`} style={{fontSize:'14px'}}>({formatPrice(report.sales_revenue.total_returns)})</td></tr>
                          <tr className={styles['table-total']}><td><strong style={{fontSize:'17px'}}>Net Sales Revenue</strong></td><td className={styles['text-right']}><strong style={{fontSize:'17px'}}>{formatPrice(report.sales_revenue.net_sales_revenue)}</strong></td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 3. EXPENSES */}
          {mountedTabs.expenses && (
            <div className={styles['tab-pane']} id="expenses" style={{ display: activeTab === 'expenses' ? 'block' : 'none' }}>
              {loadingReport && !report && <TableSkeleton />}
              {errorReport && <ErrorState message={errorReport} onRetry={loadReport} />}
              {!errorReport && report && (
                <>
                  <div className={styles['grid-two-col']}>
                    <div className={`${styles['stat-card']} ${styles['stat-danger']}`}>
                      <div className={styles['stat-label']}>Total Operating Expenses</div>
                      <div className={styles['stat-value']}>{formatPrice(report.operating_expenses.total_expenses)}</div>
                      <div className={styles['stat-detail']}>{report.operating_expenses.expense_count} expense records</div>
                    </div>
                    <div className={`${styles['stat-card']} ${styles['stat-info']}`}>
                      <div className={styles['stat-label']}>Average Daily Expense</div>
                      <div className={styles['stat-value']}>
                        {formatPrice(report.period.days > 0 ? report.operating_expenses.total_expenses / report.period.days : 0)}
                      </div>
                      <div className={styles['stat-detail']}>Based on period</div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Expense Category Breakdown</h5>
                      <button
                        className={styles['chart-expand-btn']}
                        onClick={() => expenseChartData && setExpandedChart({
                          type: 'doughnut',
                          title: 'Expense Category Breakdown',
                          labels: expenseChartData.labels,
                          values: expenseChartData.datasets[0].data,
                          colors: expenseColors,
                        })}
                      >
                        <i className="fa fa-search-plus" />
                      </button>
                    </div>
                    <div className={styles['card-body']}>
                    <div className={styles['chart-canvas-lg']}>
                        {expenseChartData && (
                          <Doughnut
                            ref={expenseChartRef}
                            data={expenseChartData}
                            options={{
                              ...doughnutOptions,
                              plugins: { ...doughnutOptions.plugins, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } } },
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}><h5>Expense Details by Category</h5></div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Category</th>
                              <th className={styles['text-right']}>Amount</th>
                              <th className={styles['text-right']}>Count</th>
                              <th className={styles['text-right']}>% of Total</th>
                              <th className={styles['text-right']}>% of Revenue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.operating_expenses.breakdown.length === 0 ? (
                              <tr><td colSpan={6} className={styles['no-data']}>No expenses found</td></tr>
                            ) : report.operating_expenses.breakdown.map((expense, index) => {
                              const percentOfTotal = report.operating_expenses.total_expenses > 0
                                ? (expense.amount / report.operating_expenses.total_expenses) * 100 : 0;
                              const percentOfRevenue = report.sales_revenue.net_sales_revenue > 0
                                ? (expense.amount / report.sales_revenue.net_sales_revenue) * 100 : 0;
                              return (
                                <tr key={index}>
                                  <td>{index + 1}</td>
                                  <td><strong>{expense.category}</strong></td>
                                  <td className={styles['text-right']}>{formatPrice(expense.amount)}</td>
                                  <td className={styles['text-right']}>{expense.count}</td>
                                  <td className={styles['text-right']}>{percentOfTotal.toFixed(1)}%</td>
                                  <td className={styles['text-right']}>{percentOfRevenue.toFixed(1)}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 4. PROFITABILITY */}
          {mountedTabs.profitability && (
            <div className={styles['tab-pane']} id="profitability" style={{ display: activeTab === 'profitability' ? 'block' : 'none' }}>
              {loadingProfitability && topProducts.length === 0 && <TableSkeleton />}
              {errorProfitability && <ErrorState message={errorProfitability} onRetry={loadProfitability} />}
              {!errorProfitability && (
                <>
                  <div className={styles['content-card']}>
                    <div className={styles['card-header-flex']}>
                      <h5>Top Products by Profitability</h5>
                      <div className={styles['header-controls']}>
                        <select className={styles['filter-select-sm']} value={topProductsSortBy} onChange={(e) => setTopProductsSortBy(e.target.value)}>
                          <option value="revenue">By Revenue</option>
                          <option value="profit">By Profit</option>
                          <option value="quantity">By Quantity</option>
                        </select>
                        <select className={styles['filter-select-sm']} value={topProductsLimit} onChange={(e) => setTopProductsLimit(Number(e.target.value))}>
                          <option value={5}>Top 5</option>
                          <option value={10}>Top 10</option>
                          <option value={20}>Top 20</option>
                        </select>
                      </div>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Product Name</th>
                              <th>Unit</th>
                              <th className={styles['text-right']}>Qty Sold</th>
                              <th className={styles['text-right']}>Revenue</th>
                              <th className={styles['text-right']}>Cost</th>
                              <th className={styles['text-right']}>Profit / Loss</th>
                              <th className={styles['text-right']}>Margin %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topProducts.length === 0 ? (
                              <tr><td colSpan={8} className={styles['no-data']}>No products found</td></tr>
                            ) : topProducts.map((product, index) => (
                              <tr key={index}>
                                <td>{index + 1}</td>
                                <td>
                                  <strong>{product.product_name}</strong>
                                  {product.type === 'service' && (
                                    <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>
                                  )}
                                </td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{product.unit}</span></td>
                                <td className={styles['text-right']}>{product.type === 'service' ? '-' : product.quantity_sold.toFixed(2)}</td>
                                <td className={styles['text-right']}>{formatPrice(product.revenue)}</td>
                                <td className={styles['text-right']}>{product.type === 'service' ? '-' : formatPrice(product.cost)}</td>
                                <td className={`${styles['text-right']} ${product.profit >= 0 ? styles['text-success'] : styles['text-danger']}`}>
                                  {formatPrice(product.profit)}
                                </td>
                                <td className={styles['text-right']}>
                                  <span className={`${styles['badge']} ${product.profit_margin >= 0 ? styles['badge-success'] : styles['badge-danger']}`}>
                                    {product.profit_margin.toFixed(1)}%
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Category Profitability Analysis</h5>
                      <button
                        className={styles['chart-expand-btn']}
                        onClick={() => setExpandedChart({
                          type: 'bar',
                          title: 'Category Profitability Analysis',
                          labels: categoryChartData.labels,
                          datasets: categoryChartData.datasets,
                        })}
                      >
                        <i className="fa fa-search-plus" />
                      </button>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['chart-canvas']}>
                      {categoryPerf.data.length > 0 && (
                          <Bar
                            ref={categoryChartRef}
                            data={categoryChartData}
                            options={{
                              ...axisChartOptions,
                              plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}` } } },
                            }}
                          />
                        )}
                      </div>
                      <div className={`${styles['table-container']} ${styles['table-margin-top']}`}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Category</th>
                              <th className={styles['text-right']}>Revenue</th>
                              <th className={styles['text-right']}>Cost</th>
                              <th className={styles['text-right']}>Profit / Loss</th>
                              <th className={styles['text-right']}>Margin %</th>
                              <th className={styles['text-right']}>Contribution %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {categoryPerf.data.length === 0 ? (
                              <tr><td colSpan={7} className={styles['no-data']}>No categories found</td></tr>
                            ) : categoryPerf.data.map((cat, index) => (
                              <tr key={index}>
                                <td>{index + 1}</td>
                                <td><strong>{cat.category}</strong></td>
                                <td className={styles['text-right']}>{formatPrice(cat.revenue)}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : formatPrice(cat.cost)}</td>
                                <td className={`${styles['text-right']} ${cat.profit >= 0 ? styles['text-success'] : styles['text-danger']}`}>
                                  {formatPrice(cat.profit)}
                                </td>
                                <td className={styles['text-right']}>
                                  <span className={`${styles['badge']} ${cat.profit_margin >= 0 ? styles['badge-success'] : styles['badge-danger']}`}>
                                    {cat.profit_margin.toFixed(1)}%
                                  </span>
                                </td>
                                <td className={styles['text-right']}>{cat.contribution_percentage.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination pagination={categoryPerf.pagination} onPageChange={setCategoryPage} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

{/* 5. RECEIVABLES AGING */}
{mountedTabs.receivables && (
            <div className={styles['tab-pane']} id="receivables" style={{ display: activeTab === 'receivables' ? 'block' : 'none' }}>
              {loadingReceivables && !receivables.summary && <TableSkeleton />}
              {errorReceivables && <ErrorState message={errorReceivables} onRetry={loadReceivables} />}
              {!errorReceivables && receivables.summary && (
                <>
                  <div className={styles['grid-three-col']}>
                    <div className={`${styles['stat-card']} ${styles['stat-danger']}`}>
                      <div className={styles['stat-label']}>Total Outstanding</div>
                      <div className={styles['stat-value']}>{formatPrice(receivables.summary.total_outstanding)}</div>
                      <div className={styles['stat-detail']}>{receivables.summary.total_invoices} invoices</div>
                    </div>
                    <div className={`${styles['stat-card']} ${styles['stat-warning']}`}>
                      <div className={styles['stat-label']}>Average Days Overdue</div>
                      <div className={styles['stat-value']}>{receivables.summary.average_days_overdue.toFixed(0)} days</div>
                      <div className={styles['stat-detail']}>Across overdue invoices</div>
                    </div>
                    <div className={`${styles['stat-card']} ${styles['stat-info']}`}>
                      <div className={styles['stat-label']}>61+ Days Overdue</div>
                      <div className={styles['stat-value']}>{formatPrice(receivables.summary.buckets[3].amount)}</div>
                      <div className={styles['stat-detail']}>{receivables.summary.buckets[3].count} invoices</div>
                    </div>
                  </div>

                  <div className={styles['grid-two-col']}>
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}><h5>Aging Buckets</h5></div>
                      <div className={styles['card-body']}>
                        <div className={styles['chart-canvas']}>
                        <Doughnut
                            data={{
                              labels: receivables.summary.buckets.map((b) => b.label),
                              datasets: [{
                                data: receivables.summary.buckets.map((b) => b.amount),
                                backgroundColor: generateDynamicColors(receivables.summary.buckets.length),
                              }],
                            }}
                            options={{
                              ...doughnutOptions,
                              plugins: { ...doughnutOptions.plugins, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } } },
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className={styles['content-card']}>
                      <div className={styles['card-header-flex']}>
                        <h5>Filter by Bucket</h5>
                        {receivablesBucket && (
                          <button
                            className={`btn ${styles['btn-primary']}`}
                            style={{ width: 'auto' }}
                            onClick={() => { setReceivablesBucket(''); setReceivablesPage(1); }}
                          >
                            Clear Filter
                          </button>
                        )}
                      </div>
                      <div className={styles['card-body']}>
                        <div className={styles['table-container']}>
                          <table className={styles['data-table']}>
                            <thead>
                              <tr>
                                <th>Bucket</th>
                                <th className={styles['text-right']}>Amount</th>
                                <th className={styles['text-right']}>Invoices</th>
                              </tr>
                            </thead>
                            <tbody>
                              {receivables.summary.buckets.map((b) => (
                                <tr
                                  key={b.key}
                                  onClick={() => { setReceivablesBucket(receivablesBucket === b.key ? '' : b.key); setReceivablesPage(1); }}
                                  style={{ cursor: 'pointer', background: receivablesBucket === b.key ? 'rgba(0,123,255,0.08)' : undefined }}
                                >
                                  <td><strong>{b.label}</strong></td>
                                  <td className={styles['text-right']}>{formatPrice(b.amount)}</td>
                                  <td className={styles['text-right']}>{b.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header-flex']}>
                      <h5>Outstanding Invoices</h5>
                      <div className={styles['header-controls']}>
                        <select
                          className={styles['filter-select-sm']}
                          value={receivablesSortBy}
                          onChange={(e) => { setReceivablesSortBy(e.target.value); setReceivablesPage(1); }}
                        >
                          <option value="days_overdue">Sort by Days Overdue</option>
                          <option value="remaining_balance">Sort by Outstanding Amount</option>
                          <option value="voucher_no">Sort by Invoice No</option>
                        </select>
                        <select
                          className={styles['filter-select-sm']}
                          value={receivablesSortOrder}
                          onChange={(e) => { setReceivablesSortOrder(e.target.value); setReceivablesPage(1); }}
                        >
                          <option value="desc">Descending</option>
                          <option value="asc">Ascending</option>
                        </select>
                      </div>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Invoice</th>
                              <th>Customer</th>
                              <th className={styles['text-right']}>Outstanding</th>
                              <th>Due Date</th>
                              <th className={styles['text-right']}>Days Overdue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receivables.invoices.length === 0 ? (
                              <tr><td colSpan={5} className={styles['no-data']}>No outstanding credit sales</td></tr>
                            ) : receivables.invoices.map((inv) => (
                              <tr key={inv.voucher_no}>
                                <td><strong>{inv.voucher_no}</strong></td>
                                <td>{inv.customer}</td>
                                <td className={styles['text-right']}>{formatPrice(inv.remaining_balance)}</td>
                                <td>{inv.due_date ? String(inv.due_date).slice(0, 10) : '-'}</td>
                                <td className={`${styles['text-right']} ${inv.days_overdue > 0 ? styles['text-danger'] : ''}`}>
                                  {inv.days_overdue > 0 ? `${inv.days_overdue} days` : 'Not due'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination pagination={receivables.pagination} onPageChange={setReceivablesPage} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 6. BREAKDOWN */}
          {mountedTabs.breakdown && (
            <div className={styles['tab-pane']} id="breakdown" style={{ display: activeTab === 'breakdown' ? 'block' : 'none' }}>
              {loadingReport && !report && <TableSkeleton />}
              {errorReport && <ErrorState message={errorReport} onRetry={loadReport} />}
              {!errorReport && report && (
                <>
                  <div className={styles['content-card']}>
                    <div className={styles['card-header-success']}><h5>Tax Collection Summary</h5></div>
                    <div className={styles['card-body']}>
                      <div className={styles['tax-summary-grid']}>
                        <div className={styles['tax-item']}>
                          <div className={styles['tax-label']}>Total Taxable Amount</div>
                          <div className={styles['tax-value']}>{formatPrice(report.tax_info.total_taxable_amount)}</div>
                        </div>
                        <div className={styles['tax-item']}>
                          <div className={styles['tax-label']}>Total Tax Collected</div>
                          <div className={styles['tax-value']}>{formatPrice(report.tax_info.total_tax_collected)}</div>
                        </div>
                        <div className={styles['tax-item']}>
                          <div className={styles['tax-label']}>Average Tax Rate</div>
                          <div className={styles['tax-value']}>{report.tax_info.avg_tax_rate.toFixed(2)}%</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}><h5>Complete Financial Breakdown</h5></div>
                    <div className={styles['card-body']}>
                      <div className={styles['breakdown-section']}>
                        <h6 className={styles['breakdown-title']}>Revenue Analysis</h6>
                        <table className={styles['breakdown-table']}>
                          <tbody>
                            <tr><td>Gross Sales</td><td>{formatPrice(report.sales_revenue.gross_sales)}</td></tr>
                            <tr><td>Less: Discounts</td><td className={styles['text-danger']}>({formatPrice(report.sales_revenue.total_discounts)})</td></tr>
                            <tr><td>Less: Returns</td><td className={styles['text-danger']}>({formatPrice(report.sales_revenue.total_returns)})</td></tr>
                            <tr className={styles['table-total']}><td><strong>Net Sales Revenue</strong></td><td><strong>{formatPrice(report.sales_revenue.net_sales_revenue)}</strong></td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className={styles['breakdown-section']}>
                        <h6 className={styles['breakdown-title']}>Cost of Goods Sold</h6>
                        <table className={styles['breakdown-table']}>
                          <tbody>
                            <tr><td>Total Cost of Goods Sold</td><td className={styles['text-danger']}>({formatPrice(report.cogs.total_cogs)})</td></tr>
                            <tr><td>COGS as % of Revenue</td><td>{report.financial_ratios.cogs_ratio.toFixed(1)}%</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className={styles['breakdown-section']}>
                        <h6 className={styles['breakdown-title']}>Operating Expenses</h6>
                        <table className={styles['breakdown-table']}>
                          <tbody>
                            {report.operating_expenses.breakdown.map((e, i) => (
                              <tr key={i}><td>{e.category}</td><td>{formatPrice(e.amount)}</td></tr>
                            ))}
                            <tr className={styles['table-total']}><td><strong>Total Operating Expenses</strong></td><td><strong>{formatPrice(report.operating_expenses.total_expenses)}</strong></td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className={styles['breakdown-section']}>
                        <h6 className={styles['breakdown-title']}>Final Profitability</h6>
                        <table className={styles['breakdown-table']}>
                          <tbody>
                            <tr><td>Gross Profit</td><td>{formatPrice(report.gross_profit.amount)}</td></tr>
                            <tr><td>Gross Profit Margin</td><td>{report.gross_profit.margin_percentage.toFixed(1)}%</td></tr>
                            <tr><td>Operating Profit (EBIT)</td><td>{formatPrice(report.operating_profit)}</td></tr>
                            <tr><td>Net Profit Margin</td><td><strong>{report.net_profit.margin_percentage.toFixed(1)}%</strong></td></tr>
                            <tr className={styles['table-total']}><td><strong>Net Profit</strong></td><td><strong>{formatPrice(report.net_profit.amount)}</strong></td></tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chart Expand Modal */}
      <ChartExpandModal expanded={expandedChart} onClose={() => setExpandedChart(null)} />
    </div>
  );
}