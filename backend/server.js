import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import categoryRoutes from './routes/categories.js';
import navbarRoutes from './routes/navbar.js';
import purchaseRoutes from './routes/purchases.js';
import supplierRoutes from './routes/supplier.js';
import expenseRoutes from './routes/expenses.js';
import manualNoteRoutes from './routes/manualNotes.js';
import licenseRoutes from './routes/license.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import customerRoutes from './routes/customers.js';
import creditCustomerRoutes from './routes/creditCustomers.js';
import advanceCustomerRoutes from './routes/advanceCustomers.js';
import customerLedgerRoutes from './routes/customerLedgerRoutes.js';
import { checkAuth } from './middleware/checkAuth.js';
import userRoutes from './routes/users.js';
import salesFilterRoutes from './routes/salesFilter.js';
import { checkLicense } from './middleware/checkLicense.js';
import multipart from '@fastify/multipart';
import salesRoutes from './routes/sales.js';
import staticFiles from '@fastify/static';
import dailySale from './routes/dailySale.js';
import bankAccountRoutes from './routes/bankAccounts.js';
import dashboardRoutes from './routes/dashboard.js';
import salesReportRoutes from './routes/salesReport/salesReport.js';
import financialReportRoutes from './routes/financialReport/financialReport.js';
import purchaseReportRoutes from './routes/purchaseReport/purchaseReport.js';
import customerDetailsRoutes from './routes/customerDetails.js';
import generalSalesRoutes from './routes/generalSale.js';
import creditSaleRoutes from './routes/creditSale.js';
import returnedSaleRoutes from './routes/returnedSale.js';
import saleReturnProcessRoutes from './routes/saleReturnProcess.js';
import walkInReturnRoutes from './routes/walkInReturn.js';
import barcodeRoutes from './routes/barcode.js';
import backupRoutes from './routes/backup.js';
import recycleBinRoutes from './routes/recycleBin.js';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const fastify = Fastify({ logger: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await fastify.register(multipart);
await fastify.register(staticFiles, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
});

// Cookie plugin (required for session-based auth)
await fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'pos-cookie-secret-change-in-production',
});

// CORS — allow Next.js frontend
await fastify.register(cors, {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
    exposedHeaders: ['Set-Cookie'],
});

fastify.addHook('onRequest', async (req, reply) => {
    await checkLicense(req, reply);
});

fastify.addHook('onRequest', async (req, reply) => {
    await checkAuth(req, reply);
});

fastify.setErrorHandler(async (error, req, reply) => {
    fastify.log.error(error);
    reply
        .header('Access-Control-Allow-Origin', 'http://localhost:3000')
        .header('Access-Control-Allow-Credentials', 'true')
        .status(500)
        .send({ error: 'Internal Server Error', message: error.message });
});

// Register route groups
await fastify.register(categoryRoutes);
await fastify.register(purchaseRoutes);
await fastify.register(supplierRoutes);
await fastify.register(expenseRoutes);
await fastify.register(manualNoteRoutes);
await fastify.register(authRoutes);
await fastify.register(licenseRoutes);
await fastify.register(userRoutes);
await fastify.register(barcodeRoutes);
await fastify.register(salesFilterRoutes);
await fastify.register(salesRoutes);
await fastify.register(dailySale);
await fastify.register(generalSalesRoutes);
await fastify.register(creditSaleRoutes);
await fastify.register(returnedSaleRoutes);
await fastify.register(saleReturnProcessRoutes);
await fastify.register(walkInReturnRoutes);
await fastify.register(navbarRoutes);
await fastify.register(customerRoutes);
await fastify.register(creditCustomerRoutes);
await fastify.register(advanceCustomerRoutes);
await fastify.register(customerLedgerRoutes);
await fastify.register(dashboardRoutes);
await fastify.register(backupRoutes);
await fastify.register(salesReportRoutes);
await fastify.register(financialReportRoutes);
await fastify.register(purchaseReportRoutes);
await fastify.register(customerDetailsRoutes);
await fastify.register(recycleBinRoutes);
await fastify.register(settingsRoutes);
await fastify.register(bankAccountRoutes);

// Start server
try {
    await fastify.listen({ port: 4000, host: '0.0.0.0' });
    console.log('✅ Fastify server running on http://localhost:4000');
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}