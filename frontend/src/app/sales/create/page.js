'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePOSKeyboard } from './hooks/usePOSKeyboard';
import { apiFetch } from '@/lib/api';
import { useCurrency } from '@/lib/currency-context';
import Swal from 'sweetalert2';
import './sale.css';

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const fmt = (n) => parseFloat(n || 0).toFixed(2);

/* Open "Another Sale" windows, stored as { [windowNo]: lastSeenTime }.
   Windows that stop sending a heartbeat (crash / killed browser) are dropped after 2 min. */
const SALE_TABS_KEY = 'posOpenSaleTabs';
const SALE_TAB_STALE_MS = 2 * 60 * 1000;

const readOpenSaleTabs = () => {
  try {
    const open = JSON.parse(localStorage.getItem(SALE_TABS_KEY) || '{}');
    const now = Date.now();
    Object.keys(open).forEach((k) => {
      if (now - open[k] > SALE_TAB_STALE_MS) delete open[k];
    });
    return open;
  } catch {
    return {};
  }
};

const writeOpenSaleTabs = (open) => {
  try {
    localStorage.setItem(SALE_TABS_KEY, JSON.stringify(open));
  } catch {}
};


/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function SaleCreatePage() {
  const { formatPrice } = useCurrency();

  /* ── Form state ── */
  const [saleDate, setSaleDate]             = useState('');
  const [customerType, setCustomerType]     = useState('cash');
  const [paymentType, setPaymentType]       = useState('cash');
  const [customerName, setCustomerName]     = useState('');
  const [city, setCity]                     = useState('');
  const [shopName, setShopName]             = useState('');
  const [contact, setContact]               = useState('');
  const [customerId, setCustomerId]         = useState(null);
  const [dueDate, setDueDate]               = useState('');
  const [voucherNo, setVoucherNo]           = useState('');
  const [actionType, setActionType]         = useState('generate');
  const [originalVoucherNo, setOriginalVoucherNo] = useState(null); // set only in edit mode
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [shopInfo, setShopInfo]             = useState(null);
  const [currentUser, setCurrentUser]       = useState(null);
  const [receiptSettings, setReceiptSettings] = useState(null);
  const [saleTabNumber, setSaleTabNumber] = useState(1);

  /* ── Category filter ── */
  const [categorySearch, setCategorySearch]             = useState('');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [selectedCategories, setSelectedCategories]     = useState([]);

  /* ── Product search ── */
  const [productSearch, setProductSearch]       = useState('');
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  /* ── Autocomplete dropdowns ── */
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [cityDropdownOpen, setCityDropdownOpen]         = useState(false);
  const [contactDropdownOpen, setContactDropdownOpen]   = useState(false);
  const [shopDropdownOpen, setShopDropdownOpen]         = useState(false);

  /* ── Table rows ── */
  const [rows, setRows] = useState([]);

  /* ── Totals ── */
  const [subtotal, setSubtotal]           = useState(0);
  const [discountType, setDiscountType]   = useState('percentage');
  const [discount, setDiscount]           = useState(0);
  const [taxType, setTaxType]             = useState('percentage');
  const [tax, setTax]                     = useState(0);
  const [grandTotal, setGrandTotal]       = useState(0);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [changeAmount, setChangeAmount]   = useState(0);
  const [remainingAmount, setRemainingAmount] = useState(0);

  /* ── Balance / advance ── */
  const [currentBalance, setCurrentBalance]       = useState(0);
  const [showBalanceAlert, setShowBalanceAlert]   = useState(false);
  const [customerAdvance, setCustomerAdvance]     = useState(0);
  const [showAdvanceAlert, setShowAdvanceAlert]   = useState(false);
  const [addMoreAdvance, setAddMoreAdvance]       = useState('');
  const [returnAdvance, setReturnAdvance]         = useState('');
  const [advancePayment, setAdvancePayment]       = useState('');
  const [netAdvanceBalance, setNetAdvanceBalance] = useState(0);
  const [netNewAdvanceBalance, setNetNewAdvanceBalance] = useState(0);
  const [finalAmount, setFinalAmount]             = useState(0);
  const [advanceTotalPayable, setAdvanceTotalPayable] = useState(0);
  const [bankAccounts, setBankAccounts]           = useState([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  // ── Data & search
const [allProducts, setAllProducts]                       = useState([]);
const [allProductsUnfiltered, setAllProductsUnfiltered]   = useState([]);
const [searchIndex, setSearchIndex]                       = useState(null);
const [dataLoaded, setDataLoaded]                         = useState(false);
const [productSuggestions, setProductSuggestions]         = useState([]);
const [categorySuggestions, setCategorySuggestions]       = useState([]);
const [customerSuggestions, setCustomerSuggestions]       = useState([]);
const [citySuggestions, setCitySuggestions]               = useState([]);
const [shopSuggestions, setShopSuggestions]               = useState([]);
const [contactSuggestions, setContactSuggestions]         = useState([]);
const [isLoadingData, setIsLoadingData]                   = useState(true);
const [historyModalOpen, setHistoryModalOpen]              = useState(false);
const [historyData, setHistoryData]                        = useState(null);
const [historyLoading, setHistoryLoading]                  = useState(false);

  /* ── Refs ── */
  const productSearchRef = useRef(null);
  const productListRef   = useRef(null);
  const allProductsUnfilteredRef = useRef([]);
const addRowRef                = useRef(null);
const userEditedDate = useRef(false);
const stockAlertOpenRef = useRef(false);
const lastAlertSignatureRef = useRef(null);

  /* ─────────────────────────────────────────
   Set default datetime on mount + keep it live
───────────────────────────────────────── */

// Machine-local wall clock as 'YYYY-MM-DDTHH:mm' for the datetime-local
// input. This must match the clock the backend's NOW() uses — a hardcoded
// +5 offset only cancels out on a PC already set to Asia/Karachi, and
// drifts 5 hours on any other machine.
const getPKTNow = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

useEffect(() => {
  // Initial set
  setSaleDate(getPKTNow());

    // Load POS data + voucher number on mount
    loadPOSData([]);
    fetchVoucherNo();
    // fetch for quotation receipts
    fetchShopInfo();
    fetchCurrentUser();
    fetchReceiptSettings();
    fetchBankAccounts();

  // Tick every minute, but stop if user manually changed the field
  const intervalId = setInterval(() => {
    if (!userEditedDate.current) {
      setSaleDate(getPKTNow());
    }
  }, 60000);

  return () => clearInterval(intervalId);
}, []);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('saleTab');
  const n = tabParam ? parseInt(tabParam, 10) : 1;
  setSaleTabNumber(n);
  document.title = n > 1 ? `Sale #${n} - POS` : 'POS';

  if (n <= 1) return;

  // Mark this window number as in use, and keep it alive while the window is open
  const markAlive = () => {
    const open = readOpenSaleTabs();
    open[n] = Date.now();
    writeOpenSaleTabs(open);
  };
  // Free this window number when the window is closed
  const release = () => {
    const open = readOpenSaleTabs();
    delete open[n];
    writeOpenSaleTabs(open);
  };

  markAlive();
  const heartbeat = setInterval(markAlive, 30000);
  window.addEventListener('pagehide', release);

  return () => {
    clearInterval(heartbeat);
    window.removeEventListener('pagehide', release);
    release();
  };
}, []);


/* ─────────────────────────────────────────
   EDIT MODE — pick up snapshot left by
   general/page.js after go-to-edit deleted
   the original sale
───────────────────────────────────────── */
useEffect(() => {
  const editDataStr = sessionStorage.getItem('editSaleData');
  if (!editDataStr) return;

  sessionStorage.removeItem('editSaleData');

  try {
    const saleData = JSON.parse(editDataStr);
    populateEditData(saleData);
  } catch (err) {
    console.error('Error parsing edit data:', err);
  }
}, []);

const populateEditData = async (saleData) => {
  setOriginalVoucherNo(saleData.voucher_no || null);

  if (saleData.customer) {
    setCustomerName(saleData.customer.name || '');
    setCity(saleData.customer.city || '');
    setContact(saleData.customer.contact || '');
    setShopName(saleData.customer.shop_name || '');
    setCustomerId(saleData.customer.id || null);

    if (saleData.customer.id) {
      try {
        const res  = await apiFetch(`/api/customer-balance/${saleData.customer.id}`);
        const data = await res.json();
        if (data.success) {
          setCurrentBalance(data.current_balance);
          setShowBalanceAlert(data.current_balance > 0);
          setCustomerAdvance(data.advance_payment);
          setShowAdvanceAlert(data.advance_payment > 0);
        }
      } catch (err) {
        console.error('Customer balance fetch error:', err);
      }
    }
  }

  if (saleData.sale_date) {
    userEditedDate.current = true;
    setSaleDate(saleData.sale_date);
  }

  if (saleData.payment_type) {
    setCustomerType(saleData.payment_type);
    setPaymentType(saleData.payment_type);
  }

  if (saleData.discount !== undefined) {
    setDiscount(saleData.discount);
    setDiscountType(saleData.discount_type || 'amount');
  }

  if (saleData.tax !== undefined) {
    setTax(saleData.tax || 0);
    setTaxType(saleData.tax_type || 'amount');
  }

  if (saleData.received_amount !== undefined) {
    setReceivedAmount(saleData.received_amount);
  }

  if (saleData.bank_account_id) {
    setSelectedBankAccountId(String(saleData.bank_account_id));
  }

  if (saleData.items && saleData.items.length > 0) {
    const editRows = saleData.items.map((item, idx) => {
      const product = item.purchase || {};
      const r = {
        id: Date.now() + idx,
        purchaseId: item.purchase_id,
        item: product.name || product.product_name || '',
        qty: item.quantity,
        unit: product.unit || 'pcs',
        rate: parseFloat(item.price) || 0,
        discountType: item.discount_type || 'amount',
        discountVal: parseFloat(item.discount_value) || 0,
        taxType: item.tax_type || 'amount',
        taxVal: parseFloat(item.tax_value) || 0,
        fixedPrice: !!product.fix_sold_price,
        fixedDiscount: !!product.fix_discount,
        fixedTax: !!product.fix_tax,
        availableStock: parseFloat(product.available_stock) || 0,
        purchasedPrice: parseFloat(product.purchased_price) || 0,
      };
      r.total = calcRowTotal(r);
      return r;
    });
    setRows(editRows);
  }

  Swal.fire({
    icon: 'info',
    title: 'Edit Mode',
    html: `Editing sale <strong>${saleData.voucher_no}</strong>.<br/>Original sale has been deleted.<br/>Modify and save to create updated sale.`,
    timer: 4000,
    showConfirmButton: false,
  });
};

  /* ─────────────────────────────────────────
     Keyboard shortcuts (via custom hook)
  ───────────────────────────────────────── */
  usePOSKeyboard({
    productSearchRef,
    rows,
    setProductSearch,
    setProductDropdownOpen,
    productDropdownOpen,
    customerDropdownOpen,
    cityDropdownOpen,
    contactDropdownOpen,
    shopDropdownOpen,
  });

  /* ─────────────────────────────────────────
     Sync payment type with customer type
  ───────────────────────────────────────── */
  useEffect(() => {
    setPaymentType(customerType);
  }, [customerType]);

  useEffect(() => {
    setShowAdvanceAlert(customerAdvance > 0);
  }, [customerAdvance]);

  /* ── Barcode / QR scanner global handler ── */
  /* ── Barcode / QR scanner global handler (works wherever focus is) ── */
  useEffect(() => {
    const SCAN_GAP_MS = 50; // scanner keys arrive < 50ms apart, humans are slower
    const MIN_LEN = 4;
    let buffer = '';
    let lastKeyTime = 0;
    let startTarget = null; // element that was focused when the scan started
    let startValue = null;  // its value before the first scanned chars leaked in
  
    const reset = () => { buffer = ''; startTarget = null; startValue = null; };
  
    // Undo the first chars that leaked into a controlled React input
    const restoreInput = () => {
      const el = startTarget;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
      if (el.value === startValue) return;
      const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, startValue);
      el.dispatchEvent(new Event('input', { bubbles: true })); // fires React onChange
    };
  
    const handleScannedCode = (code) => {
      const found = findByCode(code, allProductsUnfilteredRef.current);
      if (!found) {
        Swal.fire({ icon: 'warning', title: 'Product not found', text: `No product with code "${code}"`, timer: 1500, showConfirmButton: false });
        return;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const expiry = found.expiry_date ? new Date(found.expiry_date + 'T00:00:00') : null;
      if (expiry && expiry <= today) {
        Swal.fire({ icon: 'error', title: 'Expired product', text: `${found.name} is expired`, timer: 1500, showConfirmButton: false });
        return;
      }
      addRowRef.current(found);
    };
  
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const now = Date.now();
      const fast = now - lastKeyTime < SCAN_GAP_MS;
      lastKeyTime = now;
  
      if (e.key === 'Enter') {
        if (fast && buffer.length >= MIN_LEN) {
          e.preventDefault();
          e.stopImmediatePropagation(); // stop usePOSKeyboard from jumping to Save
          const code = buffer;
          restoreInput();
          reset();
          handleScannedCode(code);
        } else {
          reset();
        }
        return;
      }
  
      if (e.key.length !== 1) return; // Shift (for uppercase), Tab, arrows…
  
      if (!fast) {
        // First key of a possible new sequence — we can't yet tell if it's a
        // scan or a human typing, so let it type normally.
        reset();
        startTarget = document.activeElement;
        startValue = startTarget?.value ?? null;
        buffer += e.key;
        return;
      }
  
      // This key arrived inside the scan-speed window.
      buffer += e.key;
  
      if (buffer.length === 2) {
        // 2nd fast key confirms it's a scanner — undo the 1st char that
        // already leaked into the input before we knew.
        restoreInput();
      }
  
      // Keep every character from here on out of the DOM.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
  
    // capture phase on window → runs before usePOSKeyboard and React handlers
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []); // everything is read through refs
  

useEffect(() => {
  allProductsUnfilteredRef.current = allProductsUnfiltered;
}, [allProductsUnfiltered]);

useEffect(() => {
  addRowRef.current = addRow;
}, [rows]); // rows is in addRow's closure

  /* ─────────────────────────────────────────
     Recalculate totals whenever rows or
     discount / tax inputs change
  ───────────────────────────────────────── */
  useEffect(() => {
    const sub = rows.reduce((acc, r) => acc + (parseFloat(r.total) || 0), 0);
    setSubtotal(sub);

    const discAmt = discountType === 'percentage'
      ? sub * (parseFloat(discount) / 100)
      : parseFloat(discount) || 0;

    const afterDiscount = sub - discAmt;

    const taxAmt = taxType === 'percentage'
      ? afterDiscount * (parseFloat(tax) / 100)
      : parseFloat(tax) || 0;

const grand = afterDiscount + taxAmt;
    setGrandTotal(grand);

    /* credit balance adds on top */
    let payable = grand;
    if (showBalanceAlert) payable += currentBalance;

    /* advance deducts from payable */
    const advDeducted = showAdvanceAlert ? Math.min(customerAdvance, payable) : 0;
    payable -= advDeducted;

    setFinalAmount(payable);
    setAdvanceTotalPayable(payable);

   /* net advance balance remaining after this sale */
   const net = customerAdvance
   + (parseFloat(addMoreAdvance) || 0)
   - (parseFloat(returnAdvance) || 0)
   - advDeducted;
 setNetAdvanceBalance(net);

//  /* first-time advance payment: leftover after settling any existing
//     credit balance is what actually becomes the new advance */
//  const advancePaymentNum = parseFloat(advancePayment) || 0;
//  const leftoverNewAdvance = showBalanceAlert
//    ? Math.max(0, advancePaymentNum - currentBalance)
//    : advancePaymentNum;
//  setNetNewAdvanceBalance(leftoverNewAdvance);

/* first-time advance payment: leftover after covering this sale's grand total
    (and any existing credit balance) is what actually becomes the new advance */
    const advancePaymentNum = parseFloat(advancePayment) || 0;
    const advanceObligation = grand + (showBalanceAlert ? currentBalance : 0);
    const leftoverNewAdvance = Math.max(0, advancePaymentNum - advanceObligation);
    setNetNewAdvanceBalance(leftoverNewAdvance);

    /* change / remaining amount still owed */
    const recv = parseFloat(receivedAmount) || 0;
    if (recv >= payable) {
      setChangeAmount(recv - payable);
      setRemainingAmount(0);
    } else {
      setChangeAmount(0);
      setRemainingAmount(payable - recv);
    }
  }, [
    rows, discount, discountType, tax, taxType,
    currentBalance, showBalanceAlert,
    customerAdvance, showAdvanceAlert,
    addMoreAdvance, returnAdvance, receivedAmount,
    advancePayment,
  ]);

/* ─── Stable key representing only purchaseId+qty pairs,
     so price/discount/tax edits don't retrigger the stock check ─── */
     const stockCheckKey = rows
     .filter((r) => r.purchaseId)
     .map((r) => `${r.purchaseId}:${r.qty}`)
     .sort()
     .join('|');
 
   /* ─────────────────────────────────────────
      Stock oversell check — fires ONLY when
      quantities change (add row, remove row, edit qty)
   ───────────────────────────────────────── */
   useEffect(() => {
    const totals = {};
    rows.forEach((r) => {
      if (!r.purchaseId) return;
      if (!totals[r.purchaseId]) {
        totals[r.purchaseId] = {
          purchaseId: r.purchaseId,
          qty: 0,
          availableStock: r.availableStock ?? 0,
          name: r.item,
        };
      }
      totals[r.purchaseId].qty += parseFloat(r.qty) || 0;
    });

    const exceeded = Object.values(totals).find((t) => t.qty > t.availableStock);

    if (exceeded) {
      const signature = `${exceeded.purchaseId}:${exceeded.qty}:${exceeded.availableStock}`;

      // Only pop up again if THIS specific oversell state hasn't already been shown
      if (signature !== lastAlertSignatureRef.current) {
        lastAlertSignatureRef.current = signature;
        stockAlertOpenRef.current = true;
        Swal.fire({
          icon: 'warning',
          title: 'Stock Warning',
          html: `Only ${fmt(exceeded.availableStock)} units of <strong>${exceeded.name}</strong> are available.<br/>Remaining (oversold): <span style="color:red">${(exceeded.availableStock - exceeded.qty).toFixed(0)}</span>`,
          confirmButtonText: 'OK',
        }).then(() => {
          stockAlertOpenRef.current = false;
        });
      }
    } else {
      // No exceeded product anymore — clear signature so a future oversell can alert again
      lastAlertSignatureRef.current = null;
      if (stockAlertOpenRef.current) {
        Swal.close();
        stockAlertOpenRef.current = false;
      }
    }
  }, [stockCheckKey]);

  /* ─────────────────────────────────────────
     Row helpers
  ───────────────────────────────────────── */
  const newRow = () => ({
    id: Date.now(),
    purchaseId: null,
    item: '',
    qty: 1,
    unit: 'pcs',
    rate: '',
    discountType: 'amount',
    discountVal: 0,
    taxType: 'amount',
    taxVal: 0,
    total: 0,
    fixedPrice: false,
    fixedDiscount: false,
    fixedTax: false,
  });

  const calcRowTotal = (row) => {
    const rate = parseFloat(row.rate) || 0;
    const qty  = parseFloat(row.qty)  || 0;
    let base   = rate * qty;

    const discAmt = row.discountType === 'percentage'
      ? base * (parseFloat(row.discountVal) / 100)
      : parseFloat(row.discountVal) || 0;
    base -= discAmt;

    const taxAmt = row.taxType === 'percentage'
      ? base * (parseFloat(row.taxVal) / 100)
      : parseFloat(row.taxVal) || 0;
    base += taxAmt;

    return base;
  };

  const getRowDiscountAmount = (row) => {
    const rate = parseFloat(row.rate) || 0;
    const qty  = parseFloat(row.qty)  || 0;
    const base = rate * qty;
    return row.discountType === 'percentage'
      ? base * (parseFloat(row.discountVal) / 100 || 0)
      : parseFloat(row.discountVal) || 0;
  };

  const getRowTaxAmount = (row) => {
    const rate = parseFloat(row.rate) || 0;
    const qty  = parseFloat(row.qty)  || 0;
    let base   = rate * qty;
    base -= getRowDiscountAmount(row);
    return row.taxType === 'percentage'
      ? base * (parseFloat(row.taxVal) / 100 || 0)
      : parseFloat(row.taxVal) || 0;
  };

  const updateRow = (id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        updated.total = calcRowTotal(updated);
        return updated;
      })
    );
  };

  const addRow = (product = null) => {
    if (product) {
      const r = {
        ...newRow(),
        id: Date.now(),
        item: product.name,
        purchaseId: product.id,
        unit: product.unit || 'pcs',
        rate: parseFloat(product.price) || '',
        discountType: product.discount_type || 'amount',
        discountVal: parseFloat(product.discount) || 0,
        taxType: product.tax_type || 'amount',
        taxVal: parseFloat(product.tax) || 0,
        fixedPrice: !!product.fix_sold_price,
        fixedDiscount: !!product.fix_discount,
        fixedTax: !!product.fix_tax,
        availableStock: parseFloat(product.available_stock) || 0,
        purchasedPrice: parseFloat(product.purchased_price) || 0,
      };
      r.total = calcRowTotal(r);
      setRows((prev) => [r, ...prev]); // newest on top, matching Laravel behavior
    } else {
      setRows((prev) => [...prev, newRow()]);
    }
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  /* ─── Effective stock = original stock minus qty already added to cart ─── */
  const getDisplayStock = (product) => {
    const usedQty = rows
      .filter((r) => r.purchaseId === product.id)
      .reduce((sum, r) => sum + (parseFloat(r.qty) || 0), 0);
    return Math.max(0, (parseFloat(product.available_stock) || 0) - usedQty);
  };

  /* ── Sales History — real backend call ── */
  const openHistoryModal = async (product) => {
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const res  = await apiFetch(`/api/sales/product-history/${product.id}`);
      const data = await res.json();
      if (data.success) {
        setHistoryData(data.data);
      } else {
        Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to load history.' });
        setHistoryModalOpen(false);
      }
    } catch (err) {
      console.error('Product history fetch error:', err);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to connect to server.' });
      setHistoryModalOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeHistoryModal = () => {
    setHistoryModalOpen(false);
    setHistoryData(null);
  };

  /* ─────────────────────────────────────────
     Visibility helpers based on customer type
  ───────────────────────────────────────── */
  const isCredit  = customerType === 'credit';
  const isAdvance = customerType === 'advance';
  const showShop  = isCredit || isAdvance;
  const showDue   = isCredit;

  const globalDiscountAmount = discountType === 'percentage'
    ? subtotal * (parseFloat(discount) / 100 || 0)
    : parseFloat(discount) || 0;
  const globalTaxAmount = taxType === 'percentage'
    ? (subtotal - globalDiscountAmount) * (parseFloat(tax) / 100 || 0)
    : parseFloat(tax) || 0;

  /* ─────────────────────────────────────────
     Submit handler (placeholder — backend next)
  ───────────────────────────────────────── */
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSubmitting) return; // prevent double-click / double-submit

    const isAdvanceDepositOnly = rows.length === 0 && paymentType === 'advance' &&
    (parseFloat(advancePayment) > 0 || parseFloat(addMoreAdvance) > 0 || parseFloat(returnAdvance) > 0);
    const isBalancePaymentOnly = rows.length === 0 && !isAdvanceDepositOnly && showBalanceAlert && parseFloat(receivedAmount) > 0;

    if (rows.length === 0 && !isAdvanceDepositOnly && !isBalancePaymentOnly) {
      Swal.fire({ icon: 'warning', title: 'No items', text: 'Please add at least one product.' });
      return;
    }

    if (isBalancePaymentOnly && !contact) {
      Swal.fire({ icon: 'warning', title: 'Contact required', text: 'Please select a customer to pay balance for.' });
      return;
    }

    if (rows.length > 0 && paymentType === 'card' && !selectedBankAccountId) {
      Swal.fire({ icon: 'warning', title: 'Bank account required', text: 'Please select which account this card payment should be deposited to.' });
      return;
    }

    if (rows.length > 0 && paymentType === 'advance') {
      const advancePaymentNum = parseFloat(advancePayment) || 0;
      const obligation = grandTotal + (showBalanceAlert ? currentBalance : 0);

      if (advancePaymentNum <= 0) {
        Swal.fire({ icon: 'warning', title: 'Advance payment required', text: 'You cannot store an advance sale without entering an amount in Advance Payment.' });
        return;
      }
      if (advancePaymentNum <= obligation) {
        Swal.fire({ icon: 'warning', title: 'Insufficient advance payment', text: `Advance payment must be greater than ${formatPrice(obligation)}.` });
        return;
      }
    }

    let deductAdvance = false;
    if (rows.length > 0 && (paymentType === 'cash' || paymentType === 'card') && customerAdvance > 0) {
      const result = await Swal.fire({
        icon: 'question',
        title: 'Customer Has Advance Balance',
        html: `This customer has an advance balance of <strong style="color:#1890ff">${formatPrice(customerAdvance)}</strong>.<br/><br/>Sale Total: ${formatPrice(grandTotal)}<br/><br/>Would you like to deduct this sale from the advance balance?`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Yes, Deduct',
        denyButtonText: 'No, Keep Advance',
        cancelButtonText: 'Cancel',
      });

      if (!result.isConfirmed && !result.isDenied) {
        return; // Cancel — abort the whole submit
      }
      deductAdvance = result.isConfirmed;
    }

    setIsSubmitting(true);

    /* ── Balance-only payment: settle old credit sales, no items in cart ── */
    if (isBalancePaymentOnly) {
      try {
        const res  = await apiFetch('/api/sales/pay-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact,
            amount: parseFloat(receivedAmount),
            payment_date: saleDate,
          }),
        });
        const data = await res.json();

        if (data.success) {
          await Swal.fire({
            icon: 'success',
            title: 'Balance Paid!',
            text: data.message,
            timer: 2000,
            showConfirmButton: false,
          });

          if (actionType === 'print' && data.receipt) {
            openPaymentReceipt(data.receipt);
          }

          // Reset form
          setCustomerName('');
          setCity('');
          setShopName('');
          setContact('');
          setCustomerId(null);
          setCurrentBalance(0);
          setShowBalanceAlert(false);
          setCustomerAdvance(0);
          setShowAdvanceAlert(false);
          setReceivedAmount('');
        } else {
          Swal.fire({ icon: 'error', title: 'Error', text: data.message });
        }
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to connect to server.' });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    /* ── Normal sale with items, or advance-deposit-only ── */
    const items = rows.map((r) => ({
      purchase_id:    r.purchaseId,
      quantity:       r.qty,
      price:          r.rate,
      discount_type:  r.discountType,
      discount_value: r.discountVal,
      tax_type:       r.taxType,
      tax_value:      r.taxVal,
    }));

    const payload = {
      sale_date:       saleDate,
      customer_type:   customerType,
      payment_type:    paymentType,
      customer_id:     customerId,
      customer_name:   customerName,
      shop_name:       shopName,
      city,
      contact,
      due_date:        dueDate,
      voucher_no:      voucherNo,
      items,
      subtotal,
      discount_type:   discountType,
      discount,
      tax_type:        taxType,
      tax,
      grand_total:     grandTotal,
      received_amount: receivedAmount || 0,
      change_amount:   changeAmount,
      advance_payment: advancePayment || 0,
      add_more_advance: addMoreAdvance || 0,
      return_advance:   returnAdvance || 0,
      deduct_advance:   deductAdvance,
      bank_account_id:  paymentType === 'card' ? selectedBankAccountId : null,
      ...(originalVoucherNo ? { original_voucher_no: originalVoucherNo } : {}),
    };

    try {
      const res  = await apiFetch('/api/sales/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();

      if (data.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Sale Saved!',
          text: data.message,
          timer: 2000,
          showConfirmButton: false,
        });

        if (actionType === 'print' && data.receipt) {
          if (data.receipt.transactionType) {
            // solo credit/advance transaction — no items, no voucher
            openPaymentReceipt(data.receipt);
          } else {
            localStorage.setItem(`receipt:${data.voucher_no}`, JSON.stringify(data.receipt));
            window.open(
              `/sales/receipt/printReceipt?voucher=${encodeURIComponent(data.voucher_no)}`,
              'receiptPreview',
              'width=800,height=600,menubar=no,toolbar=no,location=no,status=no'
            );
          }
        }

// Reset form
userEditedDate.current = false;
setSaleDate(getPKTNow());
setRows([]);
setCustomerType('cash');
setPaymentType('cash');
setCustomerName('');
setCity('');
setShopName('');
setContact('');
setCustomerId(null);
setCurrentBalance(0);
setShowBalanceAlert(false);
setCustomerAdvance(0);
setShowAdvanceAlert(false);
setDueDate('');
setDiscount(0);
setTax(0);
setReceivedAmount('');
setAdvancePayment('');
setAddMoreAdvance('');
setReturnAdvance('');
setSelectedBankAccountId('');
setOriginalVoucherNo(null);
fetchVoucherNo();
loadPOSData(selectedCategories.map((c) => c.id)); // refresh stock so autocomplete reflects real values
  } else {
    Swal.fire({ icon: 'error', title: 'Error', text: data.message });
  }
} catch (err) {
  Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to connect to server.' });
} finally {
  setIsSubmitting(false);
}
};

/* ─── Open the solo credit/advance transaction receipt ─── */
const openPaymentReceipt = (receipt) => {
  const paymentId = `PAY-${Date.now()}`;
  localStorage.setItem(`payment-receipt:${paymentId}`, JSON.stringify(receipt));
  window.open(
    `/sales/receipt/paymentReceipt?payment=${encodeURIComponent(paymentId)}`,
    'paymentReceiptPreview',
    'width=800,height=600,menubar=no,toolbar=no,location=no,status=no'
  );
};

/* ─────────────────────────────────────────
   Quotation (price estimate) — client-side only.
   Nothing is sent to the backend / stored in DB.
   Always forced to plain "cash" — credit/advance
   state on screen is completely ignored.
───────────────────────────────────────── */
const generateQuotation = () => {
  if (rows.length === 0) {
    Swal.fire({ icon: 'warning', title: 'No items', text: 'Please add at least one product to generate a quotation.' });
    return;
  }

  const quotationItems = rows.map((r) => ({
    product_name: r.item,
    unit: r.unit,
    quantity: r.qty,
    price: r.rate,
    discount_type: r.discountType,
    discount_value: r.discountVal,
    discount_amount: getRowDiscountAmount(r),
    tax_type: r.taxType,
    tax_value: r.taxVal,
    tax_amount: getRowTaxAmount(r),
    total_after_discount: r.total, // same total already shown in the POS table
  }));

  const quotationId = `QUOTE-${Date.now()}`;

  const receipt = {
    is_quotation: true,
    shop: shopInfo || {},
    seller_name: currentUser?.name || 'N/A',
    sale: {
      voucher_no: null,
      sale_date: saleDate || new Date().toISOString(),
      payment_type: 'cash',
      status: 'paid',
      subtotal,
      discount_type: discountType,
      discount,
      discount_amount: globalDiscountAmount,
      tax_type: taxType,
      tax,
      tax_amount: globalTaxAmount,
      grand_total: grandTotal,
      received_amount: 0,
      change_amount: 0,
      remaining_balance: 0,
      due_date: null,
    },
    customer: {
      name: customerName || 'Walk-in Customer',
      contact: contact || '',
      shop_name: shopName || '',
      city: city || '',
      customer_type: 'cash',
      current_balance: 0,
      advance_payment: 0,
    },
    items: quotationItems,
    previous_balance: 0,
    total_payable: grandTotal,
    advance_used: 0,
    advance_deposit_info: null,
    total_paid: 0,
    was_previous_balance_cleared: false,
    receiptSettings: {
      paper_size: receiptSettings?.paper_size || '80mm',
      design_type: receiptSettings?.design_type || 'design1',
      language: receiptSettings?.language || 'en',
      show_signature: !!receiptSettings?.show_signature,
      show_stamp: !!receiptSettings?.show_stamp,
      show_paid_overlay: !!receiptSettings?.show_paid_overlay,
    },
  };

  localStorage.setItem(`receipt:${quotationId}`, JSON.stringify(receipt));
  window.open(
    `/sales/receipt/printReceipt?voucher=${encodeURIComponent(quotationId)}`,
    'quotationPreview',
    'width=800,height=600,menubar=no,toolbar=no,location=no,status=no'
  );
};

/* ─── Build search index ─── */
const buildSearchIndex = (products) => {
  const index = new Map();
  products.forEach((product, idx) => {
    // Include name + product_code + barcode in index
    const raw = [
      product.name        || '',
      product.product_code || '',
      product.barcode      || '',
    ].join(' ').toLowerCase().trim();

    const tokens = raw.split(/\s+/).filter(t => t.length >= 2);
    tokens.forEach(token => {
      for (let start = 0; start < token.length; start++) {
        for (let len = 2; len <= token.length - start; len++) {
          const sub = token.slice(start, start + len);
          if (!index.has(sub)) index.set(sub, new Set());
          index.get(sub).add(idx);
        }
      }
    });
  });
  return index;
};

/* ─── Search products using index ─── */
const searchProductsLocal = (query, index, products) => {
  if (!index || !products.length) return [];
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(t => t.length >= 2);
  if (!tokens.length) return [];

  let resultSet = null;
  for (const token of tokens) {
    const matches = index.get(token);
    if (!matches || !matches.size) return [];
    if (resultSet === null) {
      resultSet = new Set(matches);
    } else {
      for (const i of resultSet) {
        if (!matches.has(i)) resultSet.delete(i);
      }
    }
    if (!resultSet.size) return [];
  }
  // Cap at 500 results
  return [...resultSet].slice(0, 500).map(i => products[i]);
};

/* ─── Barcode / QR exact match ─── */
const findByCode = (code, products) => {
  const c = code.trim().toLowerCase();
  return products.find(p =>
    (p.barcode      && p.barcode.toLowerCase()       === c) ||
    (p.qr_code      && p.qr_code.toLowerCase()       === c) ||
    (p.product_code && p.product_code.toLowerCase()  === c)
  ) || null;
};

/* ─── Load all products from backend ─── */
const loadPOSData = async (categoryIds = []) => {
  setIsLoadingData(true);
  try {
    let url = '/api/salesfilter/pos-data';
    if (categoryIds.length > 0) {
      url += '?' + categoryIds.map(id => `category_ids[]=${id}`).join('&');
    }
    const res = await apiFetch(url);
    const data = await res.json();
    if (data.success) {
      setAllProducts(data.purchases);
      if (categoryIds.length === 0) setAllProductsUnfiltered(data.purchases);
      setSearchIndex(buildSearchIndex(data.purchases));
      setDataLoaded(true);
    }
  } catch (err) {
    console.error('POS data load error:', err);
  } finally {
    setIsLoadingData(false);
  }
};

/* ─── Fetch next voucher number ─── */
const fetchVoucherNo = async () => {
  try {
    const res = await apiFetch('/api/salesfilter/next-voucher-no');
    const data = await res.json();
    setVoucherNo(data.voucher_no || '');
  } catch (err) {
    console.error('Voucher fetch error:', err);
  }
};

/* ─── Fetch active bank accounts (for card payments) ─── */
const fetchBankAccounts = async () => {
  try {
    const res = await apiFetch('/api/bank-accounts?active_only=true');
    const data = await res.json();
    if (data.success) setBankAccounts(data.data || []);
  } catch (err) {
    console.error('Bank accounts fetch error:', err);
  }
};

/* ─── Fetch shop info (for quotation receipts) ─── */
const fetchShopInfo = async () => {
  try {
    const res = await apiFetch('/api/sales/shop-info-for-quotation');
    const data = await res.json();
    if (data.success) setShopInfo(data.shop);
  } catch (err) {
    console.error('Shop info fetch error:', err);
  }
};

/* ─── Fetch saved receipt settings (for quotation receipts) ─── */
const fetchReceiptSettings = async () => {
  try {
    const res = await apiFetch('/settings/receipt');
    const data = await res.json();
    if (data) setReceiptSettings(data);
  } catch (err) {
    console.error('Receipt settings fetch error:', err);
  }
};

/* ─── Fetch currently logged-in user (for cashier/seller name) for quotation receipts ─── */
const fetchCurrentUser = async () => {
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    if (data.success) setCurrentUser(data.user);
  } catch (err) {
    console.error('Current user fetch error:', err);
  }
};

/* ─── Product search input handler ─── */
const handleProductSearch = (value) => {
  setProductSearch(value);
  if (!value.trim() || value.trim().length < 2) {
    setProductSuggestions([]);
    setProductDropdownOpen(false);
    return;
  }
  const results = searchProductsLocal(value.trim(), searchIndex, allProducts);
  setProductSuggestions(results);
  setProductDropdownOpen(true);
};

/* ─── Category search input handler ─── */
const handleCategorySearch = async (value) => {
  setCategorySearch(value);
  if (!value.trim()) {
    setCategorySuggestions([]);
    setCategoryDropdownOpen(false);
    return;
  }
  try {
    const res = await apiFetch(
      `/api/salesfilter/search-categories?q=${encodeURIComponent(value)}`
    );
    const data = await res.json();
    setCategorySuggestions(data.categories || []);
    setCategoryDropdownOpen(true);
  } catch {
    setCategorySuggestions([]);
  }
};

/* ─── Add category filter ─── */
const addCategory = (cat) => {
  if (selectedCategories.find(c => c.id === cat.id)) return;
  const updated = [...selectedCategories, cat];
  setSelectedCategories(updated);
  setCategorySearch('');
  setCategorySuggestions([]);
  setCategoryDropdownOpen(false);
  loadPOSData(updated.map(c => c.id));
};

/* ─── Remove category filter ─── */
const removeCategoryFilter = (id) => {
  const updated = selectedCategories.filter(c => c.id !== id);
  setSelectedCategories(updated);
  if (updated.length === 0) {
    // Restore all products
    setAllProducts(allProductsUnfiltered);
    setSearchIndex(buildSearchIndex(allProductsUnfiltered));
  } else {
    loadPOSData(updated.map(c => c.id));
  }
};

/* ─── Customer search handler ─── */
/* ─── Generic customer-field search handler ─── */
const handleFieldSearch = async (value, field, setSuggestions, setDropdownOpen) => {
  if (!value.trim() || value.trim().length < 2) {
    setSuggestions([]);
    setDropdownOpen(false);
    return;
  }
  try {
    const res = await apiFetch(
      `/api/salesfilter/search-customers?q=${encodeURIComponent(value)}&field=${field}`
    );
    const data = await res.json();
    const results = data.customers || [];
    setSuggestions(results);
    setDropdownOpen(results.length > 0); // only open if matches found — new customers stay closed
  } catch {
    setSuggestions([]);
    setDropdownOpen(false);
  }
};

/* ─── Clear all customer-linked fields (called when name is emptied) ─── */
const clearCustomerSelection = () => {
  setCity('');
  setShopName('');
  setContact('');
  setCustomerId(null);
  setCurrentBalance(0);
  setShowBalanceAlert(false);
  setCustomerAdvance(0);
  setShowAdvanceAlert(false);
  setAddMoreAdvance('');
  setReturnAdvance('');
};

/* ─── Apply selected customer + fetch their balance/advance ─── */
const applyCustomerSelection = async (cust) => {
  setCustomerName(cust.name || '');
  setCity(cust.city || '');
  setContact(cust.contact || '');
  setShopName(cust.shop_name || '');
  setCustomerId(cust.id || null);

  setCustomerDropdownOpen(false);
  setCityDropdownOpen(false);
  setShopDropdownOpen(false);
  setContactDropdownOpen(false);

  if (!cust.id) return;

  try {
    const res  = await apiFetch(`/api/customer-balance/${cust.id}`);
    const data = await res.json();
    if (data.success) {
      setCurrentBalance(data.current_balance);
      setShowBalanceAlert(data.current_balance > 0);
      setCustomerAdvance(data.advance_payment);
      setShowAdvanceAlert(data.advance_payment > 0);
    } else {
      setCurrentBalance(0);
      setShowBalanceAlert(false);
      setCustomerAdvance(0);
      setShowAdvanceAlert(false);
    }
  } catch (err) {
    console.error('Customer balance fetch error:', err);
  }
};

const firstSelectableProductIdx = productSuggestions.findIndex((p) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = p.expiry_date ? new Date(p.expiry_date + 'T00:00:00') : null;
  return !(expiry && expiry <= today);
});

/* ─────────────────────────────────────────
   Render
───────────────────────────────────────── */
return (
  <div className="invoice-container">

      <form id="receiptForm" onSubmit={handleSubmit}>
        <div className="pos-layout">

          {/* ════════════════════════════
              LEFT COLUMN
          ════════════════════════════ */}
          <div className="left-column">

{saleTabNumber > 1 && (
  <div className="sale-tab-indicator">
    <span className="sale-tab-dot" />
    Sale Window #{saleTabNumber}
  </div>
)}

{/* ── Date & Time ── */}
<div className="customer-section">
              <h3>Adjust Date &amp; Time</h3>
              <div className="form-group customer-name-wrapper">
                <label htmlFor="adjust_date">Date &amp; Time</label>
                <input
                  type="datetime-local"
                  name="sale_date"
                  id="adjust_date"
                  value={saleDate}
                  onChange={(e) => {
                    userEditedDate.current = true;
                    setSaleDate(e.target.value);
                  }}
                />
              </div>
            </div>

            {/* ── Customer Information ── */}
            <div className="customer-section">
              <h3>Customer Information</h3>

              {/* Customer type + payment method */}
              <div className="customer-row">
                <div className="form-group">
                  <label htmlFor="customer_type">Customer Type</label>
                  <select
                    name="customer_type"
                    id="customer_type"
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                    required
                  >
                    <option value="cash">Cash Customer</option>
                    <option value="credit">Credit Customer</option>
                    <option value="card">Card Customer</option>
                    <option value="advance">Advance Customer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="payment_type">Payment Method</label>
                  <select
                    name="payment_type"
                    id="payment_type"
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value)}
                    disabled
                    className="readonly-select"
                    required
                    style={{ color: '#000', opacity: 1, WebkitTextFillColor: '#000', }}
                  >
                    <option value="cash">Cash</option>
                    <option value="credit">Credit</option>
                    <option value="card">Card</option>
                    <option value="advance">Advance</option>
                  </select>
                </div>
              </div>

              {/* Customer name + city */}
              <div className="customer-row">
                <div className="form-group customer-name-wrapper">
                  <label htmlFor="customer_name">Customer Name</label>
                  <input
                    type="text"
                    name="customer_name"
                    id="customer_name"
                    placeholder="Enter customer name"
                    value={customerName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustomerName(value);
                      handleFieldSearch(value, 'name', setCustomerSuggestions, setCustomerDropdownOpen);
                      if (!value.trim()) clearCustomerSelection();
                    }}
                    onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 200)}
                    autoComplete="off"
                  />
                  <div
                    id="customerAutocompleteList"
                    className="autocomplete-list"
                    style={{ display: customerDropdownOpen ? 'block' : 'none' }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {customerSuggestions.map((cust) => (
                      <div
                        key={cust.id}
                        className="autocomplete-item"
                        onClick={() => applyCustomerSelection(cust)}
                      >
                        <strong>{cust.name}</strong>
                        <span className="product-details">
                          {[cust.city, cust.contact, cust.shop_name].filter(Boolean).join(' | ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="city">City</label>
                  <input
                    type="text"
                    name="city"
                    id="city"
                    placeholder="City"
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      handleFieldSearch(e.target.value, 'city', setCitySuggestions, setCityDropdownOpen);
                    }}
                    onBlur={() => setTimeout(() => setCityDropdownOpen(false), 200)}
                    autoComplete="off"
                  />
                 <div
                    id="cityAutocompleteList"
                    className="autocomplete-list"
                    style={{ display: cityDropdownOpen ? 'block' : 'none' }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {citySuggestions.map((cust) => (
                      <div
                        key={cust.id}
                        className="autocomplete-item"
                        onClick={() => applyCustomerSelection(cust)}
                      >
                        <strong>{cust.name}</strong>
                        <span className="product-details">
                          {[cust.city, cust.contact, cust.shop_name].filter(Boolean).join(' | ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Shop name (credit / advance) + contact */}
              <div className="customer-row">
                {showShop && (
                  <div className="form-group" id="shopNameWrapper">
                    <label htmlFor="shop_name">Business / Shop Name</label>
                    <input
                      type="text"
                      name="shop_name"
                      id="shop_name"
                      placeholder="Shop name"
                      value={shopName}
                      onChange={(e) => {
                        setShopName(e.target.value);
                        handleFieldSearch(e.target.value, 'shop_name', setShopSuggestions, setShopDropdownOpen);
                      }}
                      onBlur={() => setTimeout(() => setShopDropdownOpen(false), 200)}
                      autoComplete="off"
                    />
                    <div
                      id="shopAutocompleteList"
                      className="autocomplete-list"
                      style={{ display: shopDropdownOpen ? 'block' : 'none' }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {shopSuggestions.map((cust) => (
                        <div
                          key={cust.id}
                          className="autocomplete-item"
                          onClick={() => applyCustomerSelection(cust)}
                        >
                          <strong>{cust.name}</strong>
                          <span className="product-details">
                          {[cust.city, cust.contact, cust.shop_name].filter(Boolean).join(' | ')}
                        </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="contact">Contact No</label>
                  <input
                    type="text"
                    name="contact"
                    id="contact"
                    placeholder="Phone number"
                    value={contact}
                    onChange={(e) => {
                      setContact(e.target.value);
                      handleFieldSearch(e.target.value, 'contact', setContactSuggestions, setContactDropdownOpen);
                    }}
                    onBlur={() => setTimeout(() => setContactDropdownOpen(false), 200)}
                    autoComplete="off"
                  />
                 <div
                    id="contactAutocompleteList"
                    className="autocomplete-list"
                    style={{ display: contactDropdownOpen ? 'block' : 'none' }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {contactSuggestions.map((cust) => (
                      <div
                        key={cust.id}
                        className="autocomplete-item"
                        onClick={() => applyCustomerSelection(cust)}
                      >
                        <strong>{cust.name}</strong>
                        <span className="product-details">
                          {[cust.city, cust.contact, cust.shop_name].filter(Boolean).join(' | ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

             {/* Bank account (card) + invoice no */}
             <div className="customer-row">
                {paymentType === 'card' && (
                  <div className="form-group" id="bankAccountWrapper">
                    <label htmlFor="bank_account_id">Deposit To</label>
                    <select
                      name="bank_account_id"
                      id="bank_account_id"
                      value={selectedBankAccountId}
                      onChange={(e) => setSelectedBankAccountId(e.target.value)}
                      required
                    >
                      <option value="">Select account</option>
                      {bankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.bank_name}{acc.account_title ? ` — ${acc.account_title}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Due date (credit) + invoice no */}
                {showDue && (
                  <div className="form-group" id="dueDateWrapper">
                    <label htmlFor="due_date">Due Date</label>
                    <input
                      type="datetime-local"
                      name="due_date"
                      id="due_date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="voucher_no">Invoice No</label>
                  <input
                    type="text"
                    id="voucher_no"
                    name="voucher_no"
                    value={voucherNo}
                    readOnly
                  />
                </div>
              </div>
            </div>

            {/* ── Category Filter ── */}
            <div className="product-section" style={{ marginBottom: 0, paddingBottom: 8 }}>
              <h3>
                Filter by Category{' '}
                <span style={{ fontSize: 11, color: '#888', fontWeight: 'normal' }}>
                  (optional)
                </span>
              </h3>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  id="categorySearch"
                  className="search-bar"
                  placeholder="Search categories to filter products..."
                  value={categorySearch}
                  onChange={(e) => handleCategorySearch(e.target.value)}
                  onBlur={() => setTimeout(() => setCategoryDropdownOpen(false), 200)}
                  autoComplete="off"
                />
                <div
  id="categoryAutocompleteList"
  style={{ display: categoryDropdownOpen ? 'block' : 'none' }}
>
  {categorySuggestions.length === 0 && (
    <div style={{ padding: '10px', color: '#888', fontSize: 13 }}>
      No categories found
    </div>
  )}
  {categorySuggestions.map((cat) => {
    const isSelected = !!selectedCategories.find(c => c.id === cat.id);
    return (
      <div
        key={cat.id}
        className="autocomplete-item"
        style={{
          padding: '8px 12px',
          cursor: isSelected ? 'default' : 'pointer',
          fontSize: 13,
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isSelected ? '#e6f7ff' : '#fff',
        }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f5f5f5'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}
        onClick={() => { if (!isSelected) addCategory(cat); }}
      >
        <span>{cat.name}</span>
        {isSelected
          ? <span style={{ color: '#1890ff', fontSize: 11, fontWeight: 600 }}>✓ Selected</span>
          : <span style={{ color: '#bbb', fontSize: 11 }}>Click to add</span>
        }
      </div>
    );
  })}
</div>
              </div>

              {selectedCategories.length > 0 && (
                <div
                  id="selectedCategoriesContainer"
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 11, color: '#666', marginRight: 4 }}>
                    Active filters:
                  </span>
                  <div id="selectedCategoryTags" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedCategories.map((cat) => (
                      <span
                        key={cat.id}
                        style={{
                          background: '#3498db',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {cat.name}
                        <button
                          type="button"
                          onClick={() => removeCategoryFilter(cat.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: 13,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    id="clearAllCategories"
                    onClick={() => {
                      setSelectedCategories([]);
                      setAllProducts(allProductsUnfiltered);
                      setSearchIndex(buildSearchIndex(allProductsUnfiltered));
                    }}
                    style={{
                      fontSize: 11,
                      color: '#dc3545',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: 0,
                      marginLeft: 4,
                    }}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {/* ── Product Search ── */}
            <div className="product-section">
              <h3>Add Products</h3>
              <div style={{ position: 'relative' }}>
                <input
                  ref={productSearchRef}
                  type="text"
                  id="productSearch"
                  className="search-bar"
                  placeholder={isLoadingData ? 'Loading products...' : 'Search products by name...'}
                  disabled={isLoadingData}
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  onBlur={() => setTimeout(() => setProductDropdownOpen(false), 200)}
                  autoComplete="off"
                />
                <span className="keyboard-hint">F2</span>
              </div>
            </div>

            {/* ── Another Sale ── */}
            <button
              type="button"
              className="btn-another-sale"
              title="Open new sale for another customer"
              onClick={() => {
                const open = readOpenSaleTabs();
                let next = 2;
                while (open[next]) next++;
                open[next] = Date.now(); // reserve it now so a quick double-click can't get the same number
                writeOpenSaleTabs(open);
                window.open(`/sales/create?saleTab=${next}`, '_blank');
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
              <span>Another Sale</span>
            </button>

            {/* Multi-iframe container anchor */}
            <div id="iframeWindowsContainer" />
          </div>

          {/* ════════════════════════════
              RIGHT COLUMN
          ════════════════════════════ */}
          <div className="right-column">

            {/* ── Credit balance alert ── */}
            {showBalanceAlert && (
              <div className="balance-alert balance-alert-credit" style={{ display: 'flex' }}>
                <span style={{ color: '#721c24', fontSize: 13, fontWeight: 600 }}>
                  Last Balance:
                </span>
                <span
                  id="currentBalanceAmount"
                  style={{ color: '#dc3545', fontSize: 14, fontWeight: 'bold', marginLeft: 8 }}
                >
                  {formatPrice(currentBalance)}
                </span>
                <span style={{ color: '#721c24', fontSize: 11, marginLeft: 12, opacity: 0.8 }}>
                  (Will be added to final amount)
                </span>
                <button
                  type="button"
                  id="clearBalanceBtn"
                  className="balance-alert-btn"
                  style={{ color: '#721c24' }}
                  onClick={() => setShowBalanceAlert(false)}
                  title="Remove previous balance from this transaction"
                >
                  ×
                </button>
              </div>
            )}

            {/* ── Advance balance alert ── */}
            {showAdvanceAlert && (
              <div className="balance-alert balance-alert-advance" style={{ display: 'flex' }}>
                <span style={{ color: '#096dd9', fontSize: 13, fontWeight: 600 }}>
                  Available Advance:
                </span>
                <span
                  id="advanceBalanceAmount"
                  style={{ color: '#1890ff', fontSize: 14, fontWeight: 'bold', marginLeft: 8 }}
                >
                  {formatPrice(customerAdvance)}
                </span>
                <span style={{ color: '#096dd9', fontSize: 11, marginLeft: 12, opacity: 0.8 }}>
                  (Will be deducted from total)
                </span>
                <button
                  type="button"
                  id="clearAdvanceBtn"
                  className="balance-alert-btn"
                  style={{ color: '#096dd9' }}
                  onClick={() => setShowAdvanceAlert(false)}
                  title="Remove advance from this transaction"
                >
                  ×
                </button>
              </div>
            )}

            {/* ── Items Table ── */}
            <div className="table-container">
              {productDropdownOpen && productSearch.trim().length >= 2 ? (
                <div
                ref={productListRef}
                id="autocompleteList"
                className="product-autocomplete-list"
                style={{ display: 'block' }}
              >
                  {productSuggestions.length === 0 ? (
                    <div className="no-results">No products found</div>
                  ) : (
                    productSuggestions.map((product, idx) => {
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const expiry = product.expiry_date
                        ? new Date(product.expiry_date + 'T00:00:00') : null;
                      const isExpired = expiry && expiry <= today;

                      return (
                        <div
                          key={product.id}
                          className={`autocomplete-item${idx === firstSelectableProductIdx ? ' keyboard-active' : ''}`}
                          style={{
                            cursor: isExpired ? 'not-allowed' : 'pointer',
                            background: isExpired ? '#fff5f5' : '#fff',
                            opacity: isExpired ? 0.6 : 1,
                            pointerEvents: isExpired ? 'none' : 'auto',
                          }}
                          onClick={() => {
                            if (isExpired) return;
                            addRow(product);
                            setProductSearch('');
                            setProductSuggestions([]);
                            setProductDropdownOpen(false);
                          }}
                        >
                          <div className="product-info">
                            <div className="product-main">
                              <strong>{product.name}</strong>
                              {isExpired && (
                                <span style={{
                                  background: '#c0392b', color: '#fff',
                                  fontSize: 11, padding: '1px 6px',
                                  borderRadius: 10, fontWeight: 'bold', marginLeft: 6,
                                }}>
                                  Expired
                                </span>
                              )}
                              <span className="product-details">
                                Unit: {product.unit} |
                                Stock: {product.type === 'service' ? '-' : getDisplayStock(product)}
                                {product.expiry_date && ` | Expiry: ${product.expiry_date}`}
                              </span>
                            </div>
                            <div className="product-actions">
                              {!isExpired && (
                                <button
                                  type="button"
                                  className="btn-history"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openHistoryModal(product);
                                  }}
                                >
                                  History
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
              <table id="itemsTable">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>Discount</th>
                    <th>Tax</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {
                    rows.map((row) => (
                      <tr key={row.id}>
                        {/* Item name */}
                        <td>
                          <input
                            type="text"
                            value={row.item}
                            readOnly
                          />
                        </td>

                      {/* Qty */}
                      <td>
                          <input
                            type="number"
                            min="1"
                            value={row.qty}
                            onChange={(e) => updateRow(row.id, 'qty', e.target.value)}
                            className="no-spin pos-qty"
                          />
                        </td>

                        {/* Unit */}
                        <td>
                          <input
                            type="text"
                            value={row.unit}
                            readOnly
                          />
                        </td>

                        {/* Rate */}
                        {/* Rate */}
                        <td>
                          <input
                            type="number"
                            value={row.rate}
                            onChange={(e) => !row.fixedPrice && updateRow(row.id, 'rate', e.target.value)}
                            placeholder="0.00"
                            className="no-spin pos-price"
                            readOnly={row.fixedPrice}
                            style={{
                              ...(row.fixedPrice ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}),
                              ...((parseFloat(row.rate) || 0) < (row.purchasedPrice || 0)
                                ? { color: '#dc3545', fontWeight: 'bold' }
                                : {}),
                            }}
                          />
                        </td>

                        {/* Discount */}
                        <td>
                          <div className="discount-container">
                            <select
                              value={row.discountType}
                              onChange={(e) => !row.fixedDiscount && updateRow(row.id, 'discountType', e.target.value)}
                              disabled={row.fixedDiscount}
                              style={row.fixedDiscount ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}}
                            >
                              <option value="amount">Amt</option>
                              <option value="percentage">%</option>
                            </select>
                            <input
                              type="number"
                              value={row.discountVal}
                              onChange={(e) => {
                                if (row.fixedDiscount) return;
                                let val = e.target.value;
                                if (row.discountType === 'percentage' && parseFloat(val) > 100) val = '100';
                                updateRow(row.id, 'discountVal', val);
                              }}
                              className="no-spin pos-discount"
                              min="0"
                              max={row.discountType === 'percentage' ? 100 : undefined}
                              readOnly={row.fixedDiscount}
                              style={row.fixedDiscount ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}}
                            />
                            {row.discountType === 'percentage' && (
                              <span className="pct-amount-inline">
                                ({formatPrice(getRowDiscountAmount(row))})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Tax */}
                        <td>
                          <div className="discount-container">
                            <select
                              value={row.taxType}
                              onChange={(e) => !row.fixedTax && updateRow(row.id, 'taxType', e.target.value)}
                              disabled={row.fixedTax}
                              style={row.fixedTax ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}}
                            >
                              <option value="amount">Amt</option>
                              <option value="percentage">%</option>
                            </select>
                            <input
                              type="number"
                              value={row.taxVal}
                              onChange={(e) => {
                                if (row.fixedTax) return;
                                let val = e.target.value;
                                if (row.taxType === 'percentage' && parseFloat(val) > 100) val = '100';
                                updateRow(row.id, 'taxVal', val);
                              }}
                              className="no-spin pos-tax"
                              min="0"
                              max={row.taxType === 'percentage' ? 100 : undefined}
                              readOnly={row.fixedTax}
                              style={row.fixedTax ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}}
                            />
                            {row.taxType === 'percentage' && (
                              <span className="pct-amount-inline">
                                ({formatPrice(getRowTaxAmount(row))})
                              </span>
                            )}
                          </div>
                        </td>
  
                          {/* Total */}
                          <td>{formatPrice(row.total)}</td>

                        {/* Remove */}
                        <td>
                          <button
                            type="button"
                            className="removeRow pos-delete"
                            onClick={() => removeRow(row.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
               )}
            </div>

            {/* ── Totals Section ── */}
            <div className="totals-section">

              {/* Subtotal */}
              <div className="totals-grid">
              <div className="total-item">
                  <label>Subtotal:</label>
                  <input type="text" name="subtotal" id="subtotal" value={formatPrice(subtotal)} readOnly />
                </div>
              </div>

              {/* Discount + Tax */}
              <div className="totals-grid">
                <div className="total-item">
                  <label>Discount Type:</label>
                  <select
                    name="discount_type"
                    id="discount_type"
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value)}
                  >
                    <option value="amount">Amount</option>
                    <option value="percentage">Percentage</option>
                  </select>
                </div>

                <div className="total-item">
                  <label>Discount:</label>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="number"
                      name="discount"
                      id="discount"
                      className="no-spin"
                      value={discount}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (discountType === 'percentage' && parseFloat(val) > 100) val = '100';
                        setDiscount(val);
                      }}
                      step="0.01"
                      max={discountType === 'percentage' ? 100 : undefined}
                      style={
                        discountType === 'percentage' && parseFloat(discount) > 0
                          ? { width: '100%', paddingRight: 62 }
                          : { width: '100%' }
                      }
                    />
                    {discountType === 'percentage' && parseFloat(discount) > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          right: 4,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: '#28a745',
                          fontSize: 10,
                          fontWeight: 600,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatPrice(globalDiscountAmount)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="total-item">
                  <label>Tax Type:</label>
                  <select
                    name="tax_type"
                    id="tax_type"
                    value={taxType}
                    onChange={(e) => setTaxType(e.target.value)}
                  >
                    <option value="amount">Amount</option>
                    <option value="percentage">Percentage</option>
                  </select>
                </div>

                <div className="total-item">
                  <label>Tax:</label>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="number"
                      name="tax"
                      id="tax"
                      className="no-spin"
                      value={tax}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (taxType === 'percentage' && parseFloat(val) > 100) val = '100';
                        setTax(val);
                      }}
                      step="0.01"
                      max={taxType === 'percentage' ? 100 : undefined}
                      style={
                        taxType === 'percentage' && parseFloat(tax) > 0
                          ? { width: '100%', paddingRight: 62 }
                          : { width: '100%' }
                      }
                    />
                    {taxType === 'percentage' && parseFloat(tax) > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          right: 4,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: '#28a745',
                          fontSize: 10,
                          fontWeight: 600,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatPrice(globalTaxAmount)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Advance-only fields */}
              {isAdvance && (
                <div className="totals-grid">
                  {customerAdvance > 0 ? (
                    <>
                      <div className="total-item" id="add-more-advance-container">
                        <label htmlFor="add_more_advance">Add More Advance:</label>
                        <input
                          type="number"
                          name="add_more_advance"
                          id="add_more_advance"
                          step="0.01"
                          placeholder="0.00"
                          value={addMoreAdvance}
                          onChange={(e) => setAddMoreAdvance(e.target.value)}
                        />
                      </div>

                      <div className="total-item" id="return-advance-container">
                        <label htmlFor="return_advance">Return Advance:</label>
                        <input
                          type="number"
                          name="return_advance"
                          id="return_advance"
                          step="0.01"
                          placeholder="0.00"
                          value={returnAdvance}
                          onChange={(e) => setReturnAdvance(e.target.value)}
                        />
                      </div>

                      <div className="total-item" id="net-advance-container">
                        <label htmlFor="net_advance_balance" style={{ color: '#28a745', fontWeight: 600 }}>
                          Net Advance Balance:
                        </label>
                        <input
                          type="text"
                          name="net_advance_balance"
                          id="net_advance_balance"
                          value={formatPrice(netAdvanceBalance)}
                          readOnly
                          style={{ color: '#28a745', fontWeight: 'bold' }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="total-item" id="advance-container">
                        <label htmlFor="advance_payment">Advance Payment:</label>
                        <input
                          type="number"
                          name="advance_payment"
                          id="advance_payment"
                          step="0.01"
                          placeholder="0.00"
                          value={advancePayment}
                          onChange={(e) => setAdvancePayment(e.target.value)}
                        />
                      </div>

                      {parseFloat(advancePayment || 0) > (grandTotal + (showBalanceAlert ? currentBalance : 0)) && (
                        <div className="total-item" id="net-new-advance-container">
                          <label htmlFor="net_new_advance_balance" style={{ color: '#28a745', fontWeight: 600 }}>
                            Net Advance Balance:
                          </label>
                          <input
                            type="text"
                            name="net_new_advance_balance"
                            id="net_new_advance_balance"
                            value={formatPrice(netNewAdvanceBalance)}
                            readOnly
                            style={{ color: '#28a745', fontWeight: 'bold' }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Received + change + remaining */}
              <div className="totals-row">
              <div className="total-item">
                  <label>Received Amount:</label>
                  <input
                    type="number"
                    className="no-spin"
                    name="received_amount"
                    id="received_amount"
                    step="0.01"
                    placeholder="0.00"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    disabled={paymentType === 'advance' && rows.length > 0}
                    style={paymentType === 'advance' && rows.length > 0 ? { background: '#f0f0f0', cursor: 'not-allowed' } : {}}
                  />
                </div>

                <div className="total-item">
                  <label>Change Amount:</label>
                  <input
                    type="text"
                    name="change_amount"
                    id="change_amount"
                    value={formatPrice(changeAmount)}
                    readOnly
                  />
                </div>

                {isCredit && remainingAmount > 0 && (
                            <div className="total-item" id="remaining-container">
                            <label>Remaining Amount:</label>
                            <input
                              type="text"
                              name="remaining_amount"
                              id="remaining_amount"
                              value={formatPrice(remainingAmount)}
                              readOnly
                            />
                          </div>
                )}

                {(paymentType === 'cash' || paymentType === 'card') &&
                  receivedAmount !== '' &&
                  remainingAmount > 0 && (
                    <div className="total-item" id="remaining-cash-card-container">
                      <label>Remaining Amount:</label>
                      <input
                        type="text"
                        name="remaining_amount_cash_card"
                        id="remaining_amount_cash_card"
                        value={formatPrice(remainingAmount)}
                        readOnly
                      />
                    </div>
                )}
              </div>

              {/* Grand Total */}
              <div className="grand-total total-item">
                <label>Grand Total:</label>
                <input
                  type="text"
                  name="grand_total"
                  id="grand_total"
                  value={formatPrice(grandTotal)}
                  readOnly
                />
              </div>

              {/* Total Payable — credit balance */}
              {showBalanceAlert && (
                <div
                  className="total-item"
                  id="finalAmountContainer"
                  style={{
                    display: 'flex',
                    borderTop: '2px solid rgb(10, 63, 107)',
                    paddingTop: 8,
                    marginTop: 8,
                  }}
                >
                  <label style={{ color: '#721c24', fontWeight: 600 }}>Total Payable:</label>
                  <input
                    type="text"
                    id="final_amount"
                    value={formatPrice(finalAmount)}
                    readOnly
                    style={{ color: '#dc3545', fontWeight: 'bold', fontSize: 16 }}
                  />
                </div>
              )}

              {/* Total Payable — advance */}
              {showAdvanceAlert && (
                <div
                  className="total-item"
                  id="advanceTotalPayableContainer"
                  style={{
                    display: 'flex',
                    borderTop: '2px solid rgb(10, 63, 107)',
                    paddingTop: 8,
                    marginTop: 8,
                  }}
                >
                  <label style={{ color: '#096dd9', fontWeight: 600 }}>Total Payable:</label>
                  <input
                    type="text"
                    id="advance_total_payable"
                    value={formatPrice(advanceTotalPayable)}
                    readOnly
                    style={{ color: '#1890ff', fontWeight: 'bold', fontSize: 16 }}
                  />
                </div>
              )}
            </div>

            {/* ── Hidden fields ── */}
            <input type="hidden" name="status" id="status" value="paid" />
            <input type="hidden" id="hidden_current_balance" value={currentBalance} />
            <input type="hidden" id="hidden_customer_advance" value={customerAdvance} />

            {/* ── Submit buttons ── */}
            <div className="submit-section">
<button
    type="submit"
    className="btn-submit"
    onClick={() => setActionType('generate')}
    disabled={isSubmitting}
    style={isSubmitting ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
  >
    {isSubmitting ? 'Saving...' : 'Save Record'}
  </button>
  <button
    type="submit"
    className="btn-print"
    onClick={() => setActionType('print')}
    disabled={isSubmitting}
    style={{ marginLeft: 8, ...(isSubmitting ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
  >
    {isSubmitting ? 'Saving...' : 'Save & Print Receipt'}
  </button>
  <button
    type="button"
    className="btn-print"
    onClick={generateQuotation}
    style={{ marginLeft: 8, background: '#6c757d' }}
    title="Print a price-estimate receipt without saving anything"
  >
    Quotation
  </button>
</div>

          </div>{/* end right-column */}
        </div>{/* end pos-layout */}
        </form>

{/* ── Sales History Modal ── */}
{historyModalOpen && (
  <div className="history-modal-overlay" onClick={closeHistoryModal}>
    <div className="history-modal" onClick={(e) => e.stopPropagation()}>
      {historyLoading || !historyData ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading history...</div>
      ) : (
      <>
      <h2 className="history-modal-title">Sales History - {historyData.product_name}</h2>

      <div className="history-stats-grid">
        <div className="history-stat"><span className="stat-label">Product:</span> {historyData.product_name}</div>
        <div className="history-stat"><span className="stat-label">Unit:</span> {historyData.unit}</div>
        <div className="history-stat"><span className="stat-label">Category:</span> {historyData.category}</div>
        <div className="history-stat"><span className="stat-label">Supplier:</span> {historyData.supplier}</div>
        <div className="history-stat"><span className="stat-label">Purchase Price:</span> {formatPrice(historyData.purchase_price)}</div>

<div className="history-stat"><span className="stat-label">Selling Price:</span> {formatPrice(historyData.selling_price)}</div>
<div className="history-stat"><span className="stat-label">Total Purchased:</span> {fmt(historyData.total_purchased)}</div>
<div className="history-stat"><span className="stat-label">Total Sold:</span> {historyData.total_sold}</div>
<div className="history-stat"><span className="stat-label">Available Stock:</span> <span className="stat-green">{historyData.available_stock}</span></div>
<div className="history-stat"><span className="stat-label">Total Transactions:</span> {historyData.total_transactions}</div>

<div className="history-stat"><span className="stat-label">Total Revenue:</span> <span className="stat-blue">{formatPrice(historyData.total_revenue)}</span></div>
<div className="history-stat">
  <span className="stat-label">{historyData.total_profit < 0 ? 'Total Loss:' : 'Total Profit:'}</span>{' '}
  <span className={historyData.total_profit < 0 ? 'stat-red' : 'stat-green'}>
    {formatPrice(Math.abs(historyData.total_profit))}
  </span>
</div>
      </div>

      <div className="history-table-wrapper">
        <table className="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice No</th>
              <th>Customer</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {historyData.transactions.map((t, i) => (
              <tr key={i}>
                <td>{new Date(String(t.date).replace(' ', 'T')).toLocaleDateString()}</td>
                <td>{t.invoice_no}</td>
                <td>{t.customer}</td>
                <td style={typeof t.qty === 'string' ? { color: '#dc3545' } : {}}>{t.qty}</td>
                <td>{formatPrice(t.price)}</td>
                <td>{formatPrice(t.total)}</td>
                <td><span className="history-payment-badge">{t.payment}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="history-modal-footer">
        <button type="button" className="history-close-btn" onClick={closeHistoryModal}>Close</button>
      </div>
      </>
      )}
    </div>
  </div>
)}
</div>
);
}