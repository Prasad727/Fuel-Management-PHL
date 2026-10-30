// Fleet Master View - backend for trips + trucks shown on /master
// Storage: a SEPARATE Google Firebase project (not the fuel one).
//   MASTER_FIREBASE_SERVICE_ACCOUNT = the whole contents of the service-account key file of the NEW Firebase project
// If that setting is missing, data is kept in a local file (data/master.json) and a warning is printed.
//
// Firestore collections in the new project:
//   master_trips    one document per trip  (document ID = trip ID, e.g. TRIP-0001)
//   master_trucks   one document per truck (document ID = truck ID, e.g. TRK-001)
//   master_counters 'trips' -> { n } the last trip number given out (numbers are never reused)
//
// API (all need a login, same as the rest of the server):
//   GET    /api/master                -> { trucks:[...], trips:[...], storage }
//   POST   /api/master/trips          -> new trip, server gives the next Trip ID
//   PUT    /api/master/trips/:id      -> update a trip (also changes the truck's driver details if "truckInfo" is sent)
//   DELETE /api/master/trips/:id
//   PUT    /api/master/trucks/:id     -> add or update one truck
//   POST   /api/master/delete         -> { trips:[ids], trucks:[ids] } delete many (trucks that still have trips are kept)
//   POST   /api/master/bulk           -> { trucks:[...], trips:[...] } add/update many (Excel bulk upload). Nothing is deleted.
const fs = require('fs'), path = require('path');
const VERSION = 5; // the page checks this number: 3 = trailer, passport, licence, 2-leg trips and loading locations

// Trip stages, in order: Dispatched, Loading, In Transit, Offloading, Loading 2, In Transit 2, Delivered, Offloading 2 (= trip completed)
const DATE = /^\d{4}-\d{2}-\d{2}$/, STAGES = ['d', 'l', 't', 'u', 'l2', 't2', 'v', 'r'];
const str = (v, n = 100) => String(v == null ? '' : v).trim().slice(0, n);
// IDs may contain letters, numbers, spaces, dots, dashes and underscores (e.g. truck "BCH 6062 ZM"). Extra spaces are squeezed to one.
const ID = /^[\w][\w .-]{0,39}$/, idc = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
// Truck IDs are matched ignoring spaces and capitals: "BCJ6422ZM" = "BCJ 6422 ZM" = "bcj 6422 zm"
const cmp = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
const tripNo = id => { const m = /^TRIP-(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
const tripId = n => 'TRIP-' + String(n).padStart(4, '0');

function cleanTrip(b) {
    const t = { truck: idc(b.truck), route: str(b.route, 150), plan: Math.round(Number(b.plan)) || 15, n: str(b.n, 500), lp: str(b.lp, 100), lp2: str(b.lp2, 100) };
    if (!t.truck) throw new Error('Truck ID is required');
    if (t.plan < 1 || t.plan > 365) throw new Error('Planned trip days must be between 1 and 365');
    for (const k of STAGES) {
        const v = str(b[k]);
        if (v && !DATE.test(v)) throw new Error('Invalid date "' + v + '" (use YYYY-MM-DD)');
        t[k] = v;
    }
    if (t.r && !(t.d || t.l)) throw new Error('An Offloading 2 (completed) date needs a dispatched or loading date');
    if (t.r && t.r < (t.d || t.l)) throw new Error('Offloading 2 (completed) date is before the start of the trip');
    return t;
}
function cleanTruck(b) {
    return {
        reg: str(b.reg), trailer: str(b.trailer, 40), driver: str(b.driver), contact: str(b.contact, 40),
        passport: str(b.passport, 40), licence: str(b.licence, 40), category: str(b.category, 20), issue: str(b.issue, 20),
        type: str(b.type), status: str(b.status) || 'Active'
    };
}

// ---------- storage: separate Firebase project ----------
async function firestoreStore(raw) {
    const admin = require('firebase-admin');
    let cred;
    try { cred = JSON.parse(raw); }
    catch (e) { throw new Error('MASTER_FIREBASE_SERVICE_ACCOUNT is not valid JSON - paste the whole contents of the NEW project\'s key file'); }
    // A NAMED app, so it never mixes with the fuel Firebase (the default app)
    const app = admin.initializeApp({ credential: admin.credential.cert(cred), projectId: cred.project_id }, 'fleet-master');
    const db = require('firebase-admin/firestore').getFirestore(app);
    const trips = db.collection('master_trips'), trucks = db.collection('master_trucks'), counter = db.collection('master_counters').doc('trips');
    try { await counter.get(); }
    catch (e) { throw new Error('Cannot reach the fleet-master Firestore (' + e.message + '). Did you click "Create database" in the NEW Firebase project?'); }
    const toObj = d => ({ id: d.id, ...d.data() });
    // Reserve k trip numbers in one transaction, so two people never get the same Trip ID
    const reserve = k => db.runTransaction(async t => {
        const s = await t.get(counter);
        let cur = s.exists ? s.data().n : null;
        if (cur == null) { // first time: start after the highest Trip ID already stored
            cur = 0; (await t.get(trips)).docs.forEach(d => { cur = Math.max(cur, tripNo(d.id)); });
        }
        t.set(counter, { n: cur + k }); return cur;
    });
    const bump = async n => db.runTransaction(async t => { // keeps the counter above any Trip ID typed in by hand / uploaded
        const s = await t.get(counter); if (!s.exists || s.data().n < n) t.set(counter, { n });
    });
    async function writeMany(col, pairs) { const bw = db.bulkWriter(); pairs.forEach(([id, o]) => bw.set(col.doc(id), o, { merge: true })); await bw.close(); }
    return {
        name: 'Google Firestore (project ' + cred.project_id + ') - collections master_trips / master_trucks',
        async all() {
            const [a, b] = await Promise.all([trucks.get(), trips.get()]);
            return { trucks: a.docs.map(toObj), trips: b.docs.map(toObj) };
        },
        async newIds(k) { const s = await reserve(k); return Array.from({ length: k }, (_, i) => tripId(s + i + 1)); },
        bump,
        async getTrip(id) { const s = await trips.doc(id).get(); return s.exists ? toObj(s) : null; },
        async truckExists(id) { return (await trucks.doc(id).get()).exists; },
        async putTrip(id, t) { await trips.doc(id).set(t); return { id, ...t }; },
        async delTrip(id) { const r = trips.doc(id); if (!(await r.get()).exists) return false; await r.delete(); return true; },
        async putTruck(id, k) { await trucks.doc(id).set(k, { merge: true }); return { id, ...(await trucks.doc(id).get()).data() }; },
        async putMany(tk, tp) { await writeMany(trucks, tk); await writeMany(trips, tp); },
        async delMany(tp, tk) { const bw = db.bulkWriter(); tp.forEach(id => bw.delete(trips.doc(id))); tk.forEach(id => bw.delete(trucks.doc(id))); await bw.close(); }
    };
}

// ---------- storage: local file (only when the Firebase setting is missing) ----------
function fileStore() {
    const DIR = process.env.DATA_DIR || path.join(__dirname, 'data'), FILE = path.join(DIR, 'master.json');
    fs.mkdirSync(DIR, { recursive: true });
    let S = { trucks: [], trips: [], n: 0 };
    try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') { console.error('Cannot read ' + FILE + ': ' + e.message); process.exit(1); } }
    const persist = () => {
        const day = path.join(DIR, 'master-backup-' + new Date().toISOString().slice(0, 10) + '.json');
        if (fs.existsSync(FILE) && !fs.existsSync(day)) fs.copyFileSync(FILE, day);
        fs.writeFileSync(FILE + '.tmp', JSON.stringify(S, null, 1)); fs.renameSync(FILE + '.tmp', FILE);
    };
    const up = (list, id, o, merge) => { const i = list.findIndex(x => x.id === id), v = { id, ...(merge && i >= 0 ? list[i] : {}), ...o }; i < 0 ? list.push(v) : list[i] = v; return v; };
    return {
        name: 'local file ' + FILE + '  (WARNING: set MASTER_FIREBASE_SERVICE_ACCOUNT to use the new Firebase)',
        async all() { return { trucks: S.trucks.slice(), trips: S.trips.slice() }; },
        async newIds(k) { S.trips.forEach(t => { S.n = Math.max(S.n, tripNo(t.id)); }); const s = S.n; S.n += k; persist(); return Array.from({ length: k }, (_, i) => tripId(s + i + 1)); },
        async bump(n) { if (S.n < n) { S.n = n; persist(); } },
        async getTrip(id) { return S.trips.find(t => t.id === id) || null; },
        async truckExists(id) { return S.trucks.some(t => t.id === id); },
        async putTrip(id, t) { const v = up(S.trips, id, t, false); persist(); return v; },
        async delTrip(id) { const i = S.trips.findIndex(t => t.id === id); if (i < 0) return false; S.trips.splice(i, 1); persist(); return true; },
        async putTruck(id, k) { const v = up(S.trucks, id, k, true); persist(); return v; },
        async putMany(tk, tp) { tk.forEach(([id, o]) => up(S.trucks, id, o, true)); tp.forEach(([id, o]) => up(S.trips, id, o, true)); persist(); },
        async delMany(tp, tk) { const a = new Set(tp), b = new Set(tk); S.trips = S.trips.filter(t => !a.has(t.id)); S.trucks = S.trucks.filter(t => !b.has(t.id)); persist(); }
    };
}

module.exports = async function makeMaster({ body, send }) {
    const raw = process.env.MASTER_FIREBASE_SERVICE_ACCOUNT;
    const store = raw ? await firestoreStore(raw) : fileStore();
    // Returns the truck ID as stored (so "BCJ6422ZM" typed on a trip finds the stored "BCJ 6422 ZM")
    const resolveTruck = async id => {
        if (await store.truckExists(id)) return id;
        const hit = (await store.all()).trucks.find(x => cmp(x.id) === cmp(id));
        if (!hit) throw new Error('Truck ' + id + ' does not exist');
        return hit.id;
    };

    async function handle(req, res, p, m) {
        if (p === '/api/master' && m === 'GET') return send(res, 200, { ...(await store.all()), storage: store.name, version: VERSION });

        if (p === '/api/master/trips' && m === 'POST') {
            const b = await body(req), t = cleanTrip(b); t.truck = await resolveTruck(t.truck);
            const [id] = await store.newIds(1);
            if (b.truckInfo) await store.putTruck(t.truck, cleanTruck(b.truckInfo));
            return send(res, 201, await store.putTrip(id, t));
        }
        let mt = p.match(/^\/api\/master\/trips\/([^/]+)$/);
        if (mt) {
            const id = idc(decodeURIComponent(mt[1]));
            if (!ID.test(id)) throw new Error('Invalid trip ID');
            if (m === 'PUT') {
                const b = await body(req), t = cleanTrip(b); t.truck = await resolveTruck(t.truck);
                if (b.truckInfo) await store.putTruck(t.truck, cleanTruck(b.truckInfo));
                await store.bump(tripNo(id));
                return send(res, 200, await store.putTrip(id, t));
            }
            if (m === 'DELETE') return (await store.delTrip(id)) ? send(res, 200, { deleted: id }) : send(res, 404, { error: 'Trip not found' });
        }
        mt = p.match(/^\/api\/master\/trucks\/([^/]+)$/);
        if (mt && m === 'PUT') {
            const id = idc(decodeURIComponent(mt[1]));
            if (!ID.test(id)) throw new Error('Invalid truck ID');
            return send(res, 200, await store.putTruck(id, cleanTruck(await body(req))));
        }
        if (p === '/api/master/bulk' && m === 'POST') {
            const b = await body(req), tk = Array.isArray(b.trucks) ? b.trucks : [], tp = Array.isArray(b.trips) ? b.trips : [];
            if (tk.length + tp.length > 20000) throw new Error('Too many rows in one upload (max 20,000)');
            // Check everything first, so a bad row never leaves a half-done upload
            const haveMap = new Map((await store.all()).trucks.map(x => [cmp(x.id), x.id])), have = new Set(haveMap.values());
            const truckPairs = tk.map((x, i) => {
                let id = idc(x.id); id = haveMap.get(cmp(id)) || id; if (!ID.test(id)) throw new Error('Trucks row ' + (i + 2) + ': invalid truck ID "' + id + '" (use letters, numbers, spaces, - . _ only)');
                const o = cleanTruck(x);
                if (have.has(id)) for (const k of Object.keys(o)) if (str(x[k]) === '') delete o[k]; // blank cells do not wipe stored details
                return [id, o];
            });
            const known = new Map([...have, ...truckPairs.map(x => x[0])].map(id => [cmp(id), id]));
            const clean = tp.map((x, i) => {
                let t; try { t = cleanTrip(x); } catch (e) { throw new Error('Trips row ' + (x.row || i + 2) + ': ' + e.message); }
                if (!known.has(cmp(t.truck))) throw new Error('Trips row ' + (x.row || i + 2) + ': truck ' + t.truck + ' does not exist');
                t.truck = known.get(cmp(t.truck));
                const id = idc(x.id); if (id && !ID.test(id)) throw new Error('Trips row ' + (x.row || i + 2) + ': invalid trip ID "' + id + '" (use letters, numbers, spaces, - . _ only)');
                return [id, t];
            });
            const need = clean.filter(([id]) => !id).length, ids = need ? await store.newIds(need) : [];
            let j = 0; const tripPairs = clean.map(([id, t]) => [id || ids[j++], t]);
            const top = Math.max(0, ...tripPairs.map(([id]) => tripNo(id))); if (top) await store.bump(top);
            await store.putMany(truckPairs, tripPairs);
            return send(res, 200, { trucks: truckPairs.length, trips: tripPairs.length, newTrips: need });
        }
        // Delete many trips / trucks at once (the "Delete trips" tool on the page). A truck that still has trips is never deleted.
        if (p === '/api/master/delete' && m === 'POST') {
            const b = await body(req), all = await store.all();
            const tripIds = new Set(all.trips.map(t => t.id)), tp = (Array.isArray(b.trips) ? b.trips : []).map(idc).filter(id => tripIds.has(id));
            const gone = new Set(tp), used = new Set(all.trips.filter(t => !gone.has(t.id)).map(t => t.truck));
            const truckIds = new Set(all.trucks.map(t => t.id)), want = (Array.isArray(b.trucks) ? b.trucks : []).map(idc).filter(id => truckIds.has(id));
            const tk = want.filter(id => !used.has(id)), kept = want.filter(id => used.has(id));
            if (tp.length + tk.length > 20000) throw new Error('Too many at once (max 20,000)');
            await store.delMany(tp, tk);
            return send(res, 200, { trips: tp.length, trucks: tk.length, keptTrucks: kept });
        }
        send(res, 404, { error: 'Not found' });
    }
    return { handle, name: store.name };
};
