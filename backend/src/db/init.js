
import fs from 'fs';
import db from './connection.js';
db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('Tables created');
