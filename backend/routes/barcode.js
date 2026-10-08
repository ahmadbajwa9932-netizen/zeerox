import pool from '../db.js';
import puppeteer from 'puppeteer';
import { getCurrencySettings, formatPrice } from '../utils/currency.js';
import { logActivity, describeChanges } from '../helpers/activityLogger.js';

// ── Barcode number generator ───────────────────────────
function padId(id) {
    return String(id).padStart(12, '0');
}

// ── Simple barcode SVG generator (CODE-128 subset A/B) ─
// Returns an SVG string of a CODE-128 barcode
function generateBarcodeSVG(text, width = 200, height = 60) {
    // CODE 128 encoding table (subset B — printable ASCII 32-127)
    const CODE128B_MAP = {
        ' ': 0, '!': 1, '"': 2, '#': 3, '$': 4, '%': 5, '&': 6, "'": 7,
        '(': 8, ')': 9, '*': 10, '+': 11, ',': 12, '-': 13, '.': 14, '/': 15,
        '0': 16, '1': 17, '2': 18, '3': 19, '4': 20, '5': 21, '6': 22, '7': 23,
        '8': 24, '9': 25, ':': 26, ';': 27, '<': 28, '=': 29, '>': 30, '?': 31,
        '@': 32, 'A': 33, 'B': 34, 'C': 35, 'D': 36, 'E': 37, 'F': 38, 'G': 39,
        'H': 40, 'I': 41, 'J': 42, 'K': 43, 'L': 44, 'M': 45, 'N': 46, 'O': 47,
        'P': 48, 'Q': 49, 'R': 50, 'S': 51, 'T': 52, 'U': 53, 'V': 54, 'W': 55,
        'X': 56, 'Y': 57, 'Z': 58, '[': 59, '\\': 60, ']': 61, '^': 62, '_': 63,
        '`': 64, 'a': 65, 'b': 66, 'c': 67, 'd': 68, 'e': 69, 'f': 70, 'g': 71,
        'h': 72, 'i': 73, 'j': 74, 'k': 75, 'l': 76, 'm': 77, 'n': 78, 'o': 79,
        'p': 80, 'q': 81, 'r': 82, 's': 83, 't': 84, 'u': 85, 'v': 86, 'w': 87,
        'x': 88, 'y': 89, 'z': 90, '{': 91, '|': 92, '}': 93, '~': 94,
    };

    // Pattern table for CODE 128 (each symbol = 6 elements, 3 bars + 3 spaces, widths 1-4)
    const PATTERNS = [
        '212222','222122','222221','121223','121322','131222','122213','122312',
        '132212','221213','221312','231212','112232','122132','122231','113222',
        '123122','123221','223211','221132','221231','213212','223112','312131',
        '311222','321122','321221','312212','322112','322211','212123','212321',
        '232121','111323','131123','131321','112313','132113','132311','211313',
        '231113','231311','112133','112331','132131','113123','113321','133121',
        '313121','211331','231131','213113','213311','213131','311123','311321',
        '331121','312113','312311','332111','314111','221411','431111','111224',
        '111422','121124','121421','141122','141221','112214','112412','122114',
        '122411','142112','142211','241211','221114','213111','241112','134111',
        '111242','121142','121241','114212','124112','124211','411212','421112',
        '421211','212141','214121','412121','111143','111341','131141','114113',
        '114311','411113','411311','113141','114131','311141','411131','211412',
        '211214','211232','2331112',
    ];

    const START_B = 104;
    const STOP    = 106;

    // Build symbol list
    const symbols = [START_B];
    let checksum = START_B;
    for (let i = 0; i < text.length; i++) {
        const val = CODE128B_MAP[text[i]];
        if (val === undefined) continue; // skip unsupported chars
        symbols.push(val);
        checksum += val * (i + 1);
    }
    symbols.push(checksum % 103);
    symbols.push(STOP);

    // Build bar pattern string: '1'=bar, '0'=space, digit = module width
    let modulesStr = '';
    for (const sym of symbols) {
        modulesStr += PATTERNS[sym];
    }
    // Add termination bar (2 modules wide)
    modulesStr += '2';

    // Calculate total modules
    const totalModules = modulesStr.split('').reduce((a, c) => a + parseInt(c), 0);
    const moduleWidth = width / totalModules;

    // Build SVG rects
    let x = 0;
    let rects = '';
    let isBar = true; // starts with bar
    for (const ch of modulesStr) {
        const w = parseInt(ch) * moduleWidth;
        if (isBar) {
            rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="black"/>`;
        }
        x += w;
        isBar = !isBar;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
}

// ── Simple QR-like SVG placeholder (2D matrix pattern) ─
// For real QR codes you'd use a library; this generates a
// visually-correct placeholder matching the Laravel SVG output
function generateQRSVG(text, size = 150) {
    // Use a simple deterministic pattern based on text hash
    // so same text → same visual (not a real QR, but consistent)
    const cells = 21; // QR version 1 = 21x21
    const cellSize = size / cells;

    // Seed a simple LCG from text
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) & 0xffffffff;
    function rand() {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        return (seed >>> 0) / 0x100000000;
    }

    // Build cell grid
    const grid = Array.from({ length: cells }, () => Array(cells).fill(0));

    // Finder patterns (top-left, top-right, bottom-left)
    function addFinder(row, col) {
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 7; c++) {
                if (r === 0 || r === 6 || c === 0 || c === 6) grid[row + r][col + c] = 1;
                else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) grid[row + r][col + c] = 1;
                else grid[row + r][col + c] = 0;
            }
        }
    }
    addFinder(0, 0);
    addFinder(0, cells - 7);
    addFinder(cells - 7, 0);

    // Fill data area with seeded random
    for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
            // Skip finder pattern areas
            if ((r < 8 && c < 8) || (r < 8 && c >= cells - 8) || (r >= cells - 8 && c < 8)) continue;
            grid[r][c] = rand() > 0.5 ? 1 : 0;
        }
    }

    let rects = '';
    for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
            if (grid[r][c]) {
                rects += `<rect x="${(c * cellSize).toFixed(2)}" y="${(r * cellSize).toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="black"/>`;
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="white"/>${rects}</svg>`;
}

// ── Date formatter (matches Laravel's date('d/m/Y')) ───
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// ── Build extra info array (shared by all templates) ───
function buildExtraInfo(displayOptions, productData, extraData, currency) {
    const items = [];
    if (displayOptions.price && productData.rate != null)
        items.push(formatPrice(productData.rate, currency));
    if (displayOptions.company && extraData.company)
        items.push(extraData.company);
    if (displayOptions.manufacturing && extraData.manufacturing)
        items.push(`Mfg: ${formatDate(extraData.manufacturing)}`);
    if (displayOptions.expiry && extraData.expiry)
        items.push(`Exp: ${formatDate(extraData.expiry)}`);
    if (displayOptions.other && extraData.other)
        items.push(extraData.other);
    if (displayOptions.description && extraData.description)
        items.push(extraData.description);
    return items;
}

// ── Build code image HTML ──────────────────────────────
function buildCodeImg(codeType, codeSvg, barcodeNumber) {
    if (codeType === 'qrcode') {
        const b64 = Buffer.from(codeSvg).toString('base64');
        return `<img src="data:image/svg+xml;base64,${b64}" alt="QR Code" style="width:80px;height:80px;">`;
    } else {
        const b64 = Buffer.from(codeSvg).toString('base64');
        return `<img src="data:image/svg+xml;base64,${b64}" alt="Barcode" style="max-width:100%;height:auto;max-height:20mm;">`;
    }
}

// ── THERMAL PDF ────────────────────────────────────────
function buildThermalPdf(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);

    let rows = '';
    for (let i = 0; i < copies; i++) {
        const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
        rows += `
        <tr>
            <td>
                ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
                <div class="barcode-image">${codeImg}</div>
                <div class="extra-info">${infoItems.join(' | ')}</div>
            </td>
        </tr>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - Thermal</title>
<style>
@page { margin: 2mm; size: 80mm auto; }
@media print { body { margin: 0; padding: 0; width: 76mm; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 8pt; width: 76mm; }
table { width: 100%; border-collapse: collapse; }
td { width: 100%; padding: 2mm; text-align: center; border: 1px dashed #ccc; }
.product-name { font-weight: bold; font-size: 10pt; margin-bottom: 2mm; word-wrap: break-word; line-height: 1.2; }
.barcode-image { margin: 2mm auto; display: flex; justify-content: center; align-items: center; }
.barcode-image img { max-width: 100%; width: auto; height: auto; max-height: 20mm; display: block; }
.extra-info { font-size: 7pt; color: #333; margin-top: 2mm; line-height: 1.2; }
</style>
</head>
<body>
<table>${rows}</table>
</body>
</html>`;
}

// ── A4 PDF ─────────────────────────────────────────────
function buildA4Pdf(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);

    let rows = '';
    let counter = 0;
    for (let i = 0; i < copies; i++) {
        const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
        if (counter % 3 === 0) rows += '<tr>';

        rows += `
        <td style="width:31%;padding:2mm;vertical-align:top;border:1px dashed #ccc;">
            <div style="text-align:center;">
                ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
                <div class="barcode-image">${codeImg}</div>
                <div class="extra-info">${infoItems.join(' | ')}</div>
            </div>
        </td>`;

        counter++;

        if (counter % 3 === 0 || i === copies - 1) {
            const rem = counter % 3;
            if (rem === 1) rows += '<td style="width:32%;"></td><td style="width:32%;"></td>';
            else if (rem === 2) rows += '<td style="width:32%;"></td>';
            rows += '</tr>';
        }
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - A4</title>
<style>
@page { margin: 10mm; size: A4; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 10pt; }
table { width: 100%; border-collapse: collapse; }
td { padding: 2mm; border: 1px dashed #ccc; }
.product-name { font-weight: bold; font-size: 9pt; margin-bottom: 2mm; word-wrap: break-word; }
.barcode-image { margin: 2mm 0; }
.barcode-image img { max-width: 100%; height: auto; }
.extra-info { font-size: 7pt; color: #333; margin-top: 2mm; }
</style>
</head>
<body>
<table style="width:100%;border-collapse:collapse;">${rows}</table>
</body>
</html>`;
}

// ── A5 PDF ─────────────────────────────────────────────
function buildA5Pdf(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);
    const itemsPerRow = 2;
    const rows = Math.ceil(copies / itemsPerRow);

    let tableRows = '';
    for (let row = 0; row < rows; row++) {
        tableRows += '<tr>';
        for (let col = 0; col < itemsPerRow; col++) {
            const index = row * itemsPerRow + col;
            if (index < copies) {
                const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
                tableRows += `
                <td>
                    <div style="text-align:center;">
                        ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
                        <div class="barcode-image">${codeImg}</div>
                        <div class="extra-info">${infoItems.join(' | ')}</div>
                    </div>
                </td>`;
            } else {
                tableRows += '<td></td>';
            }
        }
        tableRows += '</tr>';
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - A5</title>
<style>
@page { margin: 8mm; size: A5; }
@media print { body { margin: 0; padding: 0; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; }
td { padding: 2mm; border: 1px dashed #ccc; width: 50%; vertical-align: top; }
.product-name { font-weight: bold; font-size: 9pt; margin-bottom: 2mm; word-wrap: break-word; }
.barcode-image { margin: 3mm 0; }
.barcode-image img { max-width: 100%; height: auto; }
.extra-info { font-size: 7pt; color: #333; margin-top: 3mm; }
</style>
</head>
<body>
<table>${tableRows}</table>
</body>
</html>`;
}

// ── THERMAL PRINT ──────────────────────────────────────
function buildThermalPrint(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);

    let items = '';
    for (let i = 0; i < copies; i++) {
        const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
        items += `
        <div class="barcode-item">
            ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
            <div class="barcode-image">${codeImg}</div>
            <div class="extra-info">${infoItems.join(' | ')}</div>
        </div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - Thermal</title>
<style>
@page { margin: 2mm; size: 80mm auto; }
@media print { @page { size: 80mm auto; margin: 2mm; } body { margin: 0; padding: 0; width: 76mm; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 8pt; width: 76mm; }
.barcode-item { width: 100%; padding: 2mm; text-align: center; border: 1px dashed #ccc; margin-bottom: 3mm; page-break-inside: avoid; }
.barcode-item:last-child { margin-bottom: 0; }
.product-name { font-weight: bold; font-size: 10pt; margin-bottom: 2mm; word-wrap: break-word; line-height: 1.2; }
.barcode-image { margin: 2mm auto; display: flex; justify-content: center; align-items: center; }
.barcode-image img { max-width: 100%; width: auto; height: auto; max-height: 20mm; display: block; }
.extra-info { font-size: 7pt; color: #333; margin-top: 2mm; line-height: 1.2; }
</style>
</head>
<body>
${items}
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;
}

// ── A4 PRINT ───────────────────────────────────────────
function buildA4Print(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);

    let rows = '';
    let counter = 0;
    for (let i = 0; i < copies; i++) {
        const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
        if (counter % 3 === 0) rows += '<tr>';

        rows += `
        <td style="width:31%;padding:2mm;vertical-align:top;border:1px dashed #ccc;">
            <div style="text-align:center;">
                ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
                <div class="barcode-image">${codeImg}</div>
                <div class="extra-info">${infoItems.join(' | ')}</div>
            </div>
        </td>`;

        counter++;

        if (counter % 3 === 0 || i === copies - 1) {
            const rem = counter % 3;
            if (rem === 1) rows += '<td style="width:32%;"></td><td style="width:32%;"></td>';
            else if (rem === 2) rows += '<td style="width:32%;"></td>';
            rows += '</tr>';
        }
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - A4</title>
<style>
@page { margin: 10mm; size: A4; }
@media print { body { margin: 0; padding: 0; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 10pt; }
table { width: 100%; border-collapse: collapse; }
td { padding: 2mm; border: 1px dashed #ccc; }
.product-name { font-weight: bold; font-size: 9pt; margin-bottom: 2mm; word-wrap: break-word; }
.barcode-image { margin: 2mm 0; }
.barcode-image img { max-width: 100%; height: auto; }
.extra-info { font-size: 7pt; color: #333; margin-top: 2mm; }
</style>
</head>
<body>
<table style="width:100%;border-collapse:collapse;">${rows}</table>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;
}

// ── A5 PRINT ───────────────────────────────────────────
function buildA5Print(opts) {
    const { product, copies, displayOptions, productData, extraData, codeType, codeSvg, currency } = opts;
    const codeImg = buildCodeImg(codeType, codeSvg);
    const itemsPerRow = 2;
    const rows = Math.ceil(copies / itemsPerRow);

    let tableRows = '';
    for (let row = 0; row < rows; row++) {
        tableRows += '<tr>';
        for (let col = 0; col < itemsPerRow; col++) {
            const index = row * itemsPerRow + col;
            if (index < copies) {
                const infoItems = buildExtraInfo(displayOptions, productData, extraData, currency);
                tableRows += `
                <td>
                    <div style="text-align:center;">
                        ${displayOptions.productname ? `<div class="product-name">${product.product_name}</div>` : ''}
                        <div class="barcode-image">${codeImg}</div>
                        <div class="extra-info">${infoItems.join(' | ')}</div>
                    </div>
                </td>`;
            } else {
                tableRows += '<td></td>';
            }
        }
        tableRows += '</tr>';
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - A5</title>
<style>
@page { margin: 8mm; size: A5; }
@media print { body { margin: 0; padding: 0; } }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; }
td { padding: 2mm; border: 1px dashed #ccc; width: 50%; vertical-align: top; }
.product-name { font-weight: bold; font-size: 9pt; margin-bottom: 2mm; word-wrap: break-word; }
.barcode-image { margin: 3mm 0; }
.barcode-image img { max-width: 100%; height: auto; }
.extra-info { font-size: 7pt; color: #333; margin-top: 3mm; }
</style>
</head>
<body>
<table>${tableRows}</table>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;
}

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
    }
    return browserInstance;
}

export default async function barcodeRoutes(fastify) {

    // ── GET /api/barcode/search ────────────────────────
    fastify.get('/api/barcode/search', async (req, reply) => {
        try {
            const query = (req.query.query || '').trim();

            if (!query) return reply.send([]);

            // Parse tokens: price operators + name words
            const tokens = query.split(/\s+/);
            const nameSearch = [];
            let minPrice = null;
            let maxPrice = null;
            let hasPriceOp = false;

            for (const token of tokens) {
                let m;
                if ((m = token.match(/^>=(\d+(?:\.\d+)?)$/))) {
                    minPrice = parseFloat(m[1]); hasPriceOp = true;
                } else if ((m = token.match(/^<=(\d+(?:\.\d+)?)$/))) {
                    maxPrice = parseFloat(m[1]); hasPriceOp = true;
                } else if ((m = token.match(/^>(\d+(?:\.\d+)?)$/))) {
                    minPrice = parseFloat(m[1]) + 0.01; hasPriceOp = true;
                } else if ((m = token.match(/^<(\d+(?:\.\d+)?)$/))) {
                    maxPrice = parseFloat(m[1]) - 0.01; hasPriceOp = true;
                } else if ((m = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) {
                    minPrice = parseFloat(m[1]); maxPrice = parseFloat(m[2]); hasPriceOp = true;
                } else {
                    nameSearch.push(token);
                }
            }

            // Build query
            let sql = `SELECT id, type, product_name, purchased_price, sold_price, unit,
                              quantity, sold_quantity,
                              discount_type, discount, fix_discount,
                              fix_sold_price, tax, tax_type, fix_tax
                       FROM purchases
                       WHERE deleted_at IS NULL
                         AND type IN ('product','medicine')`;
            const params = [];

            if (hasPriceOp) {
                if (minPrice !== null && maxPrice !== null) {
                    sql += ' AND sold_price BETWEEN ? AND ?';
                    params.push(minPrice, maxPrice);
                } else if (minPrice !== null) {
                    sql += ' AND sold_price >= ?';
                    params.push(minPrice);
                } else if (maxPrice !== null) {
                    sql += ' AND sold_price <= ?';
                    params.push(maxPrice);
                }
            }

            for (const word of nameSearch) {
                sql += ' AND (product_name LIKE ? OR product_code LIKE ?)';
                params.push(`%${word}%`, `%${word}%`);
            }

            sql += ' LIMIT 10';

            const [rows] = await pool.query(sql, params);

            return reply.send(rows.map(p => ({
                id:             p.id,
                name:           p.product_name,
                price:          p.sold_price,
                purchased_price: p.purchased_price,
                type:           p.type,
                unit:           p.unit,
                available_stock: p.quantity - p.sold_quantity,
                fix_sold_price:  !!p.fix_sold_price,
                discount_type:   p.discount_type || 'amount',
                discount:        p.discount || 0,
                fix_discount:    !!p.fix_discount,
                tax:             p.tax || 0,
                tax_type:        p.tax_type || 'amount',
                fix_tax:         !!p.fix_tax,
            })));
        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: 'Search failed' });
        }
    });

    // ── POST /api/barcode/generate (download PDF) ──────
    fastify.post('/api/barcode/generate', async (req, reply) => {
        try {
            const {
                product_id, format = 'thermal', copies = 1,
                display_options = {}, product_data = {}, extra_data = {},
                code_type = 'barcode',
            } = req.body;

            if (!product_id) return reply.status(422).send({ error: 'product_id required' });

            const [[product]] = await pool.query(
                'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL',
                [product_id]
            );
            if (!product) return reply.status(404).send({ error: 'Product not found' });

            // Generate/save barcode or QR value
            let codeValue, codeSvg;

            if (code_type === 'qrcode') {
                codeValue = product.qr_code || padId(product.id);
                codeSvg   = generateQRSVG(codeValue, 120);
                if (!product.qr_code) {
                    await pool.query('UPDATE purchases SET qr_code = ? WHERE id = ?', [codeValue, product.id]);
                }
            } else {
                codeValue = product.barcode || padId(product.id);
                const barcodeWidth = format === 'thermal' ? 180 : 200;
                codeSvg   = generateBarcodeSVG(codeValue, barcodeWidth, 55);
                if (!product.barcode) {
                    await pool.query('UPDATE purchases SET barcode = ? WHERE id = ?', [codeValue, product.id]);
                }
            }

            const currency = await getCurrencySettings();
            const numCopies = Math.min(Math.max(parseInt(copies) || 1, 1), 50);
            const templateOpts = {
                product,
                copies:         numCopies,
                displayOptions: display_options,
                productData:    product_data,
                extraData:      extra_data || {},
                codeType:       code_type,
                codeSvg,
                currency,
            };

            const html = format === 'a4'
                ? buildA4Pdf(templateOpts)
                : format === 'a5'
                ? buildA5Pdf(templateOpts)
                : buildThermalPdf(templateOpts);

            // Use puppeteer to render PDF

            const browser = await getBrowser();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
const pdfOptions = { printBackground: true };
if (format === 'a4') {
    pdfOptions.format = 'A4';
} else if (format === 'a5') {
    pdfOptions.format = 'A5';
} else {
    pdfOptions.width = '80mm';
    pdfOptions.preferCSSPageSize = true;
}
const pdfBuffer = await page.pdf(pdfOptions);
await page.close();

const filename = `${code_type}-${product.product_name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;

await logActivity(req, {
    action_type: 'print',
    description: `Generated ${numCopies} ${code_type === 'qrcode' ? 'QR code' : 'barcode'} label(s) for "${product.product_name}" — Format: ${format.toUpperCase()} (PDF download)`,
    entity_type: 'purchase',
    entity_id: product_id,
    new_data: { format, copies: numCopies, code_type },
});

return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(Buffer.from(pdfBuffer));

} catch (err) {
fastify.log.error(err);
return reply.status(500).send({ error: 'Failed to generate PDF', message: err.message });
}
});

    // ── POST /api/barcode/print (return HTML for browser print) ──
    fastify.post('/api/barcode/print', async (req, reply) => {
        try {
            const {
                product_id, format = 'thermal', copies = 1,
                display_options = {}, product_data = {}, extra_data = {},
                code_type = 'barcode',
            } = req.body;

            if (!product_id) return reply.status(422).send({ error: 'product_id required' });

            const [[product]] = await pool.query(
                'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL',
                [product_id]
            );
            if (!product) return reply.status(404).send({ error: 'Product not found' });

            let codeValue, codeSvg;

            if (code_type === 'qrcode') {
                codeValue = product.qr_code || padId(product.id);
                codeSvg   = generateQRSVG(codeValue, 120);
                if (!product.qr_code) {
                    await pool.query('UPDATE purchases SET qr_code = ? WHERE id = ?', [codeValue, product.id]);
                }
            } else {
                codeValue = product.barcode || padId(product.id);
                const barcodeWidth = format === 'thermal' ? 180 : 200;
                codeSvg   = generateBarcodeSVG(codeValue, barcodeWidth, 55);
                if (!product.barcode) {
                    await pool.query('UPDATE purchases SET barcode = ? WHERE id = ?', [codeValue, product.id]);
                }
            }

            const currency = await getCurrencySettings();
            const numCopies = Math.min(Math.max(parseInt(copies) || 1, 1), 50);
            const templateOpts = {
                product,
                copies:         numCopies,
                displayOptions: display_options,
                productData:    product_data,
                extraData:      extra_data || {},
                codeType:       code_type,
                codeSvg,
                currency,
            };

            const html = format === 'a4'
                ? buildA4Print(templateOpts)
                : format === 'a5'
                ? buildA5Print(templateOpts)
                : buildThermalPrint(templateOpts);

            await logActivity(req, {
                action_type: 'print',
                description: `Printed ${numCopies} ${code_type === 'qrcode' ? 'QR code' : 'barcode'} label(s) for "${product.product_name}" — Format: ${format.toUpperCase()}`,
                entity_type: 'purchase',
                entity_id: product_id,
                new_data: { format, copies: numCopies, code_type },
            });

            return reply
                .header('Content-Type', 'text/html')
                .send(html);

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ error: 'Failed to generate print view', message: err.message });
        }
    });

    // ── POST /api/barcode/update-product ──────────────
    fastify.post('/api/barcode/update-product', async (req, reply) => {
        try {
            const {
                product_id, rate, discount, discount_type, tax, tax_type,
            } = req.body;

            if (!product_id) return reply.status(422).send({ success: false, message: 'product_id required' });

            const [[product]] = await pool.query(
                'SELECT id, product_name, sold_price, discount, discount_type, tax, tax_type FROM purchases WHERE id = ? AND deleted_at IS NULL',
                [product_id]
            );
            if (!product) return reply.status(404).send({ success: false, message: 'Product not found' });

            // Validate
            if (rate == null || isNaN(parseFloat(rate)) || parseFloat(rate) < 0) {
                return reply.status(422).send({ success: false, message: 'Valid rate is required' });
            }
            if (!['amount', 'percentage'].includes(discount_type)) {
                return reply.status(422).send({ success: false, message: 'Invalid discount_type' });
            }
            if (!['amount', 'percentage'].includes(tax_type)) {
                return reply.status(422).send({ success: false, message: 'Invalid tax_type' });
            }

            const newValues = {
                sold_price: parseFloat(rate),
                discount: parseFloat(discount) || 0,
                discount_type,
                tax: parseFloat(tax) || 0,
                tax_type,
            };

            await pool.query(
                `UPDATE purchases SET
                    sold_price    = ?,
                    discount      = ?,
                    discount_type = ?,
                    tax           = ?,
                    tax_type      = ?,
                    updated_at    = NOW()
                 WHERE id = ?`,
                [
                    newValues.sold_price,
                    newValues.discount,
                    newValues.discount_type,
                    newValues.tax,
                    newValues.tax_type,
                    product_id,
                ]
            );

            const changes = describeChanges(product, newValues, {
                sold_price: 'Sold Price',
                discount: 'Discount',
                discount_type: 'Discount Type',
                tax: 'Tax',
                tax_type: 'Tax Type',
            });
            const changeText = changes.length > 0 ? changes.join(', ') : 'No values changed';

            await logActivity(req, {
                action_type: 'edit',
                description: `Updated pricing for "${product.product_name}" via barcode screen — ${changeText}`,
                entity_type: 'purchase',
                entity_id: product_id,
                old_data: product,
                new_data: newValues,
            });

            return reply.send({ success: true, message: 'Product updated successfully' });

        } catch (err) {
            fastify.log.error(err);
            return reply.status(500).send({ success: false, message: err.message });
        }
    });
}