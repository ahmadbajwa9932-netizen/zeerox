import bcrypt from 'bcrypt';
import db from '../db.js';
import crypto from 'crypto';
import { isLicenseExpired, licenseDaysRemaining } from '../middleware/checkLicense.js';

function decryptString(val) {
    if (!val) return '********';
    try {
        const key = (process.env.APP_KEY || 'fallback-secret-key-32-chars!!').slice(0, 32).padEnd(32, '0');
        const [ivHex, encryptedHex] = val.split(':');
        const iv        = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        return '********';
    }
}

function encryptString(text) {
    const key = (process.env.APP_KEY || 'fallback-secret-key-32-chars!!').slice(0, 32).padEnd(32, '0');
    const iv  = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

const SALT_ROUNDS = 12;

export default async function userRoutes(fastify) {

    // ── GET /api/users/admin-details ─────────────────────────────────────────
    fastify.get('/api/users/admin-details', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[admin]] = await conn.execute(
                "SELECT id, name, email, security_questions FROM users WHERE role = 'admin' LIMIT 1"
            );
            if (!admin) return reply.code(404).send({ success: false, message: 'Admin not found' });

            const questions = typeof admin.security_questions === 'string'
                ? JSON.parse(admin.security_questions)
                : admin.security_questions;

            return reply.send({
                success: true,
                data: { id: admin.id, name: admin.name, email: admin.email, security_questions: questions ?? [] }
            });
        } finally { conn.release(); }
    });

    // ── GET /api/users/data ───────────────────────────────────────────────────
    fastify.get('/api/users/data', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const page      = parseInt(req.query.page || '1');
            const perPage   = 10;
            const offset    = (page - 1) * perPage;
            const sortCol   = ['name', 'email', 'created_at'].includes(req.query.sort_column)
                ? req.query.sort_column : 'created_at';
            const sortDir   = req.query.sort_direction === 'asc' ? 'ASC' : 'DESC';

            const [[{ total }]] = await conn.execute(
                "SELECT COUNT(*) as total FROM users WHERE role = 'user'"
            );
            const [rows] = await conn.execute(
                `SELECT id, name, email, role, shift_start, shift_end, created_at
                 FROM users WHERE role = 'user'
                 ORDER BY ${sortCol} ${sortDir}
                 LIMIT ? OFFSET ?`,
                [perPage, offset]
            );

            const lastPage = Math.ceil(total / perPage) || 1;
            return reply.send({
                success: true,
                data: rows,
                pagination: {
                    current_page:  page,
                    last_page:     lastPage,
                    per_page:      perPage,
                    total,
                    first_item:    total === 0 ? 0 : offset + 1,
                    last_item:     Math.min(offset + perPage, total),
                    has_more_pages: page < lastPage,
                    on_first_page:  page === 1,
                }
            });
        } finally { conn.release(); }
    });

    // ── POST /api/users/store ─────────────────────────────────────────────────
    fastify.post('/api/users/store', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const { name, email, password, password_confirmation, shift_start, shift_end,
                    security_questions, admin_password } = req.body;

            // Validate
            if (!name || !email || !password) {
                return reply.code(422).send({ success: false, message: 'All fields are required.' });
            }
            if (password !== password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Passwords do not match.' });
            }
            if (password.length < 6) {
                return reply.code(422).send({ success: false, message: 'Password must be at least 6 characters.' });
            }
            if (!security_questions || Object.keys(security_questions).length < 3) {
                return reply.code(422).send({ success: false, message: 'Please select at least 3 security questions.' });
            }

            // Verify admin password
            const [[admin]] = await conn.execute(
                "SELECT * FROM users WHERE role = 'admin' LIMIT 1"
            );
            if (!admin) return reply.code(400).send({ success: false, message: 'Admin not found.' });

            const adminOk = await bcrypt.compare(admin_password, admin.password);
            if (!adminOk) return reply.code(401).send({ success: false, message: 'Incorrect admin password.' });

            // Check email unique
            const [[emailExists]] = await conn.execute('SELECT id FROM users WHERE email = ?', [email]);
            if (emailExists) return reply.code(422).send({ success: false, message: 'Email already taken.' });

            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            const plainEncrypted = encryptString(password);

            const questions = Object.values(security_questions).map(q => ({
                question: q.question,
                answer:   q.answer.toLowerCase().trim(),
            }));

            const defaultBlockedPages = [
                'dashboard',
                'reports',
                'reports.sales',
                'reports.financial',
                'reports.purchase',
                'expenses',
                'expenses.create',
                'expenses.index',
                'payment-accounts',
                'backup',
                'admin',
            ];

            await conn.execute(
                `INSERT INTO users
                    (name, email, password, plain_password,
                     software_password, plain_software_password, original_software_password,
                     role, shift_start, shift_end, blocked_pages, security_questions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`,
                [
                    name, email,
                    hashedPassword, plainEncrypted,
                    admin.software_password, admin.plain_software_password, admin.original_software_password,
                    shift_start || null, shift_end || null,
                    JSON.stringify(defaultBlockedPages),
                    JSON.stringify(questions),
                ]
            );

            return reply.send({ success: true, message: 'User created successfully!' });
        } finally { conn.release(); }
    });

    // ── DELETE /api/users/delete/:id ──────────────────────────────────────────
    fastify.delete('/api/users/delete/:id', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[user]] = await conn.execute(
                "SELECT id FROM users WHERE id = ? AND role = 'user' LIMIT 1", [req.params.id]
            );
            if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

            await conn.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
            return reply.send({ success: true, message: 'User deleted successfully!' });
        } finally { conn.release(); }
    });

    // ── GET /api/users/get-user/:id ───────────────────────────────────────────
    fastify.get('/api/users/get-user/:id', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[user]] = await conn.execute(
                "SELECT id, name, email, shift_start, shift_end, security_questions FROM users WHERE id = ? AND role = 'user' LIMIT 1",
                [req.params.id]
            );
            if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

            const questions = typeof user.security_questions === 'string'
                ? JSON.parse(user.security_questions)
                : user.security_questions;

            return reply.send({
                success: true,
                data: {
                    id: user.id, name: user.name, email: user.email,
                    shift_start: user.shift_start ? user.shift_start.slice(0, 5) : null,
                    shift_end:   user.shift_end   ? user.shift_end.slice(0, 5)   : null,
                    security_questions: questions ?? [],
                }
            });
        } finally { conn.release(); }
    });

    // ── POST /api/users/update/:id ────────────────────────────────────────────
    fastify.post('/api/users/update/:id', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[user]] = await conn.execute(
                "SELECT id FROM users WHERE id = ? AND role = 'user' LIMIT 1", [req.params.id]
            );
            if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

            const { name, email, password, password_confirmation, shift_start, shift_end, security_questions } = req.body;

            if (!name || !email) return reply.code(422).send({ success: false, message: 'Name and email are required.' });
            if (password && password !== password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Passwords do not match.' });
            }
            if (!security_questions || Object.keys(security_questions).length < 3) {
                return reply.code(422).send({ success: false, message: 'Please select at least 3 security questions.' });
            }

            // Check email unique (exclude self)
            const [[emailExists]] = await conn.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?', [email, req.params.id]
            );
            if (emailExists) return reply.code(422).send({ success: false, message: 'Email already taken.' });

            const questions = Object.values(security_questions).map(q => ({
                question: q.question,
                answer:   q.answer.toLowerCase().trim(),
            }));

            if (password) {
                const hashed  = await bcrypt.hash(password, SALT_ROUNDS);
                const encoded = encryptString(password);
                await conn.execute(
                    `UPDATE users SET name=?, email=?, password=?, plain_password=?,
                     shift_start=?, shift_end=?, security_questions=?, updated_at=NOW()
                     WHERE id=?`,
                    [name, email, hashed, encoded, shift_start || null, shift_end || null,
                     JSON.stringify(questions), req.params.id]
                );
            } else {
                await conn.execute(
                    `UPDATE users SET name=?, email=?, shift_start=?, shift_end=?,
                     security_questions=?, updated_at=NOW() WHERE id=?`,
                    [name, email, shift_start || null, shift_end || null,
                     JSON.stringify(questions), req.params.id]
                );
            }

            return reply.send({ success: true, message: 'User updated successfully!' });
        } finally { conn.release(); }
    });

    // ── POST /api/users/verify-admin-password ────────────────────────────────
    fastify.post('/api/users/verify-admin-password', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const { admin_password } = req.body;
            const [[admin]] = await conn.execute("SELECT password FROM users WHERE role = 'admin' LIMIT 1");
            if (!admin) return reply.code(404).send({ success: false, message: 'Admin not found.' });

            const ok = await bcrypt.compare(admin_password, admin.password);
            if (!ok) return reply.code(401).send({ success: false, message: 'Incorrect admin password.' });

            return reply.send({ success: true, message: 'Password verified successfully.' });
        } finally { conn.release(); }
    });

    // ── POST /api/users/verify-and-show-password ─────────────────────────────
    fastify.post('/api/users/verify-and-show-password', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const { admin_password, password_type, user_id } = req.body;

            const [[admin]] = await conn.execute("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
            if (!admin) return reply.code(404).send({ success: false, message: 'Admin not found.' });

            const ok = await bcrypt.compare(admin_password, admin.password);
            if (!ok) return reply.code(401).send({ success: false, message: 'Incorrect admin password.' });

            const [[user]] = await conn.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [user_id]);
            if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

            const pw = password_type === 'software'
    ? decryptString(user.plain_software_password)
    : decryptString(user.plain_password);

            return reply.send({ success: true, password: pw });
        } finally { conn.release(); }
    });

    // ── POST /api/users/admin/update ─────────────────────────────────────────
    fastify.post('/api/users/admin/update', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[admin]] = await conn.execute("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
            if (!admin) return reply.code(404).send({ success: false, message: 'Admin not found.' });

            const { name, email, password, password_confirmation,
                    software_password, software_password_confirmation, security_questions } = req.body;

            if (!name || !email) return reply.code(422).send({ success: false, message: 'Name and email are required.' });
            if (password && password !== password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Passwords do not match.' });
            }
            if (software_password && software_password !== software_password_confirmation) {
                return reply.code(422).send({ success: false, message: 'Software passwords do not match.' });
            }
            if (!security_questions || security_questions.length < 3) {
                return reply.code(422).send({ success: false, message: 'Please select at least 3 security questions.' });
            }

            // Check email unique (exclude self)
            const [[emailExists]] = await conn.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?', [email, admin.id]
            );
            if (emailExists) return reply.code(422).send({ success: false, message: 'Email already taken.' });

            const questions = security_questions.map(q => ({
                question: q.question,
                answer:   q.answer.toLowerCase().trim(),
            }));

            let sets = ['name=?', 'email=?', 'security_questions=?', 'updated_at=NOW()'];
            let vals = [name, email, JSON.stringify(questions)];

            if (password) {
                sets.push('password=?', 'plain_password=?');
                vals.push(await bcrypt.hash(password, SALT_ROUNDS), encryptString(password));
            }
            if (software_password) {
                const hashed = await bcrypt.hash(software_password, SALT_ROUNDS);
                const enc = encryptString(software_password);
                sets.push('software_password=?', 'plain_software_password=?', 'original_software_password=?');
                vals.push(hashed, enc, enc);

                // Sync all users' software_password
                await conn.execute(
                    "UPDATE users SET software_password=?, plain_software_password=?, original_software_password=? WHERE role='user'",
                    [hashed, enc, enc]
                );
            }

            vals.push(admin.id);
            await conn.execute(`UPDATE users SET ${sets.join(',')} WHERE id=?`, vals);

            return reply.send({ success: true, message: 'Admin credentials updated successfully!' });
        } finally { conn.release(); }
    });

    // ── GET /api/users/admin/settings ────────────────────────────────────────
    fastify.get('/api/users/admin/settings', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[s]] = await conn.execute('SELECT * FROM admin_settings LIMIT 1');
            if (!s) return reply.code(404).send({ success: false, not_created: true, message: 'Admin settings not found.' });
            return reply.send({ success: true, data: { shop_name: s.shop_name, phone: s.phone, address: s.address, city: s.city, logo: s.logo } });
        } finally { conn.release(); }
    });

    // ── POST /api/users/admin/settings/update ────────────────────────────────
    fastify.post('/api/users/admin/settings/update', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const parts  = req.parts ? req.parts() : null;
            const fields = {};
            let logoPath = null;

            if (parts) {
                for await (const part of parts) {
                    if (part.file) {
                        const { createWriteStream, mkdirSync } = await import('fs');
                        const pathMod = await import('path');
                        const { fileURLToPath } = await import('url');
                        const __dirname = pathMod.default.dirname(fileURLToPath(import.meta.url));
                        const uploadDir = pathMod.default.join(__dirname, '..', 'public', 'logos');
                        mkdirSync(uploadDir, { recursive: true });
                        const ext      = part.filename.split('.').pop();
                        const fileName = `logo_${Date.now()}.${ext}`;
                        logoPath = `logos/${fileName}`;
                        const filePath = pathMod.default.join(uploadDir, fileName);
                        await new Promise((res, rej) => {
                            const ws = createWriteStream(filePath);
                            part.file.pipe(ws);
                            ws.on('finish', res);
                            ws.on('error', rej);
                        });
                    } else {
                        fields[part.fieldname] = part.value;
                    }
                }
            } else {
                Object.assign(fields, req.body);
            }

            if (!fields.shop_name) return reply.code(422).send({ success: false, message: 'Shop name is required.' });

            const [[s]] = await conn.execute('SELECT id FROM admin_settings LIMIT 1');
            if (s) {
                const sets = ['shop_name=?', 'phone=?', 'address=?', 'city=?', 'updated_at=NOW()'];
                const vals = [fields.shop_name, fields.phone || null, fields.address || null, fields.city || null];
                if (logoPath) { sets.push('logo=?'); vals.push(logoPath); }
                vals.push(s.id);
                await conn.execute(`UPDATE admin_settings SET ${sets.join(',')} WHERE id=?`, vals);
            } else {
                await conn.execute(
                    'INSERT INTO admin_settings (shop_name, phone, address, city, logo) VALUES (?,?,?,?,?)',
                    [fields.shop_name, fields.phone || null, fields.address || null, fields.city || null, logoPath]
                );
            }

            return reply.send({ success: true, message: 'Admin settings updated successfully.' });
        } finally { conn.release(); }
    });

    // ── POST /api/users/admin/settings/store ─────────────────────────────────
    fastify.post('/api/users/admin/settings/store', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const parts  = req.parts ? req.parts() : null;
            const fields = {};
            let logoPath = null;

            if (parts) {
                for await (const part of parts) {
                    if (part.file) {
                        const { createWriteStream, mkdirSync } = await import('fs');
                        const pathMod = await import('path');
                        const { fileURLToPath } = await import('url');
                        const __dirname = pathMod.default.dirname(fileURLToPath(import.meta.url));
                        const uploadDir = pathMod.default.join(__dirname, '..', 'public', 'logos');
                        mkdirSync(uploadDir, { recursive: true });
                        const ext      = part.filename.split('.').pop();
                        const fileName = `logo_${Date.now()}.${ext}`;
                        logoPath = `logos/${fileName}`;
                        const filePath = pathMod.default.join(uploadDir, fileName);
                        await new Promise((res, rej) => {
                            const ws = createWriteStream(filePath);
                            part.file.pipe(ws);
                            ws.on('finish', res);
                            ws.on('error', rej);
                        });
                    } else {
                        fields[part.fieldname] = part.value;
                    }
                }
            } else {
                Object.assign(fields, req.body);
            }

            if (!fields.shop_name) return reply.code(422).send({ success: false, message: 'Shop name is required.' });

            await conn.execute(
                'INSERT INTO admin_settings (shop_name, phone, address, city, logo) VALUES (?,?,?,?,?)',
                [fields.shop_name, fields.phone || null, fields.address || null, fields.city || null, logoPath]
            );

            return reply.send({ success: true, message: 'Admin settings created successfully.' });
        } finally { conn.release(); }
    });

    // ── GET /api/users/license/info ───────────────────────────────────────────
    fastify.get('/api/users/license/info', async (req, reply) => {
        const conn = await db.getConnection();
        try {
            const [[lic]] = await conn.execute('SELECT * FROM licenses LIMIT 1');
            if (!lic) return reply.code(404).send({ success: false, message: 'No license found.' });

            // Same helpers as checkLicense.js so this card can never disagree
            // with the middleware that actually blocks requests.
            const isExpired     = isLicenseExpired(lic.expiry_date);
            const daysRemaining = licenseDaysRemaining(lic.expiry_date);

            return reply.send({
                success: true,
                data: {
                    valid_days:     lic.valid_days,
                    start_date:     lic.start_date,
                    expiry_date:    lic.expiry_date,
                    is_expired:     isExpired,
                    days_remaining: daysRemaining,
                    status:         isExpired ? 'Expired' : 'Active',
                }
            });
        } finally { conn.release(); }
    });

    // ── GET /api/users/blocked-pages/:id ─────────────────────────────────────
fastify.get('/api/users/blocked-pages/:id', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const [[user]] = await conn.execute(
            "SELECT id, name, blocked_pages FROM users WHERE id = ? AND role = 'user' LIMIT 1",
            [req.params.id]
        );
        if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

        const blocked = typeof user.blocked_pages === 'string'
            ? JSON.parse(user.blocked_pages)
            : (user.blocked_pages ?? []);

        return reply.send({ success: true, name: user.name, blocked_pages: blocked });
    } finally { conn.release(); }
});

// ── GET /api/users/my-permissions ────────────────────────────────────────
fastify.get('/api/users/my-permissions', async (req, reply) => {
    try {
        // checkAuth middleware already attaches the full user row (including
        // blocked_pages) to req.user — no extra DB query needed here.
        if (!req.user) {
            return reply.code(401).send({ success: false, message: 'Not authenticated.' });
        }

        const blocked = typeof req.user.blocked_pages === 'string'
            ? JSON.parse(req.user.blocked_pages)
            : (req.user.blocked_pages ?? []);

        return reply.send({ success: true, blocked_pages: blocked });
    } catch (err) {
        console.error('my-permissions error:', err);
        return reply.code(500).send({ success: false, message: 'Server error fetching permissions.' });
    }
});

// ── POST /api/users/update-access/:id ────────────────────────────────────
fastify.post('/api/users/update-access/:id', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const { admin_password, blocked_pages } = req.body;

        const [[admin]] = await conn.execute("SELECT password FROM users WHERE role = 'admin' LIMIT 1");
        if (!admin) return reply.code(404).send({ success: false, message: 'Admin not found.' });

        const ok = await bcrypt.compare(admin_password, admin.password);
        if (!ok) return reply.code(401).send({ success: false, message: 'Incorrect admin password.' });

        const [[user]] = await conn.execute(
            "SELECT id FROM users WHERE id = ? AND role = 'user' LIMIT 1",
            [req.params.id]
        );
        if (!user) return reply.code(404).send({ success: false, message: 'User not found.' });

        await conn.execute(
            'UPDATE users SET blocked_pages = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(blocked_pages ?? []), req.params.id]
        );

        return reply.send({ success: true, message: 'Access settings updated successfully.' });
    } finally { conn.release(); }
});

// ── GET /api/users/:id/performance ───────────────────────────────────────
fastify.get('/api/users/:id/performance', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const userId = req.params.id;
        const page = parseInt(req.query.page || '1');
        const perPage = 15;
        const offset = (page - 1) * perPage;

        // Auto-cleanup: delete records older than 2 months
        await conn.execute(
            "DELETE FROM user_performance_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 MONTH)"
        );

        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

        const [[{ total }]] = await conn.execute(
            'SELECT COUNT(*) as total FROM user_performance_logs WHERE user_id = ? AND created_at >= ?',
            [userId, twoMonthsAgo]
        );

        const [[stats]] = await conn.execute(
            'SELECT COUNT(*) as total_days, AVG(duty_minutes) as avg_duty FROM user_performance_logs WHERE user_id = ? AND created_at >= ?',
            [userId, twoMonthsAgo]
        );

        const [logs] = await conn.execute(
            `SELECT * FROM user_performance_logs
             WHERE user_id = ? AND created_at >= ?
             ORDER BY date DESC
             LIMIT ? OFFSET ?`,
            [userId, twoMonthsAgo, perPage, offset]
        );

        const lastPage = Math.ceil(total / perPage) || 1;

        return reply.send({
            success: true,
            logs,
            stats: {
                total_days: stats.total_days,
                avg_duty: Math.round(stats.avg_duty ?? 0),
            },
            pagination: {
                current_page: page,
                last_page: lastPage,
                per_page: perPage,
                total,
                first_item: total === 0 ? 0 : offset + 1,
                last_item: Math.min(offset + perPage, total),
                has_more_pages: page < lastPage,
                on_first_page: page === 1,
            }
        });
    } finally { conn.release(); }
});

// ── GET /api/users/activity-logs ─────────────────────────────────────────
fastify.get('/api/users/activity-logs', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const page    = parseInt(req.query.page || '1');
        const perPage = 10;
        const offset  = (page - 1) * perPage;
        const userId  = req.query.user_id || null;

        const where  = userId ? 'WHERE l.user_id = ?' : '';
        const params = userId ? [userId] : [];

        const [[{ total }]] = await conn.execute(
            `SELECT COUNT(*) as total FROM user_activity_logs l ${where}`,
            params
        );

        const [rows] = await conn.execute(
            `SELECT l.id, l.user_id, l.action_type, l.action_description,
                    l.entity_type, l.entity_id, l.is_read, l.created_at,
                    COALESCE(l.user_name, u.name, 'Unknown user') as user_name
             FROM user_activity_logs l
             LEFT JOIN users u ON u.id = l.user_id
             ${where}
             ORDER BY l.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, perPage, offset]
        );

        const lastPage = Math.ceil(total / perPage) || 1;
        return reply.send({
            success: true,
            data: rows,
            pagination: {
                current_page: page,
                last_page: lastPage,
                per_page: perPage,
                total,
                first_item: total === 0 ? 0 : offset + 1,
                last_item: Math.min(offset + perPage, total),
                has_more_pages: page < lastPage,
                on_first_page: page === 1,
            }
        });
    } finally { conn.release(); }
});

// ── GET /api/users/activity-logs/unread-count ────────────────────────────
fastify.get('/api/users/activity-logs/unread-count', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const [[{ count }]] = await conn.execute(
            'SELECT COUNT(*) as count FROM user_activity_logs WHERE is_read = 0'
        );
        return reply.send({ success: true, count });
    } finally { conn.release(); }
});

// With this:
// ── POST /api/users/activity-logs/mark-read ──────────────────────────────
fastify.post('/api/users/activity-logs/mark-read', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const { ids } = req.body || {};
        if (Array.isArray(ids) && ids.length > 0) {
            await conn.query(
                `UPDATE user_activity_logs SET is_read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids
            );
        } else {
            await conn.execute('UPDATE user_activity_logs SET is_read = 1 WHERE is_read = 0');
        }
        return reply.send({ success: true, message: 'Marked as read.' });
    } finally { conn.release(); }
});

// ── DELETE /api/users/activity-logs/:id — permanently delete one log ─────
fastify.delete('/api/users/activity-logs/:id', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const [result] = await conn.execute(
            'DELETE FROM user_activity_logs WHERE id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return reply.status(404).send({ success: false, message: 'Notification not found.' });
        }
        return reply.send({ success: true, message: 'Notification deleted.' });
    } finally { conn.release(); }
});

// ── DELETE /api/users/activity-logs — bulk permanent delete ──────────────
// Body: { ids: [1,2,3] } deletes only those; omit ids (or send empty) to delete ALL.
fastify.delete('/api/users/activity-logs', async (req, reply) => {
    const conn = await db.getConnection();
    try {
        const { ids } = req.body || {};
        if (Array.isArray(ids) && ids.length > 0) {
            await conn.query(
                `DELETE FROM user_activity_logs WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids
            );
            return reply.send({ success: true, message: `${ids.length} notification(s) deleted.` });
        } else {
            await conn.execute('DELETE FROM user_activity_logs');
            return reply.send({ success: true, message: 'All notifications deleted.' });
        }
    } finally { conn.release(); }
});

}