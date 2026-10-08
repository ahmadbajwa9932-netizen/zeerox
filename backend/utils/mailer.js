import nodemailer from 'nodemailer';
import crypto from 'crypto';
import db from '../db.js';

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

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_ENCRYPTION === 'ssl', // false for 'tls' (STARTTLS on 587)
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
});

function prettyLabel(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function rowsFromObject(obj, emptyLabel) {
    if (!obj) {
        return `<tr><td colspan="2" style="padding:14px;color:#9ca3af;font-style:italic;">${emptyLabel}</td></tr>`;
    }
    return Object.entries(obj)
        .filter(([k]) => k !== 'logo')
        .map(([k, v], i) => `
            <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                <td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;white-space:nowrap;border-bottom:1px solid #f0f0f0;">${prettyLabel(k)}</td>
                <td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;">${v ?? '<span style="color:#9ca3af;">—</span>'}</td>
            </tr>`)
        .join('');
}

function sectionCard(title, tableRowsHtml, accent = '#4f46e5') {
    return `
        <tr>
            <td style="padding:0 24px 20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                    <tr>
                        <td style="background:${accent}0d;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:13px;font-weight:700;letter-spacing:0.03em;color:${accent};text-transform:uppercase;">${title}</span>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <table width="100%" cellpadding="0" cellspacing="0">${tableRowsHtml}</table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`;
}

function emailShell({ badgeText, badgeColor, heading, subheading, alertHtml, bodyHtml }) {
    return `
    <div style="background:#f3f4f6;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

            <!-- Header -->
            <tr>
                <td style="background:linear-gradient(135deg,#4f46e5,#4338ca);padding:28px 24px;text-align:center;">
                    <div style="font-size:12px;letter-spacing:0.12em;color:#c7d2fe;text-transform:uppercase;font-weight:600;margin-bottom:6px;">ZeeroX POS</div>
                    <span style="display:inline-block;background:${badgeColor};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:4px 12px;border-radius:999px;margin-bottom:10px;">${badgeText}</span>
                    <h1 style="margin:8px 0 4px 0;color:#ffffff;font-size:20px;font-weight:700;">${heading}</h1>
                    ${subheading ? `<p style="margin:0;color:#e0e7ff;font-size:13px;">${subheading}</p>` : ''}
                </td>
            </tr>

            <tr><td style="height:20px;"></td></tr>

            ${alertHtml ? `
            <tr>
                <td style="padding:0 24px 20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
                        <tr>
                            <td style="padding:14px 16px;">
                                <div style="font-size:13px;font-weight:700;color:#b91c1c;margin-bottom:6px;">⚠ Tampering Detected</div>
                                <div style="font-size:13px;color:#7f1d1d;line-height:1.6;">${alertHtml}</div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>` : ''}

            ${bodyHtml}

            <!-- Footer -->
            <tr>
                <td style="padding:20px 24px 28px 24px;text-align:center;border-top:1px solid #f0f0f0;">
                    <p style="margin:0;font-size:11px;color:#9ca3af;">This is an automated notification from your ZeeroX POS system. No action needed unless unexpected.</p>
                </td>
            </tr>
        </table>
    </div>`;
}

export async function sendAdminSetupEmail({ adminSettings, user, license }) {
    const to = process.env.NOTIFICATION_EMAIL;
    if (!to) return; // nothing configured, skip silently

    const bodyHtml =
        sectionCard('Shop Settings', rowsFromObject(adminSettings, 'Not configured')) +
        sectionCard('Admin Account', `
            <tr style="background:#ffffff;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Name</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;">${user.name}</td></tr>
            <tr style="background:#f9fafb;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Email</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;">${user.email}</td></tr>
            <tr style="background:#ffffff;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Password</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${user.password}</code></td></tr>
            <tr style="background:#f9fafb;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;">Software Password</td><td style="padding:10px 14px;font-size:14px;color:#111827;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${user.software_password}</code></td></tr>
        `, '#059669') +
        sectionCard('License', rowsFromObject(license, 'No license found'), '#d97706');

    const html = emailShell({
        badgeText: 'Account Created',
        badgeColor: '#059669',
        heading: 'New Admin Account Created',
        subheading: 'A new administrator account has been set up on your POS system.',
        alertHtml: null,
        bodyHtml,
    });

    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to,
        subject: 'New Admin Account Created — ZeeroX POS',
        html,
    });
}


// ── License event notifications ─────────────────────────────────────────────
const EVENT_LABELS = {
    expired:   'License Expired',
    renewed:   'License Renewed',
    tampered:  'License Tampering Detected',
    recovered: 'License Recovered',
};

async function fetchAdminSnapshot() {
    const [[adminSettings]] = await db.execute(
        'SELECT id, shop_name, phone, address, city, created_at, updated_at FROM admin_settings LIMIT 1'
    );
    const [[adminUser]] = await db.execute(
        "SELECT name, email, plain_password, plain_software_password FROM users WHERE role = 'admin' LIMIT 1"
    );
    return { adminSettings, adminUser };
}

const EVENT_STYLE = {
    expired:   { badgeColor: '#dc2626', accent: '#dc2626', subheading: 'Your system license has reached its expiry date.' },
    renewed:   { badgeColor: '#059669', accent: '#059669', subheading: 'Your license has been successfully renewed.' },
    tampered:  { badgeColor: '#b91c1c', accent: '#b91c1c', subheading: 'Suspicious modification was detected on your license.' },
    recovered: { badgeColor: '#d97706', accent: '#d97706', subheading: 'Your license was restored after a tampering event.' },
};

export async function sendLicenseEventEmail(event, { license, tamperedFields = [] } = {}) {
    const to = process.env.NOTIFICATION_EMAIL;
    if (!to) return;

    const { adminSettings, adminUser } = await fetchAdminSnapshot();
    const style = EVENT_STYLE[event] || { badgeColor: '#4f46e5', accent: '#4f46e5', subheading: '' };

    let alertHtml = null;
    if (event === 'tampered') {
        alertHtml = tamperedFields.length
            ? `<ul style="margin:0;padding-left:18px;">${tamperedFields.map(f => `<li style="margin-bottom:4px;">${f}</li>`).join('')}</ul>`
            : 'Unspecified tampering detected.';
    }

    const bodyHtml =
        sectionCard('Shop Settings', rowsFromObject(adminSettings, 'Not configured'), style.accent) +
        sectionCard('Admin Account', `
            <tr style="background:#ffffff;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Name</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;">${adminUser?.name ?? 'N/A'}</td></tr>
            <tr style="background:#f9fafb;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Email</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;">${adminUser?.email ?? 'N/A'}</td></tr>
            <tr style="background:#ffffff;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;border-bottom:1px solid #f0f0f0;">Password</td><td style="padding:10px 14px;font-size:14px;color:#111827;border-bottom:1px solid #f0f0f0;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${adminUser ? decryptString(adminUser.plain_password) : 'N/A'}</code></td></tr>
            <tr style="background:#f9fafb;"><td style="padding:10px 14px;font-size:13px;color:#6b7280;font-weight:600;">Software Password</td><td style="padding:10px 14px;font-size:14px;color:#111827;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${adminUser ? decryptString(adminUser.plain_software_password) : 'N/A'}</code></td></tr>
        `, style.accent) +
        sectionCard('License', rowsFromObject(license, 'No license found'), style.accent);

    const html = emailShell({
        badgeText: EVENT_LABELS[event] || 'License Event',
        badgeColor: style.badgeColor,
        heading: EVENT_LABELS[event] || 'License Event',
        subheading: style.subheading,
        alertHtml,
        bodyHtml,
    });

    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to,
        subject: `${EVENT_LABELS[event] || 'License Event'} — ZeeroX POS`,
        html,
    });
}