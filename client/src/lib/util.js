// Dates, text and Excel helpers shared by every page
export const iso = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
export const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const today = () => iso(todayDate());
export const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const fmt = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const dd = n => n + (n === 1 ? ' day' : ' days');
// truck IDs match ignoring spaces: BCJ6422ZM = BCJ 6422 ZM
export const cmp = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
// tidy IDs like "BCH  6062 ZM" -> "BCH 6062 ZM"
export const idc = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
export const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

// Excel dates / text dates -> YYYY-MM-DD ('' when empty, null when not a date)
export function toIso(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return iso(new Date(v.getTime() + 432e5));
  if (typeof v == 'number') { const u = new Date(Math.round((v - 25569) * 864e5)); return u.getUTCFullYear() + '-' + String(u.getUTCMonth() + 1).padStart(2, '0') + '-' + String(u.getUTCDate()).padStart(2, '0'); }
  const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return null;
}
// Phone numbers: Excel drops the leading 0 (962752306 -> 0962752306) and some have a space ("0 971050455")
export function phone(v) { let s = String(v == null ? '' : v).trim(); if (/^[\d\s+]+$/.test(s)) { s = s.replace(/\s+/g, ''); if (/^[79]\d{8}$/.test(s)) s = '0' + s; } return s; }
// Find a column in an Excel row by any of its usual names (case, spaces and dots ignored)
export const norm = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
export function key(o, names) { for (const k of Object.keys(o)) if (names.includes(norm(k))) return o[k]; return ''; }

// The Excel library is big (about 1 MB), so it is only downloaded the first time an Excel button is used
let xl;
export const XLSX = () => (xl = xl || import('xlsx'));
export async function readWorkbook(file) {
  const X = await XLSX();
  const buf = await file.arrayBuffer();
  return { X, wb: X.read(buf, { type: 'array', cellDates: true }) };
}
// Make and download an .xlsx file. sheets = [[name, rowsWithHeader, colWidth?], ...]
export async function saveBook(name, sheets) {
  const X = await XLSX(), wb = X.utils.book_new();
  for (const [nm, rows, w] of sheets) {
    const ws = X.utils.aoa_to_sheet(rows);
    if (w) ws['!cols'] = rows[0].map(() => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, nm);
  }
  X.writeFile(wb, name);
}
