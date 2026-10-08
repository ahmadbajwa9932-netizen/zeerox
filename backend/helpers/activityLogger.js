// backend/helpers/activityLogger.js
import pool from '../db.js';

// With this:
// Formats a date/datetime value for display in logs: "7-Sep-2026 10:30 AM".
// Leaves non-date values (like "Not set") untouched.
export function formatDateValue(v) {
    if (!v) return 'Not set';
    const d = new Date(String(v).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(v);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hours = d.getHours();
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()} ${String(h12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}`;
}

export function valuesEqual(a, b) {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    const bothNumeric = a !== null && a !== '' && b !== null && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb);
    if (bothNumeric) return na === nb;
    return String(a ?? '') === String(b ?? '');
}

// Formats a value for display: numbers drop trailing ".00" noise but keep
// real decimals (15000.00 -> "15000", 15000.5 -> "15000.5").
export function formatValue(v) {
    const n = parseFloat(v);
    if (v === null || v === undefined || v === '' || Number.isNaN(n)) return v ?? 'N/A';
    return String(n);
}

export function describeChanges(oldData, newData, labels = {}) {
    const changes = [];
    // Only check keys you explicitly labeled — prevents unlabeled fields
    // (like raw discount/tax/items objects) from leaking in as noise.
    for (const key of Object.keys(labels)) {
        if (!oldData || oldData[key] === undefined || newData[key] === undefined) continue;
        const oldVal = oldData[key];
        const newVal = newData[key];
        if (!valuesEqual(oldVal, newVal)) {
            const label = labels[key];
            changes.push(`${label}: ${formatValue(oldVal)} → ${formatValue(newVal)}`);
        }
    }
    return changes;
}

export function describeItemChanges(oldItems = [], newItems = []) {
    const changes = [];
    const fmtDiscount = (item) => item.discount_type === 'percentage' ? `${formatValue(item.discount_value)}%` : formatValue(item.discount_value);
    const fmtTax = (item) => item.tax_type === 'percentage' ? `${formatValue(item.tax_value)}%` : formatValue(item.tax_value);

    const oldMap = new Map(oldItems.map(i => [i.product_name, i]));
    const newMap = new Map(newItems.map(i => [i.product_name, i]));

    for (const [name, newItem] of newMap) {
        const oldItem = oldMap.get(name);
        if (!oldItem) {
            changes.push(`Added "${name}" (Qty: ${formatValue(newItem.quantity)}, Price: ${formatValue(newItem.price)})`);
            continue;
        }
        const itemChanges = [];
        if (!valuesEqual(oldItem.quantity, newItem.quantity)) {
            itemChanges.push(`Qty ${formatValue(oldItem.quantity)} → ${formatValue(newItem.quantity)}`);
        }
        if (!valuesEqual(oldItem.price, newItem.price)) {
            itemChanges.push(`Price ${formatValue(oldItem.price)} → ${formatValue(newItem.price)}`);
        }
        if (!valuesEqual(oldItem.discount_value, newItem.discount_value) || oldItem.discount_type !== newItem.discount_type) {
            itemChanges.push(`Discount ${fmtDiscount(oldItem)} → ${fmtDiscount(newItem)}`);
        }
        if (!valuesEqual(oldItem.tax_value, newItem.tax_value) || oldItem.tax_type !== newItem.tax_type) {
            itemChanges.push(`Tax ${fmtTax(oldItem)} → ${fmtTax(newItem)}`);
        }
        if (itemChanges.length > 0) {
            changes.push(`"${name}": ${itemChanges.join(', ')}`);
        }
    }

    for (const [name, oldItem] of oldMap) {
        if (!newMap.has(name)) {
            changes.push(`Removed "${name}" (was Qty: ${formatValue(oldItem.quantity)})`);
        }
    }

    return changes;
}

export async function logActivity(req, { action_type, description, entity_type, entity_id, old_data = null, new_data = null }) {
    // Only track actions performed by regular users — the admin is the one
    // auditing this table, so we don't log the admin against themself.
    if (!req.user || req.user.role !== 'user') return;

    try {
        await pool.query(
            `INSERT INTO user_activity_logs
                (user_id, user_name, action_type, action_description, entity_type, entity_id, old_data, new_data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user?.id || null,
                req.user?.name || null,
                action_type,
                description,
                entity_type,
                entity_id || null,
                old_data ? JSON.stringify(old_data) : null,
                new_data ? JSON.stringify(new_data) : null,
            ]
        );
    } catch (err) {
        req.log?.error(err, 'Failed to write activity log');
    }
}