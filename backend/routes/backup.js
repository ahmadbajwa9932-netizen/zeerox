import pool from '../db.js';
import bcrypt from 'bcrypt'; 
import { logActivity } from '../helpers/activityLogger.js';

// Tables that must NEVER be exported or wiped on factory reset
const EXCLUDED_TABLES = ['licenses', 'admin_settings'];

const BATCH_SIZE = 500;

// These tables only make sense to export alongside the users table,
// since they store per-user history / activity tied to user_id.
const USER_DEPENDENT_TABLES = ['user_activity_logs', 'user_performance_logs'];

// Tables that have a nullable FK column pointing at `users`. When exporting
// "without users", these columns are set to NULL in the dump instead of
// carrying over an id that won't exist (or will point at the wrong person)
// on the target database.
const USER_FK_COLUMNS = {
    sales: 'seller_id',
    sale_returns: 'user_id',
    walk_in_return_sessions: 'user_id',
};

// Tables that ship with default reference/seed rows — on factory reset these
// are truncated like everything else, then re-populated with these defaults
// instead of being left empty.
const RESET_SEED_DATA = {
    categories: {
        columns: ['name', 'description', 'status'],
        rows: [
            ['Misc', 'Default miscellaneous category', 1],
            ['Services', 'Default services category', 1],
        ],
    },
    units: {
        columns: ['name', 'display_name', 'is_active', 'is_default', 'sort_order'],
        rows: [
            ['pcs', 'Pieces', 1, 1, 1],
            ['dozen', 'Dozen', 1, 1, 2],
            ['meter', 'Meter', 1, 1, 3],
            ['feet', 'Feet', 1, 1, 4],
            ['liter', 'Liter', 1, 1, 5],
            ['ml', 'Milliliter', 1, 1, 6],
            ['gallon', 'Gallon', 1, 1, 7],
            ['bag', 'Bag', 1, 1, 8],
            ['kg', 'Kilogram', 1, 1, 9],
            ['ton', 'Ton', 1, 1, 10],
            ['roll', 'Roll', 1, 1, 11],
            ['sq.ft', 'Square Feet', 1, 1, 12],
            ['sq.m', 'Square Meter', 1, 1, 13],
            ['tube', 'Tube', 1, 1, 14],
            ['set', 'Set', 1, 1, 15],
            ['srv', 'Service', 1, 1, 16],
        ],
    },
    receipt_settings: {
        columns: ['id', 'paper_size', 'design_type', 'language', 'show_signature', 'show_stamp', 'show_paid_overlay'],
        rows: [[1, '80mm', 'design1', 'en', 1, 1, 1]],
    },
    app_settings: {
        columns: ['id', 'default_low_inventory'],
        rows: [[1, 2]],
    },
    currency_settings: {
        columns: ['id', 'currency_symbol', 'currency_position', 'currency_locale'],
        rows: [[1, 'Rs', 'before', 'en-PK']],
    },
};

async function reseedDefaults(conn) {
    for (const [table, seed] of Object.entries(RESET_SEED_DATA)) {
        const colList = seed.columns.map(ident).join(', ');
        const values = seed.rows
            .map((row) => `(${row.map((v) => conn.escape(v)).join(', ')})`)
            .join(',\n');
        await conn.query(`INSERT INTO ${ident(table)} (${colList}) VALUES\n${values}`);
    }
}

const ident = (name) => `\`${name}\``;

async function getAllTables(conn) {
    const [rows] = await conn.query('SHOW TABLES');
    const key = Object.keys(rows[0] || {})[0];
    return rows.map((r) => r[key]);
}

async function createStatement(conn, table) {
    const [rows] = await conn.query(`SHOW CREATE TABLE ${ident(table)}`);
    return rows[0]['Create Table'];
}

async function insertStatements(conn, table, whereClause = '', nullColumn = null) {
    const [rows] = await conn.query(`SELECT * FROM ${ident(table)} ${whereClause}`);
    if (rows.length === 0) return '';

    const columns = Object.keys(rows[0]);
    const colList = columns.map(ident).join(', ');
    let sql = '';

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const values = batch
            .map((row) => `(${columns.map((c) => conn.escape(c === nullColumn ? null : row[c])).join(', ')})`)
            .join(',\n');
        sql += `INSERT INTO ${ident(table)} (${colList}) VALUES\n${values};\n\n`;
    }
    return sql;
}

// Splits a raw .sql dump into statements, respecting ' " ` quoting
function splitSqlStatements(sql) {
    const statements = [];
    let current = '';
    let inString = null;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        const prev = sql[i - 1];

        if (inString) {
            current += ch;
            if (ch === inString && prev !== '\\') inString = null;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inString = ch;
            current += ch;
            continue;
        }
        if (ch === ';') {
            const t = current.trim();
            if (t) statements.push(t);
            current = '';
            continue;
        }
        current += ch;
    }
    const t = current.trim();
    if (t) statements.push(t);
    return statements;
}

async function verifyAdminPassword(password) {
    const [rows] = await pool.query("SELECT id, password FROM users WHERE role = 'admin' LIMIT 1");
    if (rows.length === 0) return { ok: false, status: 404, error: 'No admin account found' };
    const match = await bcrypt.compare(password, rows[0].password);
    if (!match) return { ok: false, status: 401, error: 'Incorrect password' };
    return { ok: true };
}

export default async function backupRoutes(fastify) {
    // fastify.addHook('preHandler', async (req, reply) => {
    //     if (!req.user || req.user.role !== 'admin') {
    //         return reply.code(403).send({ error: 'Admin access required.' });
    //     }
    // });

       // ── EXPORT ──────────────────────────────────────────
       fastify.get('/api/backup/export', async (req, reply) => {
        const includeUsers = req.query.includeUsers === 'true';
        const conn = await pool.getConnection();
        try {
            const tables = await getAllTables(conn);
            const skipTables = includeUsers ? [] : ['users', ...USER_DEPENDENT_TABLES];
            const dataTables = tables.filter((t) => !EXCLUDED_TABLES.includes(t) && !skipTables.includes(t));

            let sql = `-- POS System Backup\n-- Generated: ${new Date().toISOString()}\n`;
            sql += `-- Excluded (not in this file): ${EXCLUDED_TABLES.join(', ')}${includeUsers ? '' : ', users, ' + USER_DEPENDENT_TABLES.join(', ')}\n\n`;
            sql += 'SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n';

            for (const table of dataTables) {
                sql += `DROP TABLE IF EXISTS ${ident(table)};\n${await createStatement(conn, table)};\n\n`;
                const nullColumn = !includeUsers ? USER_FK_COLUMNS[table] || null : null;
                sql += await insertStatements(conn, table, '', nullColumn);
            }

            sql += 'SET FOREIGN_KEY_CHECKS=1;\n';

            const filename = `pos-backup-${includeUsers ? 'with-users' : 'no-users'}-${new Date().toISOString().slice(0, 10)}.sql`;

            await logActivity(req, {
                action_type: 'export',
                description: `Exported full database backup (${includeUsers ? 'with' : 'without'} users)`,
                entity_type: 'backup',
            });

            reply
                .header('Content-Type', 'application/sql')
                .header('Content-Disposition', `attachment; filename="${filename}"`)
                .send(sql);
        } catch (err) {
            fastify.log.error(err);
            reply.status(500).send({ error: 'Export failed', message: err.message });
        } finally {
            conn.release();
        }
    });

    // ── IMPORT ──────────────────────────────────────────
    fastify.post('/api/backup/import', async (req, reply) => {
        const file = await req.file();
        if (!file) return reply.status(400).send({ error: 'No file uploaded' });

        const buffer = await file.toBuffer();
        const statements = splitSqlStatements(buffer.toString('utf8'));

        const conn = await pool.getConnection();
        try {
            for (const stmt of statements) {
                await conn.query(stmt);
            }

            await logActivity(req, {
                action_type: 'import',
                description: `Imported database backup (${statements.length} statements run)`,
                entity_type: 'backup',
            });

            reply.send({ success: true, statementsRun: statements.length });
        } catch (err) {
            fastify.log.error(err);
            reply.status(500).send({ error: 'Import failed', message: err.message });
        } finally {
            conn.release();
        }
    });

    

        // ── PURCHASES EXPORT (table only) ────────────────────
        fastify.get('/api/purchases/export', async (req, reply) => {
            const conn = await pool.getConnection();
            try {
                let sql = `-- Purchases Table Backup\n-- Generated: ${new Date().toISOString()}\n\n`;
                sql += 'SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n';
                sql += `DROP TABLE IF EXISTS ${ident('purchases')};\n${await createStatement(conn, 'purchases')};\n\n`;
                sql += await insertStatements(conn, 'purchases');
                sql += 'SET FOREIGN_KEY_CHECKS=1;\n';
    
                const filename = `purchases-backup-${new Date().toISOString().slice(0, 10)}.sql`;

                await logActivity(req, {
                    action_type: 'export',
                    description: 'Exported purchases table backup',
                    entity_type: 'purchases',
                });

                reply
                    .header('Content-Type', 'application/sql')
                    .header('Content-Disposition', `attachment; filename="${filename}"`)
                    .send(sql);
            } catch (err) {
                fastify.log.error(err);
                reply.status(500).send({ error: 'Export failed', message: err.message });
            } finally {
                conn.release();
            }
        });
    
        // ── PURCHASES IMPORT (table only) ────────────────────
        fastify.post('/api/purchases/import', async (req, reply) => {
            const file = await req.file();
            if (!file) return reply.status(400).send({ success: false, message: 'No file uploaded' });
    
            const buffer = await file.toBuffer();
            const statements = splitSqlStatements(buffer.toString('utf8'));
    
                     // Safety: only allow statements that touch the purchases table
            // (plus harmless session-level SET statements the exporter itself adds)
            const allowed = /purchases/i;
            const isSetStatement = /^SET\s/i;
            for (const stmt of statements) {
                if (!allowed.test(stmt) && !isSetStatement.test(stmt.trim())) {
                    return reply.status(400).send({ success: false, message: 'File must only contain statements for the purchases table' });
                }
            }
    
            const conn = await pool.getConnection();
            try {
                await conn.query('SET FOREIGN_KEY_CHECKS=0');
                for (const stmt of statements) {
                    await conn.query(stmt);
                }
                await conn.query('SET FOREIGN_KEY_CHECKS=1');

                await logActivity(req, {
                    action_type: 'import',
                    description: `Imported purchases table backup (${statements.length} statements run)`,
                    entity_type: 'purchases',
                });

                reply.send({ success: true, message: `Purchases imported (${statements.length} statements run)` });
            } catch (err) {
                fastify.log.error(err);
                reply.status(500).send({ success: false, message: err.message });
            } finally {
                conn.release();
            }
        });
    
        // ── FACTORY RESET: step 1, verify password ──────────
        fastify.post('/api/backup/verify-admin-password', async (req, reply) => {
        const { password } = req.body || {};
        if (!password) return reply.status(400).send({ error: 'Password required' });

        const result = await verifyAdminPassword(password);
        if (!result.ok) return reply.status(result.status).send({ error: result.error });
        reply.send({ success: true });
    });

    // ── FACTORY RESET: step 2, execute ───────────────────
    fastify.post('/api/backup/factory-reset', async (req, reply) => {
        const { password } = req.body || {};
        if (!password) return reply.status(400).send({ error: 'Password required' });

        const result = await verifyAdminPassword(password);
        if (!result.ok) return reply.status(result.status).send({ error: result.error });

        // Keep the admin's current session alive so they aren't logged out after reset
        const currentSessionId = req.cookies?.pos_session;

        const conn = await pool.getConnection();
        try {
            // Dynamic via SHOW TABLES, so any table added later is picked up
            // automatically without needing to update this route.
            const tables = await getAllTables(conn);
            const truncateTables = tables.filter(
                (t) => !EXCLUDED_TABLES.includes(t) && t !== 'users' && t !== 'sessions'
            );

            await conn.query('SET FOREIGN_KEY_CHECKS=0');
            for (const table of truncateTables) {
                await conn.query(`TRUNCATE TABLE ${ident(table)}`);
            }
            await conn.query("DELETE FROM users WHERE role != 'admin'");

            // Restore default reference/seed data for tables that ship with it
            // (categories, units, receipt_settings, app_settings, currency_settings)
            await reseedDefaults(conn);

            // Wipe all sessions except the one making this request
            if (currentSessionId) {
                await conn.query('DELETE FROM sessions WHERE id != ?', [currentSessionId]);
            } else {
                await conn.query('TRUNCATE TABLE sessions');
            }

            await conn.query('SET FOREIGN_KEY_CHECKS=1');

            reply.send({ success: true });
        } catch (err) {
            fastify.log.error(err);
            reply.status(500).send({ error: 'Factory reset failed', message: err.message });
        } finally {
            conn.release();
        }
    });
}