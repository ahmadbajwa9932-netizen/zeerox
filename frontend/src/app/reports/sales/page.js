// app/reports/sales/page.js
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import styles from './salesReport.module.css';
import { apiFetch } from '@/lib/api';
import { formatPrice } from "@/lib/currency-context";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend
);

/* ============================================================
   CONFIG / HELPERS
   TODO: move formatPrice to a shared currency util once the
   Fastify /settings endpoint (currency symbol/locale) is wired up.
   ============================================================ */



function formatDate(dateString) {
  if (!dateString) return '-';
  // MySQL returns 'YYYY-MM-DD HH:MM:SS' (space-separated) — not all
  // browsers parse that reliably via new Date(), so normalize it first.
  const date = new Date(String(dateString).replace(' ', 'T'));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
}

function formatDiscountTax(type, value, amount) {
  if (type === 'percentage') {
    return `${parseFloat(value || 0).toFixed(2)}% (${formatPrice(amount)})`;
  }
  return formatPrice(amount);
}

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

// Drops leading/trailing zero-value entries (e.g. months with no sales
// at all) so a wide date_range filter doesn't render as a flat line
// padded with empty days on both ends.
function trimLeadingTrailingZeros(rows, valueKey) {
  let start = 0;
  let end = rows.length - 1;
  while (start < rows.length && Number(rows[start][valueKey]) === 0) start++;
  while (end >= 0 && Number(rows[end][valueKey]) === 0) end--;
  if (start > end) return [];
  return rows.slice(start, end + 1);
}

// Evenly samples down to at most maxPoints — used to keep the inline
// (non-expanded) charts readable; the expand modal always gets the
// untouched full dataset instead.
function downsampleToMax(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(rows[Math.floor(i * step)]);
  }
  return result;
}

// Weekly buckets get a 2-line tick: "Week 1" on top, month underneath.
// Chart.js renders array labels as multiple lines automatically.
function formatTimeLabel(d) {
  if (d.week_label) return d.week_month ? [d.week_label, d.week_month] : d.week_label;
  return d.day_name || d.time_label;
}

// analysis_type=hourly/weekly return time_label/week_label instead of
// day_name — this picks whichever one the current bucket actually has.
function getPeakLabel(peak) {
  if (!peak) return '-';
  return peak.day_name || peak.time_label || peak.week_label || '-';
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'fa-chart-line' },
  { id: 'products', label: 'Products', icon: 'fa-box' },
  { id: 'categories', label: 'Categories', icon: 'fa-tags' },
  { id: 'transactions', label: 'Transactions', icon: 'fa-receipt' },
  { id: 'tax', label: 'Tax Report', icon: 'fa-percentage' },
  { id: 'time', label: 'Time Analysis', icon: 'fa-clock' },
];


/* ============================================================
   SMALL REUSABLE PIECES
   ============================================================ */

   function Spinner() {
    return <div className={styles['spinner']} />;
  }
  
  function CardsSkeleton({ count = 5 }) {
    return (
      <div className={styles['comparison-cards']}>
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
    return (
      <div className={`${styles['chart-canvas-lg']} ${styles['skeleton-line']} ${styles['skeleton-chart']}`} />
    );
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
   Mirrors the Laravel behaviour: doughnut -> bar on expand,
   horizontal scroll for charts with many labels.
   ============================================================ */

function ChartExpandModal({ expanded, onClose }) {
  if (!expanded) return null;

  const { title, type, labels, values, isPercent, isMoney } = expanded;
  const needsScroll = labels.length > 30;
  const colors = expanded.colors || generateDynamicColors(labels.length);

  const chartType = type === 'doughnut' ? 'bar' : type;

  const lineGradientFill = (ctx) => {
    const { chart } = ctx;
    const { ctx: canvasCtx, chartArea } = chart;
    if (!chartArea) return 'rgba(20,184,166,0.2)';
    const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(20,184,166,0.45)');
    gradient.addColorStop(1, 'rgba(20,184,166,0)');
    return gradient;
  };

  const data = {
    labels,
    datasets: [
      {
        label: title,
        data: values,
        backgroundColor: type === 'line' ? lineGradientFill : colors,
        borderColor: type === 'line' ? '#14b8a6' : colors.map(darkenColor),
        borderWidth: type === 'line' ? 2 : 1,
        tension: type === 'line' ? 0.35 : undefined,
        fill: type === 'line' ? true : undefined,
        pointRadius: type === 'line' ? 3 : undefined,
        pointBackgroundColor: type === 'line' ? '#14b8a6' : undefined,
        pointBorderColor: type === 'line' ? '#fff' : undefined,
        pointBorderWidth: type === 'line' ? 1 : undefined,
        pointHoverRadius: type === 'line' ? 5 : undefined,
      },
    ],
  };

  const options = {
    responsive: !needsScroll,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: chartType === 'line', position: 'top' },
      tooltip: isPercent
      ? { callbacks: { label: (ctx) => `${ctx.label}: ${Number(ctx.parsed.y ?? ctx.parsed).toFixed(2)}%` } }
      : isMoney
      ? { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed.y ?? ctx.parsed)}` } }
      : {},
    },
    scales: {
      y: { beginAtZero: true },
      x: {
        ticks: {
          maxRotation: 65,
          minRotation: 45,
          autoSkip: needsScroll ? false : true,
          maxTicksLimit: needsScroll ? undefined : 20,
        },
      },
    },
  };

  const chartHeight = 500;
  const chartWidth = needsScroll ? Math.max(labels.length * 50, 800) : undefined;

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
        <div style={{ width: '100%', height: '70vh', overflow: needsScroll ? 'auto' : 'hidden' }}>
          {chartType === 'bar' && (
            <Bar data={data} options={options} width={chartWidth} height={chartHeight} redraw />
          )}
          {chartType === 'line' && (
            <Line data={data} options={options} width={chartWidth} height={chartHeight} redraw />
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MAIN PAGE
   ============================================================ */

export default function SalesReportPage() {
  const [activeTab, setActiveTab] = useState('overview');

  // Filters
  const [dateRange, setDateRange] = useState('today');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Loading
 // Per-tab loading / caching / error state (mirrors dashboard's pattern)
 const [mountedTabs, setMountedTabs] = useState({
  overview: true, products: false, categories: false,
  transactions: false, tax: false, time: false,
});
const [loadedTabs, setLoadedTabs] = useState({
  overview: false, products: false, categories: false,
  transactions: false, tax: false, time: false,
});
const [loadingTabs, setLoadingTabs] = useState({
  overview: true, products: false, categories: false,
  transactions: false, tax: false, time: false,
});
const [errorTabs, setErrorTabs] = useState({
  overview: null, products: null, categories: null,
  transactions: null, tax: null, time: null,
});

const abortRef = useRef(null);

  // Overview
  const [overview, setOverview] = useState(null);
  const [hiddenValues, setHiddenValues] = useState({}); // key -> bool (true = hidden)

  // Products
  const [products, setProducts] = useState({ data: [], pagination: null });
  const [productSortBy, setProductSortBy] = useState('revenue');
  const [productSortOrder, setProductSortOrder] = useState('desc');
  const [productPage, setProductPage] = useState(1);

   // Categories
   const [categories, setCategories] = useState({ data: [], pagination: null });
   const [categoryPage, setCategoryPage] = useState(1);
   // Unpaginated snapshot used only for the expand-chart modal
   const [categoriesChart, setCategoriesChart] = useState({ data: [] });

  // Transactions
  const [transactions, setTransactions] = useState({ data: [], pagination: null });
  const [transactionPage, setTransactionPage] = useState(1);
  const [filterPaymentType, setFilterPaymentType] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [searchInvoice, setSearchInvoice] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState(null);

  // Tax
  const [tax, setTax] = useState(null);
  const [taxGroupBy, setTaxGroupBy] = useState('daily');

  // Time analysis
  const [timeAnalysis, setTimeAnalysis] = useState(null);
  const [timeAnalysisType, setTimeAnalysisType] = useState('hourly');

  // Chart expand modal
  const [expandedChart, setExpandedChart] = useState(null);

  const showHourlyOption = useMemo(() => {
    if (dateRange === 'today' || dateRange === 'yesterday') return true;
    if (dateRange === 'custom') {
      const diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
      return diffDays <= 1;
    }
    return false;
  }, [dateRange, startDate, endDate]);

  const showDailyOption = useMemo(() => {
    if (dateRange === 'today' || dateRange === 'yesterday' || dateRange === 'this_week' || dateRange === 'last_week') return true;
    if (dateRange === 'custom') {
      const diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
      return diffDays <= 7;
    }
    return false;
  }, [dateRange, startDate, endDate]);

  useEffect(() => {
    if (!showHourlyOption && timeAnalysisType === 'hourly') {
      setTimeAnalysisType('daily');
    }
  }, [showHourlyOption, timeAnalysisType]);

  useEffect(() => {
    if (!showDailyOption && timeAnalysisType === 'daily') {
      setTimeAnalysisType('weekly');
    }
  }, [showDailyOption, timeAnalysisType]);

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

  const loadOverview = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, overview: true }));
    setErrorTabs((prev) => ({ ...prev, overview: null }));

    const params = buildDateParams();

    apiFetch(`/api/reports/sales/date-range?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load overview');
        setOverview(json.data);
        setLoadedTabs((prev) => ({ ...prev, overview: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, overview: 'Could not load overview data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, overview: false }));
      });
  }, [dateRange, startDate, endDate]);

  const loadProducts = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, products: true }));
    setErrorTabs((prev) => ({ ...prev, products: null }));

    const params = buildDateParams();
    params.set('sort_by', productSortBy);
    params.set('sort_order', productSortOrder);
    params.set('page', productPage);

    apiFetch(`/api/reports/sales/products?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load products');
        setProducts({ data: json.data, pagination: json.pagination });
        setLoadedTabs((prev) => ({ ...prev, products: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, products: 'Could not load product data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, products: false }));
      });
  }, [productSortBy, productSortOrder, productPage, dateRange, startDate, endDate]);

  const loadCategories = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, categories: true }));
    setErrorTabs((prev) => ({ ...prev, categories: null }));

    const params = buildDateParams();
    params.set('page', categoryPage);

    apiFetch(`/api/reports/sales/categories?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load categories');
        setCategories({ data: json.data, pagination: json.pagination });
        setLoadedTabs((prev) => ({ ...prev, categories: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, categories: 'Could not load category data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, categories: false }));
      });
    }, [categoryPage, dateRange, startDate, endDate]);

    const loadCategoriesChart = useCallback(() => {
      const params = buildDateParams();
      params.set('page', 1);
      params.set('page_size', 100); // enough to cover "all categories" for charting
  
      apiFetch(`/api/reports/sales/categories?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
        .then((json) => {
          if (json.success) setCategoriesChart({ data: json.data });
        })
        .catch(() => {}); // chart-only data; a silent miss just keeps the old chart
    }, [dateRange, startDate, endDate]);

  const loadTransactions = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, transactions: true }));
    setErrorTabs((prev) => ({ ...prev, transactions: null }));

    const params = buildDateParams();
    if (filterPaymentType) params.set('payment_type', filterPaymentType);
    if (filterCustomer) params.set('customer_id', filterCustomer);
    if (searchInvoice) params.set('invoice_no', searchInvoice);
    params.set('page', transactionPage);

    apiFetch(`/api/reports/sales/transactions?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load transactions');
        setTransactions({ data: json.data, pagination: json.pagination });
        setLoadedTabs((prev) => ({ ...prev, transactions: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, transactions: 'Could not load transactions. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, transactions: false }));
      });
  }, [filterPaymentType, filterCustomer, searchInvoice, transactionPage, dateRange, startDate, endDate]);

  const loadTax = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, tax: true }));
    setErrorTabs((prev) => ({ ...prev, tax: null }));

    const params = buildDateParams();
    params.set('group_by', taxGroupBy);

    apiFetch(`/api/reports/sales/tax?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load tax report');
        setTax(json.data);
        setLoadedTabs((prev) => ({ ...prev, tax: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, tax: 'Could not load tax data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, tax: false }));
      });
  }, [taxGroupBy, dateRange, startDate, endDate]);

  const loadTimeAnalysis = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, time: true }));
    setErrorTabs((prev) => ({ ...prev, time: null }));

    const params = buildDateParams();
    params.set('analysis_type', timeAnalysisType);

    apiFetch(`/api/reports/sales/time-analysis?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load time analysis');
        setTimeAnalysis(json.data);
        setLoadedTabs((prev) => ({ ...prev, time: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, time: 'Could not load time analysis. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, time: false }));
      });
  }, [timeAnalysisType, dateRange, startDate, endDate]);

  const loadTabById = useCallback((tabId) => {
    switch (tabId) {
      case 'overview': return loadOverview();
      case 'products': return loadProducts();
      case 'categories':
        loadCategories();
        return loadCategoriesChart();
      case 'transactions': return loadTransactions();
      case 'tax': return loadTax();
      case 'time': return loadTimeAnalysis();
      default: return;
    }
  }, [loadOverview, loadProducts, loadCategories, loadCategoriesChart, loadTransactions, loadTax, loadTimeAnalysis]);

  // Initial load only — mirrors dashboard's mount-once effect
  useEffect(() => {
    loadOverview();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
    setMountedTabs((prev) => ({ ...prev, [tabId]: true }));
    if (!loadedTabs[tabId]) {
      loadTabById(tabId);
    }
  };

  useEffect(() => {
    if (activeTab === 'products') loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSortBy, productSortOrder, productPage]);

  useEffect(() => {
    if (activeTab === 'categories') loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryPage]);

  useEffect(() => {
    if (activeTab === 'transactions') loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPaymentType, filterCustomer, transactionPage]);

  useEffect(() => {
    if (activeTab === 'tax') loadTax();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxGroupBy]);

  useEffect(() => {
    if (activeTab === 'time') loadTimeAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeAnalysisType]);

  function handleGenerate() {
    // Filters changed — every tab's cached data is now stale. Reset
    // loadedTabs for ALL tabs (not just the active one) so switching to
    // any other tab auto-refetches with the new filters, exactly like
    // the dashboard. Only the active tab fetches right now; the rest
    // fetch lazily the moment you click into them.
    setLoadedTabs({
      overview: false, products: false, categories: false,
      transactions: false, tax: false, time: false,
    });
    loadTabById(activeTab);
  }

  function toggleHidden(key) {
    setHiddenValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /* ---------- derived chart data ---------- */

  const categoryColors = useMemo(
    () => generateDynamicColors(categories.data.length),
    [categories.data.length]
  );

  const categoriesChartColors = useMemo(
    () => generateDynamicColors(categoriesChart.data.length),
    [categoriesChart.data.length]
  );

  const categoryRevenueChartData = {
    labels: categories.data.map((c) => c.category),
    datasets: [{
      label: 'Revenue',
      data: categories.data.map((c) => c.revenue),
      backgroundColor: categoryColors,
      borderColor: categoryColors.map(darkenColor),
      borderWidth: 1,
    }],
  };

  const categoryProfitChartData = {
    labels: categories.data.map((c) => c.category),
    datasets: [{
      data: categories.data.map((c) => c.profit_margin),
      backgroundColor: categoryColors,
    }],
  };

  // Drop the no-sales padding at both ends of the range before charting.
  const taxTrimmedData = tax ? trimLeadingTrailingZeros(tax.data, 'tax_collected') : [];
  const taxDownsampled = downsampleToMax(taxTrimmedData, 30);

  const taxChartData = tax ? {
    labels: taxDownsampled.map((d) => (taxGroupBy === 'daily' ? d.date : d.month)),
    datasets: [{
      label: 'Tax Collected',
      data: taxDownsampled.map((d) => d.tax_collected),
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
      pointBorderWidth: 1,
      pointHoverRadius: 5,
      borderWidth: 2,
    }],
  } : null;

  const timeChartRows = timeAnalysis ? downsampleToMax(timeAnalysis.data, 10) : [];

  const timeChartData = timeAnalysis ? {
    labels: timeChartRows.map((d) => formatTimeLabel(d)),
    datasets: [{
      label: 'Revenue',
      data: timeChartRows.map((d) => d.revenue),
      backgroundColor: 'rgba(153, 102, 255, 0.6)',
      borderColor: 'rgba(153, 102, 255, 1)',
      borderWidth: 1,
    }],
  } : null;

  const axisChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true },
      x: { ticks: { maxRotation: 65, minRotation: 45, autoSkip: true } },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
  };

  /* ---------- metric cards config ---------- */

  const metricCards = overview ? [
    { key: 'revenue', label: 'Revenue', icon: 'fa-dollar-sign', color: 'primary', money: true },
    { key: 'transactions', label: 'Transactions', icon: 'fa-receipt', color: 'success', money: false },
    { key: 'items_sold', label: 'Items Sold', icon: 'fa-box', color: 'info', money: false },
    { key: 'avg_order_value', label: 'Avg Order Value', icon: 'fa-chart-line', color: 'warning', money: true },
    {
      key: 'profit',
      label: overview.current.profit >= 0 ? 'Profit' : 'Loss',
      icon: overview.current.profit >= 0 ? 'fa-hand-holding-usd' : 'fa-exclamation-triangle',
      color: overview.current.profit >= 0 ? 'success' : 'danger',
      money: true,
    },
  ] : [];

  return (
    <div className="container">
      {/* Header */}
        <div className="main-text">
          <h2><i className="fas fa-chart-bar" /> Sales Report</h2>
          <p className="sub-text">Detailed sales analysis and insights</p>
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
              <option value="this_quarter">This Quarter</option>
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
          {/* 1. OVERVIEW */}
          {mountedTabs.overview && (
            <div className={styles['tab-pane']} id="overview" style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
              {loadingTabs.overview && !overview && <CardsSkeleton count={5} />}
              {errorTabs.overview && <ErrorState message={errorTabs.overview} onRetry={() => loadTabById('overview')} />}
              {!errorTabs.overview && (
              <>
              <div className={styles['comparison-cards']} id="comparisonCards">
                {overview && metricCards.map((metric) => {
                  const isNegativeProfit = metric.key === 'profit' && overview.current.profit < 0;
                  const change = overview.changes[metric.key];
                  const displayValue = metric.money
                    ? formatPrice(Math.abs(overview.current[metric.key]))
                    : Math.round(overview.current[metric.key]);
                  const hidden = hiddenValues[metric.key];

                  return (
                    <div className={`${styles['metric-card']} ${styles[`metric-${metric.color}`]}`} key={metric.key}>
                      <div className={styles['metric-head']}>
                        <div className={styles['metric-head-left']}>
                          <i className={`fas ${metric.icon} ${styles['metric-icon']}`} />
                          <span className={styles['metric-label']}>{metric.label}</span>
                        </div>
                        {metric.money && (
                          <EyeToggle visible={!hidden} onClick={() => toggleHidden(metric.key)} />
                        )}
                      </div>
                      <div className={`${styles['metric-value']} ${isNegativeProfit ? styles['text-danger'] : ''}`}>
                        {metric.money ? (hidden ? '••••••' : displayValue) : displayValue}
                      </div>
                      <div className={`${styles['metric-badge']} ${styles[`badge-${change.trend}`] || ''}`}>
                        <i className={`fas fa-arrow-${change.trend === 'up' ? 'up' : change.trend === 'down' ? 'down' : 'right'}`} />
                        {' '}{Math.abs(change.percent).toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles['content-card']}>
                <div className={styles['card-header-primary']}>
                  <h5>Period Comparison</h5>
                </div>
                <div className={styles['card-body']}>
                  {overview ? (
                    <div className={styles['comparison-grid']} id="comparisonDetails">
                      <div className={styles['comparison-col']}>
                        <h5>Previous Period ({overview.period.previous.start} - {overview.period.previous.end})</h5>
                        <table className={styles['comparison-table']}>
                          <tbody>
                            <tr><td>Revenue:</td><td className={styles['value-bold']}>{formatPrice(overview.previous.revenue)}</td></tr>
                            <tr><td>Transactions:</td><td className={styles['value-bold']}>{Math.round(overview.previous.transactions)}</td></tr>
                            <tr><td>Items Sold:</td><td className={styles['value-bold']}>{Math.round(overview.previous.items_sold)}</td></tr>
                            <tr><td>Avg Order Value:</td><td className={styles['value-bold']}>{formatPrice(overview.previous.avg_order_value)}</td></tr>
                            <tr>
                              <td>{overview.previous.profit >= 0 ? 'Profit' : 'Loss'}:</td>
                              <td className={`${styles['value-bold']} ${overview.previous.profit < 0 ? styles['text-danger'] : styles['text-success']}`}>
                                {formatPrice(Math.abs(overview.previous.profit))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className={styles['comparison-col']}>
                        <h5>Current Period ({overview.period.current.start} - {overview.period.current.end})</h5>
                        <table className={styles['comparison-table']}>
                          <tbody>
                            <tr><td>Revenue:</td><td className={styles['value-bold']}>{formatPrice(overview.current.revenue)}</td></tr>
                            <tr><td>Transactions:</td><td className={styles['value-bold']}>{Math.round(overview.current.transactions)}</td></tr>
                            <tr><td>Items Sold:</td><td className={styles['value-bold']}>{Math.round(overview.current.items_sold)}</td></tr>
                            <tr><td>Avg Order Value:</td><td className={styles['value-bold']}>{formatPrice(overview.current.avg_order_value)}</td></tr>
                            <tr>
                              <td>{overview.current.profit >= 0 ? 'Profit' : 'Loss'}:</td>
                              <td className={`${styles['value-bold']} ${overview.current.profit < 0 ? styles['text-danger'] : styles['text-success']}`}>
                                {formatPrice(Math.abs(overview.current.profit))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className={styles['loading-state']}><Spinner /></div>
                  )}
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 2. PRODUCTS */}
          {mountedTabs.products && (
            <div className={styles['tab-pane']} id="products" style={{ display: activeTab === 'products' ? 'block' : 'none' }}>
              {loadingTabs.products && products.data.length === 0 && <TableSkeleton />}
              {errorTabs.products && <ErrorState message={errorTabs.products} onRetry={() => loadTabById('products')} />}
              {!errorTabs.products && (
              <>
              <div className={styles['content-card']}>
                <div className={styles['card-header-flex']}>
                  <h5>Product-wise Sales Report</h5>
                  <div className={styles['header-controls']}>
                    <select className={styles['filter-select-sm']} value={productSortBy} onChange={(e) => setProductSortBy(e.target.value)}>
                      <option value="revenue">Sort by Revenue</option>
                      <option value="quantity">Sort by Quantity</option>
                      <option value="profit">Sort by Profit</option>
                    </select>
                    <select className={styles['filter-select-sm']} value={productSortOrder} onChange={(e) => setProductSortOrder(e.target.value)}>
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
                          <th>#</th>
                          <th>Product Name</th>
                          <th>Unit</th>
                          <th className={styles['text-right']}>Qty Sold</th>
                          <th className={styles['text-right']}>Revenue</th>
                          <th className={styles['text-right']}>Cost</th>
                          <th className={styles['text-right']}>Profit / Loss</th>
                          <th className={styles['text-right']}>Profit / Loss%</th>
                          <th className={styles['text-right']}>Avg Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.data.length === 0 ? (
                          <tr><td colSpan={9} className={styles['no-data']}>No products found</td></tr>
                        ) : products.data.map((product, index) => (
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
                            <td className={styles['text-right']}>{formatPrice(product.avg_selling_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination pagination={products.pagination} onPageChange={setProductPage} />
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 3. CATEGORIES */}
          {mountedTabs.categories && (
            <div className={styles['tab-pane']} id="categories" style={{ display: activeTab === 'categories' ? 'block' : 'none' }}>
              {loadingTabs.categories && categories.data.length === 0 && <TableSkeleton />}
              {errorTabs.categories && <ErrorState message={errorTabs.categories} onRetry={() => loadTabById('categories')} />}
              {!errorTabs.categories && (
              <>
              <div className={styles['grid-two-col']}>
                <div className={styles['content-card']}>
                  <div className={styles['card-header']}>
                    <h5>Category Performance</h5>
                    <button
                      className={styles['chart-expand-btn']}
                      onClick={() => setExpandedChart({
                        type: 'bar',
                        title: 'Category Performance',
                        labels: categoriesChart.data.map((c) => c.category),
                        values: categoriesChart.data.map((c) => c.revenue),
                        colors: categoriesChartColors,
                        isMoney: true,
                      })}
                    >
                      <i className="fa fa-search-plus" />
                    </button>
                  </div>
                  <div className={styles['card-body']}>
                  <div className={styles['chart-canvas']}>
                      <Bar
                        data={categoryRevenueChartData}
                        options={{
                          ...axisChartOptions,
                          plugins: { tooltip: { callbacks: { label: (ctx) => `Revenue: ${formatPrice(ctx.parsed.y)}` } } },
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className={styles['content-card']}>
                  <div className={styles['card-header']}>
                    <h5>Category Profit Margin</h5>
                    <button
                      className={styles['chart-expand-btn']}
                      onClick={() => setExpandedChart({
                        type: 'doughnut',
                        title: 'Category Profit Margin',
                        labels: categoriesChart.data.map((c) => c.category),
                        values: categoriesChart.data.map((c) => c.profit_margin),
                        colors: categoriesChartColors,
                        isPercent: true,
                      })}
                    >
                      <i className="fa fa-search-plus" />
                    </button>
                  </div>
                  <div className={styles['card-body']}>
                    <div className={styles['chart-canvas']}>
                      <Doughnut data={categoryProfitChartData} options={doughnutOptions} />
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles['content-card']}>
                <div className={styles['card-body']}>
                  <div className={styles['table-container']}>
                    <table className={styles['data-table']}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Category</th>
                          <th className={styles['text-right']}>Revenue</th>
                          <th className={styles['text-right']}>Cost</th>
                          <th className={styles['text-right']}>Profit / Loss</th>
                          <th className={styles['text-right']}>Margin %</th>
                          <th className={styles['text-right']}>Transactions</th>
                          <th className={styles['text-right']}>Items Sold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.data.length === 0 ? (
                          <tr><td colSpan={8} className={styles['no-data']}>No categories found</td></tr>
                        ) : categories.data.map((cat, index) => (
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
                            <td className={styles['text-right']}>{cat.transactions}</td>
                            <td className={styles['text-right']}>{cat.type === 'service' ? '-' : cat.items_sold.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination pagination={categories.pagination} onPageChange={setCategoryPage} />
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 4. TRANSACTIONS */}
          {mountedTabs.transactions && (
            <div className={styles['tab-pane']} id="transactions" style={{ display: activeTab === 'transactions' ? 'block' : 'none' }}>
              {loadingTabs.transactions && transactions.data.length === 0 && <TableSkeleton />}
              {errorTabs.transactions && <ErrorState message={errorTabs.transactions} onRetry={() => loadTabById('transactions')} />}
              {!errorTabs.transactions && (
              <>
              <div className={styles['content-card']}>
                <div className={styles['card-body']}>
                  <div className={styles['filter-row']}>
                    <div className={styles['filter-col']}>
                      <label className={styles['filter-label']}>Payment Type</label>
                      <select className={styles['filter-select']} value={filterPaymentType} onChange={(e) => setFilterPaymentType(e.target.value)}>
                        <option value="">All</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="credit">Credit</option>
                        <option value="advance">Advance</option>
                      </select>
                    </div>
                    <div className={styles['filter-col']}>
                      <label className={styles['filter-label']}>Customer</label>
                      <select className={styles['filter-select']} value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}>
                        <option value="">All Customers</option>
                        {/* TODO: populate from /api/customers */}
                      </select>
                    </div>
                    <div className={styles['filter-col']}>
                      <label className={styles['filter-label']}>Search Invoice</label>
                      <input
                        type="text" className={styles['filter-input']} placeholder="Invoice No..."
                        value={searchInvoice} onChange={(e) => setSearchInvoice(e.target.value)}
                      />
                    </div>
                    <div className={styles['filter-col']}>
                      <label className={styles['filter-label']}>&nbsp;</label>
                      <button className={`btn ${styles['btn-primary']}`} onClick={loadTransactions} style={{ width: 'auto' }}>
                        <i className="fas fa-filter" /> Apply Filters
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles['content-card']}>
                <div className={styles['card-body']}>
                  <div className={styles['table-container']}>
                    <table className={`${styles['data-table']} ${styles['table-compact']}`}>
                      <thead>
                        <tr>
                          <th>Invoice No</th>
                          <th>Date &amp; Time</th>
                          <th>Customer</th>
                          <th>Payment</th>
                          <th className={styles['text-right']}>Subtotal</th>
                          <th className={styles['text-right']}>Discount</th>
                          <th className={styles['text-right']}>Tax</th>
                          <th className={styles['text-right']}>Total</th>
                          <th className={styles['text-right']}>Net Amount</th>
                          <th className={styles['text-right']}>Paid</th>
                          <th className={styles['text-right']}>Balance</th>
                          <th className={styles['text-right']}>Status</th>
                          <th className={styles['text-right']}>Profit / Loss</th>
                          <th className={styles['text-center']}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.data.length === 0 ? (
                          <tr><td colSpan={14} className={styles['no-data']}>No transactions found</td></tr>
                        ) : transactions.data.map((t) => (
                          <tr key={t.id}>
                            <td><strong>{t.voucher_no}</strong></td>
                            <td>{formatDate(t.date)}</td>
                            <td>{t.customer}</td>
                            <td><span className={`${styles['badge']} ${styles[`badge-${t.payment_type.toLowerCase()}`] || ''}`}>{t.payment_type}</span></td>
                            <td className={styles['text-right']}>{formatPrice(t.subtotal)}</td>
                            <td className={styles['text-right']}>{formatDiscountTax(t.discount_type, t.discount_value, t.discount)}</td>
                            <td className={styles['text-right']}>{formatDiscountTax(t.tax_type, t.tax_value, t.tax)}</td>
                            <td className={styles['text-right']}><strong>{formatPrice(t.grand_total)}</strong></td>
                            <td className={styles['text-right']}>{formatPrice(t.net_amount)}</td>
                            <td className={`${styles['text-right']} ${styles['text-success']}`}>{formatPrice(t.paid_amount)}</td>
                            <td className={`${styles['text-right']} ${t.remaining_balance > 0 ? styles['text-danger'] : ''}`}>{formatPrice(t.remaining_balance)}</td>
                            <td className={styles['text-center']}>
                              <span className={`${styles['badge']} ${
                                t.return_status === 'unpaid' ? styles['badge-danger']
                                  : t.return_status === 'partial' ? styles['badge-warning']
                                  : styles['badge-success']
                              }`}>
                                {t.return_status.charAt(0).toUpperCase() + t.return_status.slice(1)}
                              </span>
                            </td>
                            <td className={`${styles['text-right']} ${t.profit >= 0 ? styles['text-success'] : styles['text-danger']}`}>
                              {formatPrice(t.profit)}
                            </td>
                            <td className={styles['text-center']}>
                              <button className={styles['btn-action']} onClick={() => setSelectedTransaction(t)}>View</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination pagination={transactions.pagination} onPageChange={setTransactionPage} />
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 5. TAX REPORT */}
          {mountedTabs.tax && (
            <div className={styles['tab-pane']} id="tax" style={{ display: activeTab === 'tax' ? 'block' : 'none' }}>
              {loadingTabs.tax && !tax && <ChartSkeleton />}
              {errorTabs.tax && <ErrorState message={errorTabs.tax} onRetry={() => loadTabById('tax')} />}
              {!errorTabs.tax && (
              <>
              <div className={styles['grid-three-col']}>
                <div className={`${styles['stat-card']} stat-primary`}>
                  <div className={styles['stat-label']}>Total Taxable Amount</div>
                  <div className={styles['stat-value']}>{tax ? formatPrice(tax.summary.total_taxable_amount) : formatPrice(0)}</div>
                </div>
                <div className={`${styles['stat-card']} stat-success`}>
                  <div className={styles['stat-label']}>Total Tax Collected</div>
                  <div className={styles['stat-value']}>{tax ? formatPrice(tax.summary.total_tax_collected) : formatPrice(0)}</div>
                </div>
                <div className={`${styles['stat-card']} stat-info`}>
                  <div className={styles['stat-label']}>Average Tax Rate</div>
                  <div className={styles['stat-value']}>{tax ? tax.summary.avg_tax_rate.toFixed(2) : '0.00'}%</div>
                </div>
              </div>

              <div className={styles['content-card']}>
                <div className={styles['card-header-flex']}>
                  <h5>Tax Collection Details</h5>
                  <div>
                  <button
                      className={styles['chart-expand-btn']}
                      onClick={() => taxTrimmedData.length > 0 && setExpandedChart({
                        type: 'line',
                        title: 'Tax Collection Details',
                        labels: taxTrimmedData.map((d) => (taxGroupBy === 'daily' ? d.date : d.month)),
                        values: taxTrimmedData.map((d) => d.tax_collected),
                        isMoney: true,
                      })}
                    >
                      <i className="fa fa-search-plus" />
                    </button>
                    <select className={styles['filter-select-sm']} value={taxGroupBy} onChange={(e) => setTaxGroupBy(e.target.value)}>
                      <option value="daily">Daily</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div className={styles['card-body']}>
                <div className={styles['chart-canvas-lg']}>
                    {taxChartData && (
                      <Line
                        data={taxChartData}
                        options={{
                          ...axisChartOptions,
                          plugins: { tooltip: { callbacks: { label: (ctx) => `Tax Collected: ${formatPrice(ctx.parsed.y)}` } } },
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {/* 6. TIME ANALYSIS */}
          {mountedTabs.time && (
            <div className={styles['tab-pane']} id="time" style={{ display: activeTab === 'time' ? 'block' : 'none' }}>
              {loadingTabs.time && !timeAnalysis && <ChartSkeleton />}
              {errorTabs.time && <ErrorState message={errorTabs.time} onRetry={() => loadTabById('time')} />}
              {!errorTabs.time && (
              <>
              <div className={styles['content-card']}>
                <div className={styles['card-header-flex']}>
                  <h5>Sales Pattern Analysis</h5>
                  <div>
                  <button
                      className={styles['chart-expand-btn']}
                      onClick={() => timeAnalysis && setExpandedChart({
                        type: 'bar',
                        title: 'Sales Pattern Analysis',
                        labels: timeAnalysis.data.map((d) => formatTimeLabel(d)),
                        values: timeAnalysis.data.map((d) => d.revenue),
                        isMoney: true,
                      })}
                    >
                      <i className="fa fa-search-plus" />
                    </button>
                    <select className={styles['filter-select-sm']} value={timeAnalysisType} onChange={(e) => setTimeAnalysisType(e.target.value)}>
                    {showHourlyOption && <option value="hourly">Hourly</option>}
                      {showDailyOption && <option value="daily">Day of Week</option>}
                      <option value="weekly">Weekly</option>
                    </select>
                  </div>
                </div>
                <div className={styles['card-body']}>
                <div className={styles['chart-canvas-lg']}>
                    {timeChartData && (
                      <Bar
                        data={timeChartData}
                        options={{
                          ...axisChartOptions,
                          plugins: { tooltip: { callbacks: { label: (ctx) => `Revenue: ${formatPrice(ctx.parsed.y)}` } } },
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className={styles['grid-two-col']}>
              <div className={styles['content-card']}>
                  <div className={styles['card-header-success']}><h5>Peak Revenue Time</h5></div>
                  <div className={styles['card-body']}>
                    {timeAnalysis ? (
                      <>
                        <h3 className={styles['peak-time']}>{getPeakLabel(timeAnalysis.peak_revenue_time)}</h3>
                        <p className={styles['peak-detail']}>Revenue: <strong>{formatPrice(timeAnalysis.peak_revenue_time?.revenue)}</strong></p>
                        <p className={styles['peak-detail']}>Transactions: <strong>{timeAnalysis.peak_revenue_time?.transactions ?? 0}</strong></p>
                      </>
                    ) : <div className={styles['loading-state']}><Spinner /></div>}
                  </div>
                </div>
                <div className={styles['content-card']}>
                  <div className={styles['card-header-info']}><h5>Peak Transaction Time</h5></div>
                  <div className={styles['card-body']}>
                    {timeAnalysis ? (
                      <>
                        <h3 className={styles['peak-time']}>{getPeakLabel(timeAnalysis.peak_transactions_time)}</h3>
                        <p className={styles['peak-detail']}>Transactions: <strong>{timeAnalysis.peak_transactions_time?.transactions ?? 0}</strong></p>
                        <p className={styles['peak-detail']}>Revenue: <strong>{formatPrice(timeAnalysis.peak_transactions_time?.revenue)}</strong></p>
                      </>
                    ) : <div className={styles['loading-state']}><Spinner /></div>}
                    </div>
                  </div>
                </div>
                </>
                )}
              </div>
            )}
          </div>
        </div>
  
        {/* Transaction Details Modal */}
      {selectedTransaction && (
        <div className={`${styles['modal']} ${styles['active']}`}>
          <div className={styles['modal-overlay']} onClick={() => setSelectedTransaction(null)} />
          <div className={styles['modal-dialog']}>
            <div className={styles['modal-content']}>
              <div className={styles['modal-header']}>
                <h5>Transaction Details</h5>
                <button className={styles['modal-close']} onClick={() => setSelectedTransaction(null)}>×</button>
              </div>
              <div className={styles['modal-body']}>
                <div className={styles['transaction-details']}>
                <div className={styles['detail-row']}>
                    <strong>Status:</strong>
                    <span className={
                      selectedTransaction.return_status === 'unpaid' ? styles['text-danger']
                        : selectedTransaction.return_status === 'partial' ? styles['text-warning']
                        : styles['text-success']
                    }>
                      {selectedTransaction.return_status.charAt(0).toUpperCase() + selectedTransaction.return_status.slice(1)}
                    </span>
                  </div>
                  <div className={styles['detail-row']}><strong>Invoice No:</strong><span>{selectedTransaction.voucher_no}</span></div>
                  <div className={styles['detail-row']}><strong>Date &amp; Time:</strong><span>{formatDate(selectedTransaction.date)}</span></div>
                  <div className={styles['detail-row']}><strong>Customer:</strong><span>{selectedTransaction.customer}</span></div>
                  <hr />
                  <h6>Items:</h6>
                  <table className={styles['detail-table']}>
                    <thead>
                      <tr>
                        <th style={{color:'white'}}>Product</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Qty</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Price</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Item Discount</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Tax</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Total</th>
                        <th className={styles['text-right']} style={{color:'white'}}>Profit / Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTransaction.items.map((item, i) => (
                        <tr key={i}>
                          <td>
                            {item.product}
                            {item.type === 'service' && <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>}
                          </td>
                          <td className={styles['text-right']}>
                            {item.type === 'service' ? '-' : item.net_quantity}
                            {item.returned_quantity > 0 && (
                              <><br /><small className={styles['text-warning']}>({item.returned_quantity} returned)</small></>
                            )}
                          </td>
                          <td className={styles['text-right']}>{formatPrice(item.price)}</td>
                          <td className={styles['text-right']}>{formatDiscountTax(item.discount_type, item.discount_value, item.discount)}</td>
                          <td className={styles['text-right']}>{formatDiscountTax(item.tax_type, item.tax_value, item.tax)}</td>
                          <td className={styles['text-right']}>{formatPrice(item.total)}</td>
                          <td className={`${styles['text-right']} ${item.profit >= 0 ? styles['text-success'] : styles['text-danger']}`}>
                            {formatPrice(item.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <hr />
                  <div className={styles['detail-row']}><strong>Subtotal:</strong><span>{formatPrice(selectedTransaction.subtotal)}</span></div>
                  <div className={styles['detail-row']}>
                    <strong>Discount:</strong>
                    <span>{formatDiscountTax(selectedTransaction.discount_type, selectedTransaction.discount_value, selectedTransaction.discount)}</span>
                  </div>
                  <div className={styles['detail-row']}>
                    <strong>Tax:</strong>
                    <span>{formatDiscountTax(selectedTransaction.tax_type, selectedTransaction.tax_value, selectedTransaction.tax)}</span>
                  </div>
                  <div className={`${styles['detail-row']} ${styles['detail-total']}`}>
                    <strong>Grand Total:</strong>
                    <strong>{formatPrice(selectedTransaction.grand_total)}</strong>
                  </div>
                  <div className={styles['detail-row']} style={{ fontSize: 22 }}>
                    <strong>Net Amount:</strong>
                    <strong>{formatPrice(selectedTransaction.net_amount)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart Expand Modal */}
      <ChartExpandModal expanded={expandedChart} onClose={() => setExpandedChart(null)} />
    </div>
  );
}