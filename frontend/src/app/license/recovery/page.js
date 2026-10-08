'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '../license.css';

export default function LicenseRecoveryPage() {
    const router = useRouter();
    const [activationKey, setActivationKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showCascade, setShowCascade] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('http://localhost:4000/license/recovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ activation_key: activationKey }),
            });

            const data = await res.json();

            if (data.success) {
                router.push(data.redirect || '/auth/login');
            } else {
                if (data.show_error_cascade) {
                    setShowCascade(true);
                } else {
                    setError(data.message || 'Invalid activation key');
                }
            }
        } catch (err) {
            setError('Connection error. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
    <div className="auth-page">
        <header className="auth-header">
        <div className="brand-mark">
          <div className="brand-icon"><img src="/logo/logo.png" width={60} height={60}></img></div>
          <div className="brand">
          <span className="brand-title">ZeeroX - POS System</span>
          <span className="brand-sub">Professional Point of Sale</span>
          </div>
        </div>
      </header>
      <main className="auth-main">
            <div className="auth-card">
                {error && <div className="alert error">{error}</div>}

                <form onSubmit={handleSubmit} className="auth-form">
                    <input
                        type="password"
                        name="activation_key"
                        className="form-input"
                        value={activationKey}
                        onChange={e => setActivationKey(e.target.value)}
                        required
                        autoComplete="off"
                    />

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '20px' }}
                        disabled={loading}
                    >
                        {loading ? 'Recovering...' : 'Recover License'}
                    </button>
                </form>
            </div>
            </main>

            {showCascade && <ErrorCascade onDone={() => setShowCascade(false)} />}
                </div>
        </>
    );
}

function ErrorCascade({ onDone }) {
    const [dialogs, setDialogs] = useState(() =>
        Array.from({ length: 20 }, (_, i) => ({ id: i, x: i * 10, y: i * 10, visible: true }))
    );

    function closeDialog(id) {
        setDialogs(prev => {
            const updated = prev.map(d => d.id === id ? { ...d, visible: false } : d);
            if (updated.every(d => !d.visible)) onDone();
            return updated;
        });
    }

    return (
        <div className="windows-error-overlay" style={{ display: 'block' }}>
            {dialogs.map(d =>
                d.visible ? (
                    <div
                        key={d.id}
                        className="windows-error-dialog"
                        style={{
                            left: `calc(50% - 200px + ${d.x}px)`,
                            top:  `calc(50% - 100px + ${d.y}px)`,
                        }}
                    >
                        <div className="windows-error-titlebar">
                            <span>Initialization Error</span>
                        </div>
                        <div className="windows-error-content">
                            <div className="error-icon" />
                            <div className="error-message">
                                Warning{'\n\n'}A potential security threat detected. Your system might be under attack. Please shut down your system within 3 minutes.
                            </div>
                        </div>
                        <div className="windows-error-footer">
                            <button className="windows-ok-button" onClick={() => closeDialog(d.id)}>
                                OK
                            </button>
                        </div>
                    </div>
                ) : null
            )}
        </div>
    );
}