// Staff Management - backend for the /staff page
// Staff are stored in the SAME Firebase project as Fleet Master View (collection "staff"),
// through the store that master.js already opened. No extra setting is needed.
//
// Teams: operations, finance, hr, directors, ground, mechanics, drivers
//
// A driver can be ASSIGNED A TRUCK. The driver's name, phone, passport and licence are then copied onto that truck,
// so the trip cards on /master always show the right driver. Change them here and every trip card follows.
// One truck = one driver: assigning a truck that already has a driver takes it off the other driver.
//
// API (all need a login, same as the rest of the server):
//   GET    /api/staff                  -> { staff:[...], teams:[...], trucks:[...] }
//   GET    /api/staff/teams            -> [{ key, label, count }]
//   GET    /api/staff/team/:team       -> staff of one team, e.g. /api/staff/team/drivers  /api/staff/team/finance
//   GET    /api/staff/:id              -> one staff member (e.g. STF-0001)
//   POST   /api/staff                  -> add (server gives the Staff ID)
//   PUT    /api/staff/:id              -> update
//   DELETE /api/staff/:id              -> delete (takes the driver off their truck)
//   POST   /api/staff/import-drivers   -> make driver profiles from the drivers already on the trucks
//   Trucks are added here: a driver's "Assigned truck" that does not exist yet is created (with its trailer and truck type).
//   POST   /api/staff/bulk             -> { staff:[...] } add/update many (Excel). Blank cells do not wipe saved details.

const TEAMS = [['operations', 'Operations'], ['finance', 'Finance'], ['hr', 'HR'], ['directors', 'Directors'], ['ground', 'Ground Team'], ['mechanics', 'Mechanics'], ['drivers', 'Drivers']];
const TEAM_KEYS = TEAMS.map(t => t[0]);
const STATUS = ['Active', 'On leave', 'Suspended', 'Left'];
const DATE = /^\d{4}-\d{2}-\d{2}$/, SID = /^STF-\d{4,}$/, TID = /^[\w][\w .-]{0,39}$/;
const str = (v, n = 100) => String(v == null ? '' : v).trim().slice(0, n);
const staffNo = id => { const m = /^STF-(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };
const staffId = n => 'STF-' + String(n).padStart(4, '0');
// "Ground Team", "ground", "Driver", "HR" ... -> team key
const teamKey = v => {
    const s = String(v || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    const hit = TEAMS.find(([k, l]) => s === k || s === l.toLowerCase().replace(/[^a-z]/g, '') || s + 's' === k || s === k.replace(/s$/, ''));
    return hit ? hit[0] : (s.startsWith('director') ? 'directors' : s.startsWith('mechanic') ? 'mechanics' : s.startsWith('driver') ? 'drivers' : s.startsWith('operation') ? 'operations' : s.startsWith('ground') ? 'ground' : s.startsWith('human') ? 'hr' : null);
};
const FIELDS = { name: 100, designation: 80, location: 80, phone: 40, email: 100, passport: 40, licence: 40, category: 20, issue: 20, nok: 100, nokPhone: 40, notes: 1000 };
const DATES = ['joined', 'passportExp', 'licenceExp'];

// Check and tidy one staff record. "partial" = Excel update: only the cells that were filled in.
function clean(b, partial) {
    const o = {};
    for (const [k, n] of Object.entries(FIELDS)) if (!partial || str(b[k]) !== '') o[k] = str(b[k], n);
    for (const k of DATES) if (!partial || str(b[k]) !== '') { const v = str(b[k]); if (v && !DATE.test(v)) throw new Error('Invalid date "' + v + '" (use YYYY-MM-DD)'); o[k] = v; }
    if (!partial || str(b.team) !== '') { const t = teamKey(b.team); if (!t) throw new Error('Unknown team "' + str(b.team) + '" (use: ' + TEAMS.map(x => x[1]).join(', ') + ')'); o.team = t; }
    if (!partial || str(b.status) !== '') { const s = STATUS.find(x => x.toLowerCase() === str(b.status).toLowerCase()); o.status = s || 'Active'; }
    if (!partial || str(b.truck) !== '') { o.truck = str(b.truck, 40).replace(/\s+/g, ' '); if (o.truck && !TID.test(o.truck)) throw new Error('Truck "' + o.truck + '" is not a valid truck number'); }
    // truck details (saved on the TRUCK, not on the person): trailer and truck type
    o.trailer = str(b.trailer, 40); o.ttype = str(b.ttype, 100);
    if (b.photo !== undefined && !(partial && !b.photo)) {
        const p = String(b.photo || '');
        if (p && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) throw new Error('Photo must be a JPG / PNG image');
        if (p.length > 400000) throw new Error('Photo is too big - use a smaller picture');
        o.photo = p;
    }
    if (!partial && !o.name) throw new Error('Name is required');
    return o;
}
// The driver details that are copied onto the assigned truck
const truckInfo = s => ({ driver: s.name, contact: s.phone, passport: s.passport, licence: s.licence, category: s.category, issue: s.issue });

module.exports = function makeStaff({ body, send, master }) {
    if (!master || !master.store) throw new Error('staff.js needs the Fleet Master module: makeStaff({ body, send, master })');
    const col = master.store.coll('staff');
    const nextId = async () => { const all = await col.all(); return staffId(await master.store.nextNo('staff', Math.max(0, ...all.map(x => staffNo(x.id))))); };

    // Put the staff member on their truck (or take them off). prev = how the record looked before this save.
    async function applyTruck(s, prev) {
        const want = s.team === 'drivers' && s.status !== 'Left' ? s.truck : '';
        if (prev && prev.truck && prev.truck !== want) await master.syncDriver(prev.truck, s.id, null);
        if (!want) return;
        // one truck = one driver
        for (const o of await col.all()) if (o.id !== s.id && o.truck === want) { await col.put(o.id, { ...o, truck: '' }); }
        await master.syncDriver(want, s.id, truckInfo(s));
    }
    // Trucks are added and kept here, on the drivers. Truck typed as "BCJ6422ZM" or "BCJ 6422 ZM" -> the truck as stored; a new number -> a new truck.

    async function save(id, data, prev) {
        const { trailer, ttype, ...rest } = data, s = { ...(prev || {}), ...rest, id };
        delete s.trailer; delete s.ttype;
        s.truck = s.team === 'drivers' && s.truck ? await master.ensureTruck(s.truck, { trailer, type: ttype }) : '';
        if (!prev) s.created = new Date().toISOString();
        s.updated = new Date().toISOString();
        const out = await col.put(id, s);
        await applyTruck(out, prev);
        return out;
    }
    const counts = list => TEAMS.map(([key, label]) => ({ key, label, count: list.filter(s => s.team === key).length }));

    async function handle(req, res, p, m) {
        if (p === '/api/staff' && m === 'GET') {
            const [staff, all] = await Promise.all([col.all(), master.store.all()]);
            return send(res, 200, { staff, teams: counts(staff), statuses: STATUS, trucks: all.trucks.filter(t => !/^TRK-\d{3}$/.test(t.id) || t.staffId || t.driver).map(t => ({ id: t.id, reg: t.reg || '', trailer: t.trailer || '', type: t.type || '', staffId: t.staffId || '', driver: t.driver || '' })) });
        }
        if (p === '/api/staff/teams' && m === 'GET') return send(res, 200, counts(await col.all()));
        let mt = p.match(/^\/api\/staff\/team\/([^/]+)$/);
        if (mt && m === 'GET') {
            const k = teamKey(decodeURIComponent(mt[1])); if (!k) return send(res, 404, { error: 'Unknown team. Use one of: ' + TEAM_KEYS.join(', ') });
            return send(res, 200, (await col.all()).filter(s => s.team === k));
        }
        if (p === '/api/staff' && m === 'POST') {
            const d = clean(await body(req)); // check first, so a bad form never uses up a Staff ID
            return send(res, 201, await save(await nextId(), d, null));
        }
        if (p === '/api/staff/import-drivers' && m === 'POST') {
            const [staff, all] = await Promise.all([col.all(), master.store.all()]);
            const linked = new Set(staff.map(s => s.truck).filter(Boolean)), names = new Set(staff.map(s => String(s.name).toUpperCase().replace(/\s+/g, ' ').trim()));
            let made = 0, skipped = 0;
            for (const t of all.trucks.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
                const nm = str(t.driver).replace(/\s+/g, ' ');
                if (!nm || t.staffId || linked.has(t.id)) continue;
                if (names.has(nm.toUpperCase())) { skipped++; continue; }
                await save(await nextId(), { name: nm, team: 'drivers', designation: 'Truck Driver', phone: str(t.contact, 40), passport: str(t.passport, 40), licence: str(t.licence, 40), category: str(t.category, 20), issue: str(t.issue, 20), truck: t.id, status: 'Active', location: '', email: '', joined: '', passportExp: '', licenceExp: '', nok: '', nokPhone: '', notes: '', photo: '' }, null);
                names.add(nm.toUpperCase()); made++;
            }
            return send(res, 200, { made, skipped });
        }
        if (p === '/api/staff/bulk' && m === 'POST') {
            const b = await body(req), L = Array.isArray(b.staff) ? b.staff : [];
            if (L.length > 5000) throw new Error('Too many rows in one upload (max 5,000)');
            // Check every row first, so a bad row never leaves a half-done upload
            const have = new Map((await col.all()).map(s => [s.id, s]));
            const rows = [];
            for (const [i, x] of L.entries()) {
                const row = x.row || i + 2, id = str(x.id, 20).toUpperCase();
                if (id && !SID.test(id)) throw new Error('Row ' + row + ': Staff ID "' + id + '" must look like STF-0001 (leave it empty for a new person)');
                const prev = id ? have.get(id) : null;
                let d; try { d = clean(x, !!prev); } catch (e) { throw new Error('Row ' + row + ': ' + e.message); }
                rows.push([id, d, prev]);
            }
            let added = 0, updated = 0;
            for (const [id, d, prev0] of rows) {
                const prev = prev0 ? await col.get(prev0.id) : null; // fresh copy: an earlier row may have moved a truck
                if (prev) { await save(prev.id, d, prev); updated++; }
                else { await save(id || await nextId(), d, null); added++; }
                if (id && !prev) await master.store.nextNo('staff', staffNo(id)); // keep the counter above typed-in IDs
            }
            return send(res, 200, { added, updated });
        }
        mt = p.match(/^\/api\/staff\/([^/]+)$/);
        if (mt) {
            const id = decodeURIComponent(mt[1]); if (!SID.test(id)) return send(res, 404, { error: 'Not found' });
            const prev = await col.get(id);
            if (!prev) return send(res, 404, { error: 'Staff member not found' });
            if (m === 'GET') return send(res, 200, prev);
            if (m === 'PUT') return send(res, 200, await save(id, clean(await body(req)), prev));
            if (m === 'DELETE') { await col.del(id); if (prev.truck) await master.syncDriver(prev.truck, id, null); return send(res, 200, { deleted: id }); }
        }
        send(res, 404, { error: 'Not found' });
    }
    return { handle };
};
module.exports.TEAMS = TEAMS;