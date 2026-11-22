// One helper for all API calls. Adds the login token automatically.
export async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}
