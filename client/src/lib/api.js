// One place for all calls to the server. A 401 (logged out) sends you to the login page.
export async function api(method, url, data) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: data !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Please log in again.'); }
  let j = null; try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error((j && j.error) || ('Server error ' + r.status));
  return j;
}
