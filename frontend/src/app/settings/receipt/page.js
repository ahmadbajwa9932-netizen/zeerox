'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import styles from './receipt.module.css';

export default function ReceiptSettingsPage() {
  const router = useRouter();
  const previewRef = useRef(null);

  const [paperSize, setPaperSize] = useState('80mm');
  const [designType, setDesignType] = useState('design1');
  const [languageType, setLanguageType] = useState('en');
  const [showSignature, setShowSignature] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  const [showPaidOverlay, setShowPaidOverlay] = useState(false);

  const [zoom, setZoom] = useState(0.8);
  const minZoom = 0.3;
  const maxZoom = 1.5;
  const zoomStep = 0.1;

  const [popup, setPopup] = useState(null); // { message, kind, key }
  const [saving, setSaving] = useState(false);
  
  function showToast(message, kind = 'success') {
    setPopup({ message, kind, key: Date.now() });
    setTimeout(() => setPopup(null), 3000);
  }

  useEffect(() => {
    apiFetch('/settings/receipt')
      .then((res) => res.json())
      .then((data) => {
        if (!data) return;
        setPaperSize(data.paper_size);
        setDesignType(data.design_type);
        setLanguageType(data.language || 'en');
        setShowSignature(!!data.show_signature);
        setShowStamp(!!data.show_stamp);
        setShowPaidOverlay(!!data.show_paid_overlay);
      })
      .catch(() => showToast('Failed to load settings', 'error'));
  }, []);

  function zoomIn() {
    setZoom((z) => Math.min(maxZoom, +(z + zoomStep).toFixed(2)));
  }
  function zoomOut() {
    setZoom((z) => Math.max(minZoom, +(z - zoomStep).toFixed(2)));
  }
  function resetZoom() {
    setZoom(0.8);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/settings/receipt/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paper_size: paperSize,
          design_type: designType,
          language: languageType,
          show_signature: showSignature,
          show_stamp: showStamp,
          show_paid_overlay: showPaidOverlay,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      showToast('Settings saved successfully', 'success');
} catch {
  showToast('Failed to save settings', 'error');
} finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className={`${styles.containerChild} ${styles.mainText}`}>
      {popup && <div className={`popup ${popup.kind}`} key={popup.key}>{popup.message}</div>}

        <h1 className="main-text">Receipt Page Settings</h1>
        <div style={{display:'flex', justifyContent:'space-between'}}>
        <p className="sub-text">Customize how your printed and digital receipts look</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            id="back-buttons"
            className="boton-elegante"
            onClick={() => router.push('/settings')}
          >
            ← Back
          </button>
        </div>
        </div>

        <div className={styles.settingsContainer}>
          {/* Preview Section */}
          <div className={styles.previewSection}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>Receipt Preview</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={zoomOut} className={styles.zoomBtn} title="Zoom Out">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="8" y1="11" x2="14" y2="11"></line>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </button>
                <button type="button" onClick={resetZoom} className={styles.zoomBtn} title="Reset Zoom">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </button>
                <button type="button" onClick={zoomIn} className={styles.zoomBtn} title="Zoom In">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="11" y1="8" x2="11" y2="14"></line>
                    <line x1="8" y1="11" x2="14" y2="11"></line>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.receiptPreviewContainer} id="receiptPreviewContainer">
              <div
                className={styles.receiptPreview}
                id="receiptPreview"
                ref={previewRef}
                style={{ width: '600px', transform: `scale(${zoom})`, transformOrigin: 'top center' }}
              >
                <iframe
                  src={`/sales/receipt/printReceipt?preview=1&paper_size=${paperSize}&design_type=${designType}&language=${languageType}&show_signature=${showSignature ? 1 : 0}&show_stamp=${showStamp ? 1 : 0}&show_paid_overlay=${showPaidOverlay ? 1 : 0}`}
                  width="100%"
                  height="800px"
                  style={{ border: 'none' }}
                  title="Receipt Preview"
                />
              </div>
            </div>

            <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
              Preview updates when you change settings
            </p>
          </div>

          {/* Settings Form */}
          <div className={styles.settingsForm}>
            <h3>Configure Receipt</h3>
            <form onSubmit={handleSubmit} id="settingsForm">
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '20px' }}>
                {/* Paper Size */}
                <div className={styles.formGroup}>
                  <label htmlFor="paper_size">Paper Size</label>
                  <select
                    name="paper_size"
                    id="paper_size"
                    required
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                  >
                    <option value="80mm">80mm (Thermal)</option>
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                  </select>
                </div>

                {/* Design Type */}
                <div className={styles.formGroup}>
                  <label htmlFor="design_type">Receipt Design</label>
                  <select
                    name="design_type"
                    id="design_type"
                    required
                    value={designType}
                    onChange={(e) => setDesignType(e.target.value)}
                  >
                    <option value="design1">Design 1 (Classic)</option>
                    <option value="design2">Design 2 (Modern)</option>
                    <option value="design3">Design 3 (Minimal)</option>
                  </select>
                </div>

                {/* Language */}
                <div className={styles.formGroup}>
                  <label htmlFor="language_type">Select Language</label>
                  <select
                    name="language_type"
                    id="language_type"
                    required
                    value={languageType}
                    onChange={(e) => setLanguageType(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="ur">Urdu</option>
                    <option value="ur_PK_rom">Roman Urdu</option>
                  </select>
                </div>
              </div>

              {/* Show Signature */}
              <div className={styles.formGroup}>
                <div className={styles.checkboxGroup}>
                  <input
                    type="checkbox"
                    name="show_signature"
                    id="show_signature"
                    checked={showSignature}
                    onChange={(e) => setShowSignature(e.target.checked)}
                  />
                  <label htmlFor="show_signature">Show Signature Line</label>
                </div>
              </div>

              {/* Show Stamp */}
              <div className={styles.formGroup}>
                <div className={styles.checkboxGroup}>
                  <input
                    type="checkbox"
                    name="show_stamp"
                    id="show_stamp"
                    checked={showStamp}
                    onChange={(e) => setShowStamp(e.target.checked)}
                  />
                  <label htmlFor="show_stamp">Show Stamp Line</label>
                </div>
              </div>

              {/* Show Paid/Unpaid Overlay */}
              <div className={styles.formGroup}>
                <div className={styles.checkboxGroup}>
                  <input
                    type="checkbox"
                    name="show_paid_overlay"
                    id="show_paid_overlay"
                    checked={showPaidOverlay}
                    onChange={(e) => setShowPaidOverlay(e.target.checked)}
                  />
                  <label htmlFor="show_paid_overlay">Show PAID/UNPAID Watermark</label>
                </div>
              </div>

              <button type="submit" className={styles.submitBtn} disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}