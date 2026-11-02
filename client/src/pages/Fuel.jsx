import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { fmt, today } from '../lib/util.js';
import '../styles/fuel.css';

// FUEL MANAGEMENT. API: GET /api/records[?since=], POST /api/records, PUT/DELETE /api/records/:id, POST /api/import
const blank = () => ({ date: today(), trip: '', odo: '', truck: '', fuel: '', loc: '' });
const num = (n, d = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

function parseCSV(t) {
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inq) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inq = false; else cur += c; }
    else if (c === '"') inq = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

export default function Fuel() {
  const [data, setData] = useState([]);
  const [all, setAll] = useState(null);        // every record, loaded when searching
  const [status, setStatus] = useState(null);  // { ok, text }
  const [win, setWin] = useState('all');
  const [q, setQ] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [v, setV] = useState(blank), [editing, setEditing] = useState(null), [keep, setKeep] = useState(true);
  const fileRef = useRef(null), tripRef = useRef(null), fuelRef = useRef(null);
  const allAt = useRef(0);

  function sinceDate() {
    let s = null;
    if (win !== 'all') { const d = new Date(); d.setDate(d.getDate() - parseInt(win)); s = d.toISOString().slice(0, 10); }
    if (from && (!s || from < s)) s = from;
    return s;
  }
  async function load() {
    try {
      const s = sinceDate();
      const d = await api('GET', '/api/records' + (s ? '?since=' + s : ''));
      setData(d);
      setStatus({ ok: true, text: 'Connected · ' + d.length + ' records loaded' + (win === 'all' && !s ? '' : ' (' + (win === 'all' ? 'from ' + s : 'last ' + win + ' days') + ')') + ' · ' + new Date().toLocaleTimeString() });
      if (!s) { setAll(d); allAt.current = Date.now(); }
    } catch (e) { setStatus({ ok: false, text: 'Cannot reach server: ' + e.message }); }
  }
  async function ensureAll() {
    if (all && Date.now() - allAt.current < 30000) return;
    const d = await api('GET', '/api/records'); setAll(d); allAt.current = Date.now();
  }
  useEffect(() => { load(); }, [win, from]);
  // Refresh every 60 seconds (not while searching)
  useEffect(() => { const t = setInterval(() => { if (!q.trim()) load(); }, 60000); return () => clearInterval(t); });
  useEffect(() => { if (!q.trim()) return; const t = setTimeout(() => ensureAll().catch(e => alert(e.message)), 400); return () => clearTimeout(t); }, [q]);

  async function run(fn) {
    try { await fn(); setAll(null); allAt.current = 0; await load(); if (q.trim()) await ensureAll(); }
    catch (e) { alert(e.message); }
  }

  const list = useMemo(() => {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (toks.length && all ? all : data).filter(r =>
      (!toks.length || toks.every(t => [r.id, r.trip, r.truck, r.loc, r.date].join(' ').toLowerCase().includes(t))) &&
      (!from || r.date >= from) && (!to || r.date <= to));
  }, [data, all, q, from, to]);

  const groups = useMemo(() => {
    const g = {};
    list.forEach(r => {
      const k = String(r.trip).toLowerCase() + '|' + String(r.truck).toLowerCase();
      const x = g[k] = g[k] || { trip: r.trip, truck: r.truck, n: 0, fuel: 0, odo: '', odoDate: '', odoId: '', d1: r.date, d2: r.date };
      x.n++; x.fuel += Number(r.fuel || 0);
      if (r.odo !== '' && r.odo != null && isFinite(Number(r.odo)) && (x.odo === '' || r.date > x.odoDate || (r.date === x.odoDate && String(r.id) > String(x.odoId)))) { x.odo = Number(r.odo); x.odoDate = r.date; x.odoId = r.id; }
      if (r.date < x.d1) x.d1 = r.date; if (r.date > x.d2) x.d2 = r.date;
    });
    return Object.values(g).sort((a, b) => b.d2.localeCompare(a.d2));
  }, [list]);
  const total = list.reduce((s, r) => s + Number(r.fuel || 0), 0);

  const resetForm = () => { setEditing(null); setV(f => ({ ...f, trip: '', fuel: '', odo: '' })); };
  function submit(e) {
    e.preventDefault();
    const rec = { date: v.date, trip: v.trip.trim(), truck: v.truck.trim(), fuel: parseFloat(v.fuel), loc: v.loc.trim(), odo: v.odo === '' ? '' : parseFloat(v.odo) };
    run(async () => {
      if (editing) await api('PUT', '/api/records/' + encodeURIComponent(editing), rec);
      else await api('POST', '/api/records', rec);
      if (editing || !keep) { resetForm(); tripRef.current && tripRef.current.focus(); }
      else { setV(f => ({ ...f, fuel: '', odo: '' })); fuelRef.current && fuelRef.current.focus(); }
    });
  }
  function edit(r) {
    setEditing(r.id);
    setV({ date: r.date, trip: r.trip, odo: r.odo ?? '', truck: r.truck, fuel: r.fuel, loc: r.loc });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function del(id) {
    if (!confirm('Delete record ' + id + '?')) return;
    if (editing === id) resetForm();
    run(() => api('DELETE', '/api/records/' + encodeURIComponent(id)));
  }

  function upload(e) {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    f.text().then(txt => {
      const rows = parseCSV(txt.replace(/^﻿/, ''));
      if (rows.length < 2) return alert('No data rows found.');
      const h = rows[0].map(x => x.trim().toLowerCase());
      const find = (...k) => h.findIndex(x => k.some(y => x.includes(y)));
      const ix = { date: find('date'), trip: find('trip'), truck: find('truck'), fuel: find('fuel'), loc: find('location', 'loc'), odo: find('odo') };
      if (Object.entries(ix).some(([k, v]) => k !== 'odo' && v < 0)) return alert('CSV needs columns: Date, Trip Number, Truck No, Given Fuel, Location (Odometer optional)');
      const recs = rows.slice(1).map(r => {
        let d = (r[ix.date] || '').trim(); const t = new Date(d);
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(t)) d = t.toISOString().slice(0, 10);
        return { date: d || today(), trip: (r[ix.trip] || '').trim(), truck: (r[ix.truck] || '').trim(), fuel: parseFloat(r[ix.fuel]) || 0, loc: (r[ix.loc] || '').trim(), odo: ix.odo >= 0 && (r[ix.odo] || '').trim() !== '' ? parseFloat(r[ix.odo]) : '' };
      });
      run(async () => { const j = await api('POST', '/api/import', recs); alert(j.added + ' records imported with new unique IDs.'); });
    });
  }
  async function exportCsv() {
    let d; try { d = await api('GET', '/api/records'); } catch (e) { return alert(e.message); }
    const qq = s => '"' + String(s).replace(/"/g, '""') + '"';
    download('fuel-records.csv', ['Unique ID,Date,Trip Number,Odometer,Truck No,Given Fuel,Location', ...d.map(r => [r.id, r.date, r.trip, r.odo ?? '', r.truck, r.fuel, r.loc].map(qq).join(','))].join('\n'), 'text/csv');
  }
  async function backup() {
    let d; try { d = await api('GET', '/api/records'); } catch (e) { return alert(e.message); }
    download('fleet-fuel-backup-' + today() + '.json', JSON.stringify({ app: 'fleet-fuel-manager', version: 1, exported: new Date().toISOString(), records: d }, null, 1), 'application/json');
  }
  const set = k => e => setV({ ...v, [k]: e.target.value });

  return (
    <div className="pg-fuel">
      <header className="head">
        <div>
          <h1>Fuel Management</h1>
          <div className="today">Today, {fmt(today())}</div>
          <p>Enter a date and trip number, and a unique ID is generated automatically. {status && <span className="stp">{(status.ok ? '🟢 ' : '🔴 ') + status.text}</span>}</p>
        </div>
      </header>
      <div className="body">
        <section className="kpis k3" aria-label="Fuel summary">
          <div className="k"><div className="kh">Entries<span className="chip y"><Icon name="file" /></span></div><b>{list.length}</b><span>Fuel records listed</span></div>
          <div className="k"><div className="kh">Trips<span className="chip"><Icon name="gauge" /></span></div><b>{groups.length}</b><span>Trip and truck groups</span></div>
          <div className="k"><div className="kh">Total fuel<span className="chip g"><Icon name="fuel" /></span></div><b>{num(total)}</b><span>Litres</span></div>
        </section>

        <section className="panel" style={{ marginBottom: 22 }}>
          <div className="sec2"><h2>Add fuel record</h2></div>
          <form className="fgrid" onSubmit={submit}>
            <label>Date<input type="date" required value={v.date} onChange={set('date')} /></label>
            <label>Trip Number<input ref={tripRef} required placeholder="e.g. T-1024" value={v.trip} onChange={set('trip')} /></label>
            <label>Odometer (km) – optional<input type="number" min="0" step="1" placeholder="optional" value={v.odo} onChange={set('odo')} /></label>
            <label>Truck No<input required placeholder="e.g. ABC 1234" value={v.truck} onChange={set('truck')} /></label>
            <label>Given Fuel (L)<input ref={fuelRef} type="number" min="0" step="0.01" required value={v.fuel} onChange={set('fuel')} /></label>
            <label>Location<input required placeholder="e.g. Lusaka" value={v.loc} onChange={set('loc')} /></label>
            <label className="chk"><input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} />Keep trip number after saving</label>
            <div className="fbtns"><button type="submit" className="btn pri">{editing ? 'Save changes (' + editing + ')' : 'Add record'}</button>{editing && <button type="button" className="btn" onClick={resetForm}>Cancel</button>}</div>
          </form>
          <div className="note">Or upload a CSV with columns: Date, Trip Number, Odometer (optional), Truck No, Given Fuel, Location.</div>
        </section>

        <section className="panel">
          <div className="tools2">
            <input className="grow" placeholder="Search trip no, truck no, location… (searches all records)" value={q} onChange={e => setQ(e.target.value)} />
            <input type="date" title="From date" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" title="To date" value={to} onChange={e => setTo(e.target.value)} />
            <select title="How much history to load" value={win} onChange={e => setWin(e.target.value)}>
              <option value="all">All records</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option>
            </select>
            <button className="btn" onClick={() => fileRef.current.click()}><Icon name="up" />Upload CSV</button>
            <button className="btn" onClick={exportCsv}><Icon name="down" />Export CSV</button>
            <button className="btn" title="Download a full backup of all records" onClick={backup}><Icon name="file" />Backup</button>
            <input type="file" ref={fileRef} accept=".csv,text/csv" hidden onChange={upload} />
          </div>

          <div className="sumtitle">Summary by trip &amp; truck (each fuel given is one entry)</div>
          <div className="scroll" style={{ maxHeight: 640 }}>
            <table style={{ minWidth: 640 }}>
              <thead><tr><th>Trip Number</th><th>Truck No</th><th className="num">Fuel entries</th><th className="num">Total fuel (L)</th><th className="num">Latest Odometer (km)</th><th>Date(s)</th></tr></thead>
              <tbody>
                {groups.length ? groups.map(x => <tr key={x.trip + '|' + x.truck}>
                  <td>{x.trip}</td><td>{x.truck}</td><td className="num">{x.n}</td><td className="num">{num(x.fuel)}</td>
                  <td className="num">{x.odo === '' ? '—' : x.odo.toLocaleString()}</td><td>{x.d1 === x.d2 ? x.d1 : x.d1 + ' → ' + x.d2}</td>
                </tr>) : <tr><td colSpan="6" style={{ color: 'var(--mute)', textAlign: 'center' }}>No data</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="sumtitle" style={{ marginTop: 6 }}>All fuel records</div>
          <div className="scroll">
            <table style={{ minWidth: 900 }}>
              <thead><tr><th>Unique ID</th><th>Date</th><th>Trip Number</th><th className="num">Odometer (km)</th><th>Truck No</th><th className="num">Given Fuel (L)</th><th>Location</th><th></th></tr></thead>
              <tbody>
                {list.slice().reverse().map(r => <tr key={r.id}>
                  <td className="id">{r.id}</td><td>{r.date}</td><td>{r.trip}</td>
                  <td className="num">{r.odo === '' || r.odo == null ? '—' : Number(r.odo).toLocaleString()}</td>
                  <td>{r.truck}</td><td className="num">{num(r.fuel)}</td><td>{r.loc}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="del" title="Edit" onClick={() => edit(r)}>✎</button><button className="del" title="Delete" onClick={() => del(r.id)}>✕</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {!list.length && <div className="empty">No records yet. Add one above or upload a CSV.</div>}
        </section>
      </div>
    </div>
  );
}
