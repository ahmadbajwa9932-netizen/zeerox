'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../auth.module.css';

const API = 'http://localhost:4000';  // ← here

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [softwarePassword, setSoftwarePassword] = useState('');
  const [showPassword, setShowPassword]     = useState(false);
  const [showSoftware, setShowSoftware]     = useState(false);

  const [emails, setEmails]                 = useState([]);
  const [dropdownOpen, setDropdownOpen]     = useState(false);

  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [success, setSuccess]               = useState('');
  const [shake, setShake]                   = useState(false);

  const [showSignup, setShowSignup]         = useState(false);

  const dropdownRef = useRef(null);

  // ── Load emails for dropdown ──────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/auth/emails`)
      .then(r => r.json())
      .then(data => setEmails(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // ── Check if admin exists (show Create Admin button if not) ───────
  useEffect(() => {
    fetch(`${API}/api/auth/check-setup`)
      .then(r => r.json())
      .then(data => {
        if (data.hasAdmin === false) setShowSignup(true);
      })
      .catch(() => {});
  }, []);

  // ── Close dropdown on outside click ──────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Shake helper ──────────────────────────────────────────────────
  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  // ── Submit ────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password || !softwarePassword) {
      setError('Please fill in all fields.');
      triggerShake();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, software_password: softwarePassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Invalid credentials.');
        triggerShake();
      } else {
        setSuccess(data.message || 'Login successful!');
        setTimeout(() => router.push('/'), 800);
      }
    } catch {
      setError('Network error. Please try again.');
      triggerShake();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <header className={styles.authHeader}>
        <div className={styles.brandMark}>
          <div className="brand-icon"><img src="/logo/logo.png" width={60} height={60}></img></div>
          <div className={styles.brand}>
          <span className={styles.brandTitle}>ZeeroX - POS System</span>
          <span className={styles.brandSub}>Professional Point of Sale</span>
          </div>
        </div>
      </header>

      <main className={styles.authMain}>
        <div className={`${styles.authCard} ${shake ? styles.shake : ''}`} id="loginCard">
          <h2 className={styles.cardTitle}>Sign in to POS</h2>

          {success && (
            <div className={`${styles.alert} ${styles.success}`}>
              <span className={styles.alertIcon}>✓</span>
              {success}
            </div>
          )}
          {error && (
            <div className={`${styles.alert} ${styles.error}`}>
              <span className={styles.alertIcon}>!</span>
              {error}
            </div>
          )}

          <form className={styles.authForm} onSubmit={handleSubmit}>
            {/* ── Email with dropdown ── */}
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
              <button
                type="button"
                className={styles.emailDropdownBtn}
                onClick={() => setDropdownOpen(o => !o)}
              >
                <span style={{ fontSize: 11 }}><i className="fa fa-chevron-down"></i></span>
              </button>

              {dropdownOpen && emails.length > 0 && (
                <ul className={styles.emailDropdownList} style={{ display: 'block' }}>
                  {emails.map((u, i) => (
                    <li
                      key={i}
                      data-email={u.email}
                      onClick={() => {
                        setEmail(u.email);
                        setDropdownOpen(false);
                      }}
                    >
                      {u.email}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Password ── */}
            <label className={styles.formLabel}>Password</label>
            <div className={styles.passwordRow}>
              <input
                type={showPassword ? 'text' : 'password'}
                className={styles.formInput}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className={`btn-link ${styles.togglePass}`}
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            {/* ── Software Password ── */}
            <label className={styles.formLabel}>Software Password</label>
            <div className={styles.passwordRow}>
              <input
                type={showSoftware ? 'text' : 'password'}
                className={styles.formInput}
                value={softwarePassword}
                onChange={e => setSoftwarePassword(e.target.value)}
                required
              />
              <button
                type="button"
                className={`btn-link ${styles.togglePass}`}
                onClick={() => setShowSoftware(v => !v)}
              >
                {showSoftware ? 'Hide' : 'Show'}
              </button>
            </div>

            {/* ── Remember / Forgot ── */}
            <div className={styles.rememberSection}>
              <Link href="/auth/reset-password">Forgot Password?</Link>
            </div>

            {/* ── Actions ── */}
            <div className={styles.actionsRow}>
              <button
                type="submit"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Login'}
              </button>

              {showSignup && (
                <>
                  <Link href="/auth/signup" className={`${styles.btn} ${styles.btnGhost}`} style={{ textAlign: 'center' }}>
                    Create Admin
                  </Link>
                  <p className={styles.switchLink}>
                    Don&apos;t have an account?{' '}
                    <Link href="/auth/signup">Sign up</Link>
                  </p>
                </>
              )}
            </div>
          </form>
        </div>
      </main>

      <footer className={styles.authFooter}>
        © {new Date().getFullYear()} POS System. All rights reserved.
      </footer>
    </div>
  );
}