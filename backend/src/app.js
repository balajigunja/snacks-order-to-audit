import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import auth from './routes/auth.js';
import masters from './routes/masters.js';
import orders from './routes/orders.js';
import invoices from './routes/invoices.js';
import purchases from './routes/purchases.js';
import production from './routes/production.js';
import dispatch from './routes/dispatch.js';
import payments from './routes/payments.js';
import reports from './routes/reports.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', auth);
app.use('/api/masters', masters);
app.use('/api/orders', orders);
app.use('/api/invoices', invoices);
app.use('/api/purchases', purchases);
app.use('/api/production', production);
app.use('/api/dispatch', dispatch);
app.use('/api/payments', payments);
app.use('/api/reports', reports);

const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

export default app;