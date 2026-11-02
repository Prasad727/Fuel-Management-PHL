import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Msg from '../components/Msg.jsx';
import { api } from '../lib/api.js';
import { today, days, fmt, dd, cmp, idc, byId, toIso, key, readWorkbook, saveBook } from '../lib/util.js';
import '../styles/master.css';

// FLEET MASTER VIEW: trip cards. /master = Current Trips, /master#completed = Completed Trips.
// API: GET /api/master, POST /api/master/trips, PUT|DELETE /api/master/trips/:id, POST /api/master/bulk, POST /api/master/delete

// Trip stages in order. The last one (Offloading 2) means the trip is completed.
const ST = ['Dispatched', 'Loading', 'In Transit', 'Offloading', 'Loading 2', 'In Transit 2', 'Delivered', 'Offloading 2'], K = ['d', 'l', 't', 'u', 'l2', 't2', 'v', 'r'];
const STY = { 'Offloading 2': 'g', 'Delivered': 'g', 'In Transit 2': 'y', 'Loading 2': 'p', 'Offloading': 'o', 'In Transit': 'y', 'Loading': 'p', 'Dispatched': '', 'Not Started': '' };
// What the status badge says, from the last date filled in
const LBL = { 'Not Started': 'Not started', 'Dispatched': 'Dispatched', 'Loading': 'Waiting for docs', 'In Transit': 'In transit', 'Offloading': 'Waiting to load', 'Loading 2': 'Waiting for docs', 'In Transit 2': 'In transit', 'Delivered': 'Delivered', 'Offloading 2': 'Completed' };
const COL = { g: 'var(--grn)', o: 'var(--org)', y: 'var(--yel)', p: 'var(--blu)', '': 'var(--mute2)' };
const Dash = ({ v }) => v ? v : <span className="dash">&mdash;</span>;

// A trip starts on its Dispatched date, or its Loading date if there is no dispatch date
const start = t => t.d || t.l;
// Status on a date + truck total days (from Loading, or Dispatched if not loaded yet, to Offloading 2 or the view date)
function info(t, to) {
  let s = 'Not Started'; K.forEach((k, i) => { if (t[k] && t[k] <= to) s = ST[i]; });
  const done = !!(t.r && t.r <= to), s0 = t.l || t.d;
  return { s, done, run: done ? days(s0, t.r) : (s0 ? days(s0, to) : null) };
}
// Trip 1 NB = Loading -> Offloading, Empty = Offloading -> Loading 2, Trip 2 SB = Loading 2 -> Offloading 2
function legs(t, to) {
  const has = k => t[k] && t[k] <= to;
  const part = (n, a, b, runTxt, runCls, waitTxt) => {
    if (!has(a)) return { n, txt: waitTxt, cls: '' };
    if (!has(b)) return { n, txt: runTxt, d: days(t[a], to), run: 1, cls: runCls, from: t[a] };
    return { n, d: days(t[a], t[b]), cls: 'g', from: t[a], until: t[b] };
  };
  const e = part('Empty', 'u', 'l2', 'Waiting to load', 'o', has('l') ? 'After offloading' : '');
  if (e.until) e.cls = '';
  return [part('Trip 1 · NB', 'l', 'u', 'Loaded', 'y', 'Not loaded yet'), e, part('Trip 2 · SB', 'l2', 'r', 'Loaded', 'y', has('u') ? 'Not loaded yet' : '')];
}

function Card({ t, tr, i, to, onOpen }) {
  const late = i.run > t.plan, warn = !late && i.run >= t.plan - 3 && !i.done;
  const ac = i.done ? (late ? 'r' : 'g') : (late ? 'r' : warn ? 'o' : '');
  const stg = ST.indexOf(i.s), col = COL[STY[i.s]];
  return (
    <div className={'tc ' + ac} onClick={() => onOpen(t.id)}>
      <div className="tch"><div><b className="horse trk">{tr.reg || t.truck}</b><div className="sub">Trip {String(t.id).replace('TRIP-', '')}</div></div><span className={'b ' + STY[i.s]}><i />{LBL[i.s] || i.s}</span></div>
      <div className="mini">
        <div>
          <div className="drv" title={tr.saved ? 'Driver who did this trip (saved when it was completed)' : tr.driver || ''}><Dash v={tr.driver} /></div>
          <div className="rt">{tr.contact || <span className="dash">No contact</span>}</div>
          <div className="rt">Trailer: {tr.trailer || '—'}</div>
        </div>
        <div className="rt"><Dash v={t.route} /></div>
        <div className="pg">{ST.map((_, k) => <i key={k} style={k <= stg ? { background: col } : undefined} />)}</div>
        {legs(t, to).map(x => {
          const when = x.from ? fmt(x.from).slice(0, 6) + ' → ' + (x.until ? fmt(x.until).slice(0, 6) : 'now') : '';
          return <div key={x.n} className={'lg ' + x.cls + (x.run ? ' run' : '')}>
            <div className="row"><b>{x.n}</b><span className="lgd">{x.d == null ? <span className="dash">&mdash;</span> : dd(x.d)}</span></div>
            <div className="rt">{[x.txt, when].filter(Boolean).join(' · ') || ' '}</div>
          </div>;
        })}
        <div className="row"><span className="rt">Truck total days: <b>{i.run == null ? '—' : i.run}</b></span>
          {late ? <span className="b r">{i.done ? 'Late' : 'Overdue'} +{i.run - t.plan}d</span> : <span className={'b ' + (i.done ? 'g' : warn ? 'o' : '')}>{i.done ? 'On time' : 'On track'}</span>}</div>
      </div>
    </div>
  );
}

// Excel columns. Trucks and drivers are kept on the Staff page, so the file holds trips only.
const TC = [['Trip ID', 'id'], ['Truck ID', 'truck'], ['Route (Origin - Destination)', 'route'], ['Planned Trip Days', 'plan'], ['Dispatched Date', 'd'], ['Loading Date', 'l'], ['Loading Location', 'lp'], ['In Transit Date', 't'], ['Offloading Date', 'u'], ['Loading Date 2', 'l2'], ['Loading Location 2', 'lp2'], ['In Transit Date 2', 't2'], ['Delivered Date', 'v'], ['Offloading Date 2', 'r'], ['Notes', 'n'], ['Driver on Trip', 'drvName']];
const HELP = ['How this template works',
  'This file contains ALL your current trips (Trip Log). Edit it and upload it back with "Bulk upload Excel".',
  'Trip Log: one row per trip. Truck ID is required. The truck must already be on the Staff page (a driver\'s Assigned truck). Spaces do not matter: BCJ6422ZM = BCJ 6422 ZM.',
  'Trucks, trailers and drivers are NOT in this file - they are kept on the Staff page.',
  'Trip ID filled in = that trip is UPDATED. Trip ID empty = a NEW trip with a new ID.',
  'Fill each stage date as the trip reaches it. Trip 1 (NB): Dispatched, Loading (+ location), In Transit, Offloading. Trip 2 (SB): Loading 2 (+ location), In Transit 2, Delivered, Offloading 2. Dates: yyyy-mm-dd or normal Excel dates.',
  'The card counts the days: Trip 1 NB = Loading to Offloading, Empty = Offloading to Loading 2, Trip 2 SB = Loading 2 to Offloading 2.',
  'A trip shows as a card once it has a Dispatched or Loading date. It moves to Completed Trips once it has an Offloading Date 2.',
  'Planned Trip Days: leave empty for 15.',
  'Driver on Trip is filled in for you (the driver saved on each completed trip). It is not read back when you upload.',
  'Upload ADDS and UPDATES only. Nothing is deleted.'];
const EXAMPLE = [['', 'BCH 6062 ZM', 'Ndola - TFM', 35, '2026-10-05', '2026-10-06', 'Ndola', '2026-10-08', '', '', '', '', '', '', 'Example: trip 1 in transit'], ['', 'BCH 6063 ZM', 'Ndola - BMS', 35, '2026-09-01', '2026-09-02', 'Ndola', '2026-09-04', '2026-09-12', '2026-09-15', 'Kolwezi', '2026-09-17', '2026-09-28', '2026-09-30', 'Example: completed']];
const DATECOLS = [['d', ['dispatcheddate', 'dispatched']], ['l', ['loadingdate', 'loading', 'loadingdate1']], ['t', ['intransitdate', 'intransit', 'intransitdate1']], ['u', ['offloadingdate', 'offloading', 'offloadingdate1', 'unloadingdate', 'unloading']], ['l2', ['loadingdate2', 'loading2']], ['t2', ['intransitdate2', 'intransit2']], ['v', ['delivereddate', 'delivered']], ['r', ['offloadingdate2', 'offloading2', 'returnedavailabledate', 'returneddate', 'completeddate', 'returned']]];
const DEMO_ROUTES = ['Lusaka - Lubumbashi', 'Kolwezi - Lusaka', 'Ndola - Kitwe', 'Kapiri - Solwezi', 'Chingola - Kasumbalesa', 'Lusaka - Kolwezi', 'Mumbai - Delhi'];
// Sample trips = made by "Preview 100 cards": ID like TRIP-0015, a preview route, no notes, no loading locations
const isSample = t => /^TRIP-\d{4}$/.test(t.id) && DEMO_ROUTES.includes(t.route) && !t.n && !t.lp && !t.lp2;
const isPlaceholder = (k, used) => /^TRK-\d{3}$/.test(k.id) && !k.driver && !k.trailer && !used.has(k.id);
const PER = 100;
const TRUCK_FIELDS = [['reg', 'Registration no.'], ['trailer', 'Trailer no.'], ['driver', 'Driver name'], ['contact', 'Driver contact'], ['passport', 'Passport no.'], ['licence', 'Licence no.'], ['category', 'Licence category'], ['issue', 'Licence issue no.'], ['type', 'Truck type'], ['status', 'Truck status']];

export default function Master() {
  const loc = useLocation(), nav = useNavigate();
  const done = loc.hash === '#completed';
  const [D, setD] = useState(null);
  const [demo, setDemo] = useState(false);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ from: today(), to: '', view: 'All Activity', q: '' });
  const [df, setDf] = useState({ month: '', q: '' }), [page, setPage] = useState(1);
  const [det, setDet] = useState(null), [form, setForm] = useState(null), [saving, setSaving] = useState(false);
  const [clean, setClean] = useState(null); // { tab:'T'|'K', q, sel:Set }
  const fileRef = useRef(null), topRef = useRef(null);
  const say = (text, err) => setMsg({ text, err });

  async function load() {
    const j = await api('GET', '/api/master');
    setD({ trucks: j.trucks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), trips: j.trips });
  }
  useEffect(() => { load().catch(e => say('Could not reach the server: ' + e.message, true)); }, []);
  useEffect(() => { setPage(1); window.scrollTo(0, 0); }, [done]);

  // A COMPLETED trip keeps the driver saved on it (t.drv); running trips show the truck's current driver
  const tripTruck = t => { const k = D.trucks.find(x => x.id === t.truck) || {}; return t.drv ? { ...k, ...t.drv, saved: 1 } : k; };
  const doneTrips = useMemo(() => D ? D.trips.filter(t => start(t) && t.r).sort((a, b) => b.r.localeCompare(a.r) || String(b.id).localeCompare(String(a.id))) : [], [D]);
  const blocked = () => { if (demo) { say('This is the 100-card preview, so nothing is saved. Refresh the page to go back to your real data and edit it.', true); return true; } return false; };
  const demoNoDl = () => { if (!demo) return false; say('You are looking at the 100-card preview (sample trips). Refresh the page first, then download - otherwise the file would contain the sample trips.', true); return true; };

  // Current trips: cards + summary numbers for the chosen dates
  const cur = useMemo(() => {
    if (!D) return null;
    const fr = f.from || today(), to = f.to && f.to >= fr ? f.to : fr, q = f.q.toLowerCase(), out = [], n = { st: 0, co: 0, ip: 0, dl: 0, sp: 0 };
    D.trips.forEach(t => {
      const s0 = start(t); if (!s0) return;
      const i = info(t, to), st = s0 >= fr && s0 <= to, co = t.r && t.r >= fr && t.r <= to, ip = s0 <= to && !t.r, late = ip && i.run > t.plan, sd = !!(t.d && t.d <= to && !(t.r && t.r <= to));
      if (sd) n.st++; if (t.d && t.d >= fr && t.d <= to) n.sp++; if (co) n.co++; if (ip) n.ip++; if (late) n.dl++;
      const m = !t.r && { 'All Activity': st || ip, Started: sd, 'In Progress': ip, 'Delayed / Overdue': late }[f.view], tr = tripTruck(t);
      if (m && (!q || [t.truck, t.route, tr.driver, tr.reg, tr.trailer, t.lp, t.lp2, t.id].join(' ').toLowerCase().includes(q))) out.push({ t, tr, i });
    });
    return { fr, to, n, out };
  }, [D, f]);

  // Completed trips: filtered, 100 per page
  const comp = useMemo(() => {
    const q = df.q.toLowerCase();
    const L = doneTrips.map(t => ({ t, tr: D ? tripTruck(t) : {} })).filter(({ t, tr }) => (!df.month || t.r.slice(0, 7) === df.month) && (!q || [t.truck, t.route, tr.driver, tr.reg, tr.trailer, t.lp, t.lp2, t.id].join(' ').toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(L.length / PER)), p = Math.min(Math.max(1, page), pages), s = (p - 1) * PER;
    return { L, pages, p, s, sl: L.slice(s, s + PER) };
  }, [doneTrips, df, page, D]);

  // ---- Add / edit trip
  const openForm = id => {
    const t = id ? D.trips.find(x => x.id === id) : null;
    setForm({ editing: !!t, v: t ? { ...t } : { id: '', truck: (D.trucks[0] || {}).id || '', route: '', plan: 15, n: '', lp: '', lp2: '' } });
  };
  async function saveTrip() {
    if (blocked()) return;
    const o = {}; ['id', 'truck', 'route', 'n', 'lp', 'lp2', ...K].forEach(k => o[k] = String(form.v[k] || '').trim()); o.plan = +form.v.plan || 15;
    if (o.r && !(o.d || o.l)) return alert('An Offloading 2 (completed) date needs a dispatched or loading date.');
    if (o.r && o.r < (o.d || o.l)) return alert('The Offloading 2 date is before the start of the trip.');
    setSaving(true);
    try {
      const { id, ...rest } = o;
      const r = form.editing ? await api('PUT', '/api/master/trips/' + encodeURIComponent(id), rest) : await api('POST', '/api/master/trips', rest);
      await load(); setForm(null);
      say(r.r ? <>Trip {r.id} is completed and has moved to <Link to="/master#completed" style={{ color: 'inherit', fontWeight: 700 }}>Completed Trips &rarr;</Link></> : 'Trip ' + r.id + ' saved.');
    } catch (e) { alert('Not saved: ' + e.message); }
    finally { setSaving(false); }
  }
  async function delTrip() {
    if (blocked() || !confirm('Delete this trip?')) return;
    try { await api('DELETE', '/api/master/trips/' + encodeURIComponent(form.v.id)); await load(); setForm(null); }
    catch (e) { alert('Not deleted: ' + e.message); }
  }

  // ---- Excel
  const trow = t => TC.map(([, k]) => k === 'drvName' ? (tripTruck(t).driver || '') : t[k] == null ? '' : t[k]);
  const book = (rows, name, help) => saveBook(name, (help ? [['Instructions', help.map(x => [x])]] : []).concat([['Trip Log', [TC.map(x => x[0])].concat(rows), 22]]));
  const ready = () => { if (!D) { alert('Still loading, please wait a moment.'); return false; } return true; };
  const tpl = () => { if (ready() && !demoNoDl()) book(D.trips.length ? D.trips.slice().sort(byId).map(trow) : EXAMPLE, 'fleet_master_template_' + today() + '.xlsx', HELP); };
  const exp = () => { if (ready() && !demoNoDl()) book(D.trips.slice().sort(byId).map(trow), 'fleet_master_data_' + today() + '.xlsx'); };
  const expDone = () => { if (!ready() || demoNoDl()) return; if (!doneTrips.length) return alert('There are no completed trips to export yet.'); book(doneTrips.map(trow), 'completed_trips_' + today() + '.xlsx'); };

  async function upload(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const { X, wb } = await readWorkbook(file), bad = [], inc = [];
      const rows = n => { const nm = n.find(x => wb.Sheets[x]); return nm ? X.utils.sheet_to_json(wb.Sheets[nm], { defval: '', raw: true }) : []; };
      const hadTruckSheet = rows(['Truck Master', 'Trucks']).length > 0; // old files: the Truck Master sheet is ignored now
      rows(['Trip Log', 'Trips']).forEach((r, i) => {
        const ln = i + 2, tk0 = idc(key(r, ['truckid', 'truck'])), tkm = D.trucks.find(x => cmp(x.id) === cmp(tk0)), tk = tkm ? tkm.id : tk0;
        if (!tk && !key(r, ['tripid', 'id'])) return;
        if (!tk) return bad.push('row ' + ln + ': Truck ID missing');
        if (!tkm) return bad.push('row ' + ln + ': truck ' + tk + ' is not on the Staff page yet (add it as a driver\'s Assigned truck)');
        const o = { id: idc(key(r, ['tripid', 'id'])), truck: tk, route: String(key(r, ['routeorigindestination', 'route'])).trim(), plan: +key(r, ['plannedtripdays', 'planneddays']) || 15, n: String(key(r, ['notes', 'remarks'])).trim(), lp: String(key(r, ['loadinglocation', 'loadinglocation1', 'loadingplace', 'loadingpoint'])).trim(), lp2: String(key(r, ['loadinglocation2', 'loadingplace2', 'loadingpoint2'])).trim(), row: ln };
        for (const [k, nm] of DATECOLS) { const x = toIso(key(r, nm)); if (x === null) return bad.push('row ' + ln + ': invalid date in ' + ST[K.indexOf(k)]); o[k] = x; }
        if (o.r && !(o.d || o.l)) return bad.push('row ' + ln + ': Offloading 2 date needs a dispatched or loading date');
        if (o.r && o.r < (o.d || o.l)) return bad.push('row ' + ln + ': Offloading 2 date before the start of the trip');
        inc.push(o);
      });
      const upd = inc.filter(o => o.id && D.trips.some(t => t.id === o.id)).length;
      const why = bad.length ? ' Skipped ' + bad.length + ': ' + bad.slice(0, 5).join('; ') + (bad.length > 5 ? '; ...' : '') : '';
      if (!inc.length) return say('Nothing was uploaded.' + (why || ' No "Trip Log" rows found. Download the template and fill it in.'), true);
      if (!confirm('Import ' + inc.length + ' trips (' + (inc.length - upd) + ' new, ' + upd + ' updated)? Nothing is deleted.')) return;
      say('Uploading...');
      try { await api('POST', '/api/master/bulk', { trucks: [], trips: inc }); await load(); }
      catch (x) { return say('Upload failed, nothing was saved: ' + x.message, true); }
      say(<>Upload done: {inc.length - upd} trips added, {upd} updated.{why}{hadTruckSheet && <> (The "Truck Master" sheet in this file was ignored - trucks and drivers are now kept on the <Link to="/staff#drivers" style={{ color: 'inherit', fontWeight: 700 }}>Staff page</Link>.)</>}</>, bad.length > 0);
    } catch (x) { say('Upload failed: ' + x.message, true); }
  }

  // ---- 100-card preview (not saved)
  function preview() {
    if (!ready()) return;
    const b = Date.parse((f.from || today()) + 'T00:00'), I = n => new Date(b + n * 864e5).toISOString().slice(0, 10), R = DEMO_ROUTES.slice(0, 6);
    const T = i => D.trucks.length ? D.trucks[i % D.trucks.length].id : 'TRK-' + String(i % 50 + 1).padStart(3, '0');
    const trips = [];
    for (let i = 0; i < 100; i++) { const stg = Math.floor(Math.random() * 8), t = { id: 'TRIP-' + String(i + 1).padStart(4, '0'), truck: T(i), route: R[i % 6], plan: 35, n: '' }; let c = -Math.floor(Math.random() * 30); K.forEach((k, j) => { if (j <= stg) { t[k] = I(c); c += 1 + Math.floor(Math.random() * 4); } else t[k] = ''; }); if (t.r && t.r > I(0)) t.r = ''; trips.push(t); }
    for (let i = 0; i < 250; i++) { const t = { id: 'TRIP-' + String(101 + i).padStart(4, '0'), truck: T(i + 100), route: R[i % 6], plan: 35, n: '' }; let c = -(40 + Math.floor(i * 0.7)); K.forEach(k => { t[k] = I(c); c += 1 + Math.floor(Math.random() * 4); }); trips.push(t); }
    setDemo(true); setD({ ...D, trips });
    say('Showing 100 sample trips on the board plus 250 older completed trips (see Completed Trips, 3 pages). They are not saved. Refresh the page to go back to your data.');
  }

  // ---- Delete trips / trucks
  const cRows = useMemo(() => {
    if (!clean || !D) return [];
    const q = clean.q.toLowerCase(), used = new Set(D.trips.filter(t => !clean.sel.has('T' + t.id)).map(t => t.truck)); // trips ticked for deletion don't count
    if (clean.tab === 'T') return D.trips.slice().sort(byId).map(t => ({ id: t.id, smp: isSample(t), cells: [t.truck, t.route || '', t.r ? 'Completed ' + fmt(t.r) : (start(t) ? 'Started ' + fmt(start(t)) : '')] })).filter(x => !q || [x.id, ...x.cells].join(' ').toLowerCase().includes(q));
    return D.trucks.map(k => ({ id: k.id, smp: isPlaceholder(k, used), has: used.has(k.id), cells: [k.reg || '', k.driver || '', used.has(k.id) ? 'Has trips - kept' : 'No trips'] })).filter(x => !q || [x.id, ...x.cells].join(' ').toLowerCase().includes(q));
  }, [clean, D]);
  const selN = c => clean ? [...clean.sel].filter(x => x[0] === c).length : 0;
  const tick = (ids, on) => { const s = new Set(clean.sel); ids.forEach(id => on ? s.add(clean.tab + id) : s.delete(clean.tab + id)); setClean({ ...clean, sel: s }); };
  async function doDelete() {
    const tp = [...clean.sel].filter(x => x[0] === 'T').map(x => x.slice(1)), tk = [...clean.sel].filter(x => x[0] === 'K').map(x => x.slice(1));
    if (!confirm('Delete ' + tp.length + ' trip(s) and ' + tk.length + ' truck(s)? This cannot be undone.')) return;
    try {
      const r = await api('POST', '/api/master/delete', { trips: tp, trucks: tk }), kept = r.keptTrucks || [];
      await load(); setClean(null);
      say('Deleted ' + tp.length + ' trip(s) and ' + (tk.length - kept.length) + ' truck(s).' + (kept.length ? ' Kept ' + kept.length + ' truck(s) that still have trips.' : ''));
    } catch (e) { alert('Not deleted: ' + e.message); }
  }

  // ---- Trip details pop-up
  const detView = useMemo(() => {
    if (!det || !D) return null;
    const t = D.trips.find(x => x.id === det); if (!t) return null;
    const tr = tripTruck(t), to = t.r && t.r <= today() ? t.r : today();
    return { t, tr, i: info(t, to), L: legs(t, to) };
  }, [det, D]);
  const DF = ({ l, v, date }) => <div><dt>{l}</dt><dd>{v ? (date ? fmt(v) : v) : <span className="dash">&mdash;</span>}</dd></div>;
  const I2 = ({ l, v }) => <div><small>{l}</small>{v || <span className="dash">&mdash;</span>}</div>;
  const LegHead = ({ x, extra }) => <h3><span>{x.n} <span className="sub">{extra}</span></span><span className={'b ' + (x.run ? (x.cls === 'o' ? 'o' : 'y') : x.d != null ? 'g' : '')}>{x.d == null ? (x.txt || 'Not started') : (x.run ? x.txt + ' · ' : '') + dd(x.d)}</span></h3>;

  const fv = form && form.v, tk = fv ? (D.trucks.find(x => x.id === fv.truck) || {}) : {};
  const setFv = (k, v) => setForm({ ...form, v: { ...form.v, [k]: v } });
  const fi = (n, l, type, wide, ph) => <label key={n} className={wide ? 'wide' : undefined}>{l}<input type={type || 'text'} placeholder={ph} value={fv[n] ?? ''} onChange={e => setFv(n, e.target.value)} /></label>;

  return (
    <div className="pg-master" ref={topRef}>
      <header className="head">
        <div>
          <h1>{done ? 'Completed Trips' : 'Current Trips'}</h1>
          <div className="today">Today, {fmt(today())} · Saved on the server</div>
          <p>{done ? 'Every trip that has an Offloading 2 (completed) date, stored here so you can check it any time. 100 cards per page.' : 'Pick a date to see every trip started or in progress. Trips with an Offloading 2 date move to Completed Trips. Each trip is a card with the truck, driver, route and all stage dates.'}</p>
        </div>
        {!done && <button className="btn pri" onClick={() => D && openForm(null)}><Icon name="plus" />Add trip</button>}
      </header>
      <div className="body">
        {!done ? <>
          <section className="kpis">
            {cur && [['Trips started', cur.n.st, 'Trucks with a dispatch date, not yet completed' + (cur.n.sp ? ' · ' + cur.n.sp + ' dispatched in this period' : ''), 'y'], ['link'], ['In progress', cur.n.ip, 'Still on the road at end date', ''], ['Delayed / overdue', cur.n.dl, 'Past planned trip days', 'r']].map(x => x[0] === 'link'
              ? <Link key="l" className="k link" to="/master#completed" title="Open all completed trips"><div className="kh">Trips completed<span className="go" aria-hidden="true"><Icon name="right" /></span></div><b>{doneTrips.length}</b><span style={{ display: 'block', color: 'var(--mute)', fontSize: 'var(--fs-sm)', marginBottom: 6 }}>{cur.n.co} completed in this period</span><span className="more">View all completed trips <Icon name="right" style={{ width: 15, height: 15 }} /></span></Link>
              : <div key={x[0]} className="k"><div className="kh">{x[0]}<span className={'chip ' + x[3]}><Icon name="truck" /></span></div><b>{x[1]}</b><span>{x[2]}</span></div>)}
          </section>
          <section className="panel">
            <div className="ph">
              <h2>Trip cards</h2>
              <div className="bar">
                <button className="btn" onClick={() => ready() && !blocked() && fileRef.current.click()}><Icon name="up" />Bulk upload Excel</button>
                <button className="btn" onClick={tpl}><Icon name="down" />Download template</button>
                <button className="btn" onClick={exp}><Icon name="down" />Export data</button>
                <button className="btn" title="Fills the page with 100 sample trips. Not saved." onClick={preview}>Preview 100 cards</button>
                <button className="btn" style={{ color: 'var(--rfg)' }} onClick={() => ready() && !blocked() && setClean({ tab: 'T', q: '', sel: new Set() })}>Delete trips / trucks</button>
                <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" hidden onChange={upload} />
              </div>
            </div>
            <Msg msg={msg} />
            <div className="tools">
              <label>From date<input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
              <label>To date (optional)<input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label>
              <label>Show<select value={f.view} onChange={e => setF({ ...f, view: e.target.value })}><option>All Activity</option><option>Started</option><option>In Progress</option><option>Delayed / Overdue</option></select></label>
              <label>Search<input type="search" placeholder="Truck, driver, route, trip ID" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></label>
              <button className="rst" onClick={() => setF({ from: today(), to: '', view: 'All Activity', q: '' })}><Icon name="reset" />Today</button>
            </div>
            <div className="cap">{cur && `Showing ${fmt(cur.fr)}${cur.to > cur.fr ? ' to ' + fmt(cur.to) : ''} · ${f.view} · ${cur.out.length} trip card(s)`}</div>
            <div id="cards">
              {!cur ? <div className="empty">Loading trips...</div> : cur.out.length ? cur.out.map(({ t, tr, i }) => <Card key={t.id} t={t} tr={tr} i={i} to={cur.to} onOpen={setDet} />) : <div className="empty">No trips match this date and filter.</div>}
            </div>
            <div className="foot">Click any card to see driver, contact and all stage dates. Card edge colour:<span className="b g">On time</span><span className="b o">Almost late</span><span className="b r">Late / overdue</span></div>
          </section>
        </> : <section className="panel">
          <div className="ph">
            <div className="bar" style={{ alignItems: 'center' }}><button className="btn" onClick={() => nav('/master')}><Icon name="left" />Back to Current Trips</button><h2>Completed trips<span className="cnt">{doneTrips.length}</span></h2></div>
            <div className="bar"><button className="btn" onClick={expDone}><Icon name="down" />Export completed</button></div>
          </div>
          <Msg msg={msg} />
          <div className="tools">
            <label>Completed in month<input type="month" value={df.month} onChange={e => { setDf({ ...df, month: e.target.value }); setPage(1); }} /></label>
            <label>Search<input type="search" placeholder="Truck, driver, route, trip ID" value={df.q} onChange={e => { setDf({ ...df, q: e.target.value }); setPage(1); }} /></label>
            <button className="rst" onClick={() => { setDf({ month: '', q: '' }); setPage(1); }}><Icon name="reset" />Clear filters</button>
          </div>
          <div className="cap">{comp.L.length ? `Showing ${comp.s + 1}–${comp.s + comp.sl.length} of ${comp.L.length} completed trip(s)${df.month || df.q ? ' (filtered)' : ''} · Page ${comp.p} of ${comp.pages}` : ''}</div>
          <div id="dCards">
            {!D ? <div className="empty">Loading trips...</div> : comp.sl.length ? comp.sl.map(({ t, tr }) => <Card key={t.id} t={t} tr={tr} i={info(t, t.r)} to={t.r} onOpen={setDet} />)
              : <div className="empty">{doneTrips.length ? 'No completed trips match this filter.' : 'No completed trips yet. A trip appears here once it has an Offloading 2 date.'}</div>}
          </div>
          {comp.pages > 1 && <nav className="pager" aria-label="Pages">
            {(() => {
              const set = new Set([1, comp.pages]); for (let k = comp.p - 2; k <= comp.p + 2; k++) if (k >= 1 && k <= comp.pages) set.add(k);
              const go = n => { setPage(n); topRef.current && topRef.current.scrollIntoView({ behavior: 'smooth' }); };
              let prev = 0; const out = [<button key="p" disabled={comp.p === 1} onClick={() => go(comp.p - 1)}>&lsaquo; Prev</button>];
              [...set].sort((a, b) => a - b).forEach(k => { if (k - prev > 1) out.push(<span key={'g' + k}>&hellip;</span>); out.push(<button key={k} className={k === comp.p ? 'on' : ''} onClick={() => go(k)}>{k}</button>); prev = k; });
              out.push(<button key="n" disabled={comp.p === comp.pages} onClick={() => go(comp.p + 1)}>Next &rsaquo;</button>);
              return out;
            })()}
          </nav>}
          <div className="foot">A trip shows here once it has an Offloading 2 (completed) date. Newest first, 100 cards per page. Click a card to view or edit it.</div>
        </section>}
      </div>

      {/* Trip details */}
      <Modal open={!!detView} onClose={() => setDet(null)} className="det-dlg">
        {detView && (() => {
          const { t, tr, i, L } = detView;
          return <>
            <div className="dh"><div><h2>Trip {t.id}</h2><div className="sub">{t.route ? t.route + ' · ' : ''}Planned {t.plan} days · Truck total days {i.run == null ? '—' : i.run}</div></div><span className={'b ' + STY[i.s]}><i />{LBL[i.s] || i.s}</span></div>
            <div className="dinfo">
              <I2 l="Truck" v={t.truck} /><I2 l="Trailer" v={tr.trailer} />
              {tr.staffId ? <div><small>Driver{tr.saved ? ' on this trip' : ''}</small><Link to={'/staff#' + tr.staffId} style={{ color: 'inherit' }}>{tr.driver || 'Open profile'}</Link></div> : <I2 l={tr.saved ? 'Driver on this trip' : 'Driver'} v={tr.driver} />}
              <I2 l="Contact" v={tr.contact} /><I2 l="Passport" v={tr.passport} /><I2 l="Licence (cat. / issue)" v={[tr.licence, tr.category, tr.issue].filter(Boolean).join(' · ')} />
              <I2 l="Dispatched" v={t.d ? fmt(t.d) : ''} /><I2 l="Truck type" v={tr.type} /><I2 l="Truck status" v={tr.status} />
            </div>
            <section className={'dleg ' + L[0].cls}><LegHead x={L[0]} extra="Northbound" /><dl><DF l="Loaded" v={t.l} date /><DF l="Loading location" v={t.lp} /><DF l="In transit" v={t.t} date /><DF l="Offloaded" v={t.u} date /></dl></section>
            <section className={'dleg emp ' + L[1].cls}><LegHead x={L[1]} extra="Waiting to load" /><dl><DF l="Empty since (offloaded)" v={t.u} date /><DF l="Loaded again" v={t.l2} date /></dl></section>
            <section className={'dleg ' + L[2].cls}><LegHead x={L[2]} extra="Southbound" /><dl><DF l="Loaded" v={t.l2} date /><DF l="Loading location" v={t.lp2} /><DF l="In transit" v={t.t2} date /><DF l="Offloaded" v={t.r} date /></dl>{t.v && <div className="sub" style={{ marginTop: 8 }}>Delivered: {fmt(t.v)}</div>}</section>
            {t.n && <div className="sub">Notes: {t.n}</div>}
            <div className="acts"><span /><span><button type="button" className="btn" onClick={() => setDet(null)}>Close</button> <button type="button" className="btn pri" onClick={() => { const id = det; setDet(null); openForm(id); }}>Edit trip</button></span></div>
          </>;
        })()}
      </Modal>

      {/* Add / edit trip */}
      <Modal open={!!form} onClose={() => setForm(null)}>
        {form && <form onSubmit={e => { e.preventDefault(); saveTrip(); }}>
          <h2>{form.editing ? 'Edit trip' : 'Add trip'}</h2>
          <div className="grid">
            <label>Trip ID<input readOnly value={fv.id || ''} placeholder="Given when you save" /></label>
            <label>Truck<select value={fv.truck} onChange={e => setFv('truck', e.target.value)}>{D.trucks.map(x => <option key={x.id}>{x.id}</option>)}</select></label>
            <div className="wide tdet">
              <h3>Truck &amp; driver details</h3>
              {TRUCK_FIELDS.map(([k, l]) => <label key={k}>{l}<input readOnly value={tk[k] || (k === 'status' ? 'Active' : '')} /></label>)}
              <small>Trucks and drivers are kept on the Staff page. {tk.staffId
                ? <Link to={'/staff#' + tk.staffId} style={{ color: 'var(--yfg)', fontWeight: 700 }}>Edit this driver &amp; truck in Staff &rarr;</Link>
                : <Link to="/staff#drivers" style={{ color: 'var(--yfg)', fontWeight: 700 }}>Give this truck a driver in Staff &rarr;</Link>}</small>
            </div>
            {fi('route', 'Route (Origin - Destination)', undefined, true, undefined)}
            {fi('plan', 'Planned trip days', 'number', false, undefined)}<span />
            <div className="wide leg">Trip 1 · NB (Northbound)</div>
            {fi('d', 'Dispatched date', 'date', false, undefined)}{fi('l', 'Loading date', 'date', false, undefined)}
            {fi('lp', 'Loading location', undefined, true, 'e.g. Ndola')}
            {fi('t', 'In transit date', 'date', false, undefined)}{fi('u', 'Offloading date', 'date', false, undefined)}
            <div className="wide leg">Trip 2 · SB (Southbound)</div>
            {fi('l2', 'Loading date 2', 'date', false, undefined)}{fi('lp2', 'Loading location 2', undefined, false, 'e.g. Kolwezi')}
            {fi('t2', 'In transit date 2', 'date', false, undefined)}<span />
            {fi('v', 'Delivered date', 'date', false, undefined)}{fi('r', 'Offloading date 2 (trip completed)', 'date', false, undefined)}
            {fi('n', 'Notes', undefined, true, undefined)}
          </div>
          <div className="acts"><button type="button" className="btn" style={{ color: 'var(--rfg)', visibility: form.editing ? 'visible' : 'hidden' }} onClick={delTrip}>Delete</button>
            <span><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button> <button className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></span></div>
        </form>}
      </Modal>

      {/* Delete trips / trucks */}
      <Modal open={!!clean} onClose={() => setClean(null)} className="clean-dlg">
        {clean && <>
          <h2>Delete trips / trucks</h2>
          <p className="sub" style={{ margin: '-8px 0 12px' }}>Tick what you want to delete. Deleted data cannot be brought back, so download an <b>Export data</b> copy first if you are unsure.</p>
          <div className="bar" style={{ marginBottom: 10 }}>
            {[['T', 'Trips'], ['K', 'Trucks']].map(([k, l]) => <button key={k} type="button" className={'btn' + (clean.tab === k ? ' on' : '')} onClick={() => setClean({ ...clean, tab: k, q: '' })}>{l}</button>)}
          </div>
          <div className="bar" style={{ marginBottom: 10 }}>
            <input type="search" style={{ flex: '1 1 200px' }} placeholder={clean.tab === 'T' ? 'Filter: truck, route, trip ID' : 'Filter: truck ID, driver'} value={clean.q} onChange={e => setClean({ ...clean, q: e.target.value })} />
            <button type="button" className="btn" onClick={() => tick(cRows.filter(x => x.smp).map(x => x.id), true)}>{clean.tab === 'T' ? 'Tick sample trips' : 'Tick unused TRK- trucks'} ({cRows.filter(x => x.smp).length})</button>
            <button type="button" className="btn" onClick={() => tick(cRows.filter(x => !x.has).map(x => x.id), true)}>Tick all shown</button>
            <button type="button" className="btn" onClick={() => setClean({ ...clean, sel: new Set([...clean.sel].filter(x => x[0] !== clean.tab)) })}>Untick all</button>
          </div>
          <div className="clist">
            <label className="hd"><span />{(clean.tab === 'T' ? ['Trip ID', 'Truck', 'Route', 'Status'] : ['Truck ID', 'Reg. no.', 'Driver', 'Trips']).map(x => <span key={x}>{x}</span>)}</label>
            {cRows.length ? cRows.map(x => <label key={x.id} className={x.smp ? 'smp' : ''}>
              <input type="checkbox" checked={clean.sel.has(clean.tab + x.id)} disabled={!!x.has} title={x.has ? 'This truck still has trips' : undefined} onChange={e => tick([x.id], e.target.checked)} />
              <b>{x.id}</b>{x.cells.map((c, j) => <span key={j} className="rt">{c}</span>)}
            </label>) : <div className="empty">Nothing here.</div>}
          </div>
          <div className="acts"><span className="sub" style={{ alignSelf: 'center' }}>Ticked: {selN('T')} trip(s), {selN('K')} truck(s)</span>
            <span><button type="button" className="btn" onClick={() => setClean(null)}>Cancel</button> <button type="button" className="btn" disabled={!(selN('T') + selN('K'))} style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }} onClick={doDelete}>Delete ticked</button></span></div>
        </>}
      </Modal>
    </div>
  );
}
