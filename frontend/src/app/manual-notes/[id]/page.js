'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, FileText, Printer } from 'lucide-react';
import styles from './show.module.css';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';

export default function ShowNotePage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();
    const { id } = useParams();
    const [note, setNote] = useState(null);
    const [popup, setPopup] = useState(null);

    useEffect(() => {
        fetchNote();
    }, []);

    function showPopup(message, type) {
        setPopup({ message, type });
        setTimeout(() => setPopup(null), 3000);
    }

    async function fetchNote() {
        try {
            const res = await apiFetch(`/api/manual-notes/${id}`);
            const data = await res.json();
            if (data.success) setNote(data.note);
        } catch {
            showPopup('Error loading note', 'error');
        }
    }

    function downloadPdf() {
        window.location.href = `http://localhost:4000/api/manual-notes/${id}/pdf`;
    }

    function printNote() {
        const width = 650, height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        const popup = window.open(
            `http://localhost:4000/api/manual-notes/${id}/print`,
            'PrintWindow',
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );
        if (popup) popup.focus();
    }

    if (!note) return <div className="loading-spinner"><div className="spinner"></div></div>;

    return (
        <>
            {popup && <div className={`popup ${popup.type}`}>{popup.message}</div>}

            <div className="container">
                <div className="container-child main-text">
                    <h1>View Note</h1>
                    <p>Read your saved note</p>
                </div>
                <div className="container-child sub-text">
                    <p></p>
                    <button className="boton-elegante" onClick={() => router.push('/manual-notes')}>
                        ← Back to Notes
                    </button>
                </div>

                <div className="sub-container">
                    <div className={styles['note-viewer']}>
                        <h2 className={styles['note-heading']}>{note.heading}</h2>

                        {note.columns?.length > 0 && note.rows?.length > 0 && (
                            <div className={styles['view-table']}>
                                <table>
                                    <thead>
                                        <tr>
                                            {note.columns.map((col, i) => (
                                                <th key={i}>{col}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {note.rows.map((row, ri) => (
                                            <tr key={ri}>
                                                {note.columns.map((col, ci) => (
                                                    <td key={ci}>{row[col] ?? ''}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

<div className={styles['view-actions']}>
                            {!isBlocked('manual-notes.act.edit') && (
                            <button className={`${styles['action-btn']} ${styles['btn-edit']}`} onClick={() => router.push(`/manual-notes/${id}/edit`)}>
                                <Edit size={13} /> Edit
                            </button>
                            )}
                            {!isBlocked('manual-notes.act.pdf') && (
                            <button className={`${styles['action-btn']} ${styles['btn-pdf']}`} onClick={downloadPdf}>
                                <FileText size={13} /> Download PDF
                            </button>
                            )}
                            {!isBlocked('manual-notes.act.print') && (
                            <button className={`${styles['action-btn']} ${styles['btn-print']}`} onClick={printNote}>
                                <Printer size={13} /> Print
                            </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}