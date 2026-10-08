import bcrypt from 'bcrypt';
import crypto from 'crypto';
import db from '../db.js';
import { sendAdminSetupEmail } from '../utils/mailer.js';

function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Place a shift TIME ('HH:MM:SS') on the calendar day CLOSEST to `ref`.
 * A shift that crosses midnight (e.g. 18:00 -> 02:00) would otherwise be
 * anchored to the wrong day and land up to 24h away — which showed up as
 * ~21 hours of phantom overtime for a night-shift logout before midnight.
 */
function anchorShiftTime(ref, timeStr) {
    const base = new Date(`${localDateStr(ref)}T${timeStr}`);
    if (Number.isNaN(base.getTime())) return null;
    let best = base;
    for (const delta of [-1, 1]) {
        const alt = new Date(base);
        alt.setDate(alt.getDate() + delta);
        if (Math.abs(alt - ref) < Math.abs(best - ref)) best = alt;
    }
    return best;
}

async function trackLogin(conn, user) {
    const now = new Date();
    const today = localDateStr(now);

    const [[existing]] = await conn.execute(
        'SELECT id FROM user_performance_logs WHERE user_id = ? AND date = ? LIMIT 1',
        [user.id, today]
    );
    if (existing) return; // first login only

    let lateMinutes = 0, earlyMinutes = 0;

    if (user.shift_start) {
        const shiftStart = anchorShiftTime(now, user.shift_start);
        if (shiftStart) {
            const diffMin = Math.round((now - shiftStart) / 60000);
            if (diffMin >= 10) lateMinutes = diffMin;
            else if (diffMin <= -10) earlyMinutes = Math.abs(diffMin);
        }
    }

    await conn.execute(
        `INSERT INTO user_performance_logs (user_id, login_time, date, late_minutes, early_minutes)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, now, today, lateMinutes, earlyMinutes]
    );
}

async function trackLogout(conn, userId, shiftEnd) {
    const now = new Date();
    const today = localDateStr(now);

    // Prefer the most recent STILL-OPEN session. Matching on today's date alone
    // silently dropped the logout of any shift that started before midnight and
    // ended after it — logout_time/duty_minutes were never written.
    const [openRows] = await conn.execute(
        `SELECT id, login_time FROM user_performance_logs
          WHERE user_id = ? AND logout_time IS NULL
            AND login_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          ORDER BY login_time DESC LIMIT 1`,
        [userId]
    );
    let log = openRows[0];
    if (!log) {
        // Same-day re-login: fall back to today's row so the latest logout wins.
        const [todayRows] = await conn.execute(
            'SELECT id, login_time FROM user_performance_logs WHERE user_id = ? AND date = ? LIMIT 1',
            [userId, today]
        );
        log = todayRows[0];
    }
    if (!log) return;

    // login_time is a DATETIME string under dateStrings:true — normalise the
    // space to 'T' so it parses as local time everywhere.
    const loginTime = new Date(String(log.login_time).replace(' ', 'T'));
    const dutyMinutes = Math.round((now - loginTime) / 60000);
    let overtimeMinutes = 0, earlyDepartureMinutes = 0;

    if (shiftEnd) {
        const shiftEndTime = anchorShiftTime(now, shiftEnd);
        if (shiftEndTime) {
            const diffMin = Math.round((now - shiftEndTime) / 60000);
            if (diffMin > 0) overtimeMinutes = diffMin;
            else if (diffMin <= -10) earlyDepartureMinutes = Math.abs(diffMin);
        }
    }

    await conn.execute(
        `UPDATE user_performance_logs
         SET logout_time=?, duty_minutes=?, overtime_minutes=?, early_departure_minutes=?, updated_at=NOW()
         WHERE id=?`,
        [now, dutyMinutes, overtimeMinutes, earlyDepartureMinutes, log.id]
    );
}
// ─── helpers ──────────────────────────────────────────────────────────────────
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours (matches Laravel default)
const SALT_ROUNDS = 12;

/** Create a secure random session id */
function makeSessionId() {
    return crypto.randomBytes(64).toString('hex');
}

/** Encrypt a string (matches Laravel's encrypt() — simple AES wrapper) */
function encryptString(text) {
    const key = (process.env.APP_KEY || 'fallback-secret-key-32-chars!!').slice(0, 32).padEnd(32, '0');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
function decryptString(text) {
    try {
        const key = (process.env.APP_KEY || 'fallback-secret-key-32-chars!!').slice(0, 32).padEnd(32, '0');
        const [ivHex, encryptedHex] = text.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        return null;
    }
}

/** Write session row to DB, return session id */
async function createSession(conn, userId, userAgent, ipAddress) {
    const sessionId = makeSessionId();
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ user_id: userId, created_at: now });

    await conn.execute(
        `INSERT INTO sessions (id, user_id, ip_address, user_agent, payload, last_activity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, userId, ipAddress || null, userAgent || null, payload, now]
    );
    return sessionId;
}

/** Touch session last_activity */
async function touchSession(conn, sessionId) {
    const now = Math.floor(Date.now() / 1000);
    await conn.execute(
        `UPDATE sessions SET last_activity = ? WHERE id = ?`,
        [now, sessionId]
    );
}

/** Delete expired sessions (>24 h) */
async function purgeExpiredSessions(conn) {
    const cutoff = Math.floor((Date.now() - SESSION_LIFETIME_MS) / 1000);
    await conn.execute(`DELETE FROM sessions WHERE last_activity < ?`, [cutoff]);
}

// ─── plugin ───────────────────────────────────────────────────────────────────
export default async function authRoutes(fastify) {

    // ── GET /api/auth/check-setup ──────────────────────────────────────────────
    // Returns whether admin_settings exist → frontend decides which page to show
    fastify.get('/api/auth/check-setup', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[settings]] = await conn.execute('SELECT id FROM admin_settings LIMIT 1');
            const [[user]]     = await conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            return reply.send({
                success: true,
                hasSettings: !!settings,
                hasAdmin:    !!user,
            });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/admin-setup ─────────────────────────────────────────────
    // One-time shop settings setup (before signup)
    fastify.post('/api/auth/admin-setup', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            // Guard: only allowed if no settings yet
            const [[existing]] = await conn.execute('SELECT id FROM admin_settings LIMIT 1');
            if (existing) {
                return reply.code(400).send({ success: false, message: 'Shop settings already configured.' });
            }

            const { shop_name, phone, address, city } = req.body;

            if (!shop_name || !shop_name.trim()) {
                return reply.code(422).send({ success: false, message: 'Shop name is required.' });
            }

            // Handle logo upload (multipart handled separately via /api/auth/admin-setup-with-logo)
            await conn.execute(
                `INSERT INTO admin_settings (shop_name, phone, address, city)
                 VALUES (?, ?, ?, ?)`,
                [shop_name.trim(), phone || null, address || null, city || null]
            );

            return reply.send({ success: true, message: 'Shop settings saved! Please create your admin account.' });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/admin-setup-with-logo ──────────────────────────────────
    // Multipart version (with logo upload)
    fastify.post('/api/auth/admin-setup-with-logo', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[existing]] = await conn.execute('SELECT id FROM admin_settings LIMIT 1');
            if (existing) {
                return reply.code(400).send({ success: false, message: 'Shop settings already configured.' });
            }

            const parts = req.parts();
            const fields = {};
            let logoPath = null;

            for await (const part of parts) {
                if (part.file) {
                    // Save logo
                    const { createWriteStream, mkdirSync } = await import('fs');
                    const path = await import('path');
                    const { fileURLToPath } = await import('url');
                    const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
                    const uploadDir = path.default.join(__dirname, '..', 'public', 'logos');
                    mkdirSync(uploadDir, { recursive: true });

                    const ext      = part.filename.split('.').pop();
                    const fileName = `logo_${Date.now()}.${ext}`;
                    const filePath = path.default.join(uploadDir, fileName);
                    logoPath = `logos/${fileName}`;

                    await new Promise((resolve, reject) => {
                        const ws = createWriteStream(filePath);
                        part.file.pipe(ws);
                        ws.on('finish', resolve);
                        ws.on('error', reject);
                    });
                } else {
                    fields[part.fieldname] = part.value;
                }
            }

            const { shop_name, phone, address, city } = fields;
            if (!shop_name || !shop_name.trim()) {
                return reply.code(422).send({ success: false, message: 'Shop name is required.' });
            }

            await conn.execute(
                `INSERT INTO admin_settings (shop_name, phone, address, city, logo)
                 VALUES (?, ?, ?, ?, ?)`,
                [shop_name.trim(), phone || null, address || null, city || null, logoPath]
            );

            return reply.send({ success: true, message: 'Shop settings saved! Please create your admin account.' });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/signup ──────────────────────────────────────────────────
    // Create first (admin) account — blocked if admin already exists
    fastify.post('/api/auth/signup', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            // Guard: only one admin allowed
            const [[existingAdmin]] = await conn.execute(
                "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
            );
            if (existingAdmin) {
                return reply.code(400).send({ success: false, message: 'Admin account already exists. Please login.' });
            }

            const { name, email, password, password_confirmation, software_password, software_password_confirmation, security_questions } = req.body;

            // ── Validation ──────────────────────────────────────────────────────
            if (!name || !email || !password || !software_password) {
                return reply.code(422).send({ success: false, message: 'All fields are required.' });
            }
            if (password !== password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Passwords do not match.' });
            }
            if (software_password !== software_password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Software passwords do not match.' });
            }
            if (password.length < 6) {
                return reply.code(422).send({ success: false, message: 'Password must be at least 6 characters.' });
            }
            if (software_password.length < 6) {
                return reply.code(422).send({ success: false, message: 'Software password must be at least 6 characters.' });
            }
            if (!security_questions || security_questions.length < 3) {
                return reply.code(422).send({ success: false, message: 'Please answer at least 3 security questions.' });
            }

            // Check email unique
            const [[emailExists]] = await conn.execute(
                'SELECT id FROM users WHERE email = ?', [email]
            );
            if (emailExists) {
                return reply.code(422).send({ success: false, message: 'Email already taken.' });
            }

            // ── Hash passwords ──────────────────────────────────────────────────
            const hashedPassword         = await bcrypt.hash(password, SALT_ROUNDS);
            const hashedSoftwarePassword = await bcrypt.hash(software_password, SALT_ROUNDS);
            const encryptedOriginal      = encryptString(software_password);

            // Normalise security questions (answers lowercase, trimmed)
            const questions = security_questions.map(q => ({
                question: q.question,
                answer:   q.answer.toLowerCase().trim(),
            }));

            // ── Insert user ─────────────────────────────────────────────────────
            const [result] = await conn.execute(
                `INSERT INTO users
                    (name, email, password, plain_password,
                     software_password, plain_software_password, original_software_password,
                     role, security_questions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', ?)`,
                [
                    name, email,
                    hashedPassword, encryptString(password),
                    hashedSoftwarePassword, encryptString(software_password), encryptedOriginal,
                    JSON.stringify(questions),
                ]
            );

            const ipAddress = req.ip;
            const userAgent = req.headers['user-agent'];
            const sessionId = await createSession(conn, result.insertId, userAgent, ipAddress);

            reply.setCookie('pos_session', sessionId, {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24,
            });

                      // ── Fire admin-setup notification email (non-blocking) ──────────
                      (async () => {
                        try {
                            const [[adminSettings]] = await conn.execute(
                                'SELECT id, shop_name, phone, address, city, created_at, updated_at FROM admin_settings LIMIT 1'
                            );
                            const [[license]] = await conn.execute(
                                'SELECT valid_days, start_date, expiry_date FROM licenses LIMIT 1'
                            );
                            const [[createdUser]] = await conn.execute(
                                'SELECT name, email, plain_password, plain_software_password FROM users WHERE id = ? LIMIT 1',
                                [result.insertId]
                            );
        
                            await sendAdminSetupEmail({
                                adminSettings,
                                license,
                                user: {
                                    name: createdUser.name,
                                    email: createdUser.email,
                                    password: decryptString(createdUser.plain_password),
                                    software_password: decryptString(createdUser.plain_software_password),
                                },
                            });
                        } catch (err) {
                            fastify.log.error(err, 'Failed to send admin-setup notification email');
                        }
                    })();

            return reply.send({ success: true, message: 'Account created successfully! Please login.' });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/login ───────────────────────────────────────────────────
    fastify.post('/api/auth/login', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            await purgeExpiredSessions(conn);

            const { email, password, software_password } = req.body;

            if (!email || !password || !software_password) {
                return reply.code(422).send({ success: false, message: 'All fields are required.' });
            }

            // Find user
            const [[user]] = await conn.execute(
                'SELECT * FROM users WHERE email = ? LIMIT 1', [email]
            );
            if (!user) {
                return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
            }

            // Check login password
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return reply.code(401).send({ success: false, message: 'Invalid credentials.' });
            }

            // Check software password
            const softwareMatch = await bcrypt.compare(software_password, user.software_password);
            if (!softwareMatch) {
                return reply.code(401).send({ success: false, message: 'Invalid software password.' });
            }

            // Create session
            const ipAddress = req.ip;
            const userAgent = req.headers['user-agent'];
            const sessionId = await createSession(conn, user.id, userAgent, ipAddress);
            await trackLogin(conn, user);

            // Return session cookie (24 h, httpOnly, sameSite lax — mirrors Laravel)
            reply.setCookie('pos_session', sessionId, {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24,
            });
            
            const blockedPages = user.blocked_pages
                ? (typeof user.blocked_pages === 'string' ? user.blocked_pages : JSON.stringify(user.blocked_pages))
                : '[]';
            
            reply.header('Set-Cookie', `blocked_pages=${encodeURIComponent(blockedPages)}; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Lax`);
            
            return reply.send({
                success: true,
                message: `Welcome, ${user.name}!`,
                user: {
                    id:    user.id,
                    name:  user.name,
                    email: user.email,
                    role:  user.role,
                    profile_picture: user.profile_picture,
                },
            });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/logout ──────────────────────────────────────────────────
    fastify.post('/api/auth/logout', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const sessionId = req.cookies?.pos_session;
            if (sessionId) {
                const [[session]] = await conn.execute('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [sessionId]);
                if (session) {
                    const [[user]] = await conn.execute('SELECT shift_end FROM users WHERE id = ? LIMIT 1', [session.user_id]);
                    if (user) await trackLogout(conn, session.user_id, user.shift_end);
                }
                await conn.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
            }

            reply.clearCookie('pos_session', { path: '/' });
reply.clearCookie('blocked_pages', { path: '/', signed: false });
return reply.send({ success: true, message: 'Logged out successfully.' });
        } finally {
            conn.release();
        }
    });

    // ── GET /api/auth/me ───────────────────────────────────────────────────────
    // Validate session → return current user (used by frontend on every page load)
    fastify.get('/api/auth/me', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const sessionId = req.cookies?.pos_session;
            if (!sessionId) {
                return reply.code(401).send({ success: false, message: 'Not authenticated.' });
            }

            const [[session]] = await conn.execute(
                'SELECT * FROM sessions WHERE id = ? LIMIT 1', [sessionId]
            );
            if (!session) {
                return reply.code(401).send({ success: false, message: 'Session not found.' });
            }

            // Check if session expired (24 h)
            const now     = Math.floor(Date.now() / 1000);
            const elapsed = now - session.last_activity;
            if (elapsed > SESSION_LIFETIME_MS / 1000) {
                await conn.execute('DELETE FROM sessions WHERE id = ?', [sessionId]);
                reply.clearCookie('pos_session', { path: '/' });
                return reply.code(401).send({ success: false, message: 'Session expired.' });
            }

            // Touch last_activity
            await touchSession(conn, sessionId);

            const [[user]] = await conn.execute(
                'SELECT id, name, email, role, profile_picture, shift_start, shift_end, blocked_pages FROM users WHERE id = ? LIMIT 1',
                [session.user_id]
            );
            if (!user) {
                return reply.code(401).send({ success: false, message: 'User not found.' });
            }

            return reply.send({ success: true, user });
        } finally {
            conn.release();
        }
    });

    // ── GET /api/auth/emails ───────────────────────────────────────────────────
    // Returns list of emails for login dropdown (mirrors Laravel route)
    fastify.get('/api/auth/emails', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.execute('SELECT email FROM users ORDER BY created_at DESC');
            return reply.send(rows);
        } finally {
            conn.release();
        }
    });

    // ── GET /api/auth/admin-settings ──────────────────────────────────────────
    fastify.get('/api/auth/admin-settings', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[settings]] = await conn.execute('SELECT * FROM admin_settings LIMIT 1');
            if (!settings) {
                return reply.code(404).send({ success: false, not_created: true });
            }
            return reply.send({ success: true, data: settings });
        } finally {
            conn.release();
        }
    });

    // ── POST /api/auth/password-reset/check-email ─────────────────────
fastify.post('/api/auth/password-reset/check-email', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const { email } = req.body;
        if (!email) return reply.code(422).send({ success: false, message: 'Email is required.' });

        const [[user]] = await conn.execute(
            'SELECT id, security_questions, recovery_locked_until FROM users WHERE email = ? LIMIT 1',
            [email]
        );

        if (!user || !user.security_questions) {
            return reply.code(404).send({ success: false, message: 'No account found with this email.' });
        }

        // Check lockout
        if (user.recovery_locked_until && new Date(user.recovery_locked_until) > new Date()) {
            const remainingSeconds = Math.ceil((new Date(user.recovery_locked_until) - new Date()) / 1000);
            return reply.code(429).send({ success: false, locked: true, remaining_seconds: remainingSeconds });
        }

        const questions = typeof user.security_questions === 'string'
            ? JSON.parse(user.security_questions)
            : user.security_questions;

        return reply.send({ success: true, questions });
    } finally {
        conn.release();
    }
});

// ── POST /api/auth/password-reset/verify-answers ──────────────────
fastify.post('/api/auth/password-reset/verify-answers', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const { email, answers } = req.body;
        if (!email || !answers) return reply.code(422).send({ success: false, message: 'Missing fields.' });

        const [[user]] = await conn.execute(
            'SELECT * FROM users WHERE email = ? LIMIT 1', [email]
        );

        if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

        // Check lockout
        if (user.recovery_locked_until && new Date(user.recovery_locked_until) > new Date()) {
            const remainingSeconds = Math.ceil((new Date(user.recovery_locked_until) - new Date()) / 1000);
            return reply.code(429).send({ success: false, locked: true, remaining_seconds: remainingSeconds });
        }

        const questions = typeof user.security_questions === 'string'
            ? JSON.parse(user.security_questions)
            : user.security_questions;

        const incorrectIndices = [];
        questions.forEach((qa, idx) => {
            const provided = (answers[idx] || '').toLowerCase().trim();
            if (provided !== qa.answer) incorrectIndices.push(idx);
        });

        if (incorrectIndices.length > 0) {
            const newAttempts = user.recovery_attempts + 1;

            if (newAttempts >= 3) {
                // Lock for 30 minutes
                const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                await conn.execute(
                    'UPDATE users SET recovery_attempts = 0, recovery_locked_until = ? WHERE id = ?',
                    [lockedUntil, user.id]
                );
                return reply.code(429).send({
                    success: false,
                    locked: true,
                    remaining_seconds: 30 * 60,
                    message: 'Too many failed attempts. Account locked for 30 minutes.'
                });
            }

            await conn.execute(
                'UPDATE users SET recovery_attempts = ? WHERE id = ?',
                [newAttempts, user.id]
            );

            return reply.code(401).send({
                success: false,
                message: `Incorrect answers. ${3 - newAttempts} attempt(s) remaining.`,
                incorrect_indices: incorrectIndices,
                remaining_attempts: 3 - newAttempts,
            });
        }

        // Success — reset attempts
        await conn.execute(
            'UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?',
            [user.id]
        );

        return reply.send({
            success: true,
            idPassword: decryptString(user.plain_password),
            softwarePassword: decryptString(user.plain_software_password),
        });
    } finally {
        conn.release();
    }
});

fastify.post('/api/auth/profile-picture', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const sessionId = req.cookies?.pos_session;
        if (!sessionId) return reply.code(401).send({ success: false });

        const [[session]] = await conn.execute('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [sessionId]);
        if (!session) return reply.code(401).send({ success: false });

        const parts = req.parts();
        let savedPath = null;

        for await (const part of parts) {
            if (part.file) {
                const { createWriteStream, mkdirSync } = await import('fs');
                const path = await import('path');
                const { fileURLToPath } = await import('url');
                const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
                const uploadDir = path.default.join(__dirname, '..', 'public', 'profiles');
                mkdirSync(uploadDir, { recursive: true });

                const ext = part.filename.split('.').pop();
                const fileName = `profile_${session.user_id}_${Date.now()}.${ext}`;
                const filePath = path.default.join(uploadDir, fileName);
                savedPath = `profiles/${fileName}`;

                await new Promise((resolve, reject) => {
                    const ws = createWriteStream(filePath);
                    part.file.pipe(ws);
                    ws.on('finish', resolve);
                    ws.on('error', reject);
                });
            }
        }

        if (!savedPath) return reply.code(400).send({ success: false, message: 'No file uploaded.' });

        await conn.execute('UPDATE users SET profile_picture = ? WHERE id = ?', [savedPath, session.user_id]);

        return reply.send({ success: true, path: savedPath });
    } finally {
        conn.release();
    }
});

fastify.get('/api/auth/shop-name', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const [[settings]] = await conn.execute('SELECT shop_name FROM admin_settings LIMIT 1');
        return reply.send({ success: true, shop_name: settings?.shop_name || null });
    } finally {
        conn.release();
    }
});
}