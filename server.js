// Fleet Fuel Manager - backend (Node.js 16+)
// Storage: Google Firestore when FIREBASE_SERVICE_ACCOUNT is set, otherwise a local file (data/records.json).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PASS = process.env.FLEET_PASSWORD || '';
const prefixOf = d => 'FM-' + d.replace(/-/g, '') + '-';

// Splits restored records into ones that keep their ID and ones that need a new ID
function planRestore(items) {
    const seen = new Set(), max = {}, keep = [], missing = [];
    for (const it of items) {
        const { id, ...c } = it;
        if (typeof id === 'string' && id && !seen.has(id)) {
            seen.add(id);
            const m = id.match(/^(FM-\d{8}-)(\d+)$/);
            if (m) max[m[1]] = Math.max(max[m[1]] || 0, +m[2]);
            keep.push({ id, ...c });
        } else missing.push(c);
    }
    return { keep, missing, max };
}

function fileStore() {
    const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
    const FILE = path.join(DIR, 'records.json'), CF = path.join(DIR, 'counters.json');
    fs.mkdirSync(DIR, { recursive: true });
    let records = [], counters = {};
    try { records = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') { console.error('Cannot read ' + FILE + ': ' + e.message); process.exit(1); } }
    try { counters = JSON.parse(fs.readFileSync(CF, 'utf8')); } catch (e) { }
    function persist() {
        const day = path.join(DIR, 'backup-' + new Date().toISOString().slice(0, 10) + '.json');
        if (fs.existsSync(FILE) && !fs.existsSync(day)) fs.copyFileSync(FILE, day); // one snapshot per day
        fs.writeFileSync(FILE + '.tmp', JSON.stringify(records, null, 1));
        fs.renameSync(FILE + '.tmp', FILE); // atomic write
        fs.writeFileSync(CF, JSON.stringify(counters));
    }
    function nextId(date, list) { // numbers are never reused, even after deletes
        const p = prefixOf(date); let m = counters[p] || 0;
        for (const r of list) if (r.id.startsWith(p)) m = Math.max(m, parseInt(r.id.slice(p.length), 10) || 0);
        counters[p] = m + 1;
        return p + String(m + 1).padStart(4, '0');
    }
    return {
        name: 'local file ' + FILE,
        async list(since) { return since ? records.filter(r => r.date >= since) : records.slice(); },
        async insert(c) { const rec = { id: nextId(c.date, records), ...c }; records.push(rec); persist(); return rec; },
        async insertMany(cs) { for (const c of cs) records.push({ id: nextId(c.date, records), ...c }); persist(); return cs.length; },
        async update(id, c) { const i = records.findIndex(r => r.id === id); if (i < 0) return null; records[i] = { id, ...c }; persist(); return records[i]; },
        async remove(id) { const i = records.findIndex(r => r.id === id); if (i < 0) return false; records.splice(i, 1); persist(); return true; },
        async replaceAll(items) {
            const { keep, missing, max } = planRestore(items);
            for (const p in max) counters[p] = Math.max(counters[p] || 0, max[p]);
            const next = [...keep];
            for (const c of missing) next.push({ id: nextId(c.date, next), ...c });
            records = next; persist(); return next.length;
        }
    };
}

async function firestoreStore() {
    const admin = require('firebase-admin');
    let cred;
    try { cred = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
    catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON - paste the whole contents of the key file'); }
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    const db = admin.firestore();
    const col = db.collection('records'), cnt = db.collection('counters');
    try { await cnt.limit(1).get(); }
    catch (e) { throw new Error('Cannot reach Firestore (' + e.message + '). Did you click "Create database" in the Firebase console?'); }
    const toRec = d => ({ id: d.id, ...d.data() });
    const notFound = e => e && (e.code === 5 || /NOT_FOUND/.test(e.message || ''));
    // Atomic counter: reserves k numbers for a day, so IDs stay unique even with several users
    const reserve = (p, k) => db.runTransaction(async t => {
        const ref = cnt.doc(p), s = await t.get(ref), cur = s.exists ? s.data().n : 0;
        t.set(ref, { n: cur + k }); return cur;
    });
    async function assignIds(cs) {
        const byP = {}, ids = [];
        cs.forEach((c, i) => { const p = prefixOf(c.date); (byP[p] = byP[p] || []).push(i); });
        for (const p in byP) {
            const start = await reserve(p, byP[p].length);
            byP[p].forEach((i, j) => { ids[i] = p + String(start + j + 1).padStart(4, '0'); });
        }
        return ids;
    }
    async function writeAll(pairs) { const bw = db.bulkWriter(); for (const [id, c] of pairs) bw.set(col.doc(id), c); await bw.close(); }
    return {
        name: 'Google Firestore (project ' + cred.project_id + ')',
        async list(since) { const q = since ? col.where('date', '>=', since) : col; return (await q.get()).docs.map(toRec); },
        async insert(c) { const [id] = await assignIds([c]); await col.doc(id).set(c); return { id, ...c }; },
        async insertMany(cs) { const ids = await assignIds(cs); await writeAll(ids.map((id, i) => [id, cs[i]])); return cs.length; },
        async update(id, c) { try { await col.doc(id).update(c); return { id, ...c }; } catch (e) { if (notFound(e)) return null; throw e; } },
        async remove(id) { try { await col.doc(id).delete({ exists: true }); return true; } catch (e) { if (notFound(e)) return false; throw e; } },
        async replaceAll(items) {
            const { keep, missing, max } = planRestore(items);
            for (const p in max) await db.runTransaction(async t => {
                const ref = cnt.doc(p), s = await t.get(ref); t.set(ref, { n: Math.max(s.exists ? s.data().n : 0, max[p]) });
            });
            const ids = await assignIds(missing);
            const old = await col.listDocuments(); const bw = db.bulkWriter(); old.forEach(r => bw.delete(r)); await bw.close();
            await writeAll([...keep.map(({ id, ...c }) => [id, c]), ...ids.map((id, i) => [id, missing[i]])]);
            return keep.length + missing.length;
        }
    };
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

// Pages: address -> file inside the public folder
const PAGES = { '/': 'fleet.html', '/fleet': 'fleet.html', '/fuel': 'fuel.html', '/index.html': 'fuel.html' };

let store, trips;
const server = http.createServer(async (req, res) => {
    try {
        if (!authed(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Fleet Fuel Manager"' }); return res.end('Login required'); }
        const p = new URL(req.url, 'http://x').pathname, m = req.method;
        if (!p.startsWith('/api/')) {
            if (!PAGES[p]) { res.writeHead(404); return res.end('Not found'); }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(path.join(__dirname, 'public', PAGES[p])));
        }
        if (p === '/api/fleet' || p.startsWith('/api/fleet/') || p.startsWith('/api/trips')) return await trips.handle(req, res, p, m);
        if (p === '/api/records' && m === 'GET') {
            const since = new URL(req.url, 'http://x').searchParams.get('since');
            const list = await store.list(/^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : null);
            return send(res, 200, list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
        }
        if (p === '/api/records' && m === 'POST') return send(res, 201, await store.insert(clean(await body(req))));
        if (p === '/api/import' && m === 'POST') {
            const arr = await body(req); if (!Array.isArray(arr)) throw new Error('Expected a list of records');
            return send(res, 201, { added: await store.insertMany(arr.map(clean)) }); // all validated first
        }
        if (p === '/api/restore' && m === 'POST') {
            const arr = await body(req); if (!Array.isArray(arr)) throw new Error('Expected a list of records');
            return send(res, 200, { count: await store.replaceAll(arr.map(b => ({ id: b.id, ...clean(b) }))) });
        }
        const one = p.match(/^\/api\/records\/(.+)$/);
        if (one) {
            const id = decodeURIComponent(one[1]);
            if (m === 'PUT') { const rec = await store.update(id, clean(await body(req))); return rec ? send(res, 200, rec) : send(res, 404, { error: 'Record not found' }); }
            if (m === 'DELETE') return (await store.remove(id)) ? send(res, 200, { deleted: id }) : send(res, 404, { error: 'Record not found' });
        }
        send(res, 404, { error: 'Not found' });
    } catch (e) { console.error(e.message); send(res, 400, { error: e.message }); }
});

(async () => {
    try { store = process.env.FIREBASE_SERVICE_ACCOUNT ? await firestoreStore() : fileStore(); }
    catch (e) { console.error('Could not start storage: ' + e.message); process.exit(1); }
    // Fleet trips + fleet list (same storage choice). The explicit ".js" stops Node picking a different file or folder named "trips".
    const makeTrips = require('./trips.js');
    if (typeof makeTrips !== 'function') { console.error('trips.js did not load correctly. Make sure it is the file from the chat and sits next to server.js.'); process.exit(1); }
    trips = makeTrips({ body, send });
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\nFleet Fuel Manager is running.\n  On this computer:  http://localhost:' + PORT);
        for (const l of Object.values(os.networkInterfaces()))
            for (const a of l) if (a.family === 'IPv4' && !a.internal) console.log('  On your network:   http://' + a.address + ':' + PORT);
        console.log('  Storage: ' + store.name);
        console.log(PASS ? '  Password protection: ON' : '  Password protection: OFF (set FLEET_PASSWORD to turn on)');
    });
})();
