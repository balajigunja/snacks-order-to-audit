// AUDIT TRAIL: who changed what, and when. Only INSERT, never delete.
import db from '../db/connection.js';

export function logAudit({ userId, action, tableName, recordId, oldValue = null, newValue = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId, action, tableName, recordId,
    oldValue === null ? null : JSON.stringify(oldValue),
    newValue === null ? null : JSON.stringify(newValue)
  );
}