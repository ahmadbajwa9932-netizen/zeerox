// src/middleware.js
import { NextResponse } from 'next/server';

const API = 'http://localhost:4000';
const CACHE_TTL = 15000; // ms
const cache = new Map();

async function getCached(key, url, options = {}, shouldCache = () => true) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < CACHE_TTL) {
        return hit.data;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        // Only cache a state that can no longer change under us. While setup is
        // still in progress the answer flips the moment the user submits, so a
        // cached "not done yet" bounces them back to the page they just left.
        if (shouldCache(data)) {
            cache.set(key, { data, time: Date.now() });
        } else {
            cache.delete(key);
        }
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

export async function middleware(request) {
    const { pathname } = request.nextUrl;

    // ── Skip Next.js background prefetch requests entirely ─────────────────
    if (
        request.headers.get('next-router-prefetch') ||
        request.headers.get('purpose') === 'prefetch'
    ) {
        return NextResponse.next();
    }

    // ── Always allow these pages ───────────────────────────────────────────
    if (
        pathname.startsWith('/license/setup') ||
        pathname.startsWith('/license/expired') ||
        pathname.startsWith('/license/recovery') ||
        pathname.startsWith('/unauthorized')
    ) {
        return NextResponse.next();
    }

// ── Step 1: Check license (cached) ───────────────────────────────────
let licenseStatus;
try {
    licenseStatus = await getCached('license', `${API}/license/status`, {}, d => d && !d.not_setup);
} catch {
    console.error('License status fetch failed, allowing request through');
    return NextResponse.next();
}

    if (!licenseStatus || licenseStatus.not_setup) {
        return NextResponse.redirect(new URL('/license/setup', request.url));
    }

    if (licenseStatus.is_expired) {
        return NextResponse.redirect(new URL('/license/expired', request.url));
    }

    // ── Step 2: Check setup flow (cached) ──────────────────────────────────
    let setupStatus;
try {
    setupStatus = await getCached('setup', `${API}/api/auth/check-setup`, {}, d => d && d.hasSettings && d.hasAdmin);
} catch {
    console.error('Check-setup fetch failed, allowing request through');
    return NextResponse.next();
}

    if (!setupStatus.hasSettings) {
        if (!pathname.startsWith('/auth/adminSetup')) {
            return NextResponse.redirect(new URL('/auth/adminSetup', request.url));
        }
        return NextResponse.next();
    }

    if (!setupStatus.hasAdmin) {
        if (!pathname.startsWith('/auth/signup')) {
            return NextResponse.redirect(new URL('/auth/signup', request.url));
        }
        return NextResponse.next();
    }

    // ── Step 3: Auth pages — allow if not logged in ────────────────────────
    const isAuthPage = pathname.startsWith('/auth');
    const sessionCookie = request.cookies.get('pos_session')?.value;

    if (isAuthPage) {
        // Already logged in → go home
        if (sessionCookie) {
            return NextResponse.redirect(new URL('/', request.url));
        }
        return NextResponse.next();
    }

    // ── Step 4: Protected pages — must have session cookie ─────────────────
if (!sessionCookie) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
}

// ── Step 5: Check blocked pages (fetched live, per-session, short cache) ─
const PAGE_KEY_TO_PATH = {
    'dashboard':                     '/dashboard',
    'sales.create':                  '/sales/create',
    'purchase':                      '/purchase',
    'purchase.add':                  '/purchase/add',
    'purchase.supplier':             '/purchase/supplier',
    'purchase.low-inventory':        '/purchase/low-inventory',
    'purchase.list':                 '/purchase/list',
    'purchase.stock-overview':       '/purchase/stock-overview',
    'purchase.expired':              '/purchase/expired',
    'sales':                         '/sales',
    'sales.daily':                   '/sales/daily',
    'sales.general':                 '/sales/general',
    'sales.credit':                  '/sales/credit',
    'sales.returns':                 '/sales/returns',
    'sales.returns-without-invoice': '/sales/returns-without-invoice',
    'categories':                    '/categories',
    'categories.list':               '/categories',
    'expenses':                      '/expenses',
    'expenses.create':               '/expenses/add',
    'expenses.index':                '/expenses',
    'reports':                       '/reports',
    'reports.sales':                 '/reports/sales',
    'reports.financial':             '/reports/financial',
    'reports.purchase':              '/reports/purchase',
    'customers':                     '/customers',
    'customers.list':                '/customers',
    'customers.credit':              '/customers/credit',
    'customers.advance':             '/customers/advance',
    'manual-notes':                  '/manual-notes',
    'barcode':                       '/barcode',
    'payment-accounts':              '/payment-accounts',
    'admin':                         '/admin',
    'backup':                        '/backup',
    'recycle-bin':                   '/recycle-bin',
};

let blockedPages = [];
try {
    // Cache key is per-session (not global) so different logged-in users
    // never share each other's permissions. Short TTL keeps this close to
    // live without hitting the DB on every single navigation.
    const data = await getCached(
        `perms:${sessionCookie}`,
        `${API}/api/users/my-permissions`,
        { headers: { cookie: `pos_session=${sessionCookie}` } }
    );
    blockedPages = data?.success ? (data.blocked_pages ?? []) : [];
} catch {
    console.error('my-permissions fetch failed in middleware, allowing request through');
}

for (const key of blockedPages) {
    const blockedPath = PAGE_KEY_TO_PATH[key];
    if (blockedPath && pathname.startsWith(blockedPath)) {
        return NextResponse.redirect(new URL('/unauthorized', request.url));
    }
}

// ── Allow the request through ──────────────────────────────────────────
return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|logo|public|api).*)',
    ],
};