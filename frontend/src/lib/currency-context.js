'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from './api';

const CurrencyContext = createContext(null);

const DEFAULT_CURRENCY = {
    currency_symbol: 'Rs',
    currency_locale: 'en-PK',
    currency_position: 'before',
};

// Module-level mirror of the current currency, kept in sync by the
// provider below. Lets non-component code (and components that don't
// want to bother with the hook/props) call formatPrice() directly.
let currentCurrency = DEFAULT_CURRENCY;
const subscribers = new Set();

function setModuleCurrency(next) {
    currentCurrency = next;
    subscribers.forEach((fn) => fn(next));
}

export function formatPrice(value) {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    const formatted = parseFloat(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return currentCurrency.currency_position === 'before'
        ? `${currentCurrency.currency_symbol} ${formatted}`
        : `${formatted} ${currentCurrency.currency_symbol}`;
}

export function getCurrency() {
    return currentCurrency;
}

export function CurrencyProvider({ children }) {
    const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);

    const setCurrency = useCallback((next) => {
        setCurrencyState(next);
        setModuleCurrency(next);
    }, []);

    useEffect(() => {
        apiFetch('/settings/currency')
            .then((res) => res.json())
            .then((data) => {
                if (data) setCurrency(data);
            })
            .catch((err) => console.error('Failed to load currency settings:', err));
    }, [setCurrency]);

    // Re-render this provider's subtree whenever the module-level
    // currency changes (e.g. updated from a different component tree).
    useEffect(() => {
        const onChange = (next) => setCurrencyState(next);
        subscribers.add(onChange);
        return () => subscribers.delete(onChange);
    }, []);

    return (
        <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice, loaded: true }}>
            {children}
        </CurrencyContext.Provider>
    );
}

export function useCurrency() {
    const ctx = useContext(CurrencyContext);
    if (!ctx) throw new Error('useCurrency must be used within a CurrencyProvider');
    return ctx;
}