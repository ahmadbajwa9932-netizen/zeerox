import pool from '../db.js';

// ── Currency formatting (mirrors frontend's currency_settings table) ──
export async function getCurrencySettings() {
    const [rows] = await pool.query('SELECT * FROM currency_settings WHERE id = 1');
    return rows[0] || { currency_symbol: 'Rs', currency_position: 'before' };
}

export function formatPrice(amount, currency) {
    const formatted = parseFloat(amount || 0).toFixed(2);
    return currency.currency_position === 'before'
        ? `${currency.currency_symbol} ${formatted}`
        : `${formatted} ${currency.currency_symbol}`;
}