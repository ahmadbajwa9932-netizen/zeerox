'use client';

import { useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { usePermissions } from '@/lib/permissions';
import styles from './backup.module.css';
// ── inline icons (no external icon lib dependency) ──
const Icon = {
    DB: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
    ),
    Download: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    ),
    Upload: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
    ),
    Alert: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    Eye: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
    ),
    EyeOff: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.61 3.94M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    ),
    Warn: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    Check: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    X: () => (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    ),
};

export default function BackupPage() {
    const fileInputRef = useRef(null);
    const { isBlocked } = usePermissions();

    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);

    const [resetModalOpen, setResetModalOpen] = useState(false);
    const [resetStep, setResetStep] = useState('password'); // 'password' | 'confirm'
    const [resetPassword, setResetPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState('');

    // ── Toast ────────────────────────────────────────
    const [toast, setToast] = useState(null);

    function showToast(msg, kind = 'success') {
        setToast({ msg, kind, key: Date.now() });
        setTimeout(() => setToast(null), 3000);
    }

      // ── EXPORT ──────────────────────────────────────────
      async function handleExport(includeUsers) {
        setExporting(true);
        try {
            const res = await apiFetch(`/api/backup/export?includeUsers=${includeUsers}`);
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pos-backup-${includeUsers ? 'with-users' : 'no-users'}-${new Date().toISOString().slice(0, 10)}.sql`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('Backup exported successfully');
        } catch (err) {
            showToast(err.message || 'Export failed', 'error');
        } finally {
            setExporting(false);
        }
    }

    // ── IMPORT ──────────────────────────────────────────
    function handleImportClick() {
        fileInputRef.current?.click();
    }

    async function handleFileChange(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        const confirmed = window.confirm(
            'Importing will overwrite existing data in the matching tables. Continue?'
        );
        if (!confirmed) return;

        setImporting(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await apiFetch('/api/backup/import', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed');
            showToast('Backup imported successfully');
        } catch (err) {
            showToast(err.message || 'Import failed', 'error');
        } finally {
            setImporting(false);
        }
    }

    // ── FACTORY RESET ─────────────────────────────────────
    function openResetModal() {
        setResetStep('password');
        setResetPassword('');
        setShowPassword(false);
        setResetError('');
        setResetModalOpen(true);
    }

    function closeResetModal() {
        setResetModalOpen(false);
        setResetStep('password');
        setResetPassword('');
        setResetError('');
    }

    async function handleVerifyPassword() {
        if (!resetPassword) return;
        setResetLoading(true);
        setResetError('');
        try {
            const res = await apiFetch('/api/backup/verify-admin-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: resetPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Incorrect password');
            setResetStep('confirm');
        } catch (err) {
            setResetError(err.message || 'Incorrect password');
        } finally {
            setResetLoading(false);
        }
    }

    async function handleConfirmReset() {
        setResetLoading(true);
        setResetError('');
        try {
            const res = await apiFetch('/api/backup/factory-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: resetPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Factory reset failed');
            closeResetModal();
            showToast('Factory reset complete');
        } catch (err) {
            setResetError(err.message || 'Factory reset failed');
        } finally {
            setResetLoading(false);
        }
    }

    return (
        <>
            {/* Toast */}
            {toast && (
                <div className={`popup ${toast.kind}`} key={toast.key}>
                    {toast.msg}
                </div>
            )}

            <div className={`container ${styles.page}`}>
                {/* HEADER */}
                <div className={styles.header}>
                    <div className={styles.headerTop}>
                        <div className={styles.headerIcon}><Icon.DB /></div>
                        <h2 className={styles.headerTitle}>Backup &amp; Restore</h2>
                    </div>
                    <p className={styles.headerSubtitle}>
                        Export your data for safekeeping, restore from a backup file, or reset the system to a clean state.
                    </p>
                </div>

                <div className={styles.grid}>
                    {/* EXPORT */}
                    <div className={styles.card}>
                        <div className={styles.cardIconRow}>
                            <div className={styles.cardIcon}><Icon.Download /></div>
                            <h3 className={styles.cardTitle}>Export Data</h3>
                        </div>
                        <p className={styles.cardDesc}>
                            Download a complete .sql copy of your data. Keep it somewhere safe — a USB drive,
                            Google Drive, or email it to yourself.
                        </p>
                        <div className={styles.infoBox}>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagInclude}`}>Always includes:</span>
                                <span className={styles.infoValue}>Products, sales, customers, suppliers, expenses, purchases, categories</span>
                            </div>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagInclude}`}>"With Users" adds:</span>
                                <span className={styles.infoValue}>Admin + all staff accounts, user activity logs, user performance logs</span>
                            </div>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagExclude}`}>Always excludes:</span>
                                <span className={styles.infoValue}>Software license, active login sessions</span>
                            </div>
                        </div>
                        {!isBlocked('backup.act.export-sql') && (
                            <div className={styles.exportButtonGroup}>
                                <button
                                    className={`${styles.cardButton} ${styles.buttonNeutral}`}
                                    onClick={() => handleExport(false)}
                                    disabled={exporting}
                                >
                                    {exporting ? <Icon.DB /> : <Icon.Download />}
                                    {exporting ? 'Exporting…' : 'Export without Users'}
                                </button>
                                <button
                                    className={`${styles.cardButton} ${styles.buttonPrimary}`}
                                    onClick={() => handleExport(true)}
                                    disabled={exporting}
                                >
                                    {exporting ? <Icon.DB /> : <Icon.Download />}
                                    {exporting ? 'Exporting…' : 'Export with Users'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* IMPORT */}
                    <div className={styles.card}>
                        <div className={styles.cardIconRow}>
                            <div className={styles.cardIcon}><Icon.Upload /></div>
                            <h3 className={styles.cardTitle}>Import Data</h3>
                        </div>
                        <p className={styles.cardDesc}>
                            Restore your system from a previously exported .sql file — useful when moving to a
                            new computer or recovering after an issue.
                        </p>
                        <div className={styles.infoBox}>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagInclude}`}>Restores:</span>
                                <span className={styles.infoValue}>All data contained in the backup file</span>
                            </div>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagExclude}`}>Warning:</span>
                                <span className={styles.infoValue}>Overwrites your current data in matching tables — only import a file you trust</span>
                            </div>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".sql"
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                        />
                        {!isBlocked('backup.act.import-sql') && (
                            <button
                                className={`${styles.cardButton} ${styles.buttonPrimary}`}
                                onClick={handleImportClick}
                                disabled={importing}
                            >
                                {importing ? <Icon.DB /> : <Icon.Upload />}
                                {importing ? 'Importing…' : 'Import SQL'}
                            </button>
                        )}
                    </div>

                    {/* FACTORY RESET */}
                    {!isBlocked('backup.act.factory-reset') && (
                    <div className={`${styles.card} ${styles.cardDanger}`}>
                        <div className={styles.cardIconRow}>
                            <div className={`${styles.cardIcon} ${styles.cardIconDanger}`}><Icon.Alert /></div>
                            <h3 className={styles.cardTitle}>Factory Reset</h3>
                        </div>
                        <p className={styles.cardDesc}>
                            Wipe all business data and start fresh — as if the system was just installed.
                            Requires your admin password.
                        </p>
                        <div className={`${styles.infoBox} ${styles.infoBoxDanger}`}>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagExclude}`}>Erases:</span>
                                <span className={styles.infoValue}>Products, sales, customers, suppliers, expenses, purchases, other staff accounts</span>
                            </div>
                            <div className={styles.infoLine}>
                                <span className={`${styles.infoLabel} ${styles.tagInclude}`}>Keeps:</span>
                                <span className={styles.infoValue}>Your admin login, software license, shop settings — you stay logged in</span>
                            </div>
                        </div>
                        <button className={`${styles.cardButton} ${styles.buttonDanger}`} onClick={openResetModal}>
                            <Icon.Alert />
                            Factory Reset
                        </button>
                    </div>
                    )}
                </div>

                {/* PROCESSING OVERLAY (export/import) */}
                {(exporting || importing) && (
                    <div className={styles.overlay}>
                        <div className={styles.overlayBox}>
                            <div className={styles.overlaySpinner}></div>
                            <p className={styles.overlayText}>
                                {exporting ? 'Exporting backup…' : 'Importing backup…'}
                            </p>
                            <p className={styles.overlayHint}>Please don&apos;t close this window.</p>
                        </div>
                    </div>
                )}

                {/* FACTORY RESET MODAL */}
                {resetModalOpen && (
                    <div className={styles.modalBackdrop}>
                        <div className={styles.modalBox}>
                            {resetLoading ? (
                                <div className={styles.processingCenter}>
                                    <div className={styles.overlaySpinner}></div>
                                    <p className={styles.overlayText}>Processing…</p>
                                    <p className={styles.overlayHint}>This may take a moment.</p>
                                </div>
                            ) : resetStep === 'password' ? (
                                <>
                                    <div className={styles.modalIconWrap}><Icon.Alert /></div>
                                    <h3 className={styles.modalTitle}>Confirm Admin Password</h3>
                                    <p className={styles.modalText}>
                                        Enter your admin password to continue with the factory reset.
                                    </p>
                                    <label className={styles.modalLabel}>Admin Password</label>
                                    <div className={styles.passwordWrap}>
                                        <input
                                            className={styles.passwordInput}
                                            type={showPassword ? 'text' : 'password'}
                                            value={resetPassword}
                                            onChange={(e) => setResetPassword(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleVerifyPassword()}
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            className={styles.passwordToggle}
                                            onClick={() => setShowPassword((s) => !s)}
                                            tabIndex={-1}
                                        >
                                            {showPassword ? <Icon.EyeOff /> : <Icon.Eye />}
                                        </button>
                                    </div>
                                    {resetError && (
                                        <p className={styles.errorText}><Icon.Warn />{resetError}</p>
                                    )}
                                    <div className={styles.modalActions}>
                                        <button className={styles.buttonNeutral} onClick={closeResetModal}>
                                            Cancel
                                        </button>
                                        <button
                                            className={styles.buttonPrimary}
                                            onClick={handleVerifyPassword}
                                            disabled={!resetPassword}
                                        >
                                            Verify
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className={styles.modalIconWrap}><Icon.Alert /></div>
                                    <h3 className={styles.modalTitle}>Are you absolutely sure?</h3>
                                    <p className={styles.modalText}>
                                        This will permanently erase your business data. This action cannot be undone.
                                    </p>
                                    <div className={styles.modalWarnList}>
                                        <div className={styles.modalWarnItem}>
                                            <Icon.Warn />
                                            <span>All products, sales, customers, and reports will be permanently deleted</span>
                                        </div>
                                        <div className={styles.modalWarnItem}>
                                            <Icon.Warn />
                                            <span>Other staff accounts will be removed — only your admin login will remain</span>
                                        </div>
                                        <div className={styles.modalWarnItem}>
                                            <Icon.Warn />
                                            <span>Your license and shop settings will stay intact, and you'll remain logged in</span>
                                        </div>
                                    </div>
                                    {resetError && (
                                        <p className={styles.errorText}><Icon.Warn />{resetError}</p>
                                    )}
                                    <div className={styles.modalActions}>
                                        <button className={styles.buttonNeutral} onClick={closeResetModal}>
                                            Cancel
                                        </button>
                                        <button className={styles.buttonDanger} onClick={handleConfirmReset}>
                                            Confirm Delete
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
