export function generatePrintHtml({ heading, columns, rows, shop, shopName, ownerName, logoHtml, createdAt, printedAt }) {

    const theadHtml = columns.map(col => `<th>${col}</th>`).join('');
    const tbodyHtml = rows.map(row =>
        `<tr>${columns.map(col => `<td>${row[col] ?? ''}</td>`).join('')}</tr>`
    ).join('');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Print - ${heading}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        @media print {
            body { margin: 0; padding: 0; font-size: 9px; }
            .no-print { display: none; }
            .company-header { page-break-inside: avoid; }
        }
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; font-size: 11px; }
        .print-container { display: flex; justify-content: center; position: fixed; gap: 20px; top: 10px; right: 10px; }
        .print-button { padding: 8px 16px; background: #000; color: #fff; border: none; cursor: pointer; font-size: 12px; border-radius: 5px; }
        .header-section { width: 100%; margin-top: 35px; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #000; }
        .header-table { width: 100%; border-collapse: collapse; }
        .header-table td { vertical-align: top; padding: 5px; border: none; }
        .header-left { width: 30%; text-align: left; }
        .header-center { width: 40%; text-align: center; }
        .header-right { width: 30%; text-align: right; }
        .company-logo { max-width: 80px; max-height: 80px; object-fit: contain; }
        .shop-details .shop-name { font-weight: bold; font-size: 11px; margin-bottom: 5px; color: #2c3e50; text-transform: capitalize; }
        .shop-details .detail-line { margin-bottom: 3px; color: #555; font-size: 10px; }
        .main-heading { font-size: 20px; margin-bottom: 6px; text-transform: uppercase; font-weight: bold; color: #2c3e50; }
        .sub-heading { font-size: 12px; color: #666; margin-top: 3px; }
        .header { margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #bdc3c7; }
        .heading { font-size: 14px; font-weight: bold; color: #2c3e50; margin-bottom: 4px; }
        .meta { font-size: 9px; color: #7f8c8d; }
        table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
        th { background-color: #2c3e50; color: white; padding: 10px 6px; text-align: center; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; overflow-wrap: break-word; }
        td { border: 1px solid #dfe4ea; padding: 10px 6px; text-align: center; vertical-align: middle; word-wrap: break-word; overflow-wrap: break-word; font-size: 10px; color: #2c3e50; }
        tr:nth-child(even) { background-color: #f8f9fa; }
        .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 7px; color: #7f8c8d; text-align: center; }
        .footer-company { font-weight: bold; color: #2c3e50; }
    </style>
</head>
<body>
    <div class="print-container no-print">
        <button class="print-button" onclick="window.print()">🖨️ Print</button>
    </div>

    <div class="header-section">
        <table class="header-table">
            <tr>
                <td class="header-left">
                    <div class="shop-details">
                        <div class="shop-name">${shopName}</div>
                        <div class="detail-line">Owner: ${ownerName}</div>
                        <div class="detail-line">${shop.address ?? 'N/A'}</div>
                        <div class="detail-line">City: ${shop.city ?? 'N/A'}</div>
                        <div class="detail-line">Phone: ${shop.phone ?? 'N/A'}</div>
                    </div>
                </td>
                <td class="header-center">
                    <div class="main-heading">NOTES</div>
                    <div class="sub-heading">Manual Note Record</div>
                </td>
                <td class="header-right">${logoHtml}</td>
            </tr>
        </table>
    </div>

    <div class="header">
        <div class="heading">${heading}</div>
        <div class="meta">Created on ${createdAt}</div>
    </div>

    <table>
        <thead><tr>${theadHtml}</tr></thead>
        <tbody>${tbodyHtml}</tbody>
    </table>

    <div class="footer">
        <div class="footer-company">Powered by ZIT Solutions - ZeeroX Software</div>
        <div>Printed on ${printedAt}</div>
    </div>
</body>
</html>`;
}