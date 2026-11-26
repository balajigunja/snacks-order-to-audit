import 'dotenv/config';
import fs from 'node:fs';
import db from './db/connection.js';
import app from './app.js';

db.exec(fs.readFileSync(new URL('./db/schema.sql', import.meta.url), 'utf8'));
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  await import('./db/seed_benchmark.js');
}

app.listen(process.env.PORT || 5000, () => console.log('API running'));