// backend/middleware/checkAuth.js
import db from '../db.js';

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

const PUBLIC_ROUTES = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/signup',
    '/api/auth/admin-setup',
    '/api/auth/admin-setup-with-logo',
    '/api/auth/check-setup',
    '/api/auth/emails',
    '/api/auth/admin-settings',
    '/api/auth/password-reset/check-email',
    '/api/auth/password-reset/verify-answers',
    '/api/auth/shop-name',
    '/license/setup',
    '/license/status',
    '/license/info',
    '/license/days-remaining',
    '/license/renew',
    '/license/recovery',
    '/license/early-renew',
    '/api/salesfilter/pos-data',
'/api/salesfilter/search-categories',
'/api/salesfilter/next-voucher-no',
'/api/salesfilter/search-customers',
'/api/customer-balance',
'/api/check-stock',
    '/public/',
];

export async function checkAuth(req, reply) {
    const url = req.url;

    // Allow public routes
    if (PUBLIC_ROUTES.some(route => url.startsWith(route))) {
        return;
    }

    // Allow static files
    if (url.startsWith('/public/')) {
        return;
    }

    // Get session cookie
    const sessionId = req.cookies?.pos_session || req.headers?.cookie?.split(';')
    ?.find(c => c.trim().startsWith('pos_session='))
    ?.split('=')[1]?.trim();

    if (!sessionId) {
        return reply.code(401).send({ 
            success: false, 
            message: 'Unauthorized. Please login.',
            redirect: '/auth/login'
        });
    }

    try {
        const [[session]] = await db.execute(
            'SELECT * FROM sessions WHERE id = ? LIMIT 1', 
            [sessionId]
        );

        if (!session) {
            return reply.code(401).send({ 
                success: false, 
                message: 'Session not found. Please login again.',
                redirect: '/auth/login'
            });
        }

        // Check session expiry
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - session.last_activity;
        if (elapsed > SESSION_LIFETIME_MS / 1000) {
            await db.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
            return reply.code(401).send({ 
                success: false, 
                message: 'Session expired. Please login again.',
                redirect: '/auth/login'
            });
        }

        // Attach user to request
        const [[user]] = await db.execute(
            'SELECT id, name, email, role, blocked_pages FROM users WHERE id = ? LIMIT 1',
            [session.user_id]
        );

        if (!user) {
            return reply.code(401).send({ 
                success: false, 
                message: 'User not found.',
                redirect: '/auth/login'
            });
        }

        req.user = user;

    } catch (e) {
        console.error('Auth check error:', e.message);
        return reply.code(500).send({ success: false, message: 'Server error during auth check.' });
    }
}