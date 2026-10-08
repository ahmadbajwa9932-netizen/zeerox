/**
 * purchaseReport.dateHelpers.js
 *
 * Date range resolution for purchaseReport.js only. Kept separate from
 * salesReport's dateHelpers.js on purpose — each report file owns its
 * own date logic so a change to one report's range handling can never
 * accidentally affect another report.
 *
 * IMPORTANT — timezone discipline:
 * This file NEVER calls .toISOString() or Date.UTC(). All boundaries are
 * built from local Date getters/setters (getFullYear/getMonth/getDate) and
 * formatted manually. That's what prevents the classic UTC+5 shift bug
 * (constructing a local midnight, then calling toISOString(), which rolls
 * it back to the previous day). Every date that leaves this file is a
 * plain 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss' string — never a Date object.
 */

const MAX_CUSTOM_RANGE_DAYS = 365;

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateTime(d, endOfDay = false) {
  return `${fmtDate(d)} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function getMonday(d) {
  const copy = startOfDay(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(copy, diff);
}

export function parseDateOnly(str) {
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

/**
 * Resolves a range keyword into everything purchaseReport.js's routes
 * need:
 *  - startDateTime/endDateTime: kept for consistency/future use, but
 *    purchases.purchase_date is a DATE column, so the routes actually
 *    filter with startDate/endDate below, not these.
 *  - startDate/endDate: date-only strings, used for the purchase_date
 *    BETWEEN filter and the suppliers/products/amount summary numbers.
 *  - startObj/endObj: local Date objects, used for month-gap-filling
 *    in the Trends tab.
 */
export function resolveDateRange(rangeKey, customStart, customEnd) {
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

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonthLabel(d) {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Used for avg_purchase_value (supplier summary) and avg_purchase_value
 * (monthly trend gap-filling) — same safe-division guard as every other
 * report file, kept local instead of shared.
 */
export function safeDiv(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}