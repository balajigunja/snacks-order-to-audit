
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_FILE || 'factory.db');
db.exec('PRAGMA foreign_keys = ON');

export function runInTransaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export default db;