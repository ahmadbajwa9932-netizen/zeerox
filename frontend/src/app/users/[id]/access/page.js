'use client';
import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { ShieldCheck, ChevronRight, ArrowLeft, RotateCcw, Search } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { PAGE_STRUCTURE, DEFAULT_BLOCKED_ACCESS } from '@/lib/pageAccessStructure';
import styles from './access.module.css';

function Popup({ message, type }) {
    if (!message) return null;
    return <div className={`popup ${type}`}>{message}</div>;
}

function descendantKeys(page) {
    const childKeys = (page.children ?? []).map(c => c.key);
    const childActionKeys = (page.children ?? []).flatMap(c => (c.actions ?? []).map(a => a.key));
    const ownActionKeys = (page.actions ?? []).map(a => a.key);
    return [...childKeys, ...childActionKeys, ...ownActionKeys];
}

export default function ManageAccessPage() {
    const { id } = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const userName = searchParams.get('name') || 'User';

    const [popup, setPopup] = useState({ message: '', type: 'success' });
    const [step, setStep] = useState('password'); // 'password' | 'manage'
    const [adminPw, setAdminPw] = useState('');
    const [blocked, setBlocked] = useState([]);
    const [expanded, setExpanded] = useState({});
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);

    function showPopup(message, type = 'success') {
        setPopup({ message, type });
        setTimeout(() => setPopup({ message: '', type: 'success' }), 3000);
    }

    async function verifyPassword() {
        const res = await apiFetch('/api/users/verify-admin-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_password: adminPw }),
        });
        const data = await res.json();
        if (!data.success) { showPopup(data.message || 'Incorrect password', 'error'); return; }

        const ur = await apiFetch(`/api/users/blocked-pages/${id}`);
        const ud = await ur.json();
        if (ud.success) setBlocked(ud.blocked_pages ?? []);
        setStep('manage');
    }

    // IMPORTANT: a page/child's blocked state is its OWN key only.
    // It is never derived from whether its children/actions are all blocked.
    // Ticking the page still cascades DOWN (blocks everything under it),
    // but ticking children/actions never cascades UP to the page.
    function togglePage(page) {
        const keys = descendantKeys(page);
        const isBlocked = blocked.includes(page.key);
        setBlocked(prev => isBlocked
            ? prev.filter(k => k !== page.key && !keys.includes(k))
            : [...new Set([...prev, page.key, ...keys])]);
    }

    function toggleChild(child) {
        const actionKeys = (child.actions ?? []).map(a => a.key);
        const isBlocked = blocked.includes(child.key);
        setBlocked(prev => isBlocked
            ? prev.filter(k => k !== child.key && !actionKeys.includes(k))
            : [...new Set([...prev, child.key, ...actionKeys])]);
    }

    function toggleAction(key) {
        setBlocked(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    }

    async function save() {
        setSaving(true);
        try {
            const res = await apiFetch(`/api/users/update-access/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_password: adminPw, blocked_pages: blocked }),
            });
            const data = await res.json();
            showPopup(data.message, data.success ? 'success' : 'error');
            if (data.success) {
                showPopup('Access updated. User must logout and login again for changes to take effect.', 'success');
            }
        } finally {
            setSaving(false);
        }
    }

    const filteredStructure = PAGE_STRUCTURE.filter(p =>
        !search || p.label.toLowerCase().includes(search.toLowerCase()) ||
        (p.children ?? []).some(c => c.label.toLowerCase().includes(search.toLowerCase()))
    );

    // Only counts pages whose OWN key is explicitly blocked.
    const totalBlockedPages = blocked.filter(k => PAGE_STRUCTURE.some(p => p.key === k)).length;

    return (
        <div className="container" style={{ margin: '0 auto' }}>
            <Popup message={popup.message} type={popup.type} />

            <button className={styles['back-link']} onClick={() => router.push('/admin')}>
                <ArrowLeft size={16} /> Back to Admin Panel
            </button>

            <div style={{ marginBottom: 20 }}>
                <h1 style={{ color: '#1f2937', fontSize: 24, fontWeight: 700, margin: '0 0 5px 0' }}>
                    Manage Access — {userName}
                </h1>
                <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
                    Check a box to block access. Uncheck to grant access.
                </p>
            </div>

            {step === 'password' && (
                <div className={styles['gate-card']}>
                    <ShieldCheck size={32} color="#374151" />
                    <h3>Verify Admin Password</h3>
                    <p>Enter your admin password to manage this user&apos;s access.</p>
                    <input
                        type="password"
                        placeholder="Admin password"
                        value={adminPw}
                        onChange={e => setAdminPw(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && verifyPassword()}
                        className={styles['gate-input']}
                    />
                    <div className={styles['gate-buttons']}>
                        <button className={styles['btn-primary']} onClick={verifyPassword}>Verify &amp; Continue</button>
                        <button className={styles['btn-secondary']} onClick={() => router.push('/admin')}>Cancel</button>
                    </div>
                </div>
            )}

            {step === 'manage' && (
                <>
                    <div className={styles['toolbar']}>
                        <div className={styles['search-box']}>
                            <Search size={16} />
                            <input
                                type="text"
                                placeholder="Search pages..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <div className={styles['toolbar-right']}>
                            <span className={styles['blocked-count']}>{totalBlockedPages} page(s) blocked</span>
                            <button className={styles['btn-reset']} onClick={() => setBlocked(DEFAULT_BLOCKED_ACCESS)}>
                                <RotateCcw size={14} /> Default Access
                            </button>
                        </div>
                    </div>

                    <div className={styles['tree-card']}>
                        {filteredStructure.map(page => {
                            const isOpen = !!expanded[page.key];
                            const hasSub = (page.children?.length ?? 0) > 0 || (page.actions?.length ?? 0) > 0;
                            const pageBlocked = blocked.includes(page.key);

                            return (
                                <div key={page.key} className={styles['page-row']}>
                                    <div className={styles['row-line']}>
                                        {hasSub ? (
                                            <button
                                                className={`${styles['chevron']}${isOpen ? ' ' + styles['open'] : ''}`}
                                                onClick={() => setExpanded(e => ({ ...e, [page.key]: !e[page.key] }))}
                                            >
                                                <ChevronRight size={16} />
                                            </button>
                                        ) : <span className={styles['chevron-spacer']} />}

                                        <label className={styles['checkbox-label']}>
                                            <input
                                                type="checkbox"
                                                checked={pageBlocked}
                                                onChange={() => togglePage(page)}
                                            />
                                            <i className={`fa-solid ${page.icon}`} style={{ marginRight: 8, color: '#6b7280', width: 14 }}></i>
                                            <span className={styles['page-label']}>{page.label}</span>
                                        </label>

                                        {pageBlocked && <span className={styles['blocked-tag']}>Blocked</span>}
                                    </div>

                                    {isOpen && hasSub && (
                                        <div className={styles['sub-tree']}>
                                            {(page.children ?? []).map(child => {
                                                const childBlocked = blocked.includes(child.key);
                                                return (
                                                    <div key={child.key} className={styles['child-block']}>
                                                        <div className={styles['row-line']}>
                                                            <span className={styles['chevron-spacer']} />
                                                            <label className={styles['checkbox-label']}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={childBlocked}
                                                                    onChange={() => toggleChild(child)}
                                                                />
                                                                <span>{child.label}</span>
                                                            </label>
                                                            {childBlocked && <span className={styles['blocked-tag']}>Blocked</span>}
                                                        </div>
                                                        {child.actions?.length > 0 && (
                                                            <div className={styles['action-list-wrap']}>
                                                                <span className={styles['action-list-label']}>Actions for {child.label}</span>
                                                                <div className={styles['action-list']}>
                                                                    {child.actions.map(action => (
                                                                        <label key={action.key} className={styles['action-checkbox']}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={blocked.includes(action.key)}
                                                                                onChange={() => toggleAction(action.key)}
                                                                            />
                                                                            <span>{action.label}</span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

{(!page.children || page.children.length === 0) && page.actions?.length > 0 && (
                                                <div className={styles['action-list-wrap']} style={{ marginLeft: 26 }}>
                                                    <span className={styles['action-list-label']}>Actions for {page.label}</span>
                                                    <div className={styles['action-list']}>
                                                        {page.actions.map(action => (
                                                            <label key={action.key} className={styles['action-checkbox']}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={blocked.includes(action.key)}
                                                                    onChange={() => toggleAction(action.key)}
                                                                />
                                                                <span>{action.label}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className={styles['save-bar']}>
                        <button className={styles['btn-primary']} onClick={save} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Access Settings'}
                        </button>
                        <button className={styles['btn-secondary']} onClick={() => router.push('/admin')}>Cancel</button>
                    </div>
                </>
            )}
        </div>
    );
}