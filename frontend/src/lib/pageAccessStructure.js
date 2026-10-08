// src/lib/pageAccessStructure.js
export const PAGE_STRUCTURE = [
    { key: 'dashboard', label: 'Dashboard', icon: 'fa-gauge' },
    { key: 'sales.create', label: 'Make a Sale', icon: 'fa-print', children: [] },
    {
        key: 'purchase', label: 'Purchase', icon: 'fa-shopping-cart',
        children: [
            { key: 'purchase.add', label: 'Add Purchase' },
            { key: 'purchase.supplier', label: 'Supplier', actions: [
                { key: 'purchase.supplier.act.edit', label: 'Edit' },
                { key: 'purchase.supplier.act.delete', label: 'Delete' },
            ] },
            { key: 'purchase.low-inventory', label: 'Low Inventory', actions: [
                { key: 'purchase.low-inventory.act.restock', label: 'Restock' },
            ] },
            { key: 'purchase.list', label: 'To See', actions: [
                { key: 'purchase.list.act.edit', label: 'Edit' },
                { key: 'purchase.list.act.restock', label: 'Restock' },
                { key: 'purchase.list.act.delete', label: 'Delete' },
                { key: 'purchase.list.act.import', label: 'Import Purchase' },
                { key: 'purchase.list.act.export', label: 'Export Purchase' },
            ] },
            { key: 'purchase.stock-overview', label: 'Stock Overview' },
            { key: 'purchase.expired', label: 'Expired Products' },
        ],
    },
    {
        key: 'sales', label: 'Sales', icon: 'fa-money-bill',
        children: [
            { key: 'sales.daily', label: 'Daily Sale' },
            { key: 'sales.general', label: 'General Sale', actions: [
                { key: 'sales.general.act.full-return', label: 'Full Return' },
                { key: 'sales.general.act.partial-return', label: 'Partial Return' },
                { key: 'sales.general.act.delete', label: 'Delete' },
                { key: 'sales.general.act.edit', label: 'Edit' },
                { key: 'sales.general.act.print-receipt', label: 'Print Receipt' },
                { key: 'sales.general.act.undo-sale', label: 'Undo Sale' },
            ] },
            { key: 'sales.credit', label: 'Credit Sale', actions: [
                { key: 'sales.credit.act.mark-paid', label: 'Mark as Paid' },
                { key: 'sales.credit.act.add-payment', label: 'Add Payment' },
                { key: 'sales.credit.act.return-sale', label: 'Return Sale' },
                { key: 'sales.credit.act.delete', label: 'Delete' },
                { key: 'sales.credit.act.edit-due-date', label: 'Edit Due Date' },
                { key: 'sales.credit.act.download-pdf', label: 'Download PDF' },
                { key: 'sales.credit.act.share-whatsapp', label: 'Share on WhatsApp' },
                { key: 'sales.credit.act.reduce-qty', label: 'Reduce Quantity' },
                { key: 'sales.credit.act.delete-item', label: 'Delete Item' },
            ] },
            { key: 'sales.returns', label: 'Returned Sale', actions: [
                { key: 'sales.returns.act.delete', label: 'Delete' },
            ] },
            { key: 'sales.returns-without-invoice', label: 'Return Without Invoice' },
        ],
    },
    {
        key: 'categories', label: 'Categories', icon: 'fa-book',
        children: [
            { key: 'categories.list', label: 'To See', actions: [
                { key: 'categories.list.act.edit', label: 'Edit' },
                { key: 'categories.list.act.delete', label: 'Delete' },
            ] },
        ],
    },
    {
        key: 'expenses', label: 'Expense', icon: 'fa-file-invoice-dollar',
        children: [
            { key: 'expenses.create', label: 'Add' },
            { key: 'expenses.index', label: 'To See', actions: [
                { key: 'expenses.index.act.edit', label: 'Edit' },
                { key: 'expenses.index.act.delete', label: 'Delete' },
            ] },
        ],
    },
    {
        key: 'reports', label: 'Reports', icon: 'fa-chart-bar',
        children: [
            { key: 'reports.sales', label: 'Sales Report' },
            { key: 'reports.financial', label: 'Financial Report' },
            { key: 'reports.purchase', label: 'Purchase Report' },
        ],
    },
    {
        key: 'customers', label: 'Customers', icon: 'fa-users',
        children: [
            { key: 'customers.list', label: 'Customers', actions: [
                { key: 'customers.list.act.account-ledger', label: 'Account Ledger' },
                { key: 'customers.list.act.delete', label: 'Delete' },
            ] },
            { key: 'customers.credit', label: 'Credit Customers' },
            { key: 'customers.advance', label: 'Advance Customers' },
        ],
    },
    {
        key: 'manual-notes', label: 'Notes', icon: 'fa-sticky-note',
        actions: [
            { key: 'manual-notes.act.create', label: 'Create Note' },
            { key: 'manual-notes.act.edit', label: 'Edit' },
            { key: 'manual-notes.act.pdf', label: 'PDF' },
            { key: 'manual-notes.act.print', label: 'Print' },
            { key: 'manual-notes.act.share', label: 'Share' },
            { key: 'manual-notes.act.delete', label: 'Delete' },
        ],
    },
    {
        key: 'barcode', label: 'Barcode Generator', icon: 'fa-barcode',
        actions: [
            { key: 'barcode.act.update-database', label: 'Update Database' },
            { key: 'barcode.act.pdf', label: 'PDF' },
            { key: 'barcode.act.print', label: 'Print' },
        ],
    },
    { key: 'admin', label: 'Admin Panel', icon: 'fa-shield-alt' },
    {
        key: 'backup', label: 'Backup & Restore', icon: 'fa-database',
        actions: [
            { key: 'backup.act.export-sql', label: 'Export SQL' },
            { key: 'backup.act.import-sql', label: 'Import SQL' },
            { key: 'backup.act.factory-reset', label: 'Factory Reset' },
        ],
    },
    {
        key: 'recycle-bin', label: 'Recycle Bin', icon: 'fa-trash-can-arrow-up',
        actions: [
            { key: 'recycle-bin.act.restore', label: 'Restore' },
        ],
    },
];

export const DEFAULT_BLOCKED_ACCESS = [
    'dashboard',
    'reports',
    'reports.sales',
    'reports.financial',
    'reports.purchase',
    'expenses.create',
    'expenses.index',
    'admin',
];