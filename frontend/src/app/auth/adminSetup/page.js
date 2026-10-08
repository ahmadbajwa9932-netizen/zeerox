'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../auth.module.css';
const API = 'http://localhost:4000';

export default function AdminSetupPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  const [fields, setFields] = useState({
    shop_name: '',
    phone: '',
    address: '',
    city: '',
  });
  const [logoFile, setLogoFile]   = useState(null);
  const [logoName, setLogoName]   = useState('No file chosen');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  function handleChange(e) {
    setFields(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoName(file.name);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!fields.shop_name.trim()) {
      setError('Business / shop name is required.');
      return;
    }

    setLoading(true);

    try {
      let res;

      if (logoFile) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('logo', logoFile);
        res = await fetch(`${API}/api/auth/admin-setup-with-logo`, {
          method: 'POST',
          body: fd,
        });
      } else {
        res = await fetch(`${API}/api/auth/admin-setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Something went wrong.');
      } else {
        setSuccess(data.message || 'Settings saved!');
        setTimeout(() => { window.location.href = '/auth/signup'; }, 1000);
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
          <h1 className={styles.cardTitle}>Configure Shop Setting</h1>
          <p className={styles.cardSubtitle}>Set up your shop information (One time setup)</p>

          {error   && <div className={`${styles.alert} ${styles.error}`}>{error}</div>}
          {success && <div className={`${styles.alert} ${styles.success}`}>{success}</div>}

          <form onSubmit={handleSubmit}>
            {/* Shop Name */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Business / Shop Name <span className={styles.req}>*</span>
              </label>
              <input
                className={styles.formInput}
                type="text"
                name="shop_name"
                value={fields.shop_name}
                onChange={handleChange}
                autoFocus
                required
              />
            </div>

            {/* Phone */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Phone Number</label>
              <input
                className={styles.formInput}
                type="text"
                name="phone"
                value={fields.phone}
                onChange={handleChange}
              />
            </div>

            {/* Address */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Address</label>
              <input
                className={styles.formInput}
                type="text"
                name="address"
                value={fields.address}
                onChange={handleChange}
              />
            </div>

            {/* City */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>City</label>
              <input
                className={styles.formInput}
                type="text"
                name="city"
                value={fields.city}
                onChange={handleChange}
              />
            </div>

            {/* Logo */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Shop Logo</label>
              <div className={styles.fileUpload}>
                <input
                  ref={fileInputRef}
                  type="file"
                  id="logo"
                  accept="image/*"
                  onChange={handleFile}
                />
                <label htmlFor="logo" className={styles.fileBtn}>
                  Choose Logo
                </label>
                <span className={styles.fileName} style={{marginLeft:'10px'}}>{logoName}</span>
              </div>
            </div>

            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={loading}
              style={{ marginTop: '25px' }}
            >
              {loading ? 'Saving…' : 'Save Settings & Continue →'}
            </button>
          </form>
        </div>
      </main>

      <footer className={styles.authFooter}>
        © {new Date().getFullYear()} POS System. All rights reserved.
      </footer>
    </div>
  );
}