'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../auth.module.css';

const API = 'http://localhost:4000';

const SECURITY_QUESTIONS = [
  "What is your father's date of birth?",
  "What is the name of your favorite teacher?",
  "What was your childhood nickname?",
  "Which person do you admire most as a hero?",
  "What is the name of your primary school?",
  "Which essay did you like the most during your education?",
  "What is your favorite food?",
];

export default function SignupPage() {
  const router = useRouter();

  // ── Step tracking ──
  const [step, setStep] = useState(1);

  // ── Step 1 fields ──
  const [fields, setFields] = useState({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
    software_password: '',
    software_password_confirmation: '',
  });

  // ── Visibility toggles ──
  const [show, setShow] = useState({
    password: false,
    password_confirmation: false,
    software_password: false,
    software_password_confirmation: false,
  });

  // ── Step 2: security questions ──
  const [selected, setSelected] = useState({}); // { index: true/false }
  const [answers, setAnswers]   = useState({}); // { index: 'answer' }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  // ── Submission state ──
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  function handleChange(e) {
    setFields(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function toggleShow(field) {
    setShow(prev => ({ ...prev, [field]: !prev[field] }));
  }

  // ── Step 1 → Step 2 ──
  function goNext() {
    setError('');
    const { name, email, password, password_confirmation, software_password, software_password_confirmation } = fields;

    if (!name || !email || !password || !password_confirmation || !software_password || !software_password_confirmation) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== password_confirmation) {
      setError('Passwords do not match.');
      return;
    }
    if (software_password !== software_password_confirmation) {
      setError('Software passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (software_password.length < 6) {
      setError('Software password must be at least 6 characters.');
      return;
    }

    setStep(2);
    setError('');
  }

  function goBack() {
    setStep(1);
    setError('');
  }

  function toggleQuestion(idx) {
    setSelected(prev => {
      const next = { ...prev, [idx]: !prev[idx] };
      return next;
    });
    if (selected[idx]) {
      setAnswers(prev => { const n = { ...prev }; delete n[idx]; return n; });
    }
  }

  function setAnswer(idx, val) {
    setAnswers(prev => ({ ...prev, [idx]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (selectedCount < 3) {
      setError('Please select and answer at least 3 security questions.');
      return;
    }

    const unanswered = Object.keys(selected).filter(
      idx => selected[idx] && !answers[idx]?.trim()
    );
    if (unanswered.length > 0) {
      setError('Please provide answers for all selected questions.');
      return;
    }

    const security_questions = Object.keys(selected)
      .filter(idx => selected[idx])
      .map(idx => ({
        question: SECURITY_QUESTIONS[parseInt(idx)],
        answer: answers[idx].trim(),
      }));

    setLoading(true);

    try {
      const res = await fetch(`${API}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...fields, security_questions }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Something went wrong.');
      } else {
        setSuccess(data.message || 'Account created!');
        setTimeout(() => { window.location.href = '/auth/login'; }, 1200);
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
          <div className="brand-icon"><img src="/logo/logo.png" width={60} height={60}></img></div>
          <div className={styles.brand}>
          <span className={styles.brandTitle}>ZeeroX - POS System</span>
          <span className={styles.brandSub}>Professional Point of Sale</span>
          </div>
        </div>
      </header>

      <main className={styles.authMain}>
        <div className={styles.authCard}>
          {/* Step indicator */}
          <div className={styles.steps}>
            <div className={`${styles.stepDot} ${step === 1 ? styles.active : 'done'}`}>
              {step > 1 ? '✓' : '1'}
            </div>
            <div className={`step-line ${step > 1 ? 'done' : ''}`} />
            <div className={`${styles.stepDot} ${step === 2 ? styles.active : ''}`}>2</div>
          </div>

          <p className="card-eyebrow">
            {step === 1 ? '' : ''}
          </p>
          <h1 className={styles.cardTitle}>
            {step === 1 ? 'Create Admin Account' : 'Security Questions'}
          </h1>
          <p className={styles.cardSubtitle}>
            {step === 1
              ? 'Set up the primary administrator account'
              : 'Select and answer at least 3 questions for password recovery'}
          </p>

          {error   && <div className={`${styles.alert} ${styles.error}`}>{error}</div>}
          {success && <div className={`${styles.alert} ${styles.success}`}>{success}</div>}

          <form onSubmit={handleSubmit}>

            {/* ─── STEP 1 ─── */}
            {step === 1 && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Full Name</label>
                  <input
                    className={styles.formInput}
                    type="text"
                    name="name"
                    value={fields.name}
                    onChange={handleChange}
                    autoFocus
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Email</label>
                  <input
                    className={styles.formInput}
                    type="email"
                    name="email"
                    value={fields.email}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      className={styles.formInput}
                      type={show.password ? 'text' : 'password'}
                      name="password"
                      value={fields.password}
                      onChange={handleChange}
                      required
                    />
                    <button type="button" className={`btn-link ${styles.togglePass}`} onClick={() => toggleShow('password')}>
                      {show.password ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Confirm Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      className={styles.formInput}
                      type={show.password_confirmation ? 'text' : 'password'}
                      name="password_confirmation"
                      value={fields.password_confirmation}
                      onChange={handleChange}
                      required
                    />
                    <button type="button" className={`btn-link ${styles.togglePass}`} onClick={() => toggleShow('password_confirmation')}>
                      {show.password_confirmation ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Software Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      className={styles.formInput}
                      type={show.software_password ? 'text' : 'password'}
                      name="software_password"
                      value={fields.software_password}
                      onChange={handleChange}
                      required
                    />
                    <button type="button" className={`btn-link ${styles.togglePass}`} onClick={() => toggleShow('software_password')}>
                      {show.software_password ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Confirm Software Password</label>
                  <div className={styles.passwordRow}>
                    <input
                      className={styles.formInput}
                      type={show.software_password_confirmation ? 'text' : 'password'}
                      name="software_password_confirmation"
                      value={fields.software_password_confirmation}
                      onChange={handleChange}
                      required
                    />
                    <button type="button" className={`btn-link ${styles.togglePass}`} onClick={() => toggleShow('software_password_confirmation')}>
                      {show.software_password_confirmation ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={goNext}
                  style={{ marginTop: '25px' }}
                >
                  Next →
                </button>

                <p className={styles.switchLink}>
                  Already have an account?{' '}
                  <Link href="/auth/login" className="auth-link">Login</Link>
                </p>
              </>
            )}

            {/* ─── STEP 2 ─── */}
            {step === 2 && (
              <>
                <div className={`${styles.sqCounter} ${selectedCount < 3 ? styles.warn : ''}`}>
                  Selected: {selectedCount} / {SECURITY_QUESTIONS.length} &nbsp;(minimum 3)
                </div>

                <div className={styles.sqScroll}>
                  {SECURITY_QUESTIONS.map((q, idx) => (
                    <div
                      key={idx}
                      className={`${styles.sqItem} ${selected[idx] ? 'selected' : ''}`}
                    >
                      <div className={styles.sqCheck}>
                        <input
                          type="checkbox"
                          id={`q${idx}`}
                          checked={!!selected[idx]}
                          onChange={() => toggleQuestion(idx)}
                        />
                        <label htmlFor={`q${idx}`}>{q}</label>
                      </div>

                      <div className={`${styles.sqAnswer} ${selected[idx] ? styles.active : ''}`}>
                        <input
                          type="text"
                          placeholder="Your answer"
                          value={answers[idx] || ''}
                          onChange={e => setAnswer(idx, e.target.value)}
                          disabled={!selected[idx]}
                          required={!!selected[idx]}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.btnRow}>
                  <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={goBack}>
                    ← Back
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={loading}>
                    {loading ? 'Creating…' : 'Create Admin'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      </main>

      <footer className={styles.authFooter}>
        © {new Date().getFullYear()} POS System. All rights reserved.
      </footer>
    </div>
  );
}