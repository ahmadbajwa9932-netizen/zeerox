'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { SquarePen, Bell, Users, UserCog, Eye, Store, ShieldCheck, Phone, MapPin, UserPlus, Clock, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useRouter } from 'next/navigation';
import styles from './admin.module.css';

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const QUESTIONS = [
    "What is your father's date of birth?",
    "What is the name of your favorite teacher?",
    "What was your childhood nickname?",
    "Which person do you admire most as a hero?",
    "What is the name of your primary school?",
    "Which essay did you like the most during your education?",
    "What is your favorite food?",
];

// ── HELPERS ────────────────────────────────────────────────────────────────
function formatDate(str) {
    if (!str) return '';
    // A DATE column arrives as 'YYYY-MM-DD', which new Date() parses as UTC
    // midnight; a DATETIME arrives space-separated. Force both to local.
    const s = String(str);
    const d = s.length <= 10 ? new Date(s + 'T00:00:00') : new Date(s.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '';
    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()}-${m[d.getMonth()]}-${d.getFullYear()}`;
}

function formatTime(str) {
    if (!str) return 'N/A';
    // shift_start/shift_end are TIME columns — plain wall clock with no
    // timezone attached. Parsing them as local and then converting to
    // Asia/Karachi is a no-op only on a PC already set to Karachi; on any
    // other machine it shifted the displayed time by the offset.
    const [h, m] = String(str).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 'N/A';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function licensePercentRemaining(licenseData) {
    if (!licenseData || !licenseData.valid_days) return 0;
    // expiry_date is a DATE string ('YYYY-MM-DD'). new Date() would parse it as
    // UTC midnight; parse as LOCAL end-of-day so this matches the backend, which
    // treats a licence as valid through the whole of its expiry date.
    const [ey, em, ed] = String(licenseData.expiry_date).slice(0, 10).split('-').map(Number);
    const expiryEnd = new Date(ey, em - 1, ed, 23, 59, 59, 999);
    const remainingDays = Math.max(0, Math.ceil((expiryEnd - Date.now()) / 86400000));
    return Math.min(100, Math.round((remainingDays / licenseData.valid_days) * 100));
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function toMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

// Machine-local clock — the same basis as the raw TIME columns that
// toMinutes() reads, so the "on shift now" badge stays in sync with the table.
function getCurrentPKTMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function isOnShiftNow(shiftStart, shiftEnd) {
    if (!shiftStart || !shiftEnd) return false;
    const current = getCurrentPKTMinutes();
    const start = toMinutes(shiftStart), end = toMinutes(shiftEnd);
    return start <= end ? (current >= start && current <= end) : (current >= start || current <= end);
}

function getCurrentShiftUsers(users) {
    return users.filter(u => isOnShiftNow(u.shift_start, u.shift_end));
}

function getNextShiftUsers(users) {
    const currentMinutes = getCurrentPKTMinutes();
    const withShift = users.filter(u => u.shift_start);
    if (withShift.length === 0) return [];

    const diffs = withShift.map(u => {
        let diff = toMinutes(u.shift_start) - currentMinutes;
        if (diff <= 0) diff += 24 * 60; // shift already started today -> counts for tomorrow
        return { user: u, diff };
    });
    const bestDiff = Math.min(...diffs.map(d => d.diff));
    return diffs.filter(d => d.diff === bestDiff).map(d => d.user);
}

function Popup({ message, type }) {
    if (!message) return null;
    return <div className={`popup ${type}`}>{message}</div>;
}

// ── SECURITY QUESTIONS STEP ────────────────────────────────────────────────
function SecurityQuestionsStep({ prefix, checked, setChecked, answers, setAnswers }) {
    const checkedCount = Object.keys(checked).filter(k => checked[k]).length;

    function toggle(idx) {
        setChecked(prev => {
            const next = { ...prev, [idx]: !prev[idx] };
            if (!next[idx]) {
                setAnswers(a => { const n = { ...a }; delete n[idx]; return n; });
            }
            return next;
        });
    }

    return (
        <>
            <div className={styles['question-counter']} style={{ color: checkedCount < 3 ? '#dc2626' : '#3b82f6' }}>
                Selected: {checkedCount}/7 (Minimum: 3)
            </div>
            <div className={styles['questions-scroll']}>
                {QUESTIONS.map((q, i) => (
                    <div className={styles['question-item']} key={i}>
                        <div className={styles['question-checkbox']}>
                            <input
                                type="checkbox"
                                id={`${prefix}-q${i}`}
                                checked={!!checked[i]}
                                onChange={() => toggle(i)}
                            />
                            <label htmlFor={`${prefix}-q${i}`}>{q}</label>
                        </div>
                        {checked[i] && (
                            <div className={styles['answer-input-group']}>
                                <input
                                    type="text"
                                    placeholder="Your answer"
                                    value={answers[i] || ''}
                                    onChange={e => setAnswers(a => ({ ...a, [i]: e.target.value }))}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function AdminPage() {
    const router = useRouter();
    const [popup, setPopup]         = useState({ message: '', type: 'success' });
    const [activeTab, setActiveTab] = useState('users');

    // Admin details
    const [adminData, setAdminData] = useState(null);

    // Users table
    const [users, setUsers]         = useState([]);
    const [pagination, setPagination] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortCol, setSortCol]     = useState('created_at');
    const [sortDir, setSortDir]     = useState('desc');
    const [search, setSearch]       = useState('');
    const [openDropdown, setOpenDropdown] = useState(null);

    // Modals
    const [pwVerifyModal, setPwVerifyModal]       = useState({ open: false, type: '', userId: null });
    const [pwVerifyInput, setPwVerifyInput]       = useState('');
    const [pwDisplayed, setPwDisplayed]           = useState('');

    const [actionVerifyModal, setActionVerifyModal] = useState({ open: false, action: '', userId: null, userName: '' });
    const [actionPwInput, setActionPwInput]         = useState('');

    // Create User modal
    const [createModal, setCreateModal] = useState(false);
    const [createStep, setCreateStep]   = useState(1);
    const [createForm, setCreateForm]   = useState({ name:'', email:'', password:'', passwordConfirm:'', shiftStart:'', shiftEnd:'' });
    const [createChecked, setCreateChecked] = useState({});
    const [createAnswers, setCreateAnswers] = useState({});
    const [createAdminPw, setCreateAdminPw] = useState('');

    // Edit User modal
    const [editModal, setEditModal]   = useState(false);
    const [editStep, setEditStep]     = useState(1);
    const [editForm, setEditForm]     = useState({ id:null, name:'', email:'', password:'', passwordConfirm:'', shiftStart:'', shiftEnd:'' });
    const [editChecked, setEditChecked] = useState({});
    const [editAnswers, setEditAnswers] = useState({});

    // Edit Admin modal
    const [editAdminModal, setEditAdminModal]   = useState(false);
    const [editAdminStep, setEditAdminStep]     = useState(1);
    const [editAdminForm, setEditAdminForm]     = useState({ name:'', email:'', password:'', passwordConfirm:'', softwarePassword:'', softwarePwConfirm:'' });
    const [adminChecked, setAdminChecked]       = useState({});
    const [adminAnswers, setAdminAnswers]       = useState({});

    // Admin settings
    const [settingsModal, setSettingsModal] = useState(false);
    const [settingsForm, setSettingsForm]   = useState({ shopName:'', phone:'', city:'', address:'' });
    const [settingsLogo, setSettingsLogo]   = useState(null);
    const [settingsPreview, setSettingsPreview] = useState('');
    const [settingsExists, setSettingsExists]   = useState(false);
    const [adminInfo, setAdminInfo]             = useState(undefined);
     // License
     const [licenseData, setLicenseData] = useState(null);
     // Notifications
     const [notifLogs, setNotifLogs]             = useState([]);
     const [notifPagination, setNotifPagination] = useState(null);
     const [notifPage, setNotifPage]             = useState(1);
     const [notifUserFilter, setNotifUserFilter] = useState('');
     const [notifLoading, setNotifLoading]       = useState(false);
     const [unreadCount, setUnreadCount]         = useState(0);
     const [selectedNotifIds, setSelectedNotifIds] = useState([]);
    // Early Renewal
const [earlyRenewModal, setEarlyRenewModal]     = useState(false);
const [earlyRenewStep, setEarlyRenewStep]       = useState(1); // 1=gate, 2=renew
const [earlyRenewGateKey, setEarlyRenewGateKey] = useState('');
const [earlyRenewCode, setEarlyRenewCode]       = useState('');
const [earlyRenewKey, setEarlyRenewKey]         = useState('');
const [earlyRenewLoading, setEarlyRenewLoading] = useState(false);
    const [countdown, setCountdown]     = useState('');
    const countdownRef = useRef(null);

    // ── show popup ──────────────────────────────────────────────────────────
    function showPopup(message, type = 'success') {
        setPopup({ message, type });
        setTimeout(() => setPopup({ message: '', type: 'success' }), 3000);
    }

    // ── load admin details ──────────────────────────────────────────────────
    async function loadAdminDetails() {
        const res  = await apiFetch('/api/users/admin-details');
        const data = await res.json();
        if (data.success) setAdminData(data.data);
    }

    // ── load users ──────────────────────────────────────────────────────────
    const loadUsers = useCallback(async (page = 1) => {
        setCurrentPage(page);
        const res  = await apiFetch(`/api/users/data?page=${page}&sort_column=${sortCol}&sort_direction=${sortDir}`);
        const data = await res.json();
        if (data.success) { setUsers(data.data); setPagination(data.pagination); }
    }, [sortCol, sortDir]);

    useEffect(() => { loadAdminDetails(); loadUsers(1); loadUnreadCount(); }, []);
    useEffect(() => { loadUsers(1); }, [sortCol, sortDir]);

    // Keep the badge fresh without a manual refresh
    useEffect(() => {
        const interval = setInterval(loadUnreadCount, 30000);
        return () => clearInterval(interval);
    }, []);
    // ── close dropdowns on outside click ───────────────────────────────────
    useEffect(() => {
        function handler(e) {
            if (!e.target.closest('.' + styles['user-action-dropdown'])) {
                setOpenDropdown(null);
            }
        }
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    // ── load tab data ───────────────────────────────────────────────────────
    async function switchTab(tab) {
        setActiveTab(tab);
        if (tab === 'admin-info')    loadAdminInfo();
        if (tab === 'license')       loadLicense();
        if (tab === 'notifications') loadNotifications(1, notifUserFilter);
    }

    async function loadAdminInfo() {
        const res  = await apiFetch('/api/users/admin/settings');
        const data = await res.json();
        if (data.success) setAdminInfo(data.data);
        else if (data.not_created) setAdminInfo(null);
    }


async function loadLicense() {
    const res  = await apiFetch('/api/users/license/info');
    const data = await res.json();
    if (data.success) {
        setLicenseData(data.data);
        startCountdown(data.data.expiry_date);
    }
}

async function loadUnreadCount() {
    const res  = await apiFetch('/api/users/activity-logs/unread-count');
    const data = await res.json();
    if (data.success) setUnreadCount(data.count);
}

async function loadNotifications(page = 1, userId = '') {
    setNotifLoading(true);
    setNotifPage(page);
    setSelectedNotifIds([]);
    try {
        const url = userId
            ? `/api/users/activity-logs?page=${page}&user_id=${userId}`
            : `/api/users/activity-logs?page=${page}`;
        const res  = await apiFetch(url);
        const data = await res.json();
        if (data.success) { setNotifLogs(data.data); setNotifPagination(data.pagination); }
    } finally {
        setNotifLoading(false);
    }
}

async function markAllNotificationsRead() {
    const res  = await apiFetch('/api/users/activity-logs/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.success) {
        setUnreadCount(0);
        setNotifLogs(prev => prev.map(l => ({ ...l, is_read: 1 })));
        showPopup('All notifications marked as read', 'success');
    }
}

async function markSingleNotificationRead(logId) {
    const res  = await apiFetch('/api/users/activity-logs/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [logId] }),
    });
    const data = await res.json();
    if (data.success) {
        setNotifLogs(prev => prev.map(l => l.id === logId ? { ...l, is_read: 1 } : l));
        setUnreadCount(prev => Math.max(0, prev - 1));
    }
}

function toggleNotifSelection(logId) {
    setSelectedNotifIds(prev =>
        prev.includes(logId) ? prev.filter(id => id !== logId) : [...prev, logId]
    );
}

async function deleteSingleNotification(logId) {
    if (!confirm('Permanently delete this notification?')) return;
    const res  = await apiFetch(`/api/users/activity-logs/${logId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        const wasUnread = notifLogs.find(l => l.id === logId && !l.is_read);
        setNotifLogs(prev => prev.filter(l => l.id !== logId));
        setSelectedNotifIds(prev => prev.filter(id => id !== logId));
        if (wasUnread) setUnreadCount(prev => Math.max(0, prev - 1));
        showPopup('Notification deleted', 'success');
    } else {
        showPopup(data.message || 'Failed to delete', 'error');
    }
}

async function deleteSelectedNotifications() {
    if (selectedNotifIds.length === 0) return;
    if (!confirm(`Permanently delete ${selectedNotifIds.length} selected notification(s)?`)) return;
    const res  = await apiFetch('/api/users/activity-logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedNotifIds }),
    });
    const data = await res.json();
    if (data.success) {
        loadNotifications(1, notifUserFilter);
        loadUnreadCount();
        setSelectedNotifIds([]);
        showPopup(data.message, 'success');
    } else {
        showPopup(data.message || 'Failed to delete', 'error');
    }
}

async function deleteAllNotifications() {
    if (!confirm('Permanently delete ALL notifications? This cannot be undone.')) return;
    const res  = await apiFetch('/api/users/activity-logs', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        setNotifLogs([]);
        setNotifPagination(null);
        setSelectedNotifIds([]);
        setUnreadCount(0);
        showPopup(data.message, 'success');
    } else {
        showPopup(data.message || 'Failed to delete', 'error');
    }
}

function actionTypeMeta(type) {
    const map = {
        edit:             { label: 'Edited',    className: 'action-edit' },
        delete:           { label: 'Deleted',   className: 'action-delete' },
        permanent_delete: { label: 'Perm. Deleted', className: 'action-delete' },
        restock:          { label: 'Restocked', className: 'action-restock' },
    };
    return map[type] || { label: type, className: 'action-default' };
}

function formatDateTime(str) {
    if (!str) return '-';
    const d = new Date(str.replace(' ', 'T'));
    const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hours = d.getHours();
    const h12   = hours % 12 === 0 ? 12 : hours % 12;
    const ampm  = hours >= 12 ? 'PM' : 'AM';
    return `${d.getDate()}-${m[d.getMonth()]}-${d.getFullYear()} · ${String(h12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}`;
}

    function startCountdown(expiryDate) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
            const diff = Math.floor((new Date(expiryDate) - Date.now()) / 1000);
            if (diff <= 0) { setCountdown('0 day : 00 : 00 : 00'); return; }
            const d  = Math.floor(diff / 86400);
            const h  = Math.floor((diff % 86400) / 3600);
            const m  = Math.floor((diff % 3600) / 60);
            const s  = diff % 60;
            setCountdown(`${d} day : ${String(h).padStart(2,'0')} : ${String(m).padStart(2,'0')} : ${String(s).padStart(2,'0')}`);
        }, 1000);
    }

    // ── EARLY RENEWAL ───────────────────────────────────────────────────────────
function openEarlyRenewModal() {
    setEarlyRenewStep(1);
    setEarlyRenewGateKey('');
    setEarlyRenewCode('');
    setEarlyRenewKey('');
    setEarlyRenewModal(true);
}

async function submitEarlyRenewGate() {
    if (!earlyRenewGateKey.trim()) { showPopup('Please enter the gate key', 'error'); return; }
    setEarlyRenewLoading(true);
    try {
        const res  = await apiFetch('/license/early-renew', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gate_key: earlyRenewGateKey.trim() }),
        });
        const data = await res.json();
        if (data.success) {
            setEarlyRenewStep(2);
        } else {
            showPopup(data.message || 'Invalid gate key', 'error');
        }
    } finally {
        setEarlyRenewLoading(false);
    }
}

async function submitEarlyRenew() {
    if (!earlyRenewCode.trim()) { showPopup('Please enter license code', 'error'); return; }
    if (!earlyRenewKey.trim())  { showPopup('Please enter activation key', 'error'); return; }
    setEarlyRenewLoading(true);
    try {
        const res  = await apiFetch('/license/early-renew', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gate_key:       earlyRenewGateKey.trim(),
                license_code:   earlyRenewCode.trim().toUpperCase(),
                activation_key: earlyRenewKey.trim(),
            }),
        });
        const data = await res.json();
        if (data.success) {
            showPopup(data.message, 'success');
            setEarlyRenewModal(false);
            loadLicense();
        } else {
            showPopup(data.message || 'Invalid credentials', 'error');
        }
    } finally {
        setEarlyRenewLoading(false);
    }
}

    useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

    // ── password reveal ─────────────────────────────────────────────────────
    function openPwVerify(type, userId) {
        setPwVerifyModal({ open: true, type, userId });
        setPwVerifyInput('');
        setPwDisplayed('');
    }

    async function verifyAndShowPw() {
        const res  = await apiFetch('/api/users/verify-and-show-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_password: pwVerifyInput, password_type: pwVerifyModal.type, user_id: pwVerifyModal.userId }),
        });
        const data = await res.json();
        if (data.success) setPwDisplayed(data.password);
        else showPopup(data.message || 'Incorrect password', 'error');
    }

    // ── action verify (gate for edit/delete) ────────────────────────────────
    function openActionVerify(action, userId, userName = '') {
        setActionVerifyModal({ open: true, action, userId, userName });
        setActionPwInput('');
    }

    async function verifyAndProceed() {
        const res  = await apiFetch('/api/users/verify-admin-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_password: actionPwInput }),
        });
        const data = await res.json();
        if (!data.success) { showPopup(data.message || 'Incorrect password', 'error'); return; }

        setActionVerifyModal(v => ({ ...v, open: false }));
        const { action, userId, userName } = actionVerifyModal;

        if (action === 'delete_user') {
            const dr = await apiFetch(`/api/users/delete/${userId}`, { method: 'DELETE' });
            const dd = await dr.json();
            showPopup(dd.message, dd.success ? 'success' : 'error');
            if (dd.success) loadUsers(currentPage);
        }
        if (action === 'edit_user') {
            const ur = await apiFetch(`/api/users/get-user/${userId}`);
            const ud = await ur.json();
            if (ud.success) openEditModal(ud.data);
        }
        if (action === 'edit_admin') {
            const ar = await apiFetch('/api/users/admin-details');
            const ad = await ar.json();
            if (ad.success) openEditAdminModal(ad.data);
        }
        if (action === 'edit_admin_settings') {
            const sr = await apiFetch('/api/users/admin/settings');
            const sd = await sr.json();
            if (sd.success) openSettingsModal(sd.data, true);
        }
        if (action === 'create_admin_settings') {
            openSettingsModal({ shop_name:'', phone:'', city:'', address:'', logo:'' }, false);
        }
    }

    // ── CREATE USER ─────────────────────────────────────────────────────────
    function openCreateModal() { setCreateModal(true); setCreateStep(1); setCreateForm({ name:'', email:'', password:'', passwordConfirm:'', shiftStart:'', shiftEnd:'' }); setCreateChecked({}); setCreateAnswers({}); setCreateAdminPw(''); }
    function closeCreateModal() { setCreateModal(false); }

    function createNext1() {
        const { name, email, password, passwordConfirm } = createForm;
        if (!name || !email || !password || !passwordConfirm) { showPopup('All fields are required', 'error'); return; }
        if (password !== passwordConfirm) { showPopup('Passwords do not match', 'error'); return; }
        if (password.length < 6) { showPopup('Password must be at least 6 characters', 'error'); return; }
        setCreateStep(2);
    }

    function createNext2() {
        const cnt = Object.keys(createChecked).filter(k => createChecked[k]).length;
        if (cnt < 3) { showPopup('Please select at least 3 security questions', 'error'); return; }
        const hasEmpty = Object.keys(createChecked).filter(k => createChecked[k]).some(k => !createAnswers[k]?.trim());
        if (hasEmpty) { showPopup('Please provide answers for all selected questions', 'error'); return; }
        setCreateStep(3);
    }

    async function submitCreateUser() {
        if (!createAdminPw) { showPopup('Please enter admin password', 'error'); return; }
        const questions = {};
        Object.keys(createChecked).filter(k => createChecked[k]).forEach(k => {
            questions[k] = { question: QUESTIONS[k], answer: createAnswers[k].toLowerCase().trim() };
        });
        const res  = await apiFetch('/api/users/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...createForm, password_confirmation: createForm.passwordConfirm, shift_start: createForm.shiftStart, shift_end: createForm.shiftEnd, security_questions: questions, admin_password: createAdminPw }),
        });
        const data = await res.json();
        showPopup(data.message, data.success ? 'success' : 'error');
        if (data.success) { closeCreateModal(); loadUsers(currentPage); }
    }

    // ── EDIT USER ───────────────────────────────────────────────────────────
    function openEditModal(userData) {
        setEditForm({ id: userData.id, name: userData.name, email: userData.email, password: '', passwordConfirm: '', shiftStart: userData.shift_start || '', shiftEnd: userData.shift_end || '' });

        // Pre-fill security questions
        const savedQs = Array.isArray(userData.security_questions)
            ? userData.security_questions
            : Object.values(userData.security_questions || {});
        const checked = {}, answers = {};
        savedQs.forEach(sq => {
            const idx = QUESTIONS.findIndex(q => q === sq.question);
            if (idx !== -1) { checked[idx] = true; answers[idx] = sq.answer; }
        });
        setEditChecked(checked);
        setEditAnswers(answers);
        setEditStep(1);
        setEditModal(true);
    }

    function closeEditModal() { setEditModal(false); }

    function editNext1() {
        const { name, email } = editForm;
        if (!name || !email) { showPopup('Name and email are required', 'error'); return; }
        if (editForm.password && editForm.password !== editForm.passwordConfirm) { showPopup('Passwords do not match', 'error'); return; }
        setEditStep(2);
    }

    async function submitEditUser() {
        const cnt = Object.keys(editChecked).filter(k => editChecked[k]).length;
        if (cnt < 3) { showPopup('Please select at least 3 security questions', 'error'); return; }
        const hasEmpty = Object.keys(editChecked).filter(k => editChecked[k]).some(k => !editAnswers[k]?.trim());
        if (hasEmpty) { showPopup('Please provide answers for all selected questions', 'error'); return; }

        const questions = {};
        Object.keys(editChecked).filter(k => editChecked[k]).forEach(k => {
            questions[k] = { question: QUESTIONS[k], answer: editAnswers[k].toLowerCase().trim() };
        });

        const body = { name: editForm.name, email: editForm.email, shift_start: editForm.shiftStart, shift_end: editForm.shiftEnd, security_questions: questions };
        if (editForm.password) { body.password = editForm.password; body.password_confirmation = editForm.passwordConfirm; }

        const res  = await apiFetch(`/api/users/update/${editForm.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        showPopup(data.message, data.success ? 'success' : 'error');
        if (data.success) { closeEditModal(); loadUsers(currentPage); }
    }

    // ── EDIT ADMIN ──────────────────────────────────────────────────────────
    function openEditAdminModal(admin) {
        setEditAdminForm({ name: admin.name, email: admin.email, password: '', passwordConfirm: '', softwarePassword: '', softwarePwConfirm: '' });
        const savedQs = Array.isArray(admin.security_questions)
            ? admin.security_questions
            : Object.values(admin.security_questions || {});
        const checked = {}, answers = {};
        savedQs.forEach(sq => {
            const idx = QUESTIONS.findIndex(q => q === sq.question);
            if (idx !== -1) { checked[idx] = true; answers[idx] = sq.answer; }
        });
        setAdminChecked(checked);
        setAdminAnswers(answers);
        setEditAdminStep(1);
        setEditAdminModal(true);
    }

    function editAdminNext1() {
        const { name, email, password, passwordConfirm, softwarePassword, softwarePwConfirm } = editAdminForm;
        if (!name || !email) { showPopup('Name and email are required', 'error'); return; }
        if (password && password !== passwordConfirm) { showPopup('Login passwords do not match', 'error'); return; }
        if (softwarePassword && softwarePassword !== softwarePwConfirm) { showPopup('Software passwords do not match', 'error'); return; }
        setEditAdminStep(2);
    }

    async function submitAdminEdit() {
        const cnt = Object.keys(adminChecked).filter(k => adminChecked[k]).length;
        if (cnt < 3) { showPopup('Please select at least 3 security questions', 'error'); return; }
        const hasEmpty = Object.keys(adminChecked).filter(k => adminChecked[k]).some(k => !adminAnswers[k]?.trim());
        if (hasEmpty) { showPopup('Please provide answers for all selected questions', 'error'); return; }

        const questions = Object.keys(adminChecked).filter(k => adminChecked[k]).map(k => ({
            question: QUESTIONS[k], answer: adminAnswers[k].toLowerCase().trim()
        }));

        const body = { name: editAdminForm.name, email: editAdminForm.email, security_questions: questions };
        if (editAdminForm.password) { body.password = editAdminForm.password; body.password_confirmation = editAdminForm.passwordConfirm; }
        if (editAdminForm.softwarePassword) { body.software_password = editAdminForm.softwarePassword; body.software_password_confirmation = editAdminForm.softwarePwConfirm; }

        const res  = await apiFetch('/api/users/admin/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        showPopup(data.message, data.success ? 'success' : 'error');
        if (data.success) { setEditAdminModal(false); loadAdminDetails(); }
    }

    // ── ADMIN SETTINGS ──────────────────────────────────────────────────────
    function openSettingsModal(data, exists) {
        setSettingsForm({ shopName: data.shop_name || '', phone: data.phone || '', city: data.city || '', address: data.address || '' });
        setSettingsPreview(data.logo ? `http://localhost:4000/public/${data.logo}` : '');
        setSettingsLogo(null);
        setSettingsExists(exists);
        setSettingsModal(true);
    }

    async function submitSettings() {
        if (!settingsForm.shopName) { showPopup('Shop name is required', 'error'); return; }
        const fd = new FormData();
        fd.append('shop_name', settingsForm.shopName);
        fd.append('phone',     settingsForm.phone);
        fd.append('city',      settingsForm.city);
        fd.append('address',   settingsForm.address);
        if (settingsLogo) fd.append('logo', settingsLogo);

        const endpoint = settingsExists ? '/api/users/admin/settings/update' : '/api/users/admin/settings/store';
        const res  = await apiFetch(endpoint, { method: 'POST', body: fd });
        const data = await res.json();
        showPopup(data.message, data.success ? 'success' : 'error');
        if (data.success) { setSettingsModal(false); loadAdminInfo(); }
    }

    // ── filtered users (client-side search) ────────────────────────────────
    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    );

    // ── RENDER ──────────────────────────────────────────────────────────────
    return (
        <div className="container" style={{ maxWidth: 1400, margin: '0 auto' }}>
            <Popup message={popup.message} type={popup.type} />

            {/* ── Page header */}
            <div style={{ marginBottom: 25 }}>
                <h1 style={{ color: '#1f2937', fontSize: 28, fontWeight: 700, margin: '0 0 5px 0' }}>Admin Panel</h1>
                <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Manage admin and user accounts</p>
            </div>

                        {/* ── Admin Profile Bar */}
                        <div className={styles['admin-profile-bar']}>
                <div className={styles['admin-profile-identity']}>
                    <div className={styles['admin-avatar']}><UserCog size={22} /></div>
                    {adminData ? (
                        <div>
                            <div className={styles['admin-profile-name-row']}>
                                <span className={styles['admin-profile-name']}>{adminData.name}</span>
                                <span className={styles['admin-role-badge']}>Administrator</span>
                            </div>
                            <div className={styles['admin-profile-email']}>{adminData.email}</div>
                        </div>
                    ) : <div className="loading-spinner"><div className="spinner" /></div>}
                </div>
                <div className={styles['admin-profile-creds']}>
                    <div className={styles['admin-profile-cred']}>
                        <span className={styles['admin-profile-cred-label']}>Password</span>
                        <span className={styles['admin-profile-cred-value']}>••••••••</span>
                        <button className={styles['password-toggle-btn']} onClick={() => openPwVerify('login', adminData?.id)} title="Show password"><i className="fa fa-eye"></i></button>
                    </div>
                    <div className={styles['admin-profile-cred']}>
                        <span className={styles['admin-profile-cred-label']}>Software Password</span>
                        <span className={styles['admin-profile-cred-value']}>••••••••</span>
                        <button className={styles['password-toggle-btn']} onClick={() => openPwVerify('software', adminData?.id)} title="Show software password"><i className="fa fa-eye"></i></button>
                    </div>
                    <button className={styles['btn-admin-edit']} onClick={() => openActionVerify('edit_admin', 0)}>
                        <SquarePen size={14} style={{ marginRight: 5 }} />
                        Edit Admin
                    </button>
                </div>
            </div>
                                        {/* ── Panel: Tabs + Content */}
                                        <div className={styles['admin-panel-card']}>
                                        <div className={styles['admin-panel-tabs']}>
                    {[
                        ['users', <Users size={16} key="i" />, 'Users'],
                        ['admin-info', <UserCog size={16} key="i" />, 'Shop Info'],
                        ['license', <ShieldCheck size={16} key="i" />, 'License'],
                        ['notifications', <Bell size={16} key="i" />, 'Notifications'],
                    ].map(([key, icon, label]) => (
                        <button key={key} className={`${styles['admin-panel-tab']}${activeTab === key ? ' ' + styles['active'] : ''}`} onClick={() => switchTab(key)}>
                            {icon}
                            <span>{label}</span>
                            {key === 'notifications' && unreadCount > 0 && (
                                <span className={styles['notif-badge']}>{unreadCount > 99 ? '99+' : unreadCount}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className={styles['admin-panel-body']}>

            {/* ── TAB: Users */}
            {activeTab === 'users' && (
                <div className={styles['users-section']}>
                                    <div className={styles['admin-stats-row']}>
                        <div className={styles['admin-stat-card']}>
                            <div className={`${styles['admin-stat-icon']} ${styles['stat-icon-blue']}`}><Users size={20} /></div>
                            <div>
                                <div className={styles['admin-stat-label']}>Total Users</div>
                                <div className={styles['admin-stat-value']}>{pagination ? pagination.total : users.length}</div>
                            </div>
                        </div>
                        <div className={styles['admin-stat-card']}>
                            <div className={`${styles['admin-stat-icon']} ${styles['stat-icon-green']}`}><Clock size={20} /></div>
                            <div>
                                <div className={styles['admin-stat-label']}>On Shift Now</div>
                                <div className={styles['admin-stat-value']}>{getCurrentShiftUsers(users).length}</div>
                            </div>
                        </div>
                        <div className={styles['admin-stat-card']}>
                            <div className={`${styles['admin-stat-icon']} ${styles['stat-icon-purple']}`}><UserCog size={20} /></div>
                            <div>
                                <div className={styles['admin-stat-label']}>Current Shift</div>
                                {(() => {
                                    const onShift = getCurrentShiftUsers(users);
                                    if (onShift.length === 0) {
                                        return <div className={styles['admin-stat-value']} style={{ fontSize: 15, color: '#9ca3af' }}>No one on shift</div>;
                                    }
                                    return (
                                        <div className={styles['admin-stat-value']} style={{ fontSize: 15 }}>
                                            {onShift.map(u => u.name).join(', ')}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                        <div className={styles['admin-stat-card']}>
                            <div className={`${styles['admin-stat-icon']} ${styles['stat-icon-amber']}`}><UserPlus size={20} /></div>
                            <div>
                                <div className={styles['admin-stat-label']}>Next Shift</div>
                                {(() => {
                                    const nextUsers = getNextShiftUsers(users);
                                    if (nextUsers.length === 0) {
                                        return <div className={styles['admin-stat-value']} style={{ fontSize: 15, color: '#9ca3af' }}>No shifts set</div>;
                                    }
                                    return (
                                        <div className={styles['admin-stat-value']} style={{ fontSize: 15 }}>
                                            {nextUsers.map(u => u.name).join(', ')} <span style={{ color: '#6b7280', fontWeight: 500 }}> · {formatTime(nextUsers[0].shift_start)}</span>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                    <div className={styles['section-header']}>
                        <h2>Users List</h2>
                        <div className={styles['add-user-button']}>
                            <button onClick={openCreateModal}><span>+ Create User</span></button>
                        </div>
                    </div>

                    <div className="report-search-container" style={{ marginBottom: 20 }}>
                        <div className="search-container">
                            <input type="text" className="input" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
                            <span className="icon1">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 22L20 20" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </span>
                        </div>
                    </div>

                    <div className={styles['users-table-wrap']}>
                    <table id="singleSearchTable">
                        <thead>
                            <tr>
                                <th style={{ width: 60 }}>No.</th>
                                {[['name','Name'],['email','Email']].map(([col,label]) => (
                                    <th key={col} className="sortable" style={{ cursor: 'pointer' }}>
                                        <div className="sortable-header">
                                            <span>{label}</span>
                                            <span className="sort-icons">
                                                <span className={`sort-up${sortCol===col&&sortDir==='asc'?' active':''}`} onClick={() => { setSortCol(col); setSortDir('asc'); }}>▲</span>
                                                <span className={`sort-down${sortCol===col&&sortDir==='desc'?' active':''}`} onClick={() => { setSortCol(col); setSortDir('desc'); }}>▼</span>
                                            </span>
                                        </div>
                                    </th>
                                ))}
                                <th>Password</th>
                                <th>Shift Time</th>
                                <th style={{ width: 100 }}>Role</th>
                                <th className="sortable" style={{ width: 140, cursor: 'pointer' }}>
                                    <div className="sortable-header">
                                        <span>Created At</span>
                                        <span className="sort-icons">
                                            <span className={`sort-up${sortCol==='created_at'&&sortDir==='asc'?' active':''}`} onClick={() => { setSortCol('created_at'); setSortDir('asc'); }}>▲</span>
                                            <span className={`sort-down${sortCol==='created_at'&&sortDir==='desc'?' active':''}`} onClick={() => { setSortCol('created_at'); setSortDir('desc'); }}>▼</span>
                                        </span>
                                    </div>
                                </th>
                                <th style={{ width: 100 }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.length === 0 ? (
                                <tr><td colSpan="8" style={{ textAlign:'center', padding:30, color:'#9ca3af' }}>No users found</td></tr>
                            ) : filteredUsers.map((user, idx) => (
                                <tr key={user.id}>
                                    <td>{pagination ? pagination.first_item + idx : idx + 1}</td>
                                    <td>
                                        <div className={styles['user-name-cell']}>
                                            <div className={styles['user-avatar-sm']}>{getInitials(user.name)}</div>
                                            <span>{user.name}</span>
                                        </div>
                                    </td>
                                    <td>{user.email}</td>
                                    <td>
                                        ••••••••
                                        <button className={styles['password-toggle-btn']} onClick={() => openPwVerify('user', user.id)} title="Show password"><i className="fa fa-eye"></i></button>
                                    </td>
                                    <td>{formatTime(user.shift_start)} - {formatTime(user.shift_end)}</td>
                                    <td><span className={`${styles['role-badge']} ${styles[user.role]}`}>{user.role.toUpperCase()}</span></td>
                                    <td>{formatDate(user.created_at)}</td>
                                    <td>
                                        <div className={styles['user-action-dropdown']} onClick={e => e.stopPropagation()}>
                                        <button className={styles['user-dropdown-toggle']} onClick={() => setOpenDropdown(openDropdown === user.id ? null : user.id)}>⋮</button>
                                        <div className={`${styles['user-action-dropdown-menu']}${openDropdown === user.id ? ' ' + styles['open'] : ''}`}>
                                        <button className="" onClick={() => { setOpenDropdown(null); openActionVerify('edit_user', user.id, user.name); }}>Edit</button>
                                                <button className="" onClick={() => { setOpenDropdown(null); router.push(`/users/${user.id}/access?name=${encodeURIComponent(user.name)}`); }}>Manage Access</button>
<button className="" onClick={() => { setOpenDropdown(null); router.push(`/users/${user.id}/performance?name=${encodeURIComponent(user.name)}`); }}>View Performance</button>
<button className="" onClick={() => { setOpenDropdown(null); openActionVerify('delete_user', user.id, user.name); }}>Delete</button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>

                    {/* Pagination */}
                    {pagination && pagination.last_page > 1 && (
                        <div className="custom-pagination">
                            {pagination.on_first_page ? <span className="disabled">« First</span> : <a onClick={() => loadUsers(1)}>« First</a>}
                            {pagination.on_first_page ? <span className="disabled">←</span> : <a onClick={() => loadUsers(currentPage - 1)}>←</a>}
                            {Array.from({ length: pagination.last_page }, (_, i) => i + 1)
                                .filter(p => Math.abs(p - currentPage) <= 2)
                                .map(p => (
                                    <span key={p} className={p === currentPage ? 'active' : ''} style={{ cursor:'pointer' }} onClick={() => loadUsers(p)}>{p}</span>
                                ))}
                            {pagination.has_more_pages ? <a onClick={() => loadUsers(currentPage + 1)}>→</a> : <span className="disabled">→</span>}
                            {pagination.has_more_pages ? <a onClick={() => loadUsers(pagination.last_page)}>Last »</a> : <span className="disabled">Last »</span>}
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: Admin Personal Info */}
            {activeTab === 'admin-info' && (
                <div className={styles['admin-personalInfo']}>
                    {adminInfo === undefined ? (
                        <div className="loading-spinner"><div className="spinner" /></div>
                    ) : adminInfo === null ? (
                        <div className={styles['empty-state']}>
                        <Store size={44} className={styles['empty-state-icon']} />
                        <h3>Shop Settings Not Configured</h3>
                        <p>You haven't set up your shop information yet.</p>
                        <button className={styles['btn-create']} style={{ padding:'10px 24px', width:'auto' }} onClick={() => openActionVerify('create_admin_settings', 0)}>+ Setup Shop Settings</button>
                    </div>
                    ) : (
                        <div className={styles['info-card']}>
                        <div className={styles['panel-header-row']}>
                            <h3 className={styles['panel-title']}>Shop Information</h3>
                            <button className={styles['btn-admin-edit']} onClick={() => openActionVerify('edit_admin_settings', 0)}><SquarePen size={14}/> Edit Settings</button>
                        </div>
                        <div className={styles['shop-info-layout']}>
                                <div className={styles['shop-logo-box']}>
                                    {adminInfo.logo
                                        ? <img src={`http://localhost:4000/public/${adminInfo.logo}`} alt="Logo" />
                                        : <Store size={40} color="#9ca3af" />}
                                </div>
                                <div className={styles['shop-detail-rows']}>
                                    <div className={styles['shop-detail-row']}>
                                        <span className={styles['shop-detail-row-label']}><Store size={15} className={styles['detail-row-icon']} />Business/Shop Name</span>
                                        <span className={styles['shop-detail-row-value']}>{adminInfo.shop_name || 'Not set'}</span>
                                    </div>
                                    <div className={styles['shop-detail-row']}>
                                        <span className={styles['shop-detail-row-label']}><Phone size={15} className={styles['detail-row-icon']} />Phone Number</span>
                                        <span className={styles['shop-detail-row-value']}>{adminInfo.phone || 'Not set'}</span>
                                    </div>
                                    <div className={styles['shop-detail-row']}>
                                        <span className={styles['shop-detail-row-label']}><MapPin size={15} className={styles['detail-row-icon']} />City</span>
                                        <span className={styles['shop-detail-row-value']}>{adminInfo.city || 'Not set'}</span>
                                    </div>
                                    <div className={styles['shop-detail-row']}>
                                        <span className={styles['shop-detail-row-label']}><MapPin size={15} className={styles['detail-row-icon']} />Address</span>
                                        <span className={styles['shop-detail-row-value']}>{adminInfo.address || 'Not set'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

                       {/* ── TAB: License */}
                       {activeTab === 'license' && (
                <div className={styles['licenseInfo']}>
                    {!licenseData ? (
                        <div className="loading-spinner"><div className="spinner" /></div>
                    ) : (
                        <div className={styles['info-card']}>
                        <div className={styles['license-header']}>
                            <div className={styles['license-header-info']}>
                                <ShieldCheck size={44} className={licenseData.is_expired ? styles['icon-expired'] : styles['icon-active']} />
                                <div>
                                    <h3 className={styles['license-title']}>Software License</h3>
                                    <span className={`${styles['license-status']}${licenseData.is_expired ? ' ' + styles['expired'] : ''}`}>{licenseData.status}</span>
                                </div>
                            </div>
                            <button className={styles['btn-admin-edit']} onClick={openEarlyRenewModal}>Early Renewal</button>
                        </div>

                        <div className={styles['license-progress-label']}>
                            <span>License Period Used</span>
                            <span>{licensePercentRemaining(licenseData)}% Remaining</span>
                        </div>
                        <div className={styles['license-progress-track']}>
                            <div
                                className={`${styles['license-progress-fill']}${licenseData.is_expired ? ' ' + styles['expired'] : ''}`}
                                style={{ width: `${licensePercentRemaining(licenseData)}%` }}
                            />
                        </div>

                        <div className={styles['license-stat-grid']}>
                            <div className={styles['license-stat']}>
                                <div className={styles['stat-label']}>License Valid Days</div>
                                <div className={styles['stat-value']}>{licenseData.valid_days} Days</div>
                            </div>
                            <div className={styles['license-stat']}>
                                <div className={styles['stat-label']}>Days Remaining</div>
                                <div className={styles['stat-value']} style={{ color: licenseData.is_expired ? '#dc2626' : '#15803d' }}>{countdown || '...'}</div>
                            </div>
                        </div>

                        <div className={styles['license-detail-rows']}>
                            <div className={styles['license-detail-row']}>
                                <span className={styles['license-detail-row-label']}><ShieldCheck size={15} className={styles['detail-row-icon']} />Start Date</span>
                                <span className={styles['license-detail-row-value']}>{formatDate(licenseData.start_date)}</span>
                            </div>
                            <div className={styles['license-detail-row']}>
                                <span className={styles['license-detail-row-label']}><ShieldCheck size={15} className={styles['detail-row-icon']} />End Date</span>
                                <span className={styles['license-detail-row-value']}>{formatDate(licenseData.expiry_date)}</span>
                            </div>
                            <div className={styles['license-detail-row']}>
                                <span className={styles['license-detail-row-label']}><ShieldCheck size={15} className={styles['detail-row-icon']} />Status</span>
                                <span className={styles['license-detail-row-value']}>{licenseData.status}</span>
                            </div>
                        </div>
                    </div>
                    )}
                </div>
            )}

             {/* ── TAB: Notifications */}
             {activeTab === 'notifications' && (
                <div className={styles['notifications-section']}>
                    <div className={styles['section-header']}>
                        <h2>User Activity</h2>
                        <div className={styles['notif-header-actions']}>
                            <select
                                className={styles['notif-user-filter']}
                                value={notifUserFilter}
                                onChange={e => { setNotifUserFilter(e.target.value); loadNotifications(1, e.target.value); }}
                            >
                                <option value="">All Users</option>
                                {users.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>
                            {selectedNotifIds.length > 0 && (
                                <button className={styles['notif-delete-selected-btn']} onClick={deleteSelectedNotifications}>
                                    Delete Selected ({selectedNotifIds.length})
                                </button>
                            )}
                            {unreadCount > 0 && (
                                <button className={styles['btn-admin-edit']} onClick={markAllNotificationsRead}>
                                    Mark all as read
                                </button>
                            )}
                            {notifLogs.length > 0 && (
                                <button className={styles['notif-delete-all-btn']} onClick={deleteAllNotifications}>
                                    Delete all
                                </button>
                            )}
                        </div>
                    </div>

                    {notifLoading ? (
                        <div className="loading-spinner"><div className="spinner" /></div>
                    ) : notifLogs.length === 0 ? (
                        <div className={styles['empty-state']}>
                            <Bell size={44} className={styles['empty-state-icon']} />
                            <h3>No Activity Yet</h3>
                            <p>User actions like edits, deletes, and restocks will show up here.</p>
                        </div>
                    ) : (
                        <>
                            <div className={styles['notif-list']}>
                                {notifLogs.map(log => {
                                    const meta = actionTypeMeta(log.action_type);
                                    return (
                                        <div key={log.id} className={`${styles['notif-item']}${!log.is_read ? ' ' + styles['unread'] : ''}`}>
                                            <input
                                                type="checkbox"
                                                className={styles['notif-checkbox']}
                                                checked={selectedNotifIds.includes(log.id)}
                                                onChange={() => toggleNotifSelection(log.id)}
                                            />
                                            <div className={styles['notif-item-icon']}><Bell size={16} /></div>
                                            <div className={styles['notif-item-body']}>
                                                <div className={styles['notif-item-top']}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                        <span className={styles['notif-user-badge']}>{log.user_name || 'Unknown user'}</span>
                                                        <span className={`${styles['notif-action-badge']} ${styles[meta.className]}`}>{meta.label}</span>
                                                    </div>
                                                    <span className={styles['notif-item-time']}>{formatDateTime(log.created_at)}</span>
                                                </div>
                                                <div className={styles['notif-item-desc']}>{log.action_description}</div>
                                            </div>
                                            <div className={styles['notif-item-side']}>
                                                {!log.is_read && (
                                                    <button className={styles['notif-mark-read-btn']} onClick={() => markSingleNotificationRead(log.id)}>
                                                        Mark as read
                                                    </button>
                                                )}
                                                <button
                                                    className={styles['notif-delete-icon-btn']}
                                                    onClick={() => deleteSingleNotification(log.id)}
                                                    title="Delete notification"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                                {!log.is_read && <span className={styles['notif-dot']} />}
                                        </div>
                                    );
                                })}
                            </div>

                            {notifPagination && notifPagination.last_page > 1 && (
                                <div className="custom-pagination">
                                    {notifPagination.on_first_page ? <span className="disabled">« First</span> : <a onClick={() => loadNotifications(1, notifUserFilter)}>« First</a>}
                                    {notifPagination.on_first_page ? <span className="disabled">←</span> : <a onClick={() => loadNotifications(notifPage - 1, notifUserFilter)}>←</a>}
                                    {Array.from({ length: notifPagination.last_page }, (_, i) => i + 1)
                                        .filter(p => Math.abs(p - notifPage) <= 2)
                                        .map(p => (
                                            <span key={p} className={p === notifPage ? 'active' : ''} style={{ cursor:'pointer' }} onClick={() => loadNotifications(p, notifUserFilter)}>{p}</span>
                                        ))}
                                    {notifPagination.has_more_pages ? <a onClick={() => loadNotifications(notifPage + 1, notifUserFilter)}>→</a> : <span className="disabled">→</span>}
                                    {notifPagination.has_more_pages ? <a onClick={() => loadNotifications(notifPagination.last_page, notifUserFilter)}>Last »</a> : <span className="disabled">Last »</span>}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                MODALS
            ══════════════════════════════════════════════════════════════ */}

            {/* ── Password Reveal Modal */}
            <div className={`${styles['password-verify-modal']}${pwVerifyModal.open ? ' ' + styles['open'] : ''}`}>
                <div className={styles['password-verify-content']}>
                    <h3>Verify Admin Password</h3>
                    <p style={{ color:'#6b7280', marginBottom:20 }}>Enter admin password to view this credential</p>
                    <div className={styles['admin-form-group']}>
                        <label>Admin Password *</label>
                        <input type="password" placeholder="Enter admin password" value={pwVerifyInput} onChange={e => setPwVerifyInput(e.target.value)} style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:6 }} />
                    </div>
                    {pwDisplayed && (
                        <div>
                            <label style={{ fontWeight:600, marginBottom:8, display:'block' }}>Credential:</label>
                            <div className={styles['password-display']}>{pwDisplayed}</div>
                        </div>
                    )}
                    <div className={styles['modal-buttons']} style={{ marginTop:20 }}>
                        <button className={styles['btn-create']} onClick={verifyAndShowPw}>Verify &amp; Show</button>
                        <button className={styles['btn-cancel']} onClick={() => setPwVerifyModal({ open:false, type:'', userId:null })}>Cancel</button>
                    </div>
                </div>
            </div>

            {/* ── Action Verify Modal */}
            <div className={`${styles['password-verify-modal']}${actionVerifyModal.open ? ' ' + styles['open'] : ''}`}>
                <div className={styles['password-verify-content']}>
                    <h3>Verify Admin Password</h3>
                    <p style={{ color:'#6b7280', marginBottom:20 }}>Enter admin password to proceed with this action</p>
                    <div className={styles['admin-form-group']}>
                        <label>Admin Password *</label>
                        <input type="password" placeholder="Enter admin password" value={actionPwInput}
                            onChange={e => setActionPwInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && verifyAndProceed()}
                            style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:6 }} />
                    </div>
                    <div className={styles['modal-buttons']} style={{ marginTop:20 }}>
                        <button className={styles['btn-create']} onClick={verifyAndProceed}>Verify &amp; Proceed</button>
                        <button className={styles['btn-cancel']} onClick={() => setActionVerifyModal(v => ({ ...v, open:false }))}>Cancel</button>
                    </div>
                </div>
            </div>

            {/* ── Create User Modal */}
            <div className={`${styles['modal-overlay']}${createModal ? ' ' + styles['open'] : ''}`}>
                <div className={`${styles['modal-content']} ${styles['wide']}`}>                    <div className={styles['step-indicator']}>
                {[1,2,3].map(s => <span key={s} className={`${styles['step-dot']} ${createStep === s ? styles['active'] : styles['inactive']}`}>{s}</span>)}
                    </div>
                    <h3>{createStep === 1 ? 'Create New User' : createStep === 2 ? 'Security Questions' : 'Admin Verification'}</h3>

                    {createStep === 1 && (
                        <>
                            <div className={styles['admin-form-group']}><label>Name *</label><input type="text" placeholder="Enter full name" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Email *</label><input type="email" placeholder="Enter email address" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Password *</label><input type="password" placeholder="Minimum 6 characters" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Confirm Password *</label><input type="password" placeholder="Re-enter password" value={createForm.passwordConfirm} onChange={e => setCreateForm(f => ({ ...f, passwordConfirm: e.target.value }))} /></div>
                            <div className={styles['shift-row']}>
                                <div className={styles['admin-form-group']}><label>Shift Start Time</label><input type="time" value={createForm.shiftStart} onChange={e => setCreateForm(f => ({ ...f, shiftStart: e.target.value }))} /></div>
                                <div className={styles['admin-form-group']}><label>Shift End Time</label><input type="time" value={createForm.shiftEnd} onChange={e => setCreateForm(f => ({ ...f, shiftEnd: e.target.value }))} /></div>
                            </div>
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-create']} onClick={createNext1}>Next: Security Questions</button>
                                <button className={styles['btn-cancel']} onClick={closeCreateModal}>Cancel</button>
                            </div>
                        </>
                    )}

                    {createStep === 2 && (
                        <>
                            <p style={{ color:'#6b7280', fontSize:14, marginBottom:15 }}>Select at least 3 security questions for password recovery.</p>
                            <SecurityQuestionsStep prefix="create" checked={createChecked} setChecked={setCreateChecked} answers={createAnswers} setAnswers={setCreateAnswers} />
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-cancel']} onClick={() => setCreateStep(1)}>Back</button>
                                <button className={styles['btn-create']} onClick={createNext2}>Next: Verify Admin</button>
                            </div>
                        </>
                    )}

                    {createStep === 3 && (
                        <>
                            <p style={{ color:'#6b7280', marginBottom:20 }}>Enter admin password to create this user</p>
                            <div className={styles['admin-form-group']}><label>Admin Password *</label><input type="password" placeholder="Enter admin password" value={createAdminPw} onChange={e => setCreateAdminPw(e.target.value)} /></div>
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-cancel']} onClick={() => setCreateStep(2)}>Back</button>
                                <button className={styles['btn-create']} onClick={submitCreateUser}>Create User</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Edit User Modal */}
            <div className={`${styles['modal-overlay']}${editModal ? ' ' + styles['open'] : ''}`}>
                <div className={`${styles['modal-content']} ${styles['wide']}`}>                    <div className={styles['step-indicator']}>
                {[1,2].map(s => <span key={s} className={`${styles['step-dot']} ${editStep === s ? styles['active'] : styles['inactive']}`}>{s}</span>)}
                    </div>
                    <h3>{editStep === 1 ? 'Edit User' : 'Update Security Questions'}</h3>

                    {editStep === 1 && (
                        <>
                            <div style={{ display:'flex', gap:10 }}>
                                <div className={styles['admin-form-group']} style={{ flex:1 }}><label>Name *</label><input type="text" placeholder="Enter full name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
                                <div className={styles['admin-form-group']} style={{ flex:1 }}><label>Email *</label><input type="email" placeholder="Enter email address" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
                            </div>
                            <div className={styles['admin-form-group']}><label>New Password (leave blank to keep current)</label><input type="password" placeholder="Minimum 6 characters" value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Confirm New Password</label><input type="password" placeholder="Re-enter password" value={editForm.passwordConfirm} onChange={e => setEditForm(f => ({ ...f, passwordConfirm: e.target.value }))} /></div>
                            <div className={styles['shift-row']}>
                                <div className={styles['admin-form-group']}><label>Shift Start Time</label><input type="time" value={editForm.shiftStart} onChange={e => setEditForm(f => ({ ...f, shiftStart: e.target.value }))} /></div>
                                <div className={styles['admin-form-group']}><label>Shift End Time</label><input type="time" value={editForm.shiftEnd} onChange={e => setEditForm(f => ({ ...f, shiftEnd: e.target.value }))} /></div>
                            </div>
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-create']} onClick={editNext1}>Next: Security Questions</button>
                                <button className={styles['btn-cancel']} onClick={closeEditModal}>Cancel</button>
                            </div>
                        </>
                    )}

                    {editStep === 2 && (
                        <>
                            <p style={{ color:'#6b7280', fontSize:14, marginBottom:15 }}>Update security questions. Select at least 3.</p>
                            <SecurityQuestionsStep prefix="edit" checked={editChecked} setChecked={setEditChecked} answers={editAnswers} setAnswers={setEditAnswers} />
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-cancel']} onClick={() => setEditStep(1)}>Back</button>
                                <button className={styles['btn-create']} onClick={submitEditUser}>Update User</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Edit Admin Modal */}
            <div className={`${styles['modal-overlay']}${editAdminModal ? ' ' + styles['open'] : ''}`}>
                <div className={`${styles['modal-content']} ${styles['wide']}`}>                    <div className={styles['step-indicator']}>
                {[1,2].map(s => <span key={s} className={`${styles['step-dot']} ${editAdminStep === s ? styles['active'] : styles['inactive']}`}>{s}</span>)}
                    </div>
                    <h3>{editAdminStep === 1 ? 'Edit Admin Credentials' : 'Update Security Questions'}</h3>

                    {editAdminStep === 1 && (
                        <>
                            <div style={{ display:'flex', gap:10 }}>
                                <div className={styles['admin-form-group']} style={{ flex:1 }}><label>Name *</label><input type="text" placeholder="Enter full name" value={editAdminForm.name} onChange={e => setEditAdminForm(f => ({ ...f, name: e.target.value }))} /></div>
                                <div className={styles['admin-form-group']} style={{ flex:1 }}><label>Email *</label><input type="email" placeholder="Enter email address" value={editAdminForm.email} onChange={e => setEditAdminForm(f => ({ ...f, email: e.target.value }))} /></div>
                            </div>
                            <div className={styles['admin-form-group']}><label>New Login Password (leave blank to keep current)</label><input type="password" placeholder="Minimum 6 characters" value={editAdminForm.password} onChange={e => setEditAdminForm(f => ({ ...f, password: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Confirm New Login Password</label><input type="password" placeholder="Re-enter password" value={editAdminForm.passwordConfirm} onChange={e => setEditAdminForm(f => ({ ...f, passwordConfirm: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>New Software Password (leave blank to keep current)</label><input type="password" placeholder="Minimum 6 characters" value={editAdminForm.softwarePassword} onChange={e => setEditAdminForm(f => ({ ...f, softwarePassword: e.target.value }))} /></div>
                            <div className={styles['admin-form-group']}><label>Confirm New Software Password</label><input type="password" placeholder="Re-enter software password" value={editAdminForm.softwarePwConfirm} onChange={e => setEditAdminForm(f => ({ ...f, softwarePwConfirm: e.target.value }))} /></div>
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-create']} onClick={editAdminNext1}>Next: Security Questions</button>
                                <button className={styles['btn-cancel']} onClick={() => setEditAdminModal(false)}>Cancel</button>
                            </div>
                        </>
                    )}

                    {editAdminStep === 2 && (
                        <>
                            <p style={{ color:'#6b7280', fontSize:14, marginBottom:15 }}>Update your security questions. Select at least 3.</p>
                            <SecurityQuestionsStep prefix="admin" checked={adminChecked} setChecked={setAdminChecked} answers={adminAnswers} setAnswers={setAdminAnswers} />
                            <div className={styles['modal-buttons']}>
                                <button className={styles['btn-cancel']} onClick={() => setEditAdminStep(1)}>Back</button>
                                <button className={styles['btn-create']} onClick={submitAdminEdit}>Update Admin</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Admin Settings Modal */}
            <div className={`${styles['modal-overlay']}${settingsModal ? ' ' + styles['open'] : ''}`}>
                <div className={`${styles['modal-content']} ${styles['wide']}`}>                    <h3>Edit Admin Personal Info</h3>
                    <div className={styles['admin-form-group']}><label>Business/Shop Name *</label><input type="text" placeholder="Enter shop name" value={settingsForm.shopName} onChange={e => setSettingsForm(f => ({ ...f, shopName: e.target.value }))} /></div>
                    <div className={styles['admin-form-group']}><label>Phone No.</label><input type="text" placeholder="Enter phone number" value={settingsForm.phone} onChange={e => setSettingsForm(f => ({ ...f, phone: e.target.value }))} /></div>
                    <div className={styles['admin-form-group']}><label>City</label><input type="text" placeholder="Enter city" value={settingsForm.city} onChange={e => setSettingsForm(f => ({ ...f, city: e.target.value }))} /></div>
                    <div className={styles['admin-form-group']}><label>Address</label><input type="text" placeholder="Enter shop address" value={settingsForm.address} onChange={e => setSettingsForm(f => ({ ...f, address: e.target.value }))} /></div>
                    <div className={styles['admin-form-group']}>
                        <label>Shop Logo</label>
                        <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                            <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (f) { setSettingsLogo(f); setSettingsPreview(URL.createObjectURL(f)); }}} />
                            {settingsPreview && <img src={settingsPreview} alt="Logo" style={{ maxWidth:100, maxHeight:100, borderRadius:8 }} />}
                        </div>
                    </div>
                    <div className={styles['modal-buttons']}>
                        <button className={styles['btn-create']} onClick={submitSettings}>Save Changes</button>
                        <button className={styles['btn-cancel']} onClick={() => setSettingsModal(false)}>Cancel</button>
                    </div>
                </div>
            </div>

{/* ── Early Renewal Modal */}
<div className={`${styles['modal-overlay']}${earlyRenewModal ? ' ' + styles['open'] : ''}`}>
    <div className={styles['modal-content']}>
        <div className={styles['step-indicator']}>
        {[1, 2].map(s => (
    <span key={s} className={`${styles['step-dot']} ${earlyRenewStep === s ? styles['active'] : styles['inactive']}`}>{s}</span>
))}
        </div>

        {earlyRenewStep === 1 && (
            <>
                <h3>Early License Renewal</h3>
                <p style={{ color: '#6b7280', marginBottom: 20 }}>Enter the gate key to proceed</p>
                <div className={styles['admin-form-group']}>
                    <label>Gate Key *</label>
                    <input
                        type="password"
                        placeholder="Enter gate key"
                        value={earlyRenewGateKey}
                        onChange={e => setEarlyRenewGateKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitEarlyRenewGate()}
                        style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6 }}
                    />
                </div>
                <div className={styles['modal-buttons']} style={{ marginTop: 20 }}>
                    <button className={styles['btn-create']} onClick={submitEarlyRenewGate} disabled={earlyRenewLoading}>
                        {earlyRenewLoading ? 'Verifying...' : 'Verify & Continue'}
                    </button>
                    <button className={styles['btn-cancel']} onClick={() => setEarlyRenewModal(false)}>Cancel</button>
                </div>
            </>
        )}

        {earlyRenewStep === 2 && (
            <>
                <h3>Enter New License Details</h3>
                <p style={{ color: '#6b7280', marginBottom: 20 }}>
                    Remaining days will be carried over and added to the new period.
                </p>
                <div className={styles['admin-form-group']}>
                    <label>License Code *</label>
                    <input
                        type="text"
                        placeholder="e.g. UZ"
                        value={earlyRenewCode}
                        onChange={e => setEarlyRenewCode(e.target.value.toUpperCase())}
                        style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, textTransform: 'uppercase' }}
                    />
                </div>
                <div className={styles['admin-form-group']}>
                    <label>Activation Key *</label>
                    <input
                        type="text"
                        placeholder="Enter activation key"
                        value={earlyRenewKey}
                        onChange={e => setEarlyRenewKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitEarlyRenew()}
                        style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6 }}
                    />
                </div>
                <div className={styles['modal-buttons']} style={{ marginTop: 20 }}>
                    <button className={styles['btn-cancel']} onClick={() => setEarlyRenewStep(1)}>Back</button>
                    <button className={styles['btn-create']} onClick={submitEarlyRenew} disabled={earlyRenewLoading}>
                        {earlyRenewLoading ? 'Renewing...' : 'Renew License'}
                    </button>
                </div>
            </>
        )}
    </div>
</div>
        </div>
    );
}