// Procurement - backend for the /procurement page
// Saved in the SAME Firebase project as Fleet Master View and Staff (through the store master.js opened):
//   proc_orders  - ORDER BOOK: items bought and added to the store (PO-0001 ...)
//   proc_issues  - WORKSHOP BOOK: items taken from the store for a truck (WS-0001 ...)
// Stock is worked out from these two: bought - used, per item name (capitals and spaces do not matter).
// Truck numbers are the key that links the Workshop Book to TRUCKS MAINTENANCE.
//
// Pictures (product photos and invoices) go to CLOUDINARY when these Render settings exist:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET   (or one CLOUDINARY_URL=cloudinary://key:secret@cloud)
// The browser uploads the file straight to Cloudinary with a signature from this server (the secret never leaves the server),
// then the record keeps the Cloudinary ID (public_id) and its link. Without those settings, photos are saved small inside the record.
//
// API (all need a login, same as the rest of the server):
//   GET    /api/proc                 -> { orders, issues, stock, trucks, mechanics, people, cloud }
//   GET    /api/proc/stock           -> stock list   (?status=in or ?status=out)
//   GET    /api/proc/orders          -> order book     POST /api/proc/orders     PUT|DELETE /api/proc/orders/:id
//   GET    /api/proc/issues          -> workshop book  POST /api/proc/issues     PUT|DELETE /api/proc/issues/:id
//   GET    /api/proc/truck/:truck    -> everything one truck used, e.g. /api/proc/truck/BCH%206077%20ZM
//   POST   /api/proc/sign            -> Cloudinary upload signature

const crypto = require('crypto');
const DATE = /^\d{4}-\d{2}-\d{2}$/, OID = /^PO-\d{4,}$/, IID = /^WS-\d{4,}$/;
const UNITS = ['pcs', 'litres', 'kg', 'set', 'pair', 'box', 'metres', 'roll', 'drum', 'tyre'];
const CURR = ['ZMW', 'USD', 'CDF'];
const FOLDER = 'phl/procurement';
const MAX_DOC = 900000; // Firestore keeps up to 1 MB per record
const str = (v, n = 100) => String(v == null ? '' : v).trim().slice(0, n);
const key = v => str(v, 100).toLowerCase().replace(/\s+/g, ' ');
const cmp = v => String(v || '').toUpperCase().replace(/[\s-]+/g, '');
const num = (v, what, int) => {
    const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
    if (!isFinite(n) || n <= 0) throw new Error(what + ' must be more than 0');
    if (n > 1e7) throw new Error(what + ' is too big');
    return int ? n : Math.round(n * 1000) / 1000;
};
const pad = (p, n) => p + '-' + String(n).padStart(4, '0');
const noOf = id => { const m = /-(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };

// ---- Cloudinary settings
function cloudConf() {
    let name = process.env.CLOUDINARY_CLOUD_NAME, k = process.env.CLOUDINARY_API_KEY, s = process.env.CLOUDINARY_API_SECRET;
    const u = process.env.CLOUDINARY_URL;
    if (u && (!name || !k || !s)) { const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(u.trim()); if (m) { k = m[1]; s = m[2]; name = m[3]; } }
    return name && k && s ? { name: name.trim(), key: k.trim(), secret: s.trim() } : null;
}
const cSign = (params, secret) => crypto.createHash('sha1').update(Object.keys(params).sort().map(k => k + '=' + params[k]).join('&') + secret).digest('hex');

// One picture or invoice. Cloudinary: { id: public_id, url, type: 'image'|'pdf', name }. No Cloudinary: { url: data:image/jpeg... }
function file(f, cloud, what) {
    if (!f || typeof f !== 'object') return null;
    const url = String(f.url || ''), name = str(f.name, 120);
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) {
        if (url.length > 450000) throw new Error(what + ' is too big - use a smaller picture');
        return { id: '', url, type: 'image', name };
    }
    if (cloud && url.startsWith('https://res.cloudinary.com/' + cloud.name + '/') && /^[\w\/.\-]{1,200}$/.test(String(f.id || ''))) {
        const type = /\.pdf$/i.test(url) || f.type === 'pdf' ? 'pdf' : 'image';
        return { id: String(f.id), url: url.slice(0, 500), type, name };
    }
    throw new Error(what + ': unknown file. Upload it again.');
}

module.exports = function makeProcurement({ body, send, master }) {
    const orders = master.store.coll('proc_orders'), issues = master.store.coll('proc_issues');
    const staffCol = master.store.coll('staff');

    // Stock per item: bought - used
    function stockOf(O, I) {
        const m = new Map();
        const get = (name, unit) => { const k = key(name); if (!m.has(k)) m.set(k, { item: str(name), key: k, unit: unit || 'pcs', bought: 0, used: 0, orders: 0, issues: 0, last: '', lastUsed: '', photo: null }); return m.get(k); };
        O.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(o => {
            const s = get(o.item, o.unit); s.bought += +o.qty || 0; s.orders++; s.item = o.item; s.unit = o.unit || s.unit;
            if (o.date >= s.last) s.last = o.date; if (o.photos && o.photos[0]) s.photo = o.photos[0];
        });
        I.forEach(i => { const s = get(i.item); s.used += +i.qty || 0; s.issues++; if ((i.date || '') > s.lastUsed) s.lastUsed = i.date; });
        return [...m.values()].map(s => ({ ...s, bought: Math.round(s.bought * 1000) / 1000, used: Math.round(s.used * 1000) / 1000, left: Math.round((s.bought - s.used) * 1000) / 1000 })).sort((a, b) => a.item.localeCompare(b.item));
    }
    const left = async (k, skipIssue, skipOrder, addOrder) => {
        const [O, I] = await Promise.all([orders.all(), issues.all()]);
        let b = 0, u = 0;
        O.forEach(o => { if (key(o.item) === k && o.id !== skipOrder) b += +o.qty || 0; });
        I.forEach(i => { if (key(i.item) === k && i.id !== skipIssue) u += +i.qty || 0; });
        return { bought: b + (addOrder || 0), used: u, left: Math.round((b + (addOrder || 0) - u) * 1000) / 1000, known: O.some(o => key(o.item) === k) };
    };

    function cleanOrder(b) {
        const cloud = cloudConf();
        const o = { item: str(b.item, 100).replace(/\s+/g, ' '), unit: UNITS.includes(b.unit) ? b.unit : 'pcs', qty: num(b.qty, 'Quantity'), date: str(b.date, 10), authorizedBy: str(b.authorizedBy, 80), shop: str(b.shop, 100), notes: str(b.notes, 1000) };
        if (!o.item) throw new Error('Item name is required');
        if (!DATE.test(o.date)) throw new Error('Date bought is required (YYYY-MM-DD)');
        if (!o.authorizedBy) throw new Error('Authorized by is required');
        if (!o.shop) throw new Error('Shop bought from is required');
        o.cost = str(b.cost) === '' ? null : num(b.cost, 'Cost');
        o.currency = CURR.includes(b.currency) ? b.currency : 'ZMW';
        o.invoice = file(b.invoice, cloud, 'Invoice');
        o.photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 6).map(p => file(p, cloud, 'Product photo')).filter(Boolean);
        if (JSON.stringify(o).length > MAX_DOC) throw new Error('The pictures are too big together. Use fewer photos, or add Cloudinary (see README).');
        return o;
    }
    async function cleanIssue(b, id) {
        const o = { item: str(b.item, 100).replace(/\s+/g, ' '), qty: num(b.qty, 'Quantity'), date: str(b.date, 10), authorizedBy: str(b.authorizedBy, 80), mechanic: str(b.mechanic, 80), truck: str(b.truck, 40).replace(/\s+/g, ' ').toUpperCase(), notes: str(b.notes, 1000) };
        if (!o.item) throw new Error('Item is required');
        if (!DATE.test(o.date)) throw new Error('Used date is required (YYYY-MM-DD)');
        if (!o.authorizedBy) throw new Error('Authorized by is required');
        if (!o.mechanic) throw new Error('Mechanic is required');
        if (!o.truck) throw new Error('Truck number is required');
        if (!master.ID.test(o.truck)) throw new Error('Truck "' + o.truck + '" is not a valid truck number');
        // the truck must exist (trucks are added on the Staff page); "BCH6077ZM" finds "BCH 6077 ZM"
        const all = (await master.store.all()).trucks, t = all.find(x => cmp(x.id) === cmp(o.truck) || (x.reg && cmp(x.reg) === cmp(o.truck)));
        if (!t) throw new Error('Truck ' + o.truck + ' is not in the system. Add it on the Staff page first (give it to a driver).');
        o.truck = t.id;
        const s = await left(key(o.item), id);
        if (!s.known) throw new Error('"' + o.item + '" is not in the store. Add it in the Order Book first.');
        if (o.qty > s.left) throw new Error('Only ' + s.left + ' of "' + o.item + '" left in the store');
        return o;
    }

    // Best-effort delete of pictures on Cloudinary (the record is gone either way)
    async function destroy(list) {
        const cloud = cloudConf(); if (!cloud || typeof fetch !== 'function') return;
        for (const f of list) {
            if (!f || !f.id) continue;
            const timestamp = Math.floor(Date.now() / 1000), p = { public_id: f.id, timestamp };
            try {
                await fetch('https://api.cloudinary.com/v1_1/' + cloud.name + '/image/destroy', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ ...p, api_key: cloud.key, signature: cSign(p, cloud.secret) }).toString()
                });
            } catch (e) { console.error('Cloudinary delete failed for ' + f.id + ': ' + e.message); }
        }
    }
    const filesOf = o => [o.invoice].concat(o.photos || []).filter(Boolean);
    const gone = (prev, now) => { const keep = new Set(filesOf(now).map(f => f.id)); return filesOf(prev).filter(f => f.id && !keep.has(f.id)); };

    async function nextId(col, pre) {
        const n = await master.store.nextNo('proc_' + pre.toLowerCase(), Math.max(0, ...(await col.all()).map(x => noOf(x.id))));
        return pad(pre, n);
    }
    const stamp = (o, prev) => ({ ...o, created: prev ? prev.created || '' : new Date().toISOString(), updated: new Date().toISOString() });
    const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id);

    async function handle(req, res, p, m) {
        const q = new URL(req.url, 'http://x').searchParams;
        if (p === '/api/proc' && m === 'GET') {
            const [O, I, all, S] = await Promise.all([orders.all(), issues.all(), master.store.all(), staffCol.all().catch(() => [])]);
            const cloud = cloudConf();
            const act = S.filter(s => s.status !== 'Left');
            return send(res, 200, {
                orders: O.sort(byDate), issues: I.sort(byDate), stock: stockOf(O, I), units: UNITS, currencies: CURR,
                trucks: all.trucks.filter(t => !/^TRK-\d{3}$/.test(t.id) || t.staffId || t.driver).map(t => ({ id: t.id, reg: t.reg || '', trailer: t.trailer || '', type: t.type || '', driver: t.driver || '' })),
                mechanics: act.filter(s => s.team === 'mechanics').map(s => s.name).sort(),
                people: act.filter(s => s.team !== 'drivers').map(s => ({ name: s.name, team: s.team })).sort((a, b) => a.name.localeCompare(b.name)),
                cloud: cloud ? { name: cloud.name, folder: FOLDER } : null
            });
        }
        if (p === '/api/proc/stock' && m === 'GET') {
            const st = stockOf(await orders.all(), await issues.all()), f = q.get('status');
            return send(res, 200, f === 'in' ? st.filter(s => s.left > 0) : f === 'out' ? st.filter(s => s.left <= 0) : st);
        }
        if (p === '/api/proc/sign' && m === 'POST') {
            const cloud = cloudConf(); if (!cloud) return send(res, 400, { error: 'Cloudinary is not set up on the server' });
            const timestamp = Math.floor(Date.now() / 1000), params = { folder: FOLDER, timestamp };
            return send(res, 200, { cloud: cloud.name, apiKey: cloud.key, folder: FOLDER, timestamp, signature: cSign(params, cloud.secret) });
        }
        const tr = p.match(/^\/api\/proc\/truck\/(.+)$/);
        if (tr && m === 'GET') { const t = cmp(decodeURIComponent(tr[1])); return send(res, 200, (await issues.all()).filter(i => cmp(i.truck) === t).sort(byDate)); }

        // ORDER BOOK
        if (p === '/api/proc/orders') {
            if (m === 'GET') return send(res, 200, (await orders.all()).sort(byDate));
            if (m === 'POST') { const o = cleanOrder(await body(req)); const id = await nextId(orders, 'PO'); return send(res, 201, await orders.put(id, stamp(o))); }
        }
        let mt = p.match(/^\/api\/proc\/orders\/(.+)$/);
        if (mt) {
            const id = decodeURIComponent(mt[1]); if (!OID.test(id)) return send(res, 404, { error: 'Not found' });
            const prev = await orders.get(id); if (!prev) return send(res, 404, { error: 'Order not found' });
            if (m === 'GET') return send(res, 200, prev);
            if (m === 'PUT') {
                const o = cleanOrder(await body(req));
                // the store must still cover what the workshop already used
                const was = await left(key(prev.item), null, id);
                if (was.used > was.bought + (key(o.item) === key(prev.item) ? o.qty : 0) + 1e-9) throw new Error('The workshop already used ' + was.used + ' of "' + prev.item + '". The store cannot go below that.');
                const v = await orders.put(id, stamp(o, prev)); destroy(gone(prev, o)); return send(res, 200, v);
            }
            if (m === 'DELETE') {
                const s = await left(key(prev.item), null, id);
                if (s.used > s.bought + 1e-9) throw new Error('Cannot delete: the workshop already used ' + s.used + ' of "' + prev.item + '" and only ' + s.bought + ' would be left bought. Delete those Workshop Book lines first.');
                await orders.del(id); destroy(filesOf(prev)); return send(res, 200, { deleted: id });
            }
        }
        // WORKSHOP BOOK
        if (p === '/api/proc/issues') {
            if (m === 'GET') return send(res, 200, (await issues.all()).sort(byDate));
            if (m === 'POST') { const o = await cleanIssue(await body(req)); const id = await nextId(issues, 'WS'); return send(res, 201, await issues.put(id, stamp(o))); }
        }
        mt = p.match(/^\/api\/proc\/issues\/(.+)$/);
        if (mt) {
            const id = decodeURIComponent(mt[1]); if (!IID.test(id)) return send(res, 404, { error: 'Not found' });
            const prev = await issues.get(id); if (!prev) return send(res, 404, { error: 'Workshop line not found' });
            if (m === 'GET') return send(res, 200, prev);
            if (m === 'PUT') return send(res, 200, await issues.put(id, stamp(await cleanIssue(await body(req), id), prev)));
            if (m === 'DELETE') { await issues.del(id); return send(res, 200, { deleted: id }); }
        }
        send(res, 404, { error: 'Not found' });
    }
    return { handle, cloud: () => !!cloudConf() };
};
