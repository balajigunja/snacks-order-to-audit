// One helper for every call to the backend. It adds the login token for you.
import { clearSession } from './auth.js';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status; // 0 means "could not reach the server" (offline)
    this.data = data;
  }
}

export async function api(path, method = 'GET', body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('No internet connection', 0);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/auth/login') {
    clearSession(); // token expired: go back to the login page
    window.location.href = '/';
  }
  if (!res.ok) throw new ApiError((data && data.error) || 'Something went wrong', res.status, data);
  return data;
}

// Download any file (PDF invoice, CSV report). The browser must send the token, so a plain link will not work.
export async function downloadFile(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError((data && data.error) || 'Download failed', res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// a report as a CSV file
export const downloadCsv = (path, filename) =>
  downloadFile(path + (path.includes('?') ? '&' : '?') + 'format=csv', filename);
