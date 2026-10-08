import db from '../db.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generatePdfHtml } from '../notes-templates/note-pdf.js';
import { generatePrintHtml } from '../notes-templates/note-print.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const shareTokens = new Map();
export default async function manualNoteRoutes(fastify) {

// Shared helper — used by pdf, print, and whatsapp routes
async function getNoteWithShopData(id) {
    const [notes] = await db.query('SELECT * FROM manual_notes WHERE id = ?', [id]);
    if (notes.length === 0) return null;

    const note = notes[0];
    const columns = typeof note.columns === 'string' ? JSON.parse(note.columns) : (note.columns ?? []);
    const rows = typeof note.rows === 'string' ? JSON.parse(note.rows) : (note.rows ?? []);

    let heading = note.heading;
    if (!heading && rows.length > 0) {
        const text = Object.values(rows[0]).join(' ');
        heading = 'Note: ' + text.split(' ').slice(0, 5).join(' ') + '...';
    }
    if (!heading) heading = `Note #${note.id}`;

    let shop = {}, ownerName = 'Admin', shopName = 'N/A', logoHtml = '';
    try {
        const [shops] = await db.query('SELECT * FROM admin_settings LIMIT 1');
        shop = shops[0] ?? {};
        shopName = shop.shop_name ?? 'N/A';
        const [admins] = await db.query("SELECT name FROM users WHERE role = 'admin' LIMIT 1");
        ownerName = admins[0]?.name ?? 'Admin';
        if (shop.logo) {
            try {
                const logoPath = path.join(PUBLIC_DIR, shop.logo);
                const buf = fs.readFileSync(logoPath);
                const ext = path.extname(shop.logo).slice(1) || 'png';
                logoHtml = `<img src="data:image/${ext};base64,${buf.toString('base64')}" alt="Logo" class="company-logo">`;
            } catch {
                logoHtml = '';
            }
        }
    } catch {
        // tables not set up yet — use defaults silently
    }

    return { note, heading, columns, rows, shop, shopName, ownerName, logoHtml };
}

       // GET all notes (with optional search)
       fastify.get('/api/manual-notes', async (request, reply) => {
        const { search } = request.query;

        let query = 'SELECT id, heading, created_at FROM manual_notes WHERE deleted_at IS NULL';
        const params = [];

        if (search) {
            query += ' AND heading LIKE ?';
            params.push(`%${search}%`);
        }

        query += ' ORDER BY created_at DESC';

        const [rows] = await db.query(query, params);

        return reply.send({
            success: true,
            notes: rows.map(note => ({
                id: note.id,
                heading: note.heading || `Note #${note.id}`,
                created_at: new Date(note.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: '2-digit', year: 'numeric'
                })
            }))
        });
    });

    // GET single note data
    fastify.get('/api/manual-notes/:id', async (request, reply) => {
        const { id } = request.params;
        const [rows] = await db.query('SELECT * FROM manual_notes WHERE id = ?', [id]);

        if (rows.length === 0) {
            return reply.status(404).send({ success: false, message: 'Note not found' });
        }

        const note = rows[0];
        const columns = typeof note.columns === 'string' ? JSON.parse(note.columns) : note.columns;
        const noteRows = typeof note.rows === 'string' ? JSON.parse(note.rows) : note.rows;

        // display_heading logic (same as Laravel model accessor)
        let displayHeading = note.heading;
        if (!displayHeading && noteRows && noteRows.length > 0) {
            const firstRow = noteRows[0];
            const text = Object.values(firstRow).join(' ');
            const words = text.split(' ');
            displayHeading = 'Note: ' + words.slice(0, 5).join(' ') + '...';
        }
        if (!displayHeading) displayHeading = `Note #${note.id}`;

        return reply.send({
            success: true,
            note: {
                id: note.id,
                heading: displayHeading,
                columns: columns ?? [],
                rows: noteRows ?? []
            }
        });
    });

    // POST create note
    fastify.post('/api/manual-notes', async (request, reply) => {
        const { heading, columns, rows } = request.body;

        // Duplicate protection (same as Laravel — 5 second window)
        if (heading) {
            const [existing] = await db.query(
                `SELECT id FROM manual_notes 
                 WHERE heading = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 SECOND)`,
                [heading]
            );
            if (existing.length > 0) {
                return reply.status(429).send({
                    success: false,
                    message: 'This note was just created.'
                });
            }
        }

       const [result] = await db.query(
            'INSERT INTO manual_notes (heading, `columns`, `rows`) VALUES (?, ?, ?)',
            [heading || null, JSON.stringify(columns), JSON.stringify(rows)]
        );
        
        const noteId = result.insertId;
        
        if (!heading) {
            await db.query(
                'UPDATE manual_notes SET heading = ? WHERE id = ?',
                [`Note #${noteId}`, noteId]
            );
        }

        const finalHeading = heading || `Note #${noteId}`;

        await logActivity(request, {
            action_type: 'create',
            description: `Created note "${finalHeading}"`,
            entity_type: 'manual_note',
            entity_id: noteId,
            new_data: { heading: finalHeading, columns, rows },
        });
        
        return reply.send({
            success: true,
            message: 'Note created successfully!',
            note_id: noteId
        });
    });

    // PUT update note
    fastify.put('/api/manual-notes/:id', async (request, reply) => {
        const { id } = request.params;
        const { heading, columns, rows } = request.body;

        const [existing] = await db.query('SELECT * FROM manual_notes WHERE id = ?', [id]);
        if (existing.length === 0) {
            return reply.status(404).send({ success: false, message: 'Note not found' });
        }
        const oldNote = existing[0];
        const oldRows = typeof oldNote.rows === 'string' ? JSON.parse(oldNote.rows) : (oldNote.rows ?? []);

        await db.query(
            'UPDATE manual_notes SET heading = ?, `columns` = ?, `rows` = ? WHERE id = ?',
            [heading || null, JSON.stringify(columns), JSON.stringify(rows), id]
        );

        const changes = describeChanges(
            { heading: oldNote.heading, row_count: oldRows.length },
            { heading: heading || null, row_count: Array.isArray(rows) ? rows.length : 0 },
            { heading: 'Heading', row_count: 'Row Count' }
        );
        const changeText = changes.length > 0 ? changes.join(', ') : 'Content updated';

        await logActivity(request, {
            action_type: 'edit',
            description: `Updated note "${oldNote.heading || `Note #${id}`}" — ${changeText}`,
            entity_type: 'manual_note',
            entity_id: id,
            old_data: { heading: oldNote.heading, columns: oldNote.columns, rows: oldNote.rows },
            new_data: { heading, columns, rows },
        });

        return reply.send({
            success: true,
            message: 'Note updated successfully!',
            note_id: parseInt(id)
        });
    });

     // DELETE note (soft delete by default, permanent when ?permanent=true)
     fastify.delete('/api/manual-notes/:id', async (request, reply) => {
        const { id } = request.params;
        const { permanent } = request.query;

        const [existing] = await db.query('SELECT * FROM manual_notes WHERE id = ?', [id]);
        if (existing.length === 0) {
            return reply.status(404).send({ success: false, message: 'Note not found' });
        }
        const note = existing[0];
        const noteHeading = note.heading || `Note #${id}`;

        if (permanent === 'true') {
            await db.query('DELETE FROM manual_notes WHERE id = ?', [id]);

            await logActivity(request, {
                action_type: 'permanent_delete',
                description: `Permanently deleted note "${noteHeading}"`,
                entity_type: 'manual_note',
                entity_id: id,
                old_data: note,
            });

            return reply.send({
                success: true,
                message: 'Note permanently deleted!'
            });
        }

        await db.query('UPDATE manual_notes SET deleted_at = NOW() WHERE id = ?', [id]);

        await logActivity(request, {
            action_type: 'soft_delete',
            description: `Soft Deleted note "${noteHeading}"`,
            entity_type: 'manual_note',
            entity_id: id,
            old_data: note,
        });

        return reply.send({
            success: true,
            message: 'Note moved to recycle bin.'
        });
    });
    // Generate WhatsApp share link
fastify.post('/api/manual-notes/:id/share-link', async (request, reply) => {
    const { id } = request.params;

    const [rows] = await db.query('SELECT id FROM manual_notes WHERE id = ?', [id]);
    if (rows.length === 0) {
        return reply.status(404).send({ success: false, message: 'Note not found' });
    }

    // Store token in DB-free way using a simple in-memory map
    // (same logic as Laravel Cache)
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    shareTokens.set(token, { id: parseInt(id), expires: Date.now() + 24 * 60 * 60 * 1000 });

    const shareUrl = `http://localhost:4000/api/manual-notes/shared/${token}/pdf`;

    return reply.send({
        success: true,
        share_url: shareUrl
    });
});

// Download shared PDF via token
fastify.get('/api/manual-notes/shared/:token/pdf', async (request, reply) => {
    const { token } = request.params;
    const entry = shareTokens.get(token);

    if (!entry || Date.now() > entry.expires) {
        shareTokens.delete(token);
        return reply.status(404).send({ success: false, message: 'Link expired or invalid' });
    }

    // Redirect to normal pdf download
    return reply.redirect(`/api/manual-notes/${entry.id}/pdf`);
});

// GET print page
fastify.get('/api/manual-notes/:id/print', async (request, reply) => {
    const data = await getNoteWithShopData(request.params.id);
    if (!data) return reply.status(404).send('Note not found');

    const createdAt = new Date(data.note.created_at).toLocaleString('en-US', { month: 'long', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const printedAt = new Date().toLocaleString('en-US', { month: 'long', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const html = generatePrintHtml({ ...data, createdAt, printedAt });
    return reply.type('text/html').send(html);
});

// GET download PDF (also used by WhatsApp share redirect)
fastify.get('/api/manual-notes/:id/pdf', async (request, reply) => {
    const data = await getNoteWithShopData(request.params.id);
    if (!data) return reply.status(404).send('Note not found');

    const createdAt = new Date(data.note.created_at).toLocaleString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });

    const html = generatePdfHtml({ ...data, createdAt });

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, printBackground: true });
    await browser.close();

    return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="note-${request.params.id}.pdf"`)
        .send(pdfBuffer);
});

}