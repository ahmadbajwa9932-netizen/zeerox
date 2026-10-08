'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ShieldAlert,
    Calendar,
    CalendarX2,
    Clock3,
    Hourglass,
    Unlock,
    RotateCcw,
    Mail,
    Phone,
    Smartphone,
    Loader2,
} from 'lucide-react';

export default function LicenseExpiredPage() {
    const router = useRouter();
    const [license, setLicense] = useState(null);
    const [daysRemaining, setDaysRemaining] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const [infoRes, daysRes] = await Promise.all([
                    fetch('http://localhost:4000/license/info', { credentials: 'include' }),
                    fetch('http://localhost:4000/license/days-remaining', { credentials: 'include' }),
                ]);
                const infoData = await infoRes.json();
                const daysData = await daysRes.json();

                if (infoData.success) setLicense(infoData.data);
                if (daysData.success) setDaysRemaining(daysData.days_remaining);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
    }

    const canRecover = !loading && daysRemaining > 0;

    return (
        <div className="lx-page">
            <div className="lx-card">
                <div className="lx-rail">
                    <div className="lx-icon-ring">
                        <ShieldAlert size={26} strokeWidth={2} />
                    </div>
                    <span className="lx-badge">Access suspended</span>
                    <h1 className="lx-heading">Your license has expired</h1>
                    <p className="lx-message">
                        This system is locked until the license is renewed or recovered.
                        Sales, purchases, and reports are unavailable in the meantime.
                    </p>
                </div>

                <div className="lx-content">
                    <div className="lx-detail-panel">
                        <div className="lx-detail-title">License details</div>

                        <div className="lx-row">
                            <Calendar size={16} strokeWidth={2} />
                            <span className="lx-row-label">Start date</span>
                            <span className="lx-row-value">
                                {license ? formatDate(license.start_date) : '—'}
                            </span>
                        </div>
                        <div className="lx-row">
                            <CalendarX2 size={16} strokeWidth={2} />
                            <span className="lx-row-label">Expiry date</span>
                            <span className="lx-row-value">
                                {license ? formatDate(license.expiry_date) : '—'}
                            </span>
                        </div>
                        <div className="lx-row">
                            <Clock3 size={16} strokeWidth={2} />
                            <span className="lx-row-label">Valid days</span>
                            <span className="lx-row-value">
                                {license ? `${license.valid_days} days` : '—'}
                            </span>
                        </div>
                        <div className="lx-row">
                            <Hourglass size={16} strokeWidth={2} />
                            <span className="lx-row-label">Days remaining</span>
                            <span className="lx-row-value">
                                {loading ? 'Loading…' : `${daysRemaining} days`}
                            </span>
                        </div>
                    </div>

                    <div className="lx-actions">
                        {loading ? (
                            <button className="lx-btn lx-btn-primary" disabled>
                                <Loader2 size={16} className="lx-spin" />
                                Checking license…
                            </button>
                        ) : canRecover ? (
                            <button
                                className="lx-btn lx-btn-amber"
                                onClick={() => router.push('/license/recovery')}
                            >
                                <Unlock size={16} strokeWidth={2} />
                                Recover license
                            </button>
                        ) : (
                            <button
                                className="lx-btn lx-btn-primary"
                                onClick={() => router.push('/license/setup')}
                            >
                                <RotateCcw size={16} strokeWidth={2} />
                                Renew license
                            </button>
                        )}
                    </div>

                    <div className="lx-contact">
                        <div className="lx-contact-title">Need help? Contact the developer</div>

                        <div className="lx-contact-row">
                            <span className="lx-contact-item">
                                <Mail size={15} strokeWidth={2} />
                                <span>support@zeerox.example</span>
                            </span>
                            <span className="lx-dot" />
                            <span className="lx-contact-item">
                                <Phone size={15} strokeWidth={2} />
                                <span>+92 300 1111111</span>
                            </span>
                            <span className="lx-dot" />
                            <span className="lx-contact-item">
                                <Smartphone size={15} strokeWidth={2} />
                                <span>+92 300 0000000</span>
                            </span>
                        </div>
                        <div className="lx-contact-row">
                            <span className="lx-contact-item">
                                <Mail size={15} strokeWidth={2} />
                                <span>sales@zeerox.example</span>
                            </span>
                            <span className="lx-dot" />
                            <span className="lx-contact-item">
                                <Phone size={15} strokeWidth={2} />
                                <span>+92 300 2222222</span>
                            </span>
                            <span className="lx-dot" />
                            <span className="lx-contact-item">
                                <Smartphone size={15} strokeWidth={2} />
                                <span>+92 300 2222222</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .lx-page {
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 32px 16px;
                    background:
                        radial-gradient(circle at 15% 10%, rgba(220, 38, 38, 0.10), transparent 45%),
                        radial-gradient(circle at 85% 90%, rgba(79, 70, 229, 0.10), transparent 45%),
                        #0B1220;
                }
                              .lx-card {
                    width: 100%;
                    max-width: 860px;
                    display: grid;
                    grid-template-columns: 260px 1fr;
                    background: #ffffff;
                    border-radius: 18px;
                    overflow: hidden;
                    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
                }
                @media (max-width: 680px) {
                    .lx-card { grid-template-columns: 1fr; }
                }

                .lx-rail {
                    background: linear-gradient(160deg, #7f1d1d, #dc2626);
                    color: #fff;
                    padding: 32px 28px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .lx-icon-ring {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.15);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 6px;
                }
                .lx-badge {
                    align-self: flex-start;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 4px 10px;
                    border-radius: 999px;
                    background: rgba(255,255,255,0.18);
                }
                .lx-heading {
                    font-size: 21px;
                    font-weight: 700;
                    line-height: 1.3;
                    margin: 4px 0 0 0;
                }
                .lx-message {
                    font-size: 13.5px;
                    line-height: 1.6;
                    color: rgba(255,255,255,0.88);
                    margin: 0;
                }

                .lx-content {
                    padding: 28px 28px 24px 28px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .lx-detail-panel {
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    overflow: hidden;
                }
                .lx-detail-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: #6b7280;
                    padding: 10px 14px;
                    background: #f9fafb;
                    border-bottom: 1px solid #e5e7eb;
                }
                .lx-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 14px;
                    font-size: 13.5px;
                    color: #374151;
                    border-bottom: 1px solid #f3f4f6;
                }
                .lx-row:last-child { border-bottom: none; }
                .lx-row :global(svg) { color: #9ca3af; flex-shrink: 0; }
                .lx-row-label { flex: 1; color: #6b7280; }
                .lx-row-value { font-weight: 600; color: #111827; }

                .lx-actions { display: flex; }
                .lx-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    justify-content: center;
                    width: 100%;
                    padding: 11px 16px;
                    border-radius: 10px;
                    border: none;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: filter 0.15s ease;
                }
                .lx-btn:hover { filter: brightness(0.94); }
                .lx-btn:disabled { cursor: default; opacity: 0.7; }
                .lx-btn-primary { background: #4f46e5; color: #fff; }
                .lx-btn-amber { background: #d97706; color: #fff; }
                .lx-spin { animation: lx-spin 0.9s linear infinite; }
                @keyframes lx-spin { to { transform: rotate(360deg); } }

                .lx-contact {
                    border-top: 1px solid #f0f0f0;
                    padding-top: 16px;
                }
                .lx-contact-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: #6b7280;
                    margin-bottom: 10px;
                }
                           .lx-contact-row {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px;
                    font-size: 12.5px;
                    color: #4b5563;
                    margin-bottom: 6px;
                }
                .lx-contact-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    white-space: nowrap;
                }
                .lx-contact-row :global(svg) { color: #9ca3af; flex-shrink: 0; }
                .lx-dot {
                    width: 3px;
                    height: 3px;
                    border-radius: 50%;
                    background: #d1d5db;
                    margin: 0 2px;
                }
            `}</style>
        </div>
    );
}