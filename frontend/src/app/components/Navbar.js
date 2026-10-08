'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, AlertTriangle } from 'lucide-react';
import { useCurrency } from '@/lib/currency-context';
import { usePermissions } from '@/lib/permissions';
import './navbar.css';

export default function Navbar({ onToggleSidebar, collapsed, mini }) {
        const { isBlocked } = usePermissions();
    const { formatPrice } = useCurrency();
    const router = useRouter();
    const [notifOpen, setNotifOpen] = useState(false);
    const [userOpen, setUserOpen] = useState(false);
    const notifRef = useRef(null);
    const userRef = useRef(null);

    const [profileOpen, setProfileOpen] = useState(false);
const [user, setUser] = useState(null);
const [picturePreview, setPicturePreview] = useState(null);
const fileInputRef = useRef(null);
const [shopName, setShopName] = useState(null);

// --- Notifications ---
const [notifications, setNotifications] = useState([]);
const alarmRef = useRef(null);

// --- Edit Due Date modal ---
const [editDueDateOpen, setEditDueDateOpen] = useState(false);
const [editDueDateTarget, setEditDueDateTarget] = useState(null);
const [newDueDate, setNewDueDate] = useState('');

// --- Set Reminder modal ---
const [reminderModalOpen, setReminderModalOpen] = useState(false);
const [reminderTarget, setReminderTarget] = useState(null);
const [reminderDatetime, setReminderDatetime] = useState('');

// --- Triggered reminder alert (queued, in case multiple fire at once) ---
const [reminderQueue, setReminderQueue] = useState([]);
const [activeReminder, setActiveReminder] = useState(null);

useEffect(() => {
    fetch('http://localhost:4000/api/auth/me', { credentials: 'include' })
        .then(r => r.json())
        .then(data => { if (data.success) setUser(data.user); })
        .catch(() => {});
}, []);

useEffect(() => {
    fetch('http://localhost:4000/api/auth/shop-name')
        .then(r => r.json())
        .then(data => { if (data.success) setShopName(data.shop_name); })
        .catch(() => {});
}, []);

// Fetch credit-sale notifications + poll every 15s
const fetchNotifications = () => {
    fetch('http://localhost:4000/api/navbar/credit-sales-notifications', { credentials: 'include' })
        .then(r => r.json())
        .then(data => setNotifications(Array.isArray(data) ? data : []))
        .catch(() => {});
};

useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
}, []);

// Check + queue due reminders every 30s
useEffect(() => {
    const checkReminders = () => {
        fetch('http://localhost:4000/api/navbar/check-reminders', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (data.success && data.reminders.length > 0) {
                    setReminderQueue(prev => [...prev, ...data.reminders]);
                }
            })
            .catch(() => {});
    };
    const initial = setTimeout(checkReminders, 5000);
    const interval = setInterval(checkReminders, 30000);
    return () => { clearTimeout(initial); clearInterval(interval); };
}, []);

// Pop next reminder from queue once the current one is dismissed
useEffect(() => {
    if (!activeReminder && reminderQueue.length > 0) {
        setActiveReminder(reminderQueue[0]);
        setReminderQueue(prev => prev.slice(1));
    }
}, [activeReminder, reminderQueue]);

// Play alarm whenever a new reminder becomes active
useEffect(() => {
    if (activeReminder && alarmRef.current) {
        fetch('/audio/audio.wav')
            .then(res => res.blob())
            .then(blob => {
                const url = URL.createObjectURL(blob);
                alarmRef.current.src = url;
                alarmRef.current.loop = true;
                alarmRef.current.volume = 0.7;
                return alarmRef.current.play();
            })
            .catch((err) => {
                console.error('Alarm play blocked:', err);
            });
    }
}, [activeReminder]);

// Navbar keyboard shortcuts: Ctrl+Alt+S / P / N
useEffect(() => {
    function handleShortcut(e) {
        if (!e.ctrlKey || !e.altKey || e.shiftKey) return;
        const map = {
            s: '.navbar-setting-button',
            p: '.navbar-profile-button',
            n: '.navbar-notification-button',
        };
        const selector = map[e.key.toLowerCase()];
        if (!selector) return;
        e.preventDefault();
        document.querySelector(selector)?.click();
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
}, []);

async function handlePictureChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => setPicturePreview(ev.target.result);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('profile_picture', file);
    const res = await fetch('http://localhost:4000/api/auth/profile-picture', {
        method: 'POST',
        credentials: 'include',
        body: formData,
    });
    const data = await res.json();
    if (data.success) {
        setUser(prev => ({ ...prev, profile_picture: data.path }));
    }
}

async function handleLogout() {
    const confirmed = window.confirm('Are you sure you want to logout?');
    if (!confirmed) return;
    await fetch('http://localhost:4000/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
    });
    window.location.href = '/auth/login';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
}

function openSetReminderModal(item) {
    setReminderTarget(item);
    setReminderDatetime('');
    setReminderModalOpen(true);
}

async function submitReminder(e) {
    e.preventDefault();
    if (!reminderDatetime || new Date(reminderDatetime) <= new Date()) {
        alert('Please select a future date and time');
        return;
    }
    try {
        const res = await fetch('http://localhost:4000/api/navbar/credit-sale-reminders', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sale_id: reminderTarget.sale_id,
                voucher_no: reminderTarget.voucher_no,
                customer_name: reminderTarget.customer_name,
                contact: reminderTarget.contact,
                remaining_balance: reminderTarget.remaining_balance,
                reminder_datetime: reminderDatetime,
            }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to set reminder');
        setReminderModalOpen(false);
        alert('Reminder has been set successfully!');
    } catch (err) {
        alert(err.message || 'Failed to set reminder. Please try again.');
    }
}

function openEditDueDateModal(item) {
    setEditDueDateTarget(item);
    setNewDueDate('');
    setEditDueDateOpen(true);
}

async function submitEditDueDate(e) {
    e.preventDefault();
    if (!newDueDate || new Date(newDueDate) <= new Date()) {
        alert('Cannot set a past date or time. Please select a future date and time.');
        return;
    }
    try {
        const res = await fetch(`http://localhost:4000/api/sales/${editDueDateTarget.sale_id}/update-due-date`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_due_date: newDueDate }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to update due date');
        setEditDueDateOpen(false);
        fetchNotifications();
        alert('Due date updated successfully!');
    } catch (err) {
        alert(err.message || 'Failed to update due date. Please try again.');
    }
}

function dismissReminder() {
    if (alarmRef.current) {
        alarmRef.current.pause();
        alarmRef.current.currentTime = 0;
        alarmRef.current.loop = false;
        if (alarmRef.current.src?.startsWith('blob:')) {
            URL.revokeObjectURL(alarmRef.current.src);
        }
    }
    setActiveReminder(null);
}

    // Close dropdowns when clicking outside
    useEffect(() => {
        function handleClickOutside(e) {
            if (notifRef.current && !notifRef.current.contains(e.target)) {
                setNotifOpen(false);
            }
            if (userRef.current && !userRef.current.contains(e.target)) {
                setUserOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
<div className={`navbar${collapsed ? ' sidebar-collapsed' : ''}${mini ? ' sidebar-mini' : ''}`}>
<audio ref={alarmRef} preload="none" />
    
                {/* Left - Hamburger */}
            <div className="navbar-left">
                <i
                    className="fa-solid fa-bars menu-icon"
                    onClick={onToggleSidebar}
                ></i>
            </div>

            {/* Center - Shop Name */}
            <div className="navbar-shop-name">
            <h2>{shopName || 'POS SYSTEM'}</h2>
            </div>

            {/* Right - Icons */}
            <div className="navbar-user-icons">

                {/* Notifications Dropdown */}
                <div className="navbar-dropdown-wrapper" ref={notifRef}>
                    <button
                        className="navbar-icon-btn navbar-notification-button"
                        onClick={() => {
                            setNotifOpen(!notifOpen);
                            setUserOpen(false);
                        }}
                    >
                        <i className="fa-solid fa-bell"></i>
                        <span
                            className="navbar-notification-count"
                            style={{ display: notifications.length > 0 ? 'block' : 'none' }}
                        >
                            {notifications.length}
                        </span>
                    </button>
                    <div className={`navbar-dropdown-menu${notifOpen ? ' show' : ''}`}>
                        <div className="navbar-dropdown-header">Notifications</div>
                        <div className="navbar-dropdown-content">
                            {notifications.length === 0 ? (
                                <div className="navbar-empty-state">
                                    <i className="fa-solid fa-bell-slash"></i>
                                    <div>No notifications</div>
                                </div>
                            ) : (
                                notifications.map(item => {
                                    const days = item.days_difference;
                                    let statusText, statusClass;
                                    if (days < 0) {
                                        statusText = `Overdue by ${Math.abs(days)} day(s)`;
                                        statusClass = 'overdue';
                                    } else if (days === 0) {
                                        statusText = 'Due Today';
                                        statusClass = 'overdue';
                                    } else {
                                        statusText = `Due in ${days} day(s)`;
                                        statusClass = 'upcoming';
                                    }
                                    return (
                                        <div key={item.sale_id} className={`navbar-notification-item ${statusClass}`}>
                                            <div className="navbar-notif-header">
                                                <span className="navbar-notif-name">
                                                    <i className="fa-solid fa-user"></i>
                                                    {item.customer_name}
                                                </span>
                                                <span className={`navbar-notif-status ${statusClass}`}>{statusText}</span>
                                            </div>
                                            <div className="navbar-notif-details">
                                                <div className="navbar-notif-detail-item"><i className="fa-solid fa-city"></i> {item.city || 'N/A'}</div>
                                                <div className="navbar-notif-detail-item"><i className="fa-solid fa-shop"></i> {item.shop_name || 'N/A'}</div>
                                                <div className="navbar-notif-detail-item"><i className="fa-solid fa-phone"></i> {item.contact || 'N/A'}</div>
                                                <div className="navbar-notif-detail-item"><i className="fa-solid fa-coins"></i> {formatPrice(item.remaining_balance)}</div>
                                                <div className="navbar-notif-detail-item"><i className="fa-solid fa-calendar-day"></i> {formatDate(item.due_date)}</div>
                                            </div>
                                            <div className="navbar-notif-actions">
                                                <button className="navbar-reminder-btn" onClick={() => openSetReminderModal(item)}>
                                                    <i className="fa-solid fa-bell"></i> Set Reminder
                                                </button>
                                                {!isBlocked('sales.credit.act.edit-due-date') && (
                                                   <button
                                                   className="navbar-reminder-btn"
                                                   style={{ background: 'rgb(27,42,65)' }}
                                                   onClick={() => openEditDueDateModal(item)}
                                               >
                                                   <i className="fa-solid fa-pen-to-square"></i> Edit Due Date
                                               </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* User Dropdown */}
                <div className="navbar-dropdown-wrapper" ref={userRef}>
                    <button
                        className="navbar-icon-btn"
                        onClick={() => {
                            setUserOpen(!userOpen);
                            setNotifOpen(false);
                        }}
                    >
                        <i className="fa-solid fa-user"></i>
                    </button>
                    <div className={`navbar-dropdown-menu navbar-user-dropdown${userOpen ? ' show' : ''}`}>
                        <div className="navbar-dropdown-header">
                            <i className="fa-solid fa-user-circle"></i> Admin
                        </div>
                        <div className="navbar-dropdown-content">
                        <div className="navbar-user-menu-item">
    <a
        href="#"
        className="navbar-profile-button"
        onClick={(e) => { e.preventDefault(); setProfileOpen(true); setUserOpen(false); }}
    >
        Profile
    </a>
</div>
                            <div className="navbar-user-menu-item">
                            <button type="button" onClick={handleLogout}>Logout</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Settings Icon */}
               {/* Settings Icon */}
<button
    className="navbar-icon-btn navbar-setting-button"
    onClick={() => router.push('/settings')}
>
    <i className="fa-solid fa-cog"></i>
</button>
            </div>
            {profileOpen && user && (
    <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
        <div style={{
            background: '#fff', borderRadius: '12px', padding: '30px',
            width: '420px', maxWidth: '90vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
        }}>
            <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '18px' }}>My Profile</h2>

            {/* Avatar */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div
                    onClick={() => fileInputRef.current.click()}
                    style={{
                        width: '90px', height: '90px', borderRadius: '50%',
                        border: '2px solid #667eea', margin: '0 auto', cursor: 'pointer',
                        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#f0f0f0'
                    }}
                >
                   {picturePreview ? (
    <img src={picturePreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
) : user.profile_picture ? (
    <img src={`http://localhost:4000/public/${user.profile_picture}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
) : (
    <i className="fa-solid fa-user" style={{ fontSize: '36px', color: '#aaa' }}></i>
)}
                </div>
                <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handlePictureChange} />
                <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>Click to upload/change picture</p>
            </div>

            {/* Fields */}
            {[
                { label: 'Name', value: user.name },
                { label: 'Email', value: user.email },
                { label: 'Role', value: user.role === 'admin' ? 'Admin' : 'User' },
                ...(user.role !== 'admin' ? [
                    { label: 'Shift Start', value: user.shift_start || '--:--' },
                    { label: 'Shift End', value: user.shift_end || '--:--' },
                ] : []),
            ].map(f => (
                <div key={f.label} style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>{f.label}:</label>
                    <input readOnly value={f.value || ''} style={{
                        width: '100%', padding: '8px 12px', border: '1px solid #ddd',
                        borderRadius: '6px', fontSize: '14px', background: '#f9f9f9', boxSizing: 'border-box'
                    }} />
                </div>
            ))}

            <button
                onClick={() => { setProfileOpen(false); setPicturePreview(null); }}
                style={{
                    width: '100%', padding: '10px', background: '#667eea',
                    color: '#fff', border: 'none', borderRadius: '6px',
                    fontSize: '14px', cursor: 'pointer', marginTop: '6px'
                }}
            >
                Close
            </button>
        </div>
    </div>
)}

{editDueDateOpen && editDueDateTarget && (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ marginBottom: '20px', color: '#333' }}>Edit Due Date</h3>
            <form onSubmit={submitEditDueDate}>
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Customer:</label>
                    <input type="text" readOnly value={editDueDateTarget.customer_name} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                </div>
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Current Due Date:</label>
                    <input type="text" readOnly value={formatDate(editDueDateTarget.due_date)} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', background: '#f5f5f5' }} />
                </div>
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>New Due Date:</label>
                    <input
                        type="datetime-local"
                        required
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                        style={{ width: '100%', padding: '10px', border: '2px solid #ddd', borderRadius: '6px' }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setEditDueDateOpen(false)} style={{ padding: '10px 20px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" style={{ padding: '10px 20px', background: 'rgb(44, 75, 212)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Update</button>
                </div>
            </form>
        </div>
    </div>
)}

{reminderModalOpen && reminderTarget && (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '450px', width: '90%' }}>
            <h3 style={{ marginBottom: '15px', color: '#333' }}>Set Reminder</h3>
            <p style={{ marginBottom: '8px', fontWeight: 'bold' }}>Customer: {reminderTarget.customer_name}</p>
            <p style={{ marginBottom: '8px', fontWeight: 'bold' }}>Contact: {reminderTarget.contact || 'N/A'}</p>
            <p style={{ marginBottom: '8px' }}>Invoice No: {reminderTarget.voucher_no}</p>
            <p style={{ marginBottom: '15px' }}>Balance: {formatPrice(reminderTarget.remaining_balance)}</p>
            <form onSubmit={submitReminder}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Select Date & Time:</label>
                <input
                    type="datetime-local"
                    required
                    value={reminderDatetime}
                    onChange={(e) => setReminderDatetime(e.target.value)}
                    min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    style={{ width: '100%', padding: '10px', border: '2px solid #ddd', borderRadius: '6px', marginBottom: '20px' }}
                />
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setReminderModalOpen(false)} style={{ padding: '10px 20px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" style={{ padding: '10px 20px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Set Reminder</button>
                </div>
            </form>
        </div>
    </div>
)}

{activeReminder && (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '12px', maxWidth: '450px', width: '90%' }}>
        <h3 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
    <Bell size={20} color="#667eea" /> Payment Reminder!
</h3>
            <p style={{ marginBottom: '10px' }}><strong>Customer:</strong> {activeReminder.customer_name}</p>
            <p style={{ marginBottom: '10px' }}><strong>Contact:</strong> {activeReminder.contact}</p>
            <p style={{ marginBottom: '10px' }}><strong>Invoice No:</strong> {activeReminder.voucher_no}</p>
            <p style={{ marginBottom: '15px' }}><strong>Remaining Balance:</strong> {formatPrice(activeReminder.remaining_balance)}</p>
            <p style={{ fontSize: '14px', color: '#e74c3c', fontWeight: 'bold', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
    <AlertTriangle size={16} /> Time to collect payment!
</p>
            <button
                onClick={dismissReminder}
                style={{ width: '100%', padding: '10px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
                Got It!
            </button>
        </div>
    </div>
)}
        </div>
    );
}