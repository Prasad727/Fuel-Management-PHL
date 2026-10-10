// Fleet trips storage + API (used by server.js). Same storage choice as fuel records:
// Firestore when FIREBASE_SERVICE_ACCOUNT is set, otherwise data/trips.json.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = /^\d{4}-\d{2}-\d{2}$/;
const nid = () => crypto.randomBytes(8).toString('hex');
const keyOf = t => t.h.toLowerCase() + '|' + t.ld;

function clean(b) {
    const s = (v, n = 100) => String(v == null ? '' : v).trim().slice(0, n);
    const o = { h: s(b.h).replace(/\s+/g, ' ').toUpperCase(), dir: b.dir === 'DRC' ? 'DRC' : 'ZAM', ld: s(b.ld), ll: s(b.ll), od: s(b.od), ol: s(b.ol), cl: s(b.cl), cc: b.cc === 'DRC' ? 'DRC' : 'ZAM', r: s(b.r, 200) };
    if (!o.h) throw new Error('Horse is required');
    if (!D.test(o.ld)) throw new Error('Loading date must be a valid date');
    if (o.od && !D.test(o.od)) throw new Error('Date offloaded must be a valid date');
    return o;
}

function fileStore() {
    const DIR = process.env.DATA_DIR || path.join(__dirname, 'data'), FILE = path.join(DIR, 'trips.json');
    fs.mkdirSync(DIR, { recursive: true });
    let all = [];
    try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const persist = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
    return {
        async list() { return all.slice(); },
        async putMany(ts) { for (const t of ts) { const i = all.findIndex(x => x.id === t.id); i < 0 ? all.push(t) : (all[i] = t); } persist(); },
        async del(id) { const i = all.findIndex(x => x.id === id); if (i < 0) return false; all.splice(i, 1); persist(); return true; },
        async replaceAll(ts) { all = ts.slice(); persist(); }
    };
}

function firestoreStore() {
    const db = require('firebase-admin').firestore(), col = db.collection('trips');
    const write = async ts => { const bw = db.bulkWriter(); for (const { id, ...c } of ts) bw.set(col.doc(id), c); await bw.close(); };
    return {
        async list() { return (await col.get()).docs.map(d => ({ id: d.id, ...d.data() })); },
        putMany: write,
        async del(id) { const r = col.doc(id); if (!(await r.get()).exists) return false; await r.delete(); return true; },
        async replaceAll(ts) { const bw = db.bulkWriter(); (await col.listDocuments()).forEach(r => bw.delete(r)); await bw.close(); await write(ts); }
    };
}

function fileFleet() {
    const DIR = process.env.DATA_DIR || path.join(__dirname, 'data'), FILE = path.join(DIR, 'fleet.json');
    fs.mkdirSync(DIR, { recursive: true });
    let a = [];
    try { a = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const w = () => fs.writeFileSync(FILE, JSON.stringify(a));
    return {
        async list() { return a.slice(); },
        async add(hs) { for (const h of hs) if (!a.includes(h)) a.push(h); w(); },
        async del(h) { const i = a.indexOf(h); if (i < 0) return false; a.splice(i, 1); w(); return true; }
    };
}
function firestoreFleet() {
    const db = require('firebase-admin').firestore(), col = db.collection('fleet'), id = h => h.replace(/\//g, '-');
    return {
        async list() { return (await col.get()).docs.map(d => d.data().h); },
        async add(hs) { const bw = db.bulkWriter(); for (const h of hs) bw.set(col.doc(id(h)), { h }); await bw.close(); },
        async del(h) { const r = col.doc(id(h)); if (!(await r.get()).exists) return false; await r.delete(); return true; }
    };
}

module.exports = ({ body, send }) => {
    const fb = !!process.env.FIREBASE_SERVICE_ACCOUNT;
    const st = fb ? firestoreStore() : fileStore(), fl = fb ? firestoreFleet() : fileFleet();
    // A truck already in the fleet list is never counted again. Only unknown trucks are added.
    async function register(hs) {
        const have = new Set(await fl.list()), nw = [...new Set(hs)].filter(h => !have.has(h));
        if (nw.length) await fl.add(nw);
        return nw.length;
    }
    return {
        async handle(req, res, p, m) {
            if (p === '/api/fleet' && m === 'GET') {
                if (!(await fl.list()).length) await register((await st.list()).map(t => t.h)); // first run: build the list from existing trips
                return send(res, 200, (await fl.list()).sort());
            }
            const fo = p.match(/^\/api\/fleet\/(.+)$/);
            if (fo && m === 'DELETE') return (await fl.del(decodeURIComponent(fo[1]))) ? send(res, 200, { deleted: fo[1] }) : send(res, 404, { error: 'Truck not found' });
            if (p === '/api/trips' && m === 'GET') return send(res, 200, await st.list());
            if (p === '/api/trips' && m === 'POST') { const t = { id: nid(), ...clean(await body(req)) }; await st.putMany([t]); const nt = await register([t.h]); return send(res, 201, { ...t, newTrucks: nt }); }
            if (p === '/api/trips/bulk' && m === 'POST') {
                const b = await body(req); if (!Array.isArray(b.trips)) throw new Error('Expected a list of trips');
                const inc = b.trips.map(clean), replace = b.mode === 'replace';
                const map = new Map((replace ? [] : await st.list()).map(t => [keyOf(t), t]));
                const changed = new Map(); let added = 0, updated = 0;
                for (const c of inc) {
                    const e = map.get(keyOf(c)), t = { id: e ? e.id : nid(), ...c };
                    e ? updated++ : added++; map.set(keyOf(c), t); changed.set(t.id, t);
                }
                if (replace) await st.replaceAll([...map.values()]); else await st.putMany([...changed.values()]);
                const newTrucks = await register(inc.map(c => c.h));
                return send(res, 200, { added, updated, total: map.size, newTrucks });
            }
            const one = p.match(/^\/api\/trips\/([\w-]+)$/);
            if (one && m === 'PUT') {
                const id = one[1], c = clean(await body(req));
                if (!(await st.list()).some(t => t.id === id)) return send(res, 404, { error: 'Trip not found' });
                await st.putMany([{ id, ...c }]); await register([c.h]); return send(res, 200, { id, ...c });
            }
            if (one && m === 'DELETE') return (await st.del(one[1])) ? send(res, 200, { deleted: one[1] }) : send(res, 404, { error: 'Trip not found' });
            return send(res, 404, { error: 'Not found' });
        }
    };
};
