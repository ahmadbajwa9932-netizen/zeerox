'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2, X ,Table } from 'lucide-react';
import styles from './create.module.css';
import { apiFetch } from '@/lib/api';


export default function CreateNotePage() {
    const router = useRouter();
    const [heading, setHeading] = useState('');
    const [columns, setColumns] = useState([]);
    const [rows, setRows] = useState([]);
    const [newColName, setNewColName] = useState('');
    const [showColInput, setShowColInput] = useState(false);
    const [popup, setPopup] = useState(null);

    function showPopup(message, type) {
        setPopup({ message, type });
        setTimeout(() => setPopup(null), 3000);
    }

    function addColumn() {
        setShowColInput(true);
    }

    function confirmAddColumn() {
        const name = newColName.trim();
        if (!name) return;
        setColumns(prev => [...prev, name]);
        setRows(prev => prev.map(row => ({ ...row, [name]: '' })));
        setNewColName('');
        setShowColInput(false);
    }

    function addRow() {
        if (columns.length === 0) {
            showPopup('Please add at least one column first', 'error');
            return;
        }
        const newRow = {};
        columns.forEach(col => { newRow[col] = ''; });
        setRows(prev => [...prev, newRow]);
    }

    function deleteColumn(index) {
        if (!confirm('Delete this column?')) return;
        const colName = columns[index];
        setColumns(prev => prev.filter((_, i) => i !== index));
        setRows(prev => prev.map(row => {
            const updated = { ...row };
            delete updated[colName];
            return updated;
        }));
    }

    function deleteRow(index) {
        if (!confirm('Delete this row?')) return;
        setRows(prev => prev.filter((_, i) => i !== index));
    }

    function updateColumnName(index, newName) {
        if (!newName.trim()) return;
        const oldName = columns[index];
        setColumns(prev => prev.map((col, i) => i === index ? newName.trim() : col));
        setRows(prev => prev.map(row => {
            const updated = { ...row, [newName.trim()]: row[oldName] };
            delete updated[oldName];
            return updated;
        }));
    }

    function updateCell(rowIndex, colName, value) {
        setRows(prev => prev.map((row, i) =>
            i === rowIndex ? { ...row, [colName]: value } : row
        ));
    }

    async function saveNote() {
        if (columns.length === 0) {
            showPopup('Please add at least one column', 'error');
            return;
        }
        if (rows.length === 0) {
            showPopup('Please add at least one row', 'error');
            return;
        }

        try {
            const res = await apiFetch('/api/manual-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ heading, columns, rows })
            });
            const data = await res.json();

            if (data.success) {
                showPopup(data.message, 'success');
                setTimeout(() => router.push('/manual-notes'), 1000);
            } else {
                showPopup(data.message || 'Error saving note', 'error');
            }
        } catch {
            showPopup('Error saving note', 'error');
        }
    }

    return (
        <>
        {popup && (
            <div className={`popup ${popup.type}`}>{popup.message}</div>
        )}
                <div className="container">
                    <div className="container-child main-text">
                        <h1>Create New Note</h1>
                        <p>Add heading, columns, and rows to create your custom note</p>
                    </div>
                    <div className="container-child sub-text">
                        <p></p>
                        <button className="boton-elegante" onClick={() => router.push('/manual-notes')}>
                            ← Back
                        </button>
                    </div>

                    <div className="sub-container">
                    <div className={styles['note-editor']}>

                            <input
                                type="text"
                                className={styles['heading-input']}
                                placeholder="Enter note heading (optional)"
                                value={heading}
                                onChange={e => setHeading(e.target.value)}
                            />

<div className={styles['table-controls']}>
<button className={`${styles['control-btn']} ${styles['btn-add-column']}`} onClick={addColumn}>
                                <Plus size={14} /> Add Column
                                </button>
                                <button className={`${styles['control-btn']} ${styles['btn-add-row']}`} onClick={addRow}>
                                <Plus size={14} /> Add Row
                                </button>
                            </div>

                            {/* Inline column name input */}
                            {showColInput && (
                                <div className={styles['col-input-row']}>
                                    <input
                                        type="text"
                                        className={styles['col-name-input']}
                                        placeholder="Column name..."
                                        value={newColName}
                                        onChange={e => setNewColName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && confirmAddColumn()}
                                        autoFocus
                                    />
<button className={`${styles['control-btn']} ${styles['btn-add-column']}`} onClick={confirmAddColumn}>
                                        Add
                                    </button>
                                    <button className={`${styles['control-btn']} ${styles['btn-cancel-col']}`} onClick={() => {
                                        setShowColInput(false);
                                        setNewColName('');
                                    }}>
                                        Cancel
                                    </button>
                                </div>
                            )}

<div className={styles['table-wrapper']}>
                                {columns.length === 0 ? (
                                    <div className={styles['empty-state']}>
                                    <Table size={48} color="#7f8c8d" style={{ marginBottom: 15 }} />
                                    <h3>No table yet</h3>
                                    <p>Click "Add Column" to start building your note table</p>
                                </div>
                                ) : (
<table className={styles['note-table']}>
                                        <thead>
                                            <tr>
                                                {columns.map((col, index) => (
                                                    <th key={index}>
<div className={styles['th-inner']}>
                                                            <input
                                                                type="text"
                                                                defaultValue={col}
                                                                onBlur={e => updateColumnName(index, e.target.value)}
                                                            />
<button className={styles['delete-btn']} onClick={() => deleteColumn(index)}>
                                                            <X size={12} />
                                                            </button>
                                                        </div>
                                                    </th>
                                                ))}
                                                {/* <th style={{ width: 50 }}></th> */}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row, rowIndex) => (
                                                <tr key={rowIndex}>
                                                    {columns.map(col => (
                                                        <td key={col}>
                                                            <textarea
                                                                value={row[col] || ''}
                                                                onChange={e => updateCell(rowIndex, col, e.target.value)}
                                                            />
                                                        </td>
                                                    ))}
                                                    <td style={{ textAlign: 'center' }}>
                                                    <button className={styles['delete-btn']} onClick={() => deleteRow(rowIndex)}>
                                                        <Trash2 size={12} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            <div className={styles['action-buttons']}>
                            <button className={styles['cancel-btn']} onClick={() => router.push('/manual-notes')}>
                                    Cancel
                                </button>
                                <button className={styles['save-btn']} onClick={saveNote}>
                                <Save size={14} />Save Note
                                </button>
                            </div>

                        </div>
                    </div>
                </div>
                </>
    );
}