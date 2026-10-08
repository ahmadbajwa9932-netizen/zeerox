'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Printer, Share2 } from 'lucide-react';
import styles from './index.module.css';
import { apiFetch } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';


export default function ManualNotesPage() {
    const router = useRouter();
    const { isBlocked } = usePermissions();
    const [notes, setNotes] = useState([]);
    const [search, setSearch] = useState('');
    const [popup, setPopup] = useState(null);
    const [deleteModal, setDeleteModal] = useState({ open: false, id: null });
    const [sortKey, setSortKey] = useState('date');
    const [sortDir, setSortDir] = useState('desc');
    const [openDropdown, setOpenDropdown] = useState(null);
    const searchTimeout = useRef(null);

    useEffect(() => {
        loadNotes('');
    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleF2);
        return () => document.removeEventListener('keydown', handleF2);
    }, []);

    // Close the row menu when clicking anywhere outside it
    useEffect(() => {
        function handleClick(e) {
            if (!e.target.closest('.action-dropdown')) setOpenDropdown(null);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    function handleF2(e) {
        if (e.key === 'F2') {
            e.preventDefault();
            document.getElementById('singleInputSearch')?.focus();
        }
    }

    function showPopup(message, type) {
        setPopup({ message, type });
        setTimeout(() => setPopup(null), 3000);
    }

    async function loadNotes(searchQuery) {
    try {
        let path = '/api/manual-notes';
        if (searchQuery) path += `?search=${encodeURIComponent(searchQuery)}`;
        const res = await apiFetch(path);
        const data = await res.json();
        if (data.success) setNotes(data.notes);
    } catch {
        showPopup('Error loading notes', 'error');
    }
}

    function handleSearch(e) {
        const val = e.target.value;
        setSearch(val);
        clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            loadNotes(val.trim());
        }, 100);
    }

    // Sorting happens here in the browser — the API returns every note at once
    function handleSort(key) {
        if (sortKey === key) {
            setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(key === 'heading' ? 'asc' : 'desc');
        }
    }

    const sortedNotes = useMemo(() => {
        const list = [...notes];
        list.sort((a, b) => {
            let result;
            if (sortKey === 'heading') {
                result = a.heading.localeCompare(b.heading, undefined, { sensitivity: 'base' });
            } else {
                const dateA = new Date(a.created_at).getTime();
                const dateB = new Date(b.created_at).getTime();
                // Same day, or an unparsable date — fall back to id, which follows creation order
                result = (isNaN(dateA) || isNaN(dateB) || dateA === dateB)
                    ? a.id - b.id
                    : dateA - dateB;
            }
            return sortDir === 'asc' ? result : -result;
        });
        return list;
    }, [notes, sortKey, sortDir]);

    async function handleSoftDelete() {
        try {
            const res = await apiFetch(`/api/manual-notes/${deleteModal.id}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                showPopup(data.message, 'success');
                setDeleteModal({ open: false, id: null });
                loadNotes(search);
            } else {
                showPopup(data.message, 'error');
            }
        } catch {
            showPopup('Error deleting note', 'error');
        }
    }

    async function handlePermanentDelete() {
        const confirmed = window.confirm('Permanently delete this note? This cannot be undone.');
        if (!confirmed) return;
        try {
            const res = await apiFetch(`/api/manual-notes/${deleteModal.id}?permanent=true`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                showPopup(data.message, 'success');
                setDeleteModal({ open: false, id: null });
                loadNotes(search);
            } else {
                showPopup(data.message, 'error');
            }
        } catch {
            showPopup('Error deleting note', 'error');
        }
    }

    function downloadPdf(id) {
        window.location.href = `http://localhost:4000/api/manual-notes/${id}/pdf`;
    }

    function printNote(id) {
        const width = 650, height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        const popup = window.open(
            `http://localhost:4000/api/manual-notes/${id}/print`,
            'Print Note',
            `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );
        if (!popup) alert('Please allow popups for this site to print notes');
    }

    async function shareOnWhatsApp(id, heading) {
        // Step 1: silently download PDF
        const downloadLink = document.createElement('a');
        downloadLink.href = `http://localhost:4000/api/manual-notes/${id}/pdf`;
        downloadLink.download = `note-${id}.pdf`;
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        showPopup('PDF downloading... Opening WhatsApp', 'success');

        setTimeout(() => {
            const message = `I'm sharing a note with you. Please see the attached PDF!`;
            window.location.href = `whatsapp://send?text=${encodeURIComponent(message)}`;

            setTimeout(() => {
                if (confirm('WhatsApp app not detected. Open WhatsApp Web instead?')) {
                    window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
                    showPopup('Attach the downloaded PDF manually in WhatsApp', 'success');
                }
            }, 1500);
        }, 1000);
    }

    // Sort control — mirrors the ▲▼ arrows used on the table pages
    function SortButton({ sortKeyName, label }) {
        const active = sortKey === sortKeyName;
        return (
            <button
                type="button"
                className={`${styles['sort-btn']}${active ? ' ' + styles['sort-btn-active'] : ''}`}
                onClick={() => handleSort(sortKeyName)}
            >
                <span>{label}</span>
                <span className="sort-icons">
                    <span className={active && sortDir === 'asc' ? 'active' : ''}>▲</span>
                    <span className={active && sortDir === 'desc' ? 'active' : ''}>▼</span>
                </span>
            </button>
        );
    }

    const canEdit   = !isBlocked('manual-notes.act.edit');
    const canDelete = !isBlocked('manual-notes.act.delete');

    return (
        <>
            {popup && <div className={`popup ${popup.type}`}>{popup.message}</div>}

            <div className="container">
                <div className="container-child main-text">
                    <h1>Personal Notes</h1>
                </div>
                <div className="container-child sub-text">
                    <p>Create and manage your custom notes with tables and content</p>
                </div>

                <div className="sub-container">
                <div className={styles['add-search-container']}>

                    <div className="search-container">
                        <input
                            type="text"
                            id="singleInputSearch"
                            className="input"
                            placeholder="Search..."
                            value={search}
                            onChange={handleSearch}
                        />
                        <span className="icon1">
                            <svg width="19px" height="19px" viewBox="0 0 24 24" fill="none">
                                <path opacity="1" d="M14 5H20" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path opacity="1" d="M14 8H17" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M21 11.5C21 16.75 16.75 21 11.5 21C6.25 21 2 16.75 2 11.5C2 6.25 6.25 2 11.5 2" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path opacity="1" d="M22 22L20 20" stroke="#000" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </span>
                    </div>

                    <div className="add-button">
                    {!isBlocked('manual-notes.act.create') && (
                        <button style={{ width: 'auto' }} onClick={() => router.push('/manual-notes/create')}>
                            <span>Create Note</span>
                        </button>
                    )}
                    </div>
                    </div>

                    {notes.length === 0 ? (
                        <div className={styles['no-notes']}>
                            <FileText size={64} style={{ opacity: 0.3, marginBottom: 20 }} />
                            <h3>No notes yet</h3>
                            <p>Click "Create Note" to start adding your personal notes</p>
                        </div>
                    ) : (
                        <>
                            <div className={styles['sort-bar']}>
                                <span className={styles['sort-bar-label']}>Sort by</span>
                                <SortButton sortKeyName="heading" label="Heading" />
                                <SortButton sortKeyName="date" label="Date" />
                                <span className={styles['note-count']}>
                                    {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                                </span>
                            </div>

                            <div className={styles['notes-list']}>
                                {sortedNotes.map(note => (
                                    <div className={styles['note-row']} key={note.id}>
                                        <div
                                            className={styles['note-main']}
                                            onClick={() => router.push(`/manual-notes/${note.id}`)}
                                        >
                                            <div className={styles['note-title']}>{note.heading}</div>
                                            <div className={styles['note-date']}>{note.created_at}</div>
                                        </div>

                                        <div className={styles['note-actions']}>
                                            {!isBlocked('manual-notes.act.pdf') && (
                                                <button
                                                    className={styles['note-icon-btn']}
                                                    title="Download PDF"
                                                    onClick={() => downloadPdf(note.id)}
                                                >
                                                    <FileText size={14} />
                                                </button>
                                            )}
                                            {!isBlocked('manual-notes.act.print') && (
                                                <button
                                                    className={styles['note-icon-btn']}
                                                    title="Print"
                                                    onClick={() => printNote(note.id)}
                                                >
                                                    <Printer size={14} />
                                                </button>
                                            )}
                                            {!isBlocked('manual-notes.act.share') && (
                                                <button
                                                    className={`${styles['note-icon-btn']} ${styles['note-icon-whatsapp']}`}
                                                    title="Share on WhatsApp"
                                                    onClick={() => shareOnWhatsApp(note.id, note.heading)}
                                                >
                                                    <Share2 size={14} />
                                                </button>
                                            )}

                                            {(canEdit || canDelete) && (
                                                <div className="action-dropdown">
                                                    <button
                                                        className="dropdown-toggle"
                                                        onClick={() => setOpenDropdown(openDropdown === note.id ? null : note.id)}
                                                    >
                                                        ⋮
                                                    </button>
                                                    <div className={`action-dropdown-menu${openDropdown === note.id ? ' open' : ''}`}>
                                                        {canEdit && (
                                                            <button onClick={() => { setOpenDropdown(null); router.push(`/manual-notes/${note.id}/edit`); }}>
                                                                Edit
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button onClick={() => { setOpenDropdown(null); setDeleteModal({ open: true, id: note.id }); }}>
                                                                Delete
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <div className={`delete-modal${deleteModal.open ? ' open' : ''}`}>
                <div className="delete-modal-content">
                    <div className="delete-confirm-modal-title">Delete this note?</div>
                    <div className="delete-confirm-modal-text">
                        Soft delete can be restored later from Recycle Bin. Permanent delete cannot be undone.
                    </div>
                    <div className="delete-confirm-modal-actions">
                        <button className="delete-confirm-btn delete-confirm-btn-soft" onClick={handleSoftDelete}>
                            Soft delete
                        </button>
                        <button className="delete-confirm-btn delete-confirm-btn-permanent" onClick={handlePermanentDelete}>
                            Permanent delete
                        </button>
                    </div>
                    <button className="delete-confirm-btn delete-confirm-btn-cancel" onClick={() => setDeleteModal({ open: false, id: null })}>
                        Cancel
                    </button>
                </div>
            </div>
        </>
    );
}
