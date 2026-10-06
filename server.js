// Fleet Fuel Manager - backend (no dependencies, needs Node.js 16+)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PASS = process.env.FLEET_PASSWORD || '';
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'records.json');
fs.mkdirSync(DIR, { recursive: true });

const CF = path.join(DIR, 'counters.json'); // remembers the last number used per day, so IDs are never reused
let counters = {};
try { counters = JSON.parse(fs.readFileSync(CF, 'utf8')); } catch (e) {}
let records = [];
try { records = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') { console.error('Cannot read ' + FILE + ': ' + e.message); process.exit(1); } }

function persist() {
  const day = path.join(DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
  if (fs.existsSync(FILE) && !fs.existsSync(day)) fs.copyFileSync(FILE, day); // one snapshot per day
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(records, null, 1));
  fs.renameSync(FILE + '.tmp', FILE); // atomic write
  fs.writeFileSync(CF, JSON.stringify(counters));
}
function newId(list, date) {
  const p = 'FM-' + date.replace(/-/g, '') + '-'; let m = counters[p] || 0;
  for (const r of list) if (r.id.startsWith(p)) m = Math.max(m, parseInt(r.id.slice(p.length), 10) || 0);
  counters[p] = m + 1;
  return p + String(m + 1).padStart(4, '0');
}
function clean(b) {
  const s = v => String(v == null ? '' : v).trim().slice(0, 100);
  const date = s(b.date), trip = s(b.trip), truck = s(b.truck), loc = s(b.loc);
  const fuel = Number(b.fuel), odo = (b.odo === '' || b.odo == null) ? '' : Number(b.odo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date (use YYYY-MM-DD)');
  if (!trip || !truck || !loc) throw new Error('Trip number, truck no and location are required');
  if (!isFinite(fuel) || fuel < 0) throw new Error('Given fuel must be a number, 0 or more');
  if (odo !== '' && (!isFinite(odo) || odo < 0)) throw new Error('Odometer must be a number, 0 or more');
  return { date, trip, truck, fuel, loc, odo };
}
function authed(req) {
  if (!PASS) return true;
  const [t, v] = (req.headers.authorization || '').split(' ');
  if (t !== 'Basic' || !v) return false;
  const pw = Buffer.from(v, 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pw), b = Buffer.from(PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function body(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 10e6) { no(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(new Error('Invalid JSON')); } });
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Fleet Fuel Manager"' }); return res.end('Login required'); }
    const p = new URL(req.url, 'http://x').pathname, m = req.method;
    if (!p.startsWith('/api/')) {
      if (p !== '/' && p !== '/index.html') { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (p === '/api/records' && m === 'GET') return send(res, 200, records);
    if (p === '/api/records' && m === 'POST') {
      const c = clean(await body(req)), rec = { id: newId(records, c.date), ...c };
      records.push(rec); persist(); return send(res, 201, rec);
    }
    if (p === '/api/import' && m === 'POST') {
      const arr = await body(req); if (!Array.isArray(arr)) throw new Error('Expected a list of records');
      const cleaned = arr.map(clean); // validate everything first
      for (const c of cleaned) records.push({ id: newId(records, c.date), ...c });
      persist(); return send(res, 201, { added: cleaned.length });
    }
    if (p === '/api/restore' && m === 'POST') {
      const arr = await body(req); if (!Array.isArray(arr)) throw new Error('Expected a list of records');
      const next = [], seen = new Set();
      for (const b of arr) {
        const c = clean(b); let id = typeof b.id === 'string' && b.id && !seen.has(b.id) ? b.id : newId(next, c.date);
        seen.add(id); next.push({ id, ...c });
      }
      records = next; persist(); return send(res, 200, { count: next.length });
    }
    const one = p.match(/^\/api\/records\/(.+)$/);
    if (one) {
      const id = decodeURIComponent(one[1]), i = records.findIndex(r => r.id === id);
      if (i < 0) return send(res, 404, { error: 'Record not found' });
      if (m === 'PUT') { records[i] = { id, ...clean(await body(req)) }; persist(); return send(res, 200, records[i]); }
      if (m === 'DELETE') { records.splice(i, 1); persist(); return send(res, 200, { deleted: id }); }
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\nFleet Fuel Manager is running.\n  On this computer:  http://localhost:' + PORT);
  for (const l of Object.values(os.networkInterfaces()))
    for (const a of l) if (a.family === 'IPv4' && !a.internal) console.log('  On your network:   http://' + a.address + ':' + PORT);
  console.log(PASS ? '  Password protection: ON' : '  Password protection: OFF (set FLEET_PASSWORD to turn on)');
  console.log('  Data file: ' + FILE + '\n');
});
