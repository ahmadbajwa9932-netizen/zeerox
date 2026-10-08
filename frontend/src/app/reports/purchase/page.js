// app/reports/purchase/page.js
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
import styles from './purchaseReport.module.css';
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
    { id: 'purchases', label: 'Purchase List', icon: 'fa-list' },
    { id: 'suppliers', label: 'Suppliers', icon: 'fa-truck' },
    { id: 'categories', label: 'Categories', icon: 'fa-tags' },
    { id: 'trends', label: 'Trends', icon: 'fa-chart-line' },
    { id: 'alerts', label: 'Stock Alerts', icon: 'fa-triangle-exclamation' },
  ];

/* ============================================================
   API HELPER
   ============================================================ */

   function apiGet(path, params = {}, { signal } = {}) {
    const cleaned = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(cleaned).toString();
    return apiFetch(`${path}${qs ? `?${qs}` : ''}`, { signal });
  }

/* ============================================================
   SMALL REUSABLE PIECES
   ============================================================ */

function Spinner() {
  return <div className={styles['spinner']} />;
}

function CardsSkeleton({ count = 7 }) {
  return (
    <div className={styles['purchase-comparison-cards']}>
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

/* ============================================================
   CHART EXPAND MODAL
   ============================================================ */

function ChartExpandModal({ expanded, onClose }) {
  if (!expanded) return null;

  const { title, type, labels, values, isPercent, isMoney, datasets, dualAxis, tooltipCallback } = expanded;
  const needsScroll = labels.length > 30;
  const colors = expanded.colors || generateDynamicColors(labels.length);
  const chartType = type === 'doughnut' ? 'bar' : type;

  const data = {
    labels,
    datasets: datasets || [
      {
        label: title,
        data: values,
        backgroundColor: type === 'line' ? 'rgba(153, 102, 255, 0.6)' : colors,
        borderColor: type === 'line' ? 'rgba(153, 102, 255, 1)' : colors.map(darkenColor),
        borderWidth: type === 'line' ? 2 : 1,
        tension: type === 'line' ? 0.1 : undefined,
      },
    ],
  };

  const defaultTooltip = isPercent
    ? { callbacks: { label: (ctx) => `${ctx.label}: ${Number(ctx.parsed.y ?? ctx.parsed).toFixed(2)}%` } }
    : isMoney
    ? { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed.y ?? ctx.parsed)}` } }
    : {};

  const axisTicks = {
    maxRotation: 65,
    minRotation: 45,
    autoSkip: needsScroll ? false : true,
    maxTicksLimit: needsScroll ? undefined : 20,
  };

  const options = {
    responsive: !needsScroll,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: chartType === 'line', position: 'top' },
      tooltip: tooltipCallback ? { callbacks: { label: tooltipCallback } } : defaultTooltip,
    },
    scales: dualAxis
      ? {
          y: { type: 'linear', display: true, position: 'left', beginAtZero: true },
          y1: { type: 'linear', display: true, position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } },
          x: { ticks: axisTicks },
        }
      : {
          y: { beginAtZero: true },
          x: { ticks: axisTicks },
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

export default function PurchaseReportPage() {
  const [activeTab, setActiveTab] = useState('purchases');

  // Filters (top-level date range)
  const [dateRange, setDateRange] = useState('this_month');
  // Local-date formatting (not toISOString) — matches the timezone
  // discipline in purchaseReport.dateHelpers.js. toISOString() converts
  // to UTC first, which rolls the date back a day for any PKT time
  // before 5 AM.
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Per-tab loading / caching / error state (mirrors salesReport pattern)
  const [mountedTabs, setMountedTabs] = useState({
    purchases: true, suppliers: false, categories: false, trends: false, alerts: false,
  });
  const [loadedTabs, setLoadedTabs] = useState({
    purchases: false, suppliers: false, categories: false, trends: false, alerts: false,
  });
  const [loadingTabs, setLoadingTabs] = useState({
    purchases: true, suppliers: false, categories: false, trends: false, alerts: false,
  });
  const [errorTabs, setErrorTabs] = useState({
    purchases: null, suppliers: null, categories: null, trends: null, alerts: null,
  });

  const abortRef = useRef(null);

  // Summary cards
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [hiddenValues, setHiddenValues] = useState({});

  // Filter dropdown options
  const [supplierOptions, setSupplierOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);

  // Purchases tab
  const [purchases, setPurchases] = useState({ data: [], pagination: null });
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [searchProduct, setSearchProduct] = useState('');
  const [purchaseSortBy, setPurchaseSortBy] = useState('purchase_date');
  const [purchaseSortOrder, setPurchaseSortOrder] = useState('desc');
  const [purchasePage, setPurchasePage] = useState(1);

  // Suppliers tab
  const [suppliers, setSuppliers] = useState({ data: [], pagination: null });
  const [supplierPage, setSupplierPage] = useState(1);

  // Categories tab
  const [categories, setCategories] = useState({ data: [], pagination: null });
  const [categoryPage, setCategoryPage] = useState(1);

  // Trends tab
  const [trends, setTrends] = useState(null);
  const [reorderSuggestions, setReorderSuggestions] = useState([]);

  // Stock Alerts tab — each of the 3 tables paginates independently
  const [stockAlerts, setStockAlerts] = useState({
    expiring: [], expiringPagination: null,
    lowStock: [], lowStockPagination: null,
    deadStock: [], deadStockPagination: null,
  });
  const [expiringPage, setExpiringPage] = useState(1);
  const [lowStockPage, setLowStockPage] = useState(1);
  const [deadStockPage, setDeadStockPage] = useState(1);

  // Chart expand modal
  const [expandedChart, setExpandedChart] = useState(null);

  /* ---------- data loaders ---------- */

  function buildDateParams() {
    const params = { date_range: dateRange };
    if (dateRange === 'custom') {
      params.start_date = startDate;
      params.end_date = endDate;
    }
    return params;
  }

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    apiGet('/api/reports/purchase/summary', buildDateParams())
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setSummary(json.data);
      })
      .finally(() => setSummaryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, startDate, endDate]);

  const loadFilterDropdowns = useCallback(() => {
    apiGet('/api/reports/purchase/suppliers-list').then((res) => res.json()).then((json) => {
      if (json.success) setSupplierOptions(json.data);
    });
    apiGet('/api/reports/purchase/categories-list').then((res) => res.json()).then((json) => {
      if (json.success) setCategoryOptions(json.data);
    });
  }, []);

  const loadPurchaseList = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, purchases: true }));
    setErrorTabs((prev) => ({ ...prev, purchases: null }));

    const params = {
      ...buildDateParams(),
      supplier_id: filterSupplier,
      category_id: filterCategory,
      search: searchProduct,
      sort_by: purchaseSortBy,
      sort_order: purchaseSortOrder,
      page: purchasePage,
    };

    apiGet('/api/reports/purchase/purchases', params, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load purchases');
        setPurchases({ data: json.data, pagination: json.pagination });
        setLoadedTabs((prev) => ({ ...prev, purchases: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, purchases: 'Could not load purchase data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, purchases: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSupplier, filterCategory, searchProduct, purchaseSortBy, purchaseSortOrder, purchasePage, dateRange, startDate, endDate]);

  const loadSupplierSummary = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, suppliers: true }));
    setErrorTabs((prev) => ({ ...prev, suppliers: null }));

    const params = { ...buildDateParams(), page: supplierPage };

    apiGet('/api/reports/purchase/supplier-summary', params, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load suppliers');
        setSuppliers({ data: json.data, pagination: json.pagination });
        setLoadedTabs((prev) => ({ ...prev, suppliers: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, suppliers: 'Could not load supplier data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, suppliers: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierPage, dateRange, startDate, endDate]);

  const loadCategoryAnalysis = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, categories: true }));
    setErrorTabs((prev) => ({ ...prev, categories: null }));

    const params = { ...buildDateParams(), page: categoryPage };

    apiGet('/api/reports/purchase/category-analysis', params, { signal: controller.signal })
      .then((res) => res.json())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryPage, dateRange, startDate, endDate]);

  const fetchAllSuppliers = useCallback(async () => {
    try {
      const res = await apiGet('/api/reports/purchase/supplier-summary', { ...buildDateParams(), all: '1' });
      const json = await res.json();
      return json.success ? json.data : suppliers.data;
    } catch {
      return suppliers.data;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, startDate, endDate, suppliers.data]);

  const fetchAllCategories = useCallback(async () => {
    try {
      const res = await apiGet('/api/reports/purchase/category-analysis', { ...buildDateParams(), all: '1' });
      const json = await res.json();
      return json.success ? json.data : categories.data;
    } catch {
      return categories.data;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, startDate, endDate, categories.data]);

  const loadTrendAnalysis = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, trends: true }));
    setErrorTabs((prev) => ({ ...prev, trends: null }));

    Promise.all([
      apiGet('/api/reports/purchase/monthly-trend', buildDateParams(), { signal: controller.signal }).then((res) => res.json()),
      apiGet('/api/reports/purchase/reorder-suggestions', {}, { signal: controller.signal }).then((res) => res.json()),
    ])
      .then(([trendJson, reorderJson]) => {
        if (!trendJson.success) throw new Error(trendJson.error || 'Failed to load trends');
        setTrends(trendJson.data);
        if (reorderJson.success) setReorderSuggestions(reorderJson.data);
        setLoadedTabs((prev) => ({ ...prev, trends: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, trends: 'Could not load trend data. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, trends: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, startDate, endDate]);

  const loadStockAlerts = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingTabs((prev) => ({ ...prev, alerts: true }));
    setErrorTabs((prev) => ({ ...prev, alerts: null }));

    const params = {
      expiring_page: expiringPage,
      low_stock_page: lowStockPage,
      dead_stock_page: deadStockPage,
    };

    apiGet('/api/reports/purchase/stock-alerts', params, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Failed to load stock alerts');
        setStockAlerts(json.data);
        setLoadedTabs((prev) => ({ ...prev, alerts: true }));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setErrorTabs((prev) => ({ ...prev, alerts: 'Could not load stock alerts. Please try again.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTabs((prev) => ({ ...prev, alerts: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiringPage, lowStockPage, deadStockPage]);

  const loadTabById = useCallback((tabId) => {
    switch (tabId) {
      case 'purchases': return loadPurchaseList();
      case 'suppliers': return loadSupplierSummary();
      case 'categories': return loadCategoryAnalysis();
      case 'trends': return loadTrendAnalysis();
      case 'alerts': return loadStockAlerts();
      default: return;
    }
  }, [loadPurchaseList, loadSupplierSummary, loadCategoryAnalysis, loadTrendAnalysis, loadStockAlerts]);

  // Initial load only
  useEffect(() => {
    loadSummary();
    loadFilterDropdowns();
    loadPurchaseList();
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
    if (activeTab === 'purchases') loadPurchaseList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSupplier, filterCategory, purchaseSortBy, purchaseSortOrder, purchasePage]);

  useEffect(() => {
    if (activeTab === 'suppliers') loadSupplierSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierPage]);

  useEffect(() => {
    if (activeTab === 'categories') loadCategoryAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryPage]);

  useEffect(() => {
    if (activeTab === 'alerts') loadStockAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiringPage, lowStockPage, deadStockPage]);

  function handleGenerate() {
    // Date range changed — everything is stale. Reset loadedTabs for ALL
    // tabs so switching tabs auto-refetches, same pattern as salesReport.
    setLoadedTabs({ purchases: false, suppliers: false, categories: false, trends: false, alerts: false });
    loadSummary();
    loadTabById(activeTab);
  }

  function toggleHidden(key) {
    setHiddenValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /* ---------- derived chart data ---------- */

  const supplierColors = useMemo(
    () => generateDynamicColors(Math.min(suppliers.data.length, 10)),
    [suppliers.data.length]
  );

  const top10Suppliers = suppliers.data.slice(0, 10);

  const supplierBarChartData = {
    labels: top10Suppliers.map((s) => s.name || s.company || 'Unknown'),
    datasets: [{
      label: 'Total Amount',
      data: top10Suppliers.map((s) => s.total_amount),
      backgroundColor: supplierColors,
      borderColor: supplierColors.map(darkenColor),
      borderWidth: 1,
    }],
  };

  const supplierPieChartData = {
    labels: top10Suppliers.map((s) => s.name || s.company || 'Unknown'),
    datasets: [{
      data: top10Suppliers.map((s) => s.total_amount),
      backgroundColor: supplierColors,
    }],
  };

  const categoryColors = useMemo(
    () => generateDynamicColors(categories.data.length),
    [categories.data.length]
  );

  const categoryBarChartData = {
    labels: categories.data.map((c) => c.category),
    datasets: [{
      label: 'Total Cost',
      data: categories.data.map((c) => c.total_cost),
      backgroundColor: categoryColors,
      borderColor: categoryColors.map(darkenColor),
      borderWidth: 1,
    }],
  };

  const categoryStockChartData = {
    labels: categories.data.map((c) => c.category),
    datasets: [{
      data: categories.data.map((c) => c.stock_value),
      backgroundColor: categoryColors,
    }],
  };

  function makeGradientFill(r, g, b) {
    return (ctx) => {
      const { chart } = ctx;
      const { ctx: canvasCtx, chartArea } = chart;
      if (!chartArea) return `rgba(${r},${g},${b},0.2)`;
      const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, `rgba(${r},${g},${b},0.45)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      return gradient;
    };
  }

  const trendChartData = trends ? {
    labels: trends.map((t) => t.month),
    datasets: [
      {
        label: 'Total Amount',
        data: trends.map((t) => t.total_amount),
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: makeGradientFill(75, 192, 192),
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(75, 192, 192, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        borderWidth: 2,
        yAxisID: 'y',
      },
      {
        label: 'Total Purchases',
        data: trends.map((t) => t.total_purchases),
        borderColor: 'rgba(255, 99, 132, 1)',
        backgroundColor: makeGradientFill(255, 99, 132),
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: 'rgba(255, 99, 132, 1)',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        borderWidth: 2,
        yAxisID: 'y1',
      },
    ],
  } : null;

  const axisChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true },
      x: { ticks: { maxRotation: 65, minRotation: 45, autoSkip: true } },
    },
  };

  const trendChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { type: 'linear', display: true, position: 'left', beginAtZero: true },
      y1: { type: 'linear', display: true, position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } },
      x: { ticks: { maxRotation: 65, minRotation: 45, autoSkip: true } },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
  };

  /* ---------- metric cards config ---------- */

  const metricCards = summary ? [
    { key: 'total_purchases', label: 'Total Purchases', icon: 'fa-shopping-cart', color: 'primary', money: false, value: summary.total_purchases },
    { key: 'total_purchase_amount', label: 'Total Amount', icon: 'fa-dollar-sign', color: 'success', money: true, value: summary.total_purchase_amount },
    { key: 'total_suppliers', label: 'Active Suppliers', icon: 'fa-users', color: 'info', money: false, value: summary.total_suppliers },
    { key: 'total_products', label: 'Total Products', icon: 'fa-boxes', color: 'warning', money: false, value: summary.total_products },
    { key: 'stock_in_hand', label: 'Stock in Hand', icon: 'fa-warehouse', color: 'danger', money: false, value: Number(summary.stock_in_hand).toFixed(2) },
    { key: 'available_purchase_amount', label: 'Available Inventory', icon: 'fa-box-open', color: 'success', money: true, value: summary.available_purchase_amount },
    { key: 'negative_stock', label: 'Negative Stock', icon: 'fa-exclamation-triangle', color: 'warning', money: false, value: Number(summary.negative_stock).toFixed(2) },
  ] : [];

  return (
    <div className="container">
      {/* Header */}
      <div className="main-text">
        <h2><i className="fas fa-box" /> Purchase &amp; Supplier Report</h2>
        <p className="sub-text">Comprehensive purchase analysis and supplier insights</p>
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

      {/* Summary Cards */}
      {summaryLoading && !summary && <CardsSkeleton count={7} />}
      {summary && (
        <div className={styles['purchase-comparison-cards']} id="summaryCards">
          {metricCards.map((metric) => {
            const hidden = hiddenValues[metric.key];
            const displayValue = metric.money ? formatPrice(metric.value) : metric.value;
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
                <div className={styles['metric-value']}>
                  {metric.money ? (hidden ? '••••••' : displayValue) : displayValue}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
          {/* 1. PURCHASE LIST */}
          {mountedTabs.purchases && (
            <div className={styles['tab-pane']} id="purchases" style={{ display: activeTab === 'purchases' ? 'block' : 'none' }}>
              {loadingTabs.purchases && purchases.data.length === 0 && <TableSkeleton />}
              {errorTabs.purchases && <ErrorState message={errorTabs.purchases} onRetry={() => loadTabById('purchases')} />}
              {!errorTabs.purchases && (
                <>
                  <div className={styles['content-card']}>
                    <div className={styles['card-body']}>
                      <div className={styles['filter-row']}>
                        <div className={styles['filter-col']}>
                          <label className={styles['filter-label']}>Supplier</label>
                          <select className={styles['filter-select']} value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
                            <option value="">All Suppliers</option>
                            {supplierOptions.map((s) => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className={styles['filter-col']}>
                          <label className={styles['filter-label']}>Category</label>
                          <select className={styles['filter-select']} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                            <option value="">All Categories</option>
                            {categoryOptions.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className={styles['filter-col']}>
                          <label className={styles['filter-label']}>Search Product</label>
                          <input
                            type="text" className={styles['filter-input']} placeholder="Product name..."
                            value={searchProduct} onChange={(e) => setSearchProduct(e.target.value)}
                          />
                        </div>
                        <div className={styles['filter-col']}>
                          <label className={styles['filter-label']}>&nbsp;</label>
                          <button className={`btn ${styles['btn-primary']} ${styles['btn-block']}`} onClick={loadPurchaseList}>
                            <i className="fas fa-filter" /> Apply Filters
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header-flex']}>
                      <h5>Purchase Records</h5>
                      <div className={styles['header-controls']}>
                        <select className={styles['filter-select-sm']} value={purchaseSortBy} onChange={(e) => setPurchaseSortBy(e.target.value)}>
                          <option value="purchase_date">Sort by Date</option>
                          <option value="product_name">Sort by Product</option>
                          <option value="purchased_price">Sort by Price</option>
                          <option value="quantity">Sort by Quantity</option>
                        </select>
                        <select className={styles['filter-select-sm']} value={purchaseSortOrder} onChange={(e) => setPurchaseSortOrder(e.target.value)}>
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
                              <th>Date</th>
                              <th>Supplier</th>
                              <th>Product</th>
                              <th>Category</th>
                              <th className={styles['text-right']}>Qty</th>
                              <th className={styles['text-right']}>Sold</th>
                              <th className={styles['text-right']}>Stock</th>
                              <th className={styles['text-right']}>Price</th>
                              <th className={styles['text-right']}>Total</th>
                              <th className={styles['text-right']}>Stock Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchases.data.length === 0 ? (
                              <tr><td colSpan={11} className={styles['no-data']}>No purchases found</td></tr>
                            ) : purchases.data.map((purchase, index) => (
                              <tr key={index}>
                                <td>{index + 1}</td>
                                <td>{purchase.purchase_date}</td>
                                <td>
                                  <strong>{purchase.type === 'service' ? '-' : purchase.supplier_name}</strong>
                                  {purchase.supplier_company && (
                                    <><br /><small className={styles['text-muted']}>{purchase.supplier_company}</small></>
                                  )}
                                </td>
                                <td>
                                  <strong>{purchase.product_name}</strong>
                                  {purchase.type === 'service' && (
                                    <span style={{ color: '#666', fontSize: 11 }}> (Service)</span>
                                  )}
                                </td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{purchase.category}</span></td>
                                <td className={styles['text-right']}>{purchase.type === 'service' ? '-' : `${purchase.quantity.toFixed(2)} ${purchase.unit}`}</td>
                                <td className={styles['text-right']}>{purchase.type === 'service' ? '-' : purchase.sold_quantity.toFixed(2)}</td>
                                <td className={`${styles['text-right']} ${purchase.remaining_stock <= 5 ? styles['text-danger'] : ''}`}>
                                  {purchase.type === 'service' ? '-' : purchase.remaining_stock.toFixed(2)}
                                </td>
                                <td className={styles['text-right']}>{purchase.type === 'service' ? '-' : formatPrice(purchase.purchased_price)}</td>
                                <td className={styles['text-right']}><strong>{purchase.type === 'service' ? '-' : formatPrice(purchase.total_amount)}</strong></td>
                                <td className={styles['text-right']}>{purchase.type === 'service' ? '-' : formatPrice(purchase.stock_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination pagination={purchases.pagination} onPageChange={setPurchasePage} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 2. SUPPLIERS */}
          {mountedTabs.suppliers && (
            <div className={styles['tab-pane']} id="suppliers" style={{ display: activeTab === 'suppliers' ? 'block' : 'none' }}>
              {loadingTabs.suppliers && suppliers.data.length === 0 && <TableSkeleton />}
              {errorTabs.suppliers && <ErrorState message={errorTabs.suppliers} onRetry={() => loadTabById('suppliers')} />}
              {!errorTabs.suppliers && (
                <>
                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Supplier-wise Summary</h5>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Supplier Name</th>
                              <th>Company</th>
                              <th>Contact</th>
                              <th className={styles['text-right']}>Purchases</th>
                              <th className={styles['text-right']}>Products</th>
                              <th className={styles['text-right']}>Total Amount</th>
                              <th className={styles['text-right']}>Avg Purchase</th>
                              <th>Last Purchase</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suppliers.data.length === 0 ? (
                              <tr><td colSpan={9} className={styles['no-data']}>No suppliers found</td></tr>
                            ) : suppliers.data.map((supplier, index) => (
                              <tr key={index}>
                                <td>{index + 1}</td>
                                <td><strong>{supplier.name || 'N/A'}</strong></td>
                                <td>{supplier.company || 'N/A'}</td>
                                <td>{supplier.contact_info || 'N/A'}</td>
                                <td className={styles['text-right']}>{supplier.total_purchases}</td>
                                <td className={styles['text-right']}>{supplier.total_products}</td>
                                <td className={styles['text-right']}><strong>{formatPrice(supplier.total_amount)}</strong></td>
                                <td className={styles['text-right']}>{formatPrice(supplier.avg_purchase_value)}</td>
                                <td>{supplier.last_purchase_date}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination pagination={suppliers.pagination} onPageChange={setSupplierPage} />
                    </div>
                  </div>

                  <div className={styles['grid-two-col']}>
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}>
                        <h5>Top Suppliers by Amount</h5>
                        <button
                          className={styles['chart-expand-btn']}
                          onClick={async () => {
                            const full = await fetchAllSuppliers();
                            setExpandedChart({
                              type: 'bar',
                              title: 'Top Suppliers by Amount (All Suppliers)',
                              labels: full.map((s) => s.name || s.company || 'Unknown'),
                              values: full.map((s) => s.total_amount),
                              colors: generateDynamicColors(full.length),
                              isMoney: true,
                            });
                          }}
                        >
                          <i className="fa fa-search-plus" />
                        </button>
                      </div>
                      <div className={styles['card-body']}>
                        <div className={styles['chart-canvas']}>
                          <Bar
                            data={supplierBarChartData}
                            options={{
                              ...axisChartOptions,
                              plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}` } } },
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}>
                        <h5>Supplier Distribution</h5>
                        <button
                          className={styles['chart-expand-btn']}
                          onClick={async () => {
                            const full = await fetchAllSuppliers();
                            setExpandedChart({
                              type: 'doughnut',
                              title: 'Supplier Distribution (All Suppliers)',
                              labels: full.map((s) => s.name || s.company || 'Unknown'),
                              values: full.map((s) => s.total_amount),
                              colors: generateDynamicColors(full.length),
                              isMoney: true,
                            });
                          }}
                        >
                          <i className="fa fa-search-plus" />
                        </button>
                      </div>
                      <div className={styles['card-body']}>
                        <div className={styles['chart-canvas']}>
                          <Doughnut
                            data={supplierPieChartData}
                            options={{
                              ...doughnutOptions,
                              plugins: { ...doughnutOptions.plugins, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } } },
                            }}
                          />
                        </div>
                      </div>
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
                        <h5>Category Purchase Distribution</h5>
                        <button
                          className={styles['chart-expand-btn']}
                          onClick={async () => {
                            const full = await fetchAllCategories();
                            setExpandedChart({
                              type: 'bar',
                              title: 'Category Purchase Distribution (All Categories)',
                              labels: full.map((c) => c.category),
                              values: full.map((c) => c.total_cost),
                              colors: generateDynamicColors(full.length),
                              isMoney: true,
                            });
                          }}
                        >
                          <i className="fa fa-search-plus" />
                        </button>
                      </div>
                      <div className={styles['card-body']}>
                        <div className={styles['chart-canvas']}>
                          <Bar
                            data={categoryBarChartData}
                            options={{
                              ...axisChartOptions,
                              plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}` } } },
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}>
                        <h5>Category Stock Value</h5>
                        <button
                          className={styles['chart-expand-btn']}
                          onClick={async () => {
                            const full = await fetchAllCategories();
                            setExpandedChart({
                              type: 'doughnut',
                              title: 'Category Stock Value (All Categories)',
                              labels: full.map((c) => c.category),
                              values: full.map((c) => c.stock_value),
                              colors: generateDynamicColors(full.length),
                              isMoney: true,
                            });
                          }}
                        >
                          <i className="fa fa-search-plus" />
                        </button>
                      </div>
                      <div className={styles['card-body']}>
                        <div className={styles['chart-canvas']}>
                          <Doughnut
                            data={categoryStockChartData}
                            options={{
                              ...doughnutOptions,
                              plugins: { ...doughnutOptions.plugins, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatPrice(ctx.parsed)}` } } },
                            }}
                          />
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
                              <th className={styles['text-right']}>Products</th>
                              <th className={styles['text-right']}>Purchases</th>
                              <th className={styles['text-right']}>Total Quantity</th>
                              <th className={styles['text-right']}>Total Cost</th>
                              <th className={styles['text-right']}>Remaining Quantity</th>
                              <th className={styles['text-right']}>Stock Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {categories.data.length === 0 ? (
                              <tr><td colSpan={8} className={styles['no-data']}>No categories found</td></tr>
                            ) : categories.data.map((cat, index) => (
                              <tr key={index}>
                                <td>{index + 1}</td>
                                <td><strong>{cat.category}</strong></td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : cat.total_products}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : cat.total_purchases}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : cat.total_quantity.toFixed(2)}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : formatPrice(cat.total_cost)}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : cat.remaining_quantity.toFixed(2)}</td>
                                <td className={styles['text-right']}>{cat.type === 'service' ? '-' : formatPrice(cat.stock_value)}</td>
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

          {/* 4. TRENDS */}
          {mountedTabs.trends && (
            <div className={styles['tab-pane']} id="trends" style={{ display: activeTab === 'trends' ? 'block' : 'none' }}>
              {loadingTabs.trends && !trends && <ChartSkeleton />}
              {errorTabs.trends && <ErrorState message={errorTabs.trends} onRetry={() => loadTabById('trends')} />}
              {!errorTabs.trends && (
                <>
                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Monthly Purchase Trend</h5>
                      <button
                        className={styles['chart-expand-btn']}
                        onClick={() => trendChartData && setExpandedChart({
                          type: 'line',
                          title: 'Monthly Purchase Trend',
                          labels: trendChartData.labels,
                          datasets: trendChartData.datasets,
                          dualAxis: true,
                          tooltipCallback: (ctx) => ctx.dataset.label === 'Total Amount'
                            ? `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}`
                            : `${ctx.dataset.label}: ${ctx.parsed.y}`,
                        })}
                      >
                        <i className="fa fa-search-plus" />
                      </button>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['chart-canvas-lg']}>
                        {trendChartData && (
                          <Line
                            data={trendChartData}
                            options={{
                              ...trendChartOptions,
                              plugins: {
                                tooltip: {
                                  callbacks: {
                                    label: (ctx) => ctx.dataset.label === 'Total Amount'
                                      ? `${ctx.dataset.label}: ${formatPrice(ctx.parsed.y)}`
                                      : `${ctx.dataset.label}: ${ctx.parsed.y}`,
                                  },
                                },
                              },
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Monthly Trend Analysis</h5>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Month</th>
                              <th className={styles['text-right']}>Purchases</th>
                              <th className={styles['text-right']}>Suppliers</th>
                              <th className={styles['text-right']}>Total Amount</th>
                              <th className={styles['text-right']}>Total Quantity</th>
                              <th className={styles['text-right']}>Avg Purchase Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {!trends || trends.length === 0 ? (
                              <tr><td colSpan={6} className={styles['no-data']}>No trend data found</td></tr>
                            ) : trends.map((item, index) => (
                              <tr key={index}>
                                <td><strong>{item.month}</strong></td>
                                <td className={styles['text-right']}>{item.total_purchases}</td>
                                <td className={styles['text-right']}>{item.suppliers_count}</td>
                                <td className={styles['text-right']}>{formatPrice(item.total_amount)}</td>
                                <td className={styles['text-right']}>{item.total_quantity.toFixed(2)}</td>
                                <td className={styles['text-right']}>{formatPrice(item.avg_purchase_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                          </table>
                      </div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Reorder Suggestions</h5>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Category</th>
                              <th className={styles['text-right']}>Current Stock</th>
                              <th className={styles['text-right']}>Avg Monthly Sold</th>
                              <th className={styles['text-right']}>Suggested Reorder Qty</th>
                              <th>Supplier</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reorderSuggestions.length === 0 ? (
                              <tr><td colSpan={6} className={styles['no-data']}>No reorder suggestions right now</td></tr>
                            ) : reorderSuggestions.map((item, index) => (
                              <tr key={index}>
                                <td><strong>{item.product_name}</strong></td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{item.category}</span></td>
                                <td className={`${styles['text-right']} ${item.current_stock <= 5 ? styles['text-danger'] : ''}`}>{item.current_stock}</td>
                                <td className={styles['text-right']}>{item.avg_monthly_sold}</td>
                                <td className={styles['text-right']}><strong>{item.suggested_reorder_qty}</strong></td>
                                <td>{item.supplier_name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 5. STOCK ALERTS */}
          {mountedTabs.alerts && (
            <div className={styles['tab-pane']} id="alerts" style={{ display: activeTab === 'alerts' ? 'block' : 'none' }}>
              {loadingTabs.alerts && stockAlerts.expiring.length === 0 && stockAlerts.lowStock.length === 0 && <TableSkeleton />}
              {errorTabs.alerts && <ErrorState message={errorTabs.alerts} onRetry={() => loadTabById('alerts')} />}
              {!errorTabs.alerts && (
                <>
                  <div className={styles['grid-three-col']}>
                    <div className={styles['stat-card']}>
                      <div className={styles['stat-label']}>Expiring Soon</div>
                      <div className={`${styles['stat-value']} ${styles['text-danger']}`}>{stockAlerts.expiringPagination?.total ?? stockAlerts.expiring.length}</div>
                    </div>
                    <div className={styles['stat-card']}>
                      <div className={styles['stat-label']}>Low Stock Items</div>
                      <div className={styles['stat-value']} style={{ color: 'var(--pr-warning)' }}>{stockAlerts.lowStockPagination?.total ?? stockAlerts.lowStock.length}</div>
                    </div>
                    <div className={styles['stat-card']}>
                      <div className={styles['stat-label']}>Dead / Non-Moving Stock</div>
                      <div className={styles['stat-value']}>{stockAlerts.deadStockPagination?.total ?? stockAlerts.deadStock.length}</div>
                    </div>
                  </div>

                  <div className={styles['content-card']}>
                    <div className={styles['card-header']}>
                      <h5>Expiring Soon</h5>
                    </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Category</th>
                              <th>Expiry Date</th>
                              <th className={styles['text-right']}>Days Left</th>
                              <th className={styles['text-right']}>Quantity</th>
                              <th className={styles['text-right']}>Stock Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockAlerts.expiring.length === 0 ? (
                              <tr><td colSpan={6} className={styles['no-data']}>Nothing expiring soon</td></tr>
                            ) : stockAlerts.expiring.map((item, index) => (
                              <tr key={index}>
                                <td><strong>{item.product_name}</strong></td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{item.category}</span></td>
                                <td>{item.expiry_date}</td>
                                <td className={styles['text-right']}>
                                  <span className={`${styles['badge']} ${item.days_left <= 7 ? 'badge-danger' : item.days_left <= 20 ? 'badge-warning' : styles['badge-secondary']}`}>
                                    {item.days_left} days
                                  </span>
                                </td>
                                <td className={styles['text-right']}>{item.quantity}</td>
                                <td className={styles['text-right']}>{formatPrice(item.stock_value)}</td>
                              </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination pagination={stockAlerts.expiringPagination} onPageChange={setExpiringPage} />
                      </div>
                    </div>
  
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}>
                        <h5>Low Stock</h5>
                      </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Category</th>
                              <th className={styles['text-right']}>Current Stock</th>
                              <th className={styles['text-right']}>Threshold</th>
                              <th>Supplier</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockAlerts.lowStock.length === 0 ? (
                              <tr><td colSpan={5} className={styles['no-data']}>No low stock items</td></tr>
                            ) : stockAlerts.lowStock.map((item, index) => (
                              <tr key={index}>
                                <td><strong>{item.product_name}</strong></td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{item.category}</span></td>
                                <td className={`${styles['text-right']} ${item.current_stock === 0 ? styles['text-danger'] : ''}`}>{item.current_stock}</td>
                                <td className={styles['text-right']}>{item.low_inventory}</td>
                                <td>{item.supplier_name}</td>
                              </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination pagination={stockAlerts.lowStockPagination} onPageChange={setLowStockPage} />
                      </div>
                    </div>
  
                    <div className={styles['content-card']}>
                      <div className={styles['card-header']}>
                        <h5>Dead / Non-Moving Stock</h5>
                      </div>
                    <div className={styles['card-body']}>
                      <div className={styles['table-container']}>
                        <table className={styles['data-table']}>
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Category</th>
                              <th>Purchase Date</th>
                              <th className={styles['text-right']}>Days Since Purchase</th>
                              <th className={styles['text-right']}>Quantity</th>
                              <th className={styles['text-right']}>Sold</th>
                              <th className={styles['text-right']}>Stock Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockAlerts.deadStock.length === 0 ? (
                              <tr><td colSpan={7} className={styles['no-data']}>No dead stock found</td></tr>
                            ) : stockAlerts.deadStock.map((item, index) => (
                              <tr key={index}>
                                <td><strong>{item.product_name}</strong></td>
                                <td><span className={`${styles['badge']} ${styles['badge-secondary']}`}>{item.category}</span></td>
                                <td>{item.purchase_date}</td>
                                <td className={styles['text-right']}>{item.days_since_purchase}</td>
                                <td className={styles['text-right']}>{item.quantity}</td>
                                <td className={styles['text-right']}>{item.sold_quantity}</td>
                                <td className={styles['text-right']}>{formatPrice(item.stock_value)}</td>
                              </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                        <Pagination pagination={stockAlerts.deadStockPagination} onPageChange={setDeadStockPage} />
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