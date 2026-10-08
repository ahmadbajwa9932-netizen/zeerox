'use client';

import { useState, useEffect, useRef, Suspense  } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from '../auth.module.css';

const API = 'http://localhost:4000';

function SecurityQuestionsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') || '';

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [incorrectIndices, setIncorrectIndices] = useState([]);

  // Lockout
  const [locked, setLocked] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const timerRef = useRef(null);

  // Password modal
  const [showModal, setShowModal] = useState(false);
  const [idPassword, setIdPassword] = useState('');
  const [softwarePassword, setSoftwarePassword] = useState('');

  // Load questions on mount
  useEffect(() => {
    if (!email) { router.push('/auth/reset-password'); return; }

    // Check if redirected as locked
    const isLocked = params.get('locked');
    const seconds = parseInt(params.get('seconds') || '0');
    if (isLocked && seconds > 0) {
      setLocked(true);
      setLockSeconds(seconds);
      setLoading(false);
      startTimer(seconds);
      return;
    }

    fetch(`${API}/api/auth/password-reset/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.locked) {
          setLocked(true);
          setLockSeconds(data.remaining_seconds);
          startTimer(data.remaining_seconds);
        } else if (data.success) {
          setQuestions(data.questions);
        } else {
          router.push('/auth/reset-password');
        }
      })
      .catch(() => router.push('/auth/reset-password'))
      .finally(() => setLoading(false));
  }, []);

  function startTimer(seconds) {
    let s = seconds;
    timerRef.current = setInterval(() => {
      s--;
      setLockSeconds(s);
      if (s <= 0) {
        clearInterval(timerRef.current);
        window.location.reload();
      }
    }, 1000);
  }

  useEffect(() => () => clearInterval(timerRef.current), []);

  function formatTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIncorrectIndices([]);
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/api/auth/password-reset/verify-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answers }),
      });
      const data = await res.json();

      if (data.success) {
        setIdPassword(data.idPassword);
        setSoftwarePassword(data.softwarePassword);
        setShowModal(true);
      } else if (data.locked) {
        setLocked(true);
        setLockSeconds(data.remaining_seconds);
        startTimer(data.remaining_seconds);
      } else {
        setError(data.message || 'Incorrect answers.');
        setIncorrectIndices(data.incorrect_indices || []);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return (
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
      <main className={styles.authMain}><div className={styles.authCard}><p style={{textAlign:'center',color:'#6b7280'}}>Loading…</p></div></main>
    </div>
  );

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
        <div className={styles.authCard}>
          <h2 className={styles.cardTitle}>Answer Security Questions</h2>
          <p className={styles.cardSubtitle}>Answer the questions you set during registration</p>

          {/* Lockout Timer */}
          {locked && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className={`${styles.alert} ${styles.error}`} style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <strong>Account Locked</strong>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, margin: '8px 0' }}>{formatTime(lockSeconds)}</span>
                <p style={{ fontSize: 13 }}>Please wait before trying again.</p>
              </div>
              <Link href="/auth/login" className={`${styles.btn} ${styles.btnGhost}`} style={{ textAlign: 'center' }}>Back to Login</Link>
            </div>
          )}

          {/* Form */}
          {!locked && (
            <>
              {error && (
                <div className={`${styles.alert} ${styles.error}`}>
                  <span className={styles.alertIcon}>!</span>
                  <span>{error}</span>
                </div>
              )}

              <form className={styles.authForm} onSubmit={handleSubmit}>
                {questions.map((qa, idx) => (
                  <div
                    key={idx}
                    className={styles.questionItem}
                    style={{ borderColor: incorrectIndices.includes(idx) ? '#ef4444' : '#e5e7eb', borderWidth: 2 }}
                  >
                    <label className={styles.formLabel} style={{ marginBottom: 8 }}>{qa.question}</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Your answer"
                      value={answers[idx] || ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                      required
                    />
                  </div>
                ))}

                <div className={styles.actionsRow}>
                  <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
                    {submitting ? 'Verifying…' : 'Verify Answers'}
                  </button>
                  <Link href="/auth/login" className={`${styles.btn} ${styles.btnGhost}`} style={{ textAlign: 'center' }}>Back to Login</Link>
                </div>
              </form>
            </>
          )}
        </div>
      </main>

      {/* Password Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: 'white', padding: 30, borderRadius: 12,
            maxWidth: 450, width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', textAlign: 'center'
          }}>
            <h3 style={{ color: '#10b981', marginBottom: 20, fontSize: 20 }}>✓ Your Passwords</h3>
            <p style={{ color: '#6b7280', marginBottom: 16 }}>Here are your recovered passwords:</p>

            <div style={{
              background: '#f3f4f6', padding: '16px 20px', borderRadius: 8,
              border: '2px solid #3b82f6', marginBottom: 12,
              display: 'flex', flexDirection: 'column', gap: 4
            }}>
              <span style={{ color: '#229954', fontSize: 13, fontWeight: 700 }}>ID Password</span>
              <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: 2, color: '#1f2937' }}>
                {idPassword}
              </span>
            </div>

            <div style={{
              background: '#f3f4f6', padding: '16px 20px', borderRadius: 8,
              border: '2px solid #3b82f6', marginBottom: 20,
              display: 'flex', flexDirection: 'column', gap: 4
            }}>
              <span style={{ color: '#229954', fontSize: 13, fontWeight: 700 }}>Software Password</span>
              <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: 2, color: '#1f2937' }}>
                {softwarePassword}
              </span>
            </div>

            <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
              Please save these passwords and use them to login.
            </p>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => router.push('/auth/login')}>
              Go to Login
            </button>
          </div>
        </div>
      )}

      <footer className={styles.authFooter}>© {new Date().getFullYear()} POS System. All rights reserved.</footer>
    </div>
  );
}

export default function SecurityQuestionsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SecurityQuestionsContent />
    </Suspense>
  );
}