'use client';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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

function formatPKTime(str) {
    if (!str) return 'N/A';
    // login_time/logout_time are DATETIME written from the server's own local
    // clock, so they are already local wall time — converting them again to
    // Asia/Karachi double-shifted them on any non-Karachi machine.
    const d = new Date(String(str).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatMinutes(min) {
    if (!min) return '0h 0m';
    const h = Math.floor(Math.abs(min) / 60);
    const m = Math.abs(min) % 60;
    return `${h}h ${m}m`;
}

export default function UserPerformancePage() {
    const { id } = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const userName = searchParams.get('name') || 'User';

    const [logs, setLogs]           = useState([]);
    const [stats, setStats]         = useState(null);
    const [pagination, setPagination] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading]     = useState(true);

    async function loadPerformance(page = 1) {
        setLoading(true);
        const res  = await apiFetch(`/api/users/${id}/performance?page=${page}`);
        const data = await res.json();
        if (data.success) {
            setLogs(data.logs);
            setStats(data.stats);
            setPagination(data.pagination);
            setCurrentPage(page);
        }
        setLoading(false);
    }

    useEffect(() => { loadPerformance(1); }, [id]);

    return (
        <div className="container" style={{ margin: '0 auto' }}>
            <div className="container-child main-text" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <h1>Performance Report - {userName}</h1>
                <button onClick={() => router.push('/admin')} style={{ padding:'8px 16px', background:'#e5e7eb', borderRadius:6, color:'#374151', border:'none', cursor:'pointer', fontSize:14 }}>← Back</button>
            </div>
            <div className="container-child sub-text">
                <p>Login/logout history and duty time for this user (last 2 months)</p>
            </div>

            {/* Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, max-content)', gap:15, marginBottom:20 }}>
                <div style={{ background:'#eff6ff', padding:15, borderRadius:8, textAlign:'center', minWidth:140 }}>
                    <div style={{ fontSize:24, fontWeight:700, color:'#3b82f6' }}>{stats ? stats.total_days : '—'}</div>
                    <div style={{ fontSize:12, color:'#6b7280' }}>Total Days</div>
                </div>
                <div style={{ background:'#f3f4f6', padding:15, borderRadius:8, textAlign:'center', minWidth:140 }}>
                    <div style={{ fontSize:24, fontWeight:700, color:'#1f2937' }}>{stats ? formatMinutes(stats.avg_duty) : '—'}</div>
                    <div style={{ fontSize:12, color:'#6b7280' }}>Avg Duty Time</div>
                </div>
            </div>

            <div className="sub-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Login</th>
                            <th>Logout</th>
                            <th>Duty Time</th>
                            <th>Late</th>
                            <th>Early Arrival</th>
                            <th>Overtime</th>
                            <th>Early Departure</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="8" style={{ textAlign:'center', padding:30 }}>
                                <div className="loading-spinner"><div className="spinner" /></div>
                            </td></tr>
                        ) : logs.length === 0 ? (
                            <tr><td colSpan="8" style={{ textAlign:'center', padding:30, color:'#9ca3af' }}>No performance data available</td></tr>
                        ) : logs.map(log => (
                            <tr key={log.id}>
                                <td>{formatDate(log.date)}</td>
                                <td>{formatPKTime(log.login_time)}</td>
                                <td>{log.logout_time ? formatPKTime(log.logout_time) : 'Still logged in'}</td>
                                <td>{formatMinutes(log.duty_minutes)}</td>
                                <td style={{ color: log.late_minutes > 0 ? '#ef4444' : '#10b981' }}>{formatMinutes(log.late_minutes)}</td>
                                <td style={{ color: log.early_minutes > 0 ? '#3b82f6' : '#6b7280' }}>{formatMinutes(log.early_minutes)}</td>
                                <td style={{ color: log.overtime_minutes > 0 ? '#ec4899' : '#6b7280' }}>{formatMinutes(log.overtime_minutes)}</td>
                                <td style={{ color: log.early_departure_minutes > 0 ? '#f59e0b' : '#6b7280' }}>{formatMinutes(log.early_departure_minutes)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Pagination */}
{pagination && pagination.last_page > 1 && (
    <div className="custom-pagination">
        {pagination.on_first_page
            ? <span className="disabled">« First</span>
            : <span onClick={() => loadPerformance(1)}>« First</span>}
        {pagination.on_first_page
            ? <span className="disabled">←</span>
            : <span onClick={() => loadPerformance(currentPage - 1)}>←</span>}

        {(() => {
            const start = Math.max(currentPage - 2, 1);
            const end   = Math.min(currentPage + 2, pagination.last_page);
            const pages = [];
            if (start > 1) pages.push(<span key="dots-start" className="dots">...</span>);
            for (let p = start; p <= end; p++) {
                pages.push(
                    <span
                        key={p}
                        className={p === currentPage ? 'active' : ''}
                        style={{ cursor: p !== currentPage ? 'pointer' : 'default' }}
                        onClick={() => p !== currentPage && loadPerformance(p)}
                    >{p}</span>
                );
            }
            if (end < pagination.last_page) pages.push(<span key="dots-end" className="dots">...</span>);
            return pages;
        })()}

        {pagination.has_more_pages
            ? <span onClick={() => loadPerformance(currentPage + 1)}>→</span>
            : <span className="disabled">→</span>}
        {pagination.has_more_pages
            ? <span onClick={() => loadPerformance(pagination.last_page)}>Last »</span>
            : <span className="disabled">Last »</span>}
    </div>
)}
            </div>
        </div>
    );
}