import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Msg from '../components/Msg.jsx';
import { api } from '../lib/api.js';
import { today, days, fmt, cmp, toIso, phone, norm, readWorkbook, saveBook } from '../lib/util.js';
import '../styles/staff.css';

// STAFF: everyone by team; drivers carry their truck. /staff#drivers opens a team, /staff#STF-0001 opens a profile.
// API: GET /api/staff, POST /api/staff, PUT|DELETE /api/staff/:id, POST /api/staff/import-drivers, POST /api/staff/bulk
const TEAMS = [['operations', 'Operations'], ['finance', 'Finance'], ['hr', 'HR'], ['directors', 'Directors'], ['ground', 'Ground Team'], ['mechanics', 'Mechanics'], ['drivers', 'Drivers']];
const TL = Object.fromEntries(TEAMS), TCOL = { operations: 'p', finance: 'g', hr: 'o', directors: 'r', ground: '', mechanics: 'o', drivers: 'y' };
const AVC = ['#0f766e', '#7c3aed', '#b45309', '#be123c', '#1d4ed8', '#15803d', '#a21caf', '#0369a1'];
const F = ['id', 'name', 'team', 'designation', 'location', 'status', 'phone', 'email', 'joined', 'passport', 'passportExp', 'licence', 'licenceExp', 'category', 'issue', 'truck', 'trailer', 'ttype', 'nok', 'nokPhone', 'notes'];
const DESIGS = ['Truck Driver', 'Mechanic', 'Operations Manager', 'Dispatcher', 'Accountant', 'Finance Manager', 'HR Officer', 'Director', 'Managing Director', 'Yard Supervisor', 'Security Guard', 'Fuel Attendant'];
const TTYPES = ['SINO', 'Flatbed', 'Tanker', 'Tipper', 'Side Tipper', 'Lowbed', 'Container'];

// Photo, or initials on a colour picked from the name
function Av({ s, big }) {
  const cls = 'av' + (big ? ' big' : '');
  if (s.photo) return <div className={cls}><img src={s.photo} alt="" /></div>;
  const ini = String(s.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  let h = 0; for (const c of String(s.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <div className={cls} style={{ background: AVC[h % AVC.length] }}>{ini}</div>;
}
// Document expiry: '' fine, 'o' within 60 days, 'r' expired
const expCls = d => !d ? '' : d < today() ? 'r' : days(today(), d) <= 60 ? 'o' : '';
function DocBadges({ s }) {
  const out = [];
  const one = (lbl, d) => { const c = expCls(d); if (c) out.push(<span key={lbl} className={'b ' + c}>{lbl} {c === 'r' ? 'expired' : 'expires'} {fmt(d)}</span>); };
  one('Passport', s.passportExp); if (s.team === 'drivers') one('Licence', s.licenceExp);
  return out.length ? <>{out}</> : null;
}

const COLS = [['Staff ID', 'id'], ['Full Name', 'name'], ['Team', 'team'], ['Designation', 'designation'], ['Location', 'location'], ['Phone', 'phone'], ['Email', 'email'], ['Status', 'status'], ['Date Joined', 'joined'], ['Passport No.', 'passport'], ['Passport Expiry', 'passportExp'], ['Licence No.', 'licence'], ['Licence Category', 'category'], ['Licence Issue No.', 'issue'], ['Licence Expiry', 'licenceExp'], ['Assigned Truck', 'truck'], ['Trailer No.', 'trailer'], ['Truck Type', 'ttype'], ['Next of Kin', 'nok'], ['Next of Kin Phone', 'nokPhone'], ['Notes', 'notes']];
const HELP = ['How this file works',
  'One row per person. Upload it with "Bulk upload Excel" on the Staff page.',
  'Staff ID filled in = that person is UPDATED (blank cells keep what is saved). Staff ID empty = a NEW person.',
  'Team must be one of: ' + TEAMS.map(t => t[1]).join(', ') + '.',
  'Status: Active, On leave, Suspended or Left.',
  'Drivers: Assigned Truck, Trailer No. and Truck Type. A truck number that does not exist yet is ADDED as a new truck. Spaces do not matter (BCJ6422ZM = BCJ 6422 ZM).',
  'Trucks are kept here on the Staff page. Fleet Master View only holds the trips.',
  'Dates: yyyy-mm-dd or normal Excel dates. Photos are added on the page, not in Excel.'];
const ALIAS = { id: ['staffid', 'id', 'empid', 'employeeid'], name: ['fullname', 'name', 'staffname', 'drivername'], team: ['team', 'department', 'dept'], designation: ['designation', 'position', 'jobtitle', 'title'], location: ['location', 'branch', 'station'], phone: ['phone', 'contact', 'phoneno', 'mobile', 'drivercontact'], email: ['email', 'emailaddress'], status: ['status'], joined: ['datejoined', 'joined', 'joiningdate', 'startdate'], passport: ['passportno', 'passport', 'passportnumber'], passportExp: ['passportexpiry', 'passportexpirydate', 'passportexp'], licence: ['licenceno', 'licence', 'licencenumber', 'licenseno', 'license', 'licensenumber'], category: ['licencecategory', 'licensecategory', 'category'], issue: ['licenceissueno', 'licenseissueno', 'issueno', 'issue'], licenceExp: ['licenceexpiry', 'licenseexpiry', 'licenceexp', 'licenceexpirydate'], truck: ['assignedtruck', 'truck', 'truckid', 'reg', 'truckno', 'trucknumber'], trailer: ['trailerno', 'trailer', 'trailernumber'], ttype: ['trucktype', 'type'], nok: ['nextofkin', 'nok'], nokPhone: ['nextofkinphone', 'nokphone'], notes: ['notes', 'remarks'] };

export default function Staff() {
  const loc = useLocation(), nav = useNavigate();
  const [S, setS] = useState(null), [TR, setTR] = useState([]);
  const [team, setTeam] = useState(() => TL[loc.hash.slice(1)] ? loc.hash.slice(1) : 'all');
  const [f, setF] = useState({ q: '', loc: '', st: '', doc: '' });
  const [msg, setMsg] = useState(null), [err, setErr] = useState('');
  const [form, setForm] = useState(null); // { editing: staff|null, v, photo }
  const [api2, setApi2] = useState(false), [saving, setSaving] = useState(false);
  const fileRef = useRef(null), picRef = useRef(null);
  const say = (text, e) => setMsg({ text, err: e });

  async function load() { const j = await api('GET', '/api/staff'); setS(j.staff); setTR(j.trucks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))); return j.staff; }
  useEffect(() => { load().catch(e => setErr(e.message)); }, []);
  // Links like /staff#drivers or /staff#STF-0001 (from Fleet Master) open the team or the profile
  useEffect(() => {
    const h = loc.hash.slice(1);
    if (TL[h]) setTeam(h);
    if (S && /^STF-\d+$/.test(h)) openForm(h);
  }, [loc.hash, !!S]);

  const findTruck = v => v ? TR.find(t => cmp(t.id) === cmp(v)) : null;
  const holder = (t, me) => t && t.staffId && t.staffId !== me ? ((S.find(s => s.id === t.staffId) || {}).name || t.driver) : '';
  const truckLabel = id => { const t = TR.find(x => x.id === id); return t ? (t.reg || t.id) : id; };

  const list = useMemo(() => {
    if (!S) return [];
    const q = f.q.toLowerCase();
    return S.filter(s => team === 'all' || s.team === team)
      .filter(s => f.st ? s.status === f.st : s.status !== 'Left')
      .filter(s => !f.loc || s.location === f.loc)
      .filter(s => !f.doc || (f.doc === 'exp' ? (expCls(s.passportExp) || (s.team === 'drivers' && expCls(s.licenceExp))) : f.doc === 'nopass' ? !s.passport : (s.team === 'drivers' && !s.truck)))
      .filter(s => !q || [s.id, s.name, s.designation, s.location, s.phone, s.email, s.passport, s.licence, s.truck, truckLabel(s.truck), TL[s.team]].join(' ').toLowerCase().includes(q))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [S, team, f, TR]);
  const locs = useMemo(() => [...new Set((S || []).map(s => s.location).filter(Boolean))].sort(), [S]);
  const act = (S || []).filter(s => s.status !== 'Left');

  const pickTeam = t => { setTeam(t); nav(t === 'all' ? '/staff' : '/staff#' + t, { replace: true }); };

  // ---- Profile form
  function openForm(id) {
    const s = id ? (S || []).find(x => x.id === id) : null;
    const o = s || { team: team === 'all' ? 'drivers' : team, status: 'Active' };
    const v = Object.fromEntries(F.map(k => [k, o[k] || (k === 'status' ? 'Active' : '')]));
    const t = findTruck(v.truck); v.trailer = t ? t.trailer || '' : ''; v.ttype = t ? t.type || '' : '';
    setForm({ editing: s, v, photo: o.photo || '' });
  }
  const setV = (k, val) => setForm(fm => {
    const v = { ...fm.v, [k]: val };
    if (k === 'truck') { const t = findTruck(val); v.trailer = t ? t.trailer || '' : ''; v.ttype = t ? t.type || '' : ''; }
    return { ...fm, v };
  });
  async function save() {
    const o = {}; F.forEach(k => o[k] = String(form.v[k] || '').trim()); o.photo = form.photo;
    if (!o.name) return alert('Please type the name.');
    if (o.team !== 'drivers') { o.truck = ''; o.trailer = ''; o.ttype = ''; }
    const ed = form.editing, t = findTruck(o.truck), w = holder(t, ed && ed.id); if (t) o.truck = t.id;
    if (w && !confirm(t.id + ' is now with ' + w + '. Move it to ' + o.name + '?')) return;
    if (o.truck && !t && !confirm(o.truck + ' is a new truck number. Add it as a new truck?')) return;
    setSaving(true);
    try {
      const { id, ...rest } = o;
      const r = ed ? await api('PUT', '/api/staff/' + encodeURIComponent(ed.id), rest) : await api('POST', '/api/staff', rest);
      await load(); setForm(null);
      if (/^#STF-/.test(loc.hash)) nav('/staff', { replace: true });
      say(r.name + ' saved' + (r.truck ? ' and shown on truck ' + r.truck : '') + '.');
    } catch (e) { alert('Not saved: ' + e.message); }
    finally { setSaving(false); }
  }
  async function del() {
    const ed = form.editing;
    if (!ed || !confirm('Delete ' + ed.name + '? ' + (ed.truck ? 'They will also be taken off truck ' + truckLabel(ed.truck) + '. ' : '') + 'This cannot be undone. (To keep their record, set Status to "Left" instead.)')) return;
    try { await api('DELETE', '/api/staff/' + encodeURIComponent(ed.id)); await load(); setForm(null); say(ed.name + ' deleted.'); }
    catch (e) { alert('Not deleted: ' + e.message); }
  }
  const closeForm = () => { setForm(null); if (/^#STF-/.test(loc.hash)) nav('/staff', { replace: true }); };

  // Photo: made small (max 320px, JPEG) before saving, so pages stay fast
  function pickPhoto(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 320, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      const p = c.toDataURL('image/jpeg', .8); URL.revokeObjectURL(url); setForm(fm => ({ ...fm, photo: p }));
    };
    img.onerror = () => alert('That file is not a picture this browser can open. Use a JPG or PNG.');
    img.src = url;
  }

  async function importDrivers() {
    if (!confirm('Make a driver profile for every driver saved on a truck in Fleet Master View (name, phone, passport, licence and the truck)? Drivers that already have a profile are skipped.')) return;
    try { const r = await api('POST', '/api/staff/import-drivers'); await load(); pickTeam('drivers'); say(r.made + ' driver profile(s) made' + (r.skipped ? ', ' + r.skipped + ' skipped (a profile with that name already exists)' : '') + '.'); }
    catch (e) { say('Import failed: ' + e.message, true); }
  }

  // ---- Excel
  const row = s => { const t = findTruck(s.truck) || {}; return COLS.map(([, k]) => k === 'team' ? TL[s.team] || s.team : k === 'trailer' ? t.trailer || '' : k === 'ttype' ? t.type || '' : s[k] || ''); };
  const header = COLS.map(c => c[0]);
  const exp = () => { if (!list.length) return alert('Nobody to export with these filters.'); saveBook('staff_' + (team === 'all' ? 'all' : team) + '_' + today() + '.xlsx', [['Staff', [header].concat(list.map(row)), 18]]); };
  const tpl = () => saveBook('staff_template_' + today() + '.xlsx', [['Instructions', HELP.map(x => [x])], ['Staff', [header].concat((S || []).length ? S.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(row) : [['', 'Example Person', 'Finance', 'Accountant', 'Ndola', '0970000000', '', 'Active', '2026-01-15', '', '', '', '', '', '', '', '', '', '', '', 'Example row - replace it']]), 18]]);
  async function upload(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const { X, wb } = await readWorkbook(file), nm = wb.SheetNames.find(n => /staff/i.test(n)) || wb.SheetNames.find(n => !/instruction/i.test(n));
      const R = X.utils.sheet_to_json(wb.Sheets[nm], { defval: '', raw: true }), out = [], bad = [], nw = new Set();
      R.forEach((r, i) => {
        const o = { row: i + 2 }, keys = Object.keys(r);
        for (const [fld, al] of Object.entries(ALIAS)) { const k = keys.find(k => al.includes(norm(k))); o[fld] = k == null ? '' : r[k]; }
        if (!String(o.name).trim() && !String(o.id).trim()) return;
        for (const d of ['joined', 'passportExp', 'licenceExp']) { const x = toIso(o[d]); if (x === null) { bad.push('row ' + o.row + ': bad date in ' + d); return; } o[d] = x; }
        o.phone = phone(o.phone); o.nokPhone = phone(o.nokPhone);
        for (const k of Object.keys(o)) if (k !== 'row') o[k] = String(o[k]).replace(/\s+/g, ' ').trim();
        if (o.truck) { const t = TR.find(x => cmp(x.id) === cmp(o.truck) || (x.reg && cmp(x.reg) === cmp(o.truck))); if (t) o.truck = t.id; else nw.add(o.truck); }
        out.push(o);
      });
      if (bad.length) return say('Nothing was uploaded. Fix these rows: ' + bad.slice(0, 5).join('; '), true);
      if (!out.length) return say('No staff rows found. Download the template and fill it in.', true);
      const upd = out.filter(o => o.id && S.some(s => s.id === o.id.toUpperCase())).length;
      if (!confirm('Upload ' + out.length + ' staff (' + (out.length - upd) + ' new, ' + upd + ' updated)' + (nw.size ? ' and add ' + nw.size + ' new truck(s): ' + [...nw].slice(0, 6).join(', ') + (nw.size > 6 ? ' ...' : '') : '') + '? Nothing is deleted.')) return;
      say('Uploading...');
      const r = await api('POST', '/api/staff/bulk', { staff: out }); await load();
      say('Upload done: ' + r.added + ' added, ' + r.updated + ' updated.');
    } catch (x) { say('Upload failed, nothing was saved: ' + x.message, true); }
  }

  // ---- Profile form pieces (plain functions, so inputs keep focus while typing)
  const v = form && form.v;
  const inp = (k, l, o = {}) => <label key={k} className={o.wide ? 'wide' : undefined}>{l}<input type={o.type || 'text'} list={o.list} placeholder={o.ph} readOnly={o.ro} value={v[k] || ''} onChange={e => setV(k, e.target.value)} autoComplete={o.list ? 'off' : undefined} /></label>;
  const t = v && findTruck(v.truck.trim()), w = v && holder(t, form.editing && form.editing.id);

  return (
    <div className="pg-staff">
      <header className="head">
        <div><h1>Staff</h1><p>Everyone at Professional Hauliers, by team. Click a person to see and edit their profile, passport and documents. Trucks are kept here too: give a driver a truck (with its trailer and type) and their details show on that truck's trip cards.</p></div>
        <button className="btn pri" onClick={() => S && openForm(null)}><Icon name="plus" />Add staff</button>
      </header>
      <div className="body">
        <section className="teams">
          {[['all', 'All staff']].concat(TEAMS).map(([k, l]) => <button key={k} className={'tm ' + (team === k ? 'on' : '')} onClick={() => pickTeam(k)}><span>{l}</span><b>{k === 'all' ? act.length : act.filter(s => s.team === k).length}</b></button>)}
        </section>
        <section className="panel">
          <div className="ph">
            <h2>{team === 'all' ? 'All staff' : TL[team]}</h2>
            <div className="bar">
              <button className="btn" title="Makes a driver profile for every driver already saved on a truck in Fleet Master View" onClick={importDrivers}>Import drivers from trucks</button>
              <button className="btn" onClick={() => fileRef.current.click()}><Icon name="up" />Bulk upload Excel</button>
              <button className="btn" onClick={tpl}><Icon name="down" />Download template</button>
              <button className="btn" onClick={exp}><Icon name="down" />Export</button>
              <button className="btn" onClick={() => setApi2(true)}>Team APIs</button>
              <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" hidden onChange={upload} />
            </div>
          </div>
          <Msg msg={msg} />
          <div className="tools">
            <label>Search<input type="search" placeholder="Name, designation, phone, passport, truck" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></label>
            <label>Location<select value={f.loc} onChange={e => setF({ ...f, loc: e.target.value })}><option value="">All locations</option>{locs.map(l => <option key={l}>{l}</option>)}</select></label>
            <label>Status<select value={f.st} onChange={e => setF({ ...f, st: e.target.value })}><option value="">All except Left</option><option>Active</option><option>On leave</option><option>Suspended</option><option>Left</option></select></label>
            <label>Documents<select value={f.doc} onChange={e => setF({ ...f, doc: e.target.value })}><option value="">All</option><option value="exp">Expired or expiring (60 days)</option><option value="nopass">No passport number</option><option value="notruck">Drivers without a truck</option></select></label>
            <button className="rst" onClick={() => setF({ q: '', loc: '', st: '', doc: '' })}><Icon name="reset" />Clear filters</button>
          </div>
          <div className="cap">{S && list.length + ' of ' + S.length + ' staff'}</div>
          <div id="cards">
            {err ? <div className="empty">Could not load staff: {err}<br />Is staff.js added to server.js and the server restarted?</div>
              : !S ? <div className="empty">Loading staff...</div>
                : list.length ? list.map(s => <div key={s.id} className={'sc ' + (s.status === 'Left' ? 'left' : '')} onClick={() => openForm(s.id)}>
                  <div className="sh"><Av s={s} /><div style={{ minWidth: 0 }}><div className="nm">{s.name}</div><div className="ds">{s.designation || TL[s.team] || ''}</div></div></div>
                  <div className="chips"><span className={'b ' + TCOL[s.team]}>{TL[s.team] || s.team}</span>{s.status !== 'Active' && <span className={'b ' + (s.status === 'Left' ? 'r' : 'o')}>{s.status}</span>}{s.team === 'drivers' && (s.truck ? <span className="trk">{truckLabel(s.truck)}</span> : <span className="b o">No truck</span>)}</div>
                  <div className="meta"><div>{s.location ? 'Location: ' + s.location : <span style={{ color: 'var(--mute2)' }}>No location</span>}</div><div>{s.phone || <span style={{ color: 'var(--mute2)' }}>No phone</span>}</div><div>Passport: {s.passport || <span style={{ color: 'var(--mute2)' }}>&mdash;</span>}</div></div>
                  {(expCls(s.passportExp) || (s.team === 'drivers' && expCls(s.licenceExp))) && <div className="chips"><DocBadges s={s} /></div>}
                </div>)
                  : <div className="empty">{S.length ? 'Nobody matches these filters.' : <>No staff yet. Click <b>Add staff</b>, or <b>Import drivers from trucks</b> to start with the drivers already in Fleet Master View.</>}</div>}
          </div>
          <div className="foot">Passport and licence expiry: <span className="b o">expires within 60 days</span> <span className="b r">expired</span></div>
        </section>
      </div>

      <Modal open={!!form} onClose={closeForm}>
        {form && <form onSubmit={e => { e.preventDefault(); save(); }}>
          <div className="dt"><div><h2>{form.editing ? form.editing.name : 'Add staff'}</h2><div className="hint">{form.editing ? form.editing.id + ' · ' + (TL[form.editing.team] || '') + (form.editing.updated ? ' · last changed ' + fmt(form.editing.updated.slice(0, 10)) : '') : ''}</div></div><span>{form.editing && <DocBadges s={form.editing} />}</span></div>
          <div className="pf">
            <div className="pic">
              <Av s={{ name: v.name || '?', photo: form.photo }} big />
              <div className="bar" style={{ justifyContent: 'center' }}><button type="button" className="btn" onClick={() => picRef.current.click()}>Upload photo</button>{form.photo && <button type="button" className="btn" style={{ color: 'var(--rfg)' }} onClick={() => setForm({ ...form, photo: '' })}>Remove</button>}</div>
              <small>JPG or PNG. It is made smaller automatically.</small>
              <input type="file" ref={picRef} accept="image/*" hidden onChange={pickPhoto} />
            </div>
            <div>
              <div className="sec"><h3>Profile</h3><div className="grid">
                {inp('name', 'Full name', { wide: true })}
                <label>Team<select value={v.team} onChange={e => setV('team', e.target.value)}>{TEAMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                {inp('designation', 'Designation', { list: 'desigs', ph: 'e.g. Accountant' })}
                {inp('location', 'Location', { list: 'locs', ph: 'e.g. Ndola' })}
                <label>Status<select value={v.status} onChange={e => setV('status', e.target.value)}><option>Active</option><option>On leave</option><option>Suspended</option><option>Left</option></select></label>
                {inp('phone', 'Phone', { type: 'tel' })}{inp('email', 'Email', { type: 'email' })}
                {inp('joined', 'Date joined', { type: 'date' })}
                <label>Staff ID<input readOnly value={v.id} placeholder="Given when you save" /></label>
              </div></div>
              <div className="sec"><h3>Passport</h3><div className="grid">{inp('passport', 'Passport no.')}{inp('passportExp', 'Passport expiry', { type: 'date' })}</div></div>
              {v.team === 'drivers' && <div className="sec drv"><h3>Driver licence &amp; truck</h3><div className="grid">
                {inp('licence', 'Licence no.')}{inp('licenceExp', 'Licence expiry', { type: 'date' })}
                {inp('category', 'Licence category', { ph: 'e.g. D,G' })}{inp('issue', 'Licence issue no.')}
                {inp('truck', 'Assigned truck', { wide: true, list: 'trkList', ph: 'Pick a truck, or type a new truck number e.g. BCH 6062 ZM' })}
                {inp('trailer', 'Trailer no.', { ph: 'e.g. BCH 6192 ZM' })}{inp('ttype', 'Truck type', { list: 'ttypes', ph: 'e.g. SINO' })}
                <div className="wide hint">{!v.truck.trim() ? 'No truck. Pick one from the list, or type a new truck number to add it.'
                  : !t ? <><b>New truck</b> - {v.truck.trim()} will be added when you save. Fill in its trailer and type.</>
                    : w ? <><b style={{ color: 'var(--ofg)' }}>This truck is now with {w}.</b> Saving moves it to this driver.</>
                      : 'The driver\'s name, phone, passport and licence show on this truck\'s trip cards. Trailer and type belong to the truck.'}</div>
              </div></div>}
              <div className="sec"><h3>Next of kin &amp; notes</h3><div className="grid">
                {inp('nok', 'Next of kin')}{inp('nokPhone', 'Next of kin phone', { type: 'tel' })}
                <label className="wide">Notes<textarea value={v.notes} onChange={e => setV('notes', e.target.value)} /></label>
              </div></div>
            </div>
          </div>
          <div className="acts"><button type="button" className="btn" style={{ color: 'var(--rfg)', visibility: form.editing ? 'visible' : 'hidden' }} onClick={del}>Delete</button>
            <span className="bar"><button type="button" className="btn" onClick={closeForm}>Cancel</button><button className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></span></div>
          <datalist id="desigs">{DESIGS.map(d => <option key={d}>{d}</option>)}</datalist>
          <datalist id="locs">{locs.map(l => <option key={l}>{l}</option>)}</datalist>
          <datalist id="ttypes">{TTYPES.map(d => <option key={d}>{d}</option>)}</datalist>
          <datalist id="trkList">{TR.map(x => { const ww = holder(x, form.editing && form.editing.id); return <option key={x.id} value={x.id}>{(x.trailer ? 'trailer ' + x.trailer + ' · ' : '') + (ww ? 'now with ' + ww : x.staffId && x.staffId === (form.editing && form.editing.id) ? 'this driver' : 'free')}</option>; })}</datalist>
        </form>}
      </Modal>

      <Modal open={api2} onClose={() => setApi2(false)}>
        <h2 style={{ marginBottom: 6 }}>Team APIs</h2>
        <p className="hint" style={{ margin: '0 0 12px' }}>Other pages (fuel, procurement, accounts...) can read staff from these addresses. They need the same login as this page and return JSON.</p>
        <div className="api">{['GET /api/staff  (everyone + trucks)', 'GET /api/staff/teams  (team names and counts)'].concat(TEAMS.map(([k, l]) => `GET /api/staff/team/${k}  (${l})`)).concat(['GET /api/staff/STF-0001  (one person)']).map(x => <div key={x}>{x}</div>)}</div>
        <div className="acts"><span /><button type="button" className="btn" onClick={() => setApi2(false)}>Close</button></div>
      </Modal>
    </div>
  );
}
