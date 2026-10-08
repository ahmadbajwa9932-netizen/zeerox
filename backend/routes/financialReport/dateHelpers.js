/**
 * dateHelpers.js
 *
 * Shared by dashboard.js and salesReport.js. Extracted here (rather than
 * duplicated in both files) so a future date-math fix only has to happen
 * once.
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
 * Resolves a range keyword into everything routes need:
 *  - startDateTime/endDateTime: for BETWEEN comparisons against DATETIME columns
 *  - startDate/endDate: date-only strings, for DATE columns
 *  - startObj/endObj: local Date objects, for day-math
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

/**
 * Given a resolved range, returns the immediately-preceding period of the
 * SAME length — e.g. current = Aug 1-10 (10 days) -> previous = Jul 22-31.
 * Used by the Sales Report Overview tab's period-over-period comparison.
 */
export function resolvePreviousPeriod(range) {
  const durationDays = Math.round((range.endObj - range.startObj) / 86400000) + 1;
  const previousEnd = addDays(range.startObj, -1);
  const previousStart = addDays(previousEnd, -(durationDays - 1));
  return {
    startDateTime: fmtDateTime(previousStart, false),
    endDateTime: fmtDateTime(previousEnd, true),
    startDate: fmtDate(previousStart),
    endDate: fmtDate(previousEnd),
    startObj: previousStart,
    endObj: previousEnd,
  };
}

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayLabel(d) {
  return `${pad(d.getDate())} ${MONTH_ABBR[d.getMonth()]}`;
}

export function formatMonthLabel(d) {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

export function safeDiv(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

/** Percent change + trend for period-over-period comparisons. */
export function computeChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) {
    if (c === 0) return { trend: 'same', percent: 0 };
    return { trend: 'up', percent: 100 };
  }
  const percent = ((c - p) / Math.abs(p)) * 100;
  return { trend: percent > 0 ? 'up' : percent < 0 ? 'down' : 'same', percent: Math.abs(percent) };
}

/**
 * Same day-overlap proration as dashboard.js's prorateExpenses, but also
 * grouped by expense.category for the Financial Report's expense
 * breakdown table. An expense's window is [date, date + days - 1]; only
 * the days that overlap [rangeStartObj, rangeEndObj] are counted, at
 * amount/days per day.
 */
export function prorateExpensesByCategory(expenseRows, rangeStartObj, rangeEndObj) {
  const byCategory = new Map(); // category -> { amount, count }
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
    if (overlapDays <= 0) continue;

    const proratedAmount = dailyShare * overlapDays;
    total += proratedAmount;

    const category = row.category || 'Uncategorized';
    const existing = byCategory.get(category) || { amount: 0, count: 0 };
    existing.amount += proratedAmount;
    existing.count += 1;
    byCategory.set(category, existing);
  }

  const breakdown = Array.from(byCategory.entries())
    .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  return { total, breakdown, expenseCount: expenseRows.length };
}