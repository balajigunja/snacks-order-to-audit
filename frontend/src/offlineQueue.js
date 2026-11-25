// OFFLINE ORDERS (stretch goal). When the phone has no internet, the order is saved on the phone
// and sent later. Every order has its own clientUuid, so sending it twice can never make a duplicate:
// the server recognises the uuid and answers "duplicate".
import { api } from './api.js';

const key = (userId) => `pendingOrders:${userId}`;

export const getPending = (userId) => JSON.parse(localStorage.getItem(key(userId)) || '[]');
const save = (userId, list) => localStorage.setItem(key(userId), JSON.stringify(list));

// crypto.randomUUID only works on https/localhost, so keep a simple fallback for a phone on plain http
export const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

export function queueOrder(userId, order) {
  save(userId, [...getPending(userId), order]);
}

// Try to send every saved order. Returns { sent, failed: [{ error }] }.
//  - no internet again -> stop and keep the rest for later
//  - server refused it (bad data) -> remove it and report why
export async function syncPending(userId) {
  const waiting = getPending(userId);
  const keep = [];
  const failed = [];
  let sent = 0;
  for (let i = 0; i < waiting.length; i++) {
    try {
      await api('/orders', 'POST', waiting[i]);
      sent += 1;
    } catch (err) {
      if (err.status === 0 || err.status >= 500) {
        keep.push(...waiting.slice(i)); // still offline or server down: try again later
        break;
      }
      failed.push({ error: err.message });
    }
  }
  save(userId, keep);
  return { sent, failed };
}
