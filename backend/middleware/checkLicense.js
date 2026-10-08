// backend/middleware/checkLicense.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import 'dotenv/config';
import { sendLicenseEventEmail } from '../utils/mailer.js';

let _notifiedExpiredKey = null;
let _notifiedTamperKey  = null;

export function resetLicenseNotificationState() {
    _notifiedExpiredKey = null;
    _notifiedTamperKey  = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LICENSE_FILE_PATH = path.join(__dirname, '../storage/pos_license.json');

/* ────────────────────────────────────────────────────────────────────────
   LICENCE DATE HELPERS  (single source of truth — also used by routes/license.js)

   licenses.start_date / expiry_date are DATE columns. With dateStrings:true
   they arrive as plain 'YYYY-MM-DD'. Two traps to avoid:
     • new Date('2026-01-01')  parses as UTC midnight  -> 05:00 local in PKT
     • .toISOString()          converts back through UTC -> rolls the day back
   Both shift the calendar day. Nothing below uses either one: every date is
   built and read with local getters only.

   The SAME string is written to the DB and to the encrypted licence file, and
   runTamperCheck() compares them — so these helpers must be used on BOTH
   sides. Changing only one side makes every request fail as 'tampered'.
   ──────────────────────────────────────────────────────────────────────── */

/** Local 'YYYY-MM-DD' for a Date (never UTC). */
export function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a 'YYYY-MM-DD' DATE value to LOCAL midnight. */
export function parseDateOnly(v) {
    const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Local 'YYYY-MM-DD' n calendar days after `base` (DST-safe). */
export function addDaysStr(base, n) {
    return localDateStr(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
}

/** A licence is valid through the END of its expiry date, not from midnight. */
export function expiryEnd(v) {
    const d = parseDateOnly(v);
    d.setHours(23, 59, 59, 999);
    return d;
}

export function isLicenseExpired(expiryValue) {
    return new Date() > expiryEnd(expiryValue);
}

/** Whole days left, inclusive of the expiry day itself. 0 once expired. */
export function licenseDaysRemaining(expiryValue) {
    const ms = expiryEnd(expiryValue) - new Date();
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

function generateLicenseHash(startDate, validDays, renewedAt) {
    const appKey = process.env.APP_KEY || 'default-secret-key';
    const data = `${startDate}|${validDays}|${renewedAt ?? 'null'}`;
    return crypto.createHmac('sha256', appKey).update(data).digest('hex');
}

function decryptData(encryptedText) {
    const key = crypto.scryptSync(process.env.APP_KEY || 'default-key', 'salt', 32);
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

function encryptData(data) {
    const key = crypto.scryptSync(process.env.APP_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

let _licenseCache = null;
let _licenseCacheTime = 0;
const LICENSE_CACHE_TTL = 10000; // ms

async function getLicense() {
    if (_licenseCache && Date.now() - _licenseCacheTime < LICENSE_CACHE_TTL) {
        return _licenseCache;
    }
    const [[license]] = await db.execute('SELECT * FROM licenses LIMIT 1');
    _licenseCache = license;
    _licenseCacheTime = Date.now();
    return license;
}

// ── Shared tamper-detection — used here AND by /license/status ─────────────
// throttle:true  (default) → file read at most once per 5 min. Used by this
//   hook since it fires on every single API request.
// throttle:false → always runs. Used by /license/status so page navigation
//   catches tampering immediately, even when only start_date/valid_days was
//   changed and expiry_date is untouched (so the plain expiry check misses it).
export async function runTamperCheck(license, { throttle = true } = {}) {
    if (throttle) {
        if (!global._lastLicenseFileCheck) global._lastLicenseFileCheck = 0;
        const shouldCheckFile = Date.now() - global._lastLicenseFileCheck > 5 * 60 * 1000;
        if (!shouldCheckFile) return { tampered: false, tamperedFields: [] };
        global._lastLicenseFileCheck = Date.now();
    }

    if (!fs.existsSync(LICENSE_FILE_PATH)) {
        return { tampered: false, tamperedFields: [] };
    }

    try {
        const fileData = decryptData(fs.readFileSync(LICENSE_FILE_PATH, 'utf8'));
        const tamperedFields = [];

        if (fileData.last_check_time) {
            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime < fileData.last_check_time) {
                tamperedFields.push('System clock moved backward (time tampering detected)');
            }
        }

        const origStart  = fileData.original_start_date ?? fileData.installed_on;
        const origDays   = fileData.original_valid_days  ?? fileData.license_days;
        const origExpiry = fileData.original_expiry_date ?? null;

        // Already 'YYYY-MM-DD' thanks to dateStrings:true — compare the raw
        // strings. The old Date->toISOString round-trip shifted the day.
        const dbStart  = String(license.start_date).slice(0, 10);
        const dbExpiry = String(license.expiry_date).slice(0, 10);

        if (dbStart !== origStart) {
            tamperedFields.push(`start_date tampered (expected ${origStart}, found ${dbStart})`);
        }
        if (license.valid_days !== origDays) {
            tamperedFields.push(`valid_days tampered (expected ${origDays}, found ${license.valid_days})`);
        }
        if (origExpiry && dbExpiry !== origExpiry) {
            tamperedFields.push(`expiry_date tampered (expected ${origExpiry}, found ${dbExpiry})`);
        }

        if (tamperedFields.length === 0 && fileData.signature) {
            const expected = generateLicenseHash(
                fileData.installed_on,
                fileData.license_days,
                fileData.last_renewed_at
            );
            if (fileData.signature !== expected) {
                tamperedFields.push('License signature mismatch (file was manually edited)');
            }
        }

        if (tamperedFields.length > 0) {
            const tamperKey = tamperedFields.join('|');
            if (_notifiedTamperKey !== tamperKey) {
                _notifiedTamperKey = tamperKey;
                sendLicenseEventEmail('tampered', { license, tamperedFields })
                    .catch(err => console.error('Failed to send license-tampered email:', err.message));
            }
            return { tampered: true, tamperedFields };
        }

        // Clean pass — refresh last_check_time in the file
        fileData.last_check_time = Math.floor(Date.now() / 1000);
        fs.writeFileSync(LICENSE_FILE_PATH, encryptData(fileData), 'utf8');

        return { tampered: false, tamperedFields: [] };
    } catch (e) {
        console.error('License file check error:', e.message);
        return { tampered: false, tamperedFields: [] };
    }
}

export async function checkLicense(req, reply) {
    // Skip license routes themselves
    const url = req.url;
    if (
        url.startsWith('/license') ||
        url.startsWith('/expired') ||
        url.startsWith('/database/export') ||
        url.startsWith('/database/import') ||
        url.startsWith('/api/auth') ||
        url.startsWith('/public/')
    ) {
        return;
    }

    const license = await getLicense();

    if (!license) {
        return reply.code(403).send({ redirect: '/license/setup' });
    }

    // ── Tamper check now runs FIRST, before the "skip if valid" shortcut ───
    // Previously this ran after the block below, so it never fired for
    // ordinary /api/ traffic on a currently-valid license — exactly when
    // start_date/valid_days tampering (without touching expiry_date) needed
    // to be caught.
    const { tampered, tamperedFields } = await runTamperCheck(license);
    if (tampered) {
        return reply.code(403).send({ redirect: '/expired', reason: 'db_tampering', tamperedFields });
    }

    // ── License exists, untampered, not yet expired — skip further checks for API routes ──
    if (url.startsWith('/api/') && !isLicenseExpired(license.expiry_date)) {
        return;
    }

    // ── Expiry check ───────────────────────────────────────────────────────
    if (isLicenseExpired(license.expiry_date)) {
        const expiryKey = `${license.expiry_date}|${license.valid_days}`;
        if (_notifiedExpiredKey !== expiryKey) {
            _notifiedExpiredKey = expiryKey;
            sendLicenseEventEmail('expired', { license })
                .catch(err => console.error('Failed to send license-expired email:', err.message));
        }
        return reply.code(403).send({ redirect: '/expired' });
    }
}