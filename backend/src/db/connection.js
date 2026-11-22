
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('factory.db');
db.exec('PRAGMA foreign_keys = ON');
// Use it for invoice + stock changes, production runs, etc.
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
