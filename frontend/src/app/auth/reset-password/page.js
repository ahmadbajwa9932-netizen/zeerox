'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../auth.module.css';

const API = 'http://localhost:4000';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emails, setEmails] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/auth/emails`)
      .then(r => r.json())
      .then(data => setEmails(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email.');
      setShake(true); setTimeout(() => setShake(false), 500);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/password-reset/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.locked) {
          router.push(`/auth/security-questions?email=${encodeURIComponent(email)}&locked=1&seconds=${data.remaining_seconds}`);
        } else {
          setError(data.message || 'Email not found.');
          setShake(true); setTimeout(() => setShake(false), 500);
        }
      } else {
        router.push(`/auth/security-questions?email=${encodeURIComponent(email)}`);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <header className={styles.authHeader}>
        <div className={styles.brandMark}>
          <div className="brand-icon"><img src="/logo/logo.png" width={60} height={60} /></div>
          <div className={styles.brand}>
            <span className={styles.brandTitle}>ZeeroX - POS System</span>
            <span className={styles.brandSub}>Professional Point of Sale</span>
          </div>
        </div>
      </header>

      <main className={styles.authMain}>
        <div className={`${styles.authCard} ${shake ? styles.shake : ''}`}>
          <h2 className={styles.cardTitle}>Reset Password</h2>
          <p className={styles.cardSubtitle}>Enter your email to continue to security questions</p>

          {error && <div className={`${styles.alert} ${styles.error}`}><span className={styles.alertIcon}>!</span>{error}</div>}

          <form className={styles.authForm} onSubmit={handleSubmit}>
            <label className={styles.formLabel}>Email</label>
            <div className={styles.inputWithDropdown} ref={dropdownRef}>
              <input
                type="text"
                className={styles.formInput}
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
              <button type="button" className={styles.emailDropdownBtn} onClick={() => setDropdownOpen(o => !o)}>
                <i className="fa fa-chevron-down" />
              </button>
              {dropdownOpen && emails.length > 0 && (
                <ul className={styles.emailDropdownList} style={{ display: 'block' }}>
                  {emails.map((u, i) => (
                    <li key={i} onClick={() => { setEmail(u.email); setDropdownOpen(false); }}>{u.email}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.actionsRow}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={loading}>
                {loading ? 'Checking…' : 'Continue to Security Questions'}
              </button>
              <Link href="/auth/login" className={`${styles.btn} ${styles.btnGhost}`} style={{ textAlign: 'center' }}>Back to Login</Link>
            </div>
          </form>
        </div>
      </main>

      <footer className={styles.authFooter}>© {new Date().getFullYear()} POS System. All rights reserved.</footer>
    </div>
  );
}