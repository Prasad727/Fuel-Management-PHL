import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Msg from '../components/Msg.jsx';
import { api } from '../lib/api.js';
import { today, fmt, cmp, saveBook } from '../lib/util.js';
import '../styles/procurement.css';

// PHL PROCUREMENT
//   /procurement            Order Book      - items bought and added to the store (with invoice + product photos)
//   /procurement#stock      Store           - what is left of every item (#instock / #outstock filter it)
//   /procurement#workshop   Workshop Book   - items requested from the warehouse for a truck (takes them off the stock)
//   /procurement#trucks     Trucks Maintenance - one card per truck; click it to see everything that truck used
// API: GET /api/proc · POST|PUT|DELETE /api/proc/orders(/:id) · POST|PUT|DELETE /api/proc/issues(/:id) · POST /api/proc/sign
const VIEWS = ['orders', 'stock', 'instock', 'outstock', 'workshop', 'trucks'];
const viewOf = h => { const v = (h || '').slice(1); return VIEWS.includes(v) ? v : 'orders'; };
const n0 = v => (Math.round((+v || 0) * 1000) / 1000).toLocaleString('en-GB');
const money = (v, c) => v == null || v === '' ? '' : (c || 'ZMW') + ' ' + (+v).toLocaleString('en-GB', { maximumFractionDigits: 2 });

// Small, fast versions of Cloudinary pictures (the original stays on Cloudinary)
export function thumb(f, w = 120) {
  if (!f || !f.url) return '';
  if (!f.url.includes('res.cloudinary.com')) return f.url;
  const t = 'c_fill,w_' + w + ',h_' + w + ',q_auto' + (f.type === 'pdf' ? ',pg_1,f_jpg' : ',f_auto');
  const u = f.url.replace('/upload/', '/upload/' + t + '/');
  return f.type === 'pdf' ? u.replace(/\.pdf$/i, '.jpg') : u;
}
const big = f => !f ? '' : f.url.includes('res.cloudinary.com') && f.type !== 'pdf' ? f.url.replace('/upload/', '/upload/c_limit,w_1600,q_auto,f_auto/') : f.url;

// Make a photo smaller in the browser (phone photos are 3-8 MB)
function shrink(file, max, q, asBlob) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (asBlob) c.toBlob(b => b ? ok(b) : no(new Error('Could not read the picture')), 'image/jpeg', q); else ok(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error(file.name + ' is not a picture this browser can read')); };
    img.src = url;
  });
}
// Upload one picture or invoice. With Cloudinary -> { id: public_id, url }. Without -> a small picture kept in the record.
async function sendFile(file, cloud, kind) {
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!pdf && !/^image\//.test(file.type)) throw new Error(file.name + ': use a photo (JPG/PNG) or a PDF');
  if (!cloud) {
    if (pdf) throw new Error('PDF invoices need Cloudinary to be set up. For now, take a photo of the invoice instead.');
    return { id: '', url: await shrink(file, kind === 'invoice' ? 1300 : 700, kind === 'invoice' ? .7 : .72), type: 'image', name: file.name };
  }
  if (pdf && file.size > 10e6) throw new Error(file.name + ' is bigger than 10 MB');
  const s = await api('POST', '/api/proc/sign');
  const fd = new FormData();
  fd.append('file', pdf ? file : await shrink(file, 1800, .85, true), pdf ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg');
  fd.append('api_key', s.apiKey); fd.append('timestamp', s.timestamp); fd.append('folder', s.folder); fd.append('signature', s.signature);
  const r = await fetch('https://api.cloudinary.com/v1_1/' + s.cloud + '/auto/upload', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Cloudinary: ' + ((j.error && j.error.message) || 'upload failed (' + r.status + ')'));
  return { id: j.public_id, url: j.secure_url, type: j.format === 'pdf' ? 'pdf' : 'image', name: file.name };
}

const blankOrder = () => ({ item: '', unit: 'pcs', qty: '', date: today(), authorizedBy: '', shop: '', cost: '', currency: 'ZMW', notes: '', invoice: null, photos: [] });
const blankIssue = (o = {}) => ({ item: '', qty: '', date: today(), authorizedBy: '', mechanic: '', truck: '', notes: '', ...o });

export default function Procurement() {
  const loc = useLocation(), nav = useNavigate();
  const view = viewOf(loc.hash);
  const [D, setD] = useState(null), [err, setErr] = useState('');
  const [q, setQ] = useState(''), [month, setMonth] = useState('');
  const [msg, setMsg] = useState(null);
  const [order, setOrder] = useState(null);   // { editing, v }
  const [issue, setIssue] = useState(null);   // { editing, v }
  const [truck, setTruck] = useState(null);   // truck id shown in the pop-up
  const [pic, setPic] = useState(null);       // { list, i } picture viewer
  const [apis, setApis] = useState(false);
  const [busy, setBusy] = useState(''), [saving, setSaving] = useState(false), [ferr, setFerr] = useState('');
  const invRef = useRef(null), phRef = useRef(null);
  const say = (text, e) => setMsg({ text, err: e });
  const go = v => { setQ(''); setMonth(''); nav(v === 'orders' ? '/procurement' : '/procurement#' + v); };

  async function load() { const j = await api('GET', '/api/proc'); setD(j); return j; }
  useEffect(() => { load().catch(e => setErr(e.message)); }, []);
  useEffect(() => { setMsg(null); }, [view]);

  // ---- numbers for the link cards
  const stock = D ? D.stock : [], inS = stock.filter(s => s.left > 0), outS = stock.filter(s => s.left <= 0);
  const stockBy = useMemo(() => new Map(stock.map(s => [s.key, s])), [D]);
  const sKey = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const photoOf = item => { const s = stockBy.get(sKey(item)); return s && s.photo; };

  // Trucks: every truck in the system + any truck number used in the Workshop Book
  const truckCards = useMemo(() => {
    if (!D) return [];
    const m = new Map();
    D.trucks.forEach(t => m.set(cmp(t.id), { ...t, lines: [], items: 0 }));
    D.issues.forEach(i => { const k = cmp(i.truck); if (!m.has(k)) m.set(k, { id: i.truck, driver: '', trailer: '', lines: [], items: 0 }); const c = m.get(k); c.lines.push(i); c.items += +i.qty || 0; });
    return [...m.values()].map(c => ({ ...c, last: c.lines.reduce((a, i) => i.date > a ? i.date : a, '') }))
      .sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }, [D]);

  // ---- filtered lists
  const has = (o, ks) => !q.trim() || ks.some(k => String(o[k] || '').toLowerCase().includes(q.trim().toLowerCase())) || (ks.includes('truck') && cmp(o.truck).includes(cmp(q)));
  const inMonth = o => !month || (o.date || '').startsWith(month);
  const orders = D ? D.orders.filter(o => inMonth(o) && has(o, ['id', 'item', 'shop', 'authorizedBy', 'notes'])) : [];
  const issues = D ? D.issues.filter(o => inMonth(o) && has(o, ['id', 'item', 'truck', 'mechanic', 'authorizedBy', 'notes'])) : [];
  const stockList = (view === 'instock' ? inS : view === 'outstock' ? outS : stock).filter(s => has(s, ['item']));
  const trucksList = truckCards.filter(t => has(t, ['id', 'driver', 'trailer', 'truck']));
  const months = useMemo(() => D ? [...new Set(D.orders.concat(D.issues).map(o => (o.date || '').slice(0, 7)).filter(Boolean))].sort().reverse() : [], [D]);
  const shops = useMemo(() => D ? [...new Set(D.orders.map(o => o.shop).filter(Boolean))].sort() : [], [D]);
  const authNames = useMemo(() => D ? [...new Set(D.people.map(p => p.name).concat(D.orders.map(o => o.authorizedBy), D.issues.map(o => o.authorizedBy)).filter(Boolean))].sort() : [], [D]);
  const mechNames = useMemo(() => D ? [...new Set(D.mechanics.concat(D.issues.map(o => o.mechanic)).filter(Boolean))].sort() : [], [D]);
  const monthName = m => new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // ---- ORDER BOOK form
  const openOrder = o => { setFerr(''); setOrder({ editing: o || null, v: o ? { ...blankOrder(), ...o, cost: o.cost == null ? '' : String(o.cost), qty: String(o.qty), photos: (o.photos || []).slice() } : blankOrder() }); };
  const setOV = (k, val) => setOrder(f => ({ ...f, v: { ...f.v, [k]: val } }));
  async function addFiles(e, kind) {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    setFerr(''); setBusy(kind === 'invoice' ? 'Uploading invoice...' : 'Uploading ' + files.length + ' photo(s)...');
    try {
      if (kind === 'invoice') { const f = await sendFile(files[0], D.cloud, 'invoice'); setOV('invoice', f); }
      else {
        const room = 6 - order.v.photos.length; if (room <= 0) throw new Error('Up to 6 product photos');
        const out = []; for (const f of files.slice(0, room)) out.push(await sendFile(f, D.cloud, 'photo'));
        setOrder(fm => ({ ...fm, v: { ...fm.v, photos: fm.v.photos.concat(out) } }));
        if (files.length > room) setFerr('Only 6 product photos are kept per entry.');
      }
    } catch (x) { setFerr(x.message); }
    setBusy('');
  }
  async function saveOrder() {
    setSaving(true); setFerr('');
    try {
      const v = order.v, body = { ...v, item: v.item.trim() };
      const r = order.editing ? await api('PUT', '/api/proc/orders/' + order.editing.id, body) : await api('POST', '/api/proc/orders', body);
      await load(); setOrder(null); say((order.editing ? 'Saved ' : 'Added to the store: ') + r.id + ' · ' + r.qty + ' ' + r.unit + ' ' + r.item);
    } catch (x) { setFerr(x.message); }
    setSaving(false);
  }
  async function delOrder(o) {
    if (!confirm('Delete ' + o.id + ' (' + o.qty + ' ' + o.unit + ' ' + o.item + ') from the Order Book?' + (o.invoice || (o.photos || []).length ? ' Its invoice and photos are deleted too.' : ''))) return;
    try { await api('DELETE', '/api/proc/orders/' + o.id); await load(); setOrder(null); say('Deleted ' + o.id); } catch (x) { alert(x.message); }
  }

  // ---- WORKSHOP BOOK form
  const openIssue = (o, preset) => { setFerr(''); setIssue({ editing: o || null, v: o ? { ...blankIssue(), ...o, qty: String(o.qty) } : blankIssue(preset) }); };
  const setIV = (k, val) => setIssue(f => ({ ...f, v: { ...f.v, [k]: val } }));
  async function saveIssue() {
    setSaving(true); setFerr('');
    try {
      const r = issue.editing ? await api('PUT', '/api/proc/issues/' + issue.editing.id, issue.v) : await api('POST', '/api/proc/issues', issue.v);
      await load(); setIssue(null); say((issue.editing ? 'Saved ' : 'Workshop Book: ') + r.id + ' · ' + r.qty + ' ' + r.item + ' for ' + r.truck);
    } catch (x) { setFerr(x.message); }
    setSaving(false);
  }
  async function delIssue(o) {
    if (!confirm('Delete ' + o.id + ' (' + o.qty + ' ' + o.item + ' for ' + o.truck + ')? The quantity goes back into the store.')) return;
    try { await api('DELETE', '/api/proc/issues/' + o.id); await load(); setIssue(null); say('Deleted ' + o.id + ' - ' + o.qty + ' ' + o.item + ' back in the store'); } catch (x) { alert(x.message); }
  }

  // ---- Excel
  const xOrders = () => saveBook('order_book_' + today() + '.xlsx', [['Order Book', [['PO No.', 'Date Bought', 'Item', 'Quantity', 'Unit', 'Shop', 'Authorized By', 'Cost', 'Currency', 'Invoice', 'Product Photos', 'Notes']].concat(orders.map(o => [o.id, o.date, o.item, o.qty, o.unit, o.shop, o.authorizedBy, o.cost == null ? '' : o.cost, o.currency, o.invoice ? o.invoice.id || 'saved in record' : '', (o.photos || []).map(p => p.id || 'saved in record').join(', '), o.notes])), 16]]);
  const xIssues = (list, name) => saveBook(name + '_' + today() + '.xlsx', [['Workshop Book', [['WS No.', 'Date Used', 'Truck', 'Item', 'Quantity', 'Mechanic', 'Authorized By', 'Notes']].concat(list.map(o => [o.id, o.date, o.truck, o.item, o.qty, o.mechanic, o.authorizedBy, o.notes])), 16]]);
  const xStock = () => saveBook('store_' + view + '_' + today() + '.xlsx', [['Store', [['Item', 'Unit', 'Bought', 'Used', 'Left', 'Last Bought', 'Last Used']].concat(stockList.map(s => [s.item, s.unit, s.bought, s.used, s.left, s.last, s.lastUsed])), 16]]);

  // ---- pieces (plain functions so inputs keep focus while typing)
  const Th = (f, w, list) => f ? <img className="th" src={thumb(f, w)} alt="" loading="lazy" style={{ width: w / 2, height: w / 2 }} onClick={e => { e.stopPropagation(); setPic({ list: list || [f], i: list ? list.indexOf(f) : 0 }); }} /> : null;
  const noPic = s => <span className="th none" style={{ width: s, height: s }}><Icon name="image" /></span>;
  const acts = (onE, onD) => <td className="acts-c"><button className="ib" title="Edit" onClick={e => { e.stopPropagation(); onE(); }}><Icon name="edit" /></button><button className="ib del" title="Delete" onClick={e => { e.stopPropagation(); onD(); }}><Icon name="trash" /></button></td>;
  const leftBadge = s => !s ? <span className="b r">Not in store</span> : s.left <= 0 ? <span className="b r">Out of stock</span> : <span className="b g">{n0(s.left)} {s.unit} left</span>;
  const truckChip = id => <span className="trk">{id}</span>;
  const oi = (k, l, o = {}) => <label key={k} className={o.wide ? 'wide' : undefined}>{l}<input type={o.type || 'text'} list={o.list} placeholder={o.ph} value={order.v[k]} step={o.step} min={o.min} onChange={e => setOV(k, e.target.value)} autoComplete="off" /></label>;
  const ii = (k, l, o = {}) => <label key={k} className={o.wide ? 'wide' : undefined}>{l}<input type={o.type || 'text'} list={o.list} placeholder={o.ph} value={issue.v[k]} step={o.step} min={o.min} onChange={e => setIV(k, e.target.value)} autoComplete="off" /></label>;

  const CARDS = [
    ['orders', 'Order Book', D ? D.orders.length : '', 'book', 'items bought'],
    ['stock', 'Store', stock.length, 'box', 'different items'],
    ['instock', 'In stock', inS.length, 'check', 'items available'],
    ['outstock', 'Out of stock', outS.length, 'reset', 'items finished'],
    ['workshop', 'Requested from warehouse', D ? D.issues.length : '', 'wrench', 'Workshop Book lines'],
    ['trucks', 'Trucks Maintenance', truckCards.filter(t => t.lines.length).length, 'truck', 'trucks with work']
  ];
  const tLines = truck ? (truckCards.find(t => cmp(t.id) === cmp(truck)) || { lines: [] }).lines.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id)) : [];
  const tInfo = truck ? truckCards.find(t => cmp(t.id) === cmp(truck)) || { id: truck } : null;
  const sel = issue && stockBy.get(sKey(issue.v.item));
  const selLeft = sel ? sel.left + (issue.editing && sKey(issue.editing.item) === sel.key ? +issue.editing.qty : 0) : 0;

  const filters = (ph, withMonth = true) => <div className="tools">
    <label>Search<input type="search" placeholder={ph} value={q} onChange={e => setQ(e.target.value)} /></label>
    {withMonth && <label>Month<select value={month} onChange={e => setMonth(e.target.value)}><option value="">All months</option>{months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>}
    <button className="rst" onClick={() => { setQ(''); setMonth(''); }}><Icon name="reset" />Clear filters</button>
  </div>;

  return (
    <div className="pg-proc">
      <header className="head">
        <div><h1>PHL Procurement</h1><p>Add what is bought to the store with its invoice and photos, give items to the workshop for a truck, and see every truck's maintenance history. Stock goes down automatically when the workshop uses an item.</p></div>
        <div className="bar">
          <button className="btn" onClick={() => setApis(true)}>APIs</button>
          <button className="btn" onClick={() => D && openIssue(null)}><Icon name="wrench" />Workshop: use item</button>
          <button className="btn pri" onClick={() => D && openOrder(null)}><Icon name="plus" />Add items to store</button>
        </div>
      </header>
      <div className="body">
        <section className="links">
          {CARDS.map(([k, l, n, ic, sub]) => <button key={k} className={'lk ' + (view === k ? 'on' : '') + (k === 'outstock' && n ? ' warn' : '')} onClick={() => go(k)}>
            <span className="lt"><Icon name={ic} />{l}</span><b>{D ? n : '–'}</b><small>{sub}</small></button>)}
        </section>
        {D && !D.cloud && <div className="note"><b>Cloudinary is not set up yet.</b> Photos are saved small inside each record and PDF invoices cannot be added. Add the 3 Cloudinary settings on Render (see README) to keep full-size photos and PDFs on Cloudinary.</div>}

        <section className="panel">
          {err ? <div className="empty">Could not load procurement: {err}<br />Is procurement.js added to server.js and the server restarted?</div>
            : !D ? <div className="empty">Loading...</div>
              : view === 'orders' ? <>
                <div className="ph"><h2>Order Book <small>items added to the store</small></h2><div className="bar"><button className="btn" onClick={xOrders}><Icon name="down" />Export Excel</button><button className="btn pri" onClick={() => openOrder(null)}><Icon name="plus" />Add items to store</button></div></div>
                <Msg msg={msg} />
                {filters('Item, shop, authorized by, PO number')}
                <div className="cap">{orders.length} of {D.orders.length} entries</div>
                <div className="scroll"><table className="tbl">
                  <colgroup><col style={{ width: 82 }} /><col style={{ width: 96 }} /><col /><col style={{ width: 90 }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 84 }} /></colgroup>
                  <thead><tr><th>PO No.</th><th>Date bought</th><th>Item</th><th>Qty</th><th>Shop</th><th>Authorized by</th><th>Cost</th><th>Invoice / photos</th><th></th></tr></thead>
                  <tbody>{orders.length ? orders.map(o => { const all = [o.invoice].concat(o.photos || []).filter(Boolean); return <tr key={o.id} onClick={() => openOrder(o)}>
                    <td className="mono">{o.id}</td><td>{fmt(o.date)}</td>
                    <td><div className="it">{o.photos && o.photos[0] ? Th(o.photos[0], 72, all) : noPic(36)}<div><b>{o.item}</b>{o.notes && <small>{o.notes}</small>}</div></div></td>
                    <td><b>{n0(o.qty)}</b> {o.unit}</td><td>{o.shop}</td><td>{o.authorizedBy}</td><td>{money(o.cost, o.currency) || <span className="dash">&mdash;</span>}</td>
                    <td><div className="pics">{o.invoice ? <button className="inv" onClick={e => { e.stopPropagation(); setPic({ list: all, i: 0 }); }}><Icon name="file" />{o.invoice.type === 'pdf' ? 'PDF' : 'Invoice'}</button> : <span className="b o">No invoice</span>}{(o.photos || []).length > 1 && <span className="b">+{o.photos.length} photos</span>}</div></td>
                    {acts(() => openOrder(o), () => delOrder(o))}</tr>; })
                    : <tr><td colSpan="9" className="empty">{D.orders.length ? 'Nothing matches these filters.' : <>The store is empty. Click <b>Add items to store</b> to add what was bought.</>}</td></tr>}</tbody>
                </table></div>
              </>
                : view === 'workshop' ? <>
                  <div className="ph"><h2>Workshop Book <small>items requested from the warehouse</small></h2><div className="bar"><button className="btn" onClick={() => xIssues(issues, 'workshop_book')}><Icon name="down" />Export Excel</button><button className="btn pri" onClick={() => openIssue(null)}><Icon name="plus" />Use item</button></div></div>
                  <Msg msg={msg} />
                  {filters('Truck, item, mechanic, WS number')}
                  <div className="cap">{issues.length} of {D.issues.length} lines</div>
                  <div className="scroll"><table className="tbl">
                    <colgroup><col style={{ width: 82 }} /><col style={{ width: 96 }} /><col style={{ width: 120 }} /><col /><col style={{ width: 80 }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: 84 }} /></colgroup>
                    <thead><tr><th>WS No.</th><th>Used date</th><th>Truck</th><th>Item</th><th>Qty</th><th>Mechanic</th><th>Authorized by</th><th>Notes</th><th></th></tr></thead>
                    <tbody>{issues.length ? issues.map(o => <tr key={o.id} onClick={() => openIssue(o)}>
                      <td className="mono">{o.id}</td><td>{fmt(o.date)}</td>
                      <td><button className="trkb" title="Open this truck's maintenance" onClick={e => { e.stopPropagation(); setTruck(o.truck); }}>{truckChip(o.truck)}</button></td>
                      <td><div className="it">{photoOf(o.item) ? Th(photoOf(o.item), 72) : noPic(36)}<b>{o.item}</b></div></td>
                      <td><b>{n0(o.qty)}</b></td><td>{o.mechanic}</td><td>{o.authorizedBy}</td><td className="rem"><span className="clamp">{o.notes}</span></td>
                      {acts(() => openIssue(o), () => delIssue(o))}</tr>)
                      : <tr><td colSpan="9" className="empty">{D.issues.length ? 'Nothing matches these filters.' : <>No items used yet. Click <b>Use item</b> when the workshop takes something from the store.</>}</td></tr>}</tbody>
                  </table></div>
                </>
                  : view === 'trucks' ? <>
                    <div className="ph"><h2>Trucks Maintenance <small>click a truck to see everything it used</small></h2><div className="bar"><button className="btn" onClick={() => xIssues(D.issues, 'trucks_maintenance')}><Icon name="down" />Export all</button></div></div>
                    <Msg msg={msg} />
                    {filters('Truck number, driver, trailer', false)}
                    <div className="cap">{trucksList.length} trucks · {truckCards.filter(t => t.lines.length).length} with workshop records</div>
                    <div className="tcards">{trucksList.length ? trucksList.map(t => <button key={t.id} className={'tc ' + (t.lines.length ? '' : 'idle')} onClick={() => setTruck(t.id)}>
                      <div className="tch">{truckChip(t.id)}{t.lines.length ? <span className="b g">{t.lines.length} record{t.lines.length > 1 ? 's' : ''}</span> : <span className="b">No records</span>}</div>
                      <div className="tcm"><div>Driver: {t.driver || <span className="dash">&mdash;</span>}</div><div>Trailer: {t.trailer || <span className="dash">&mdash;</span>}</div></div>
                      <div className="tcf"><span><b>{n0(t.items)}</b> items used</span><span>{t.last ? 'Last: ' + fmt(t.last) : ''}</span></div>
                    </button>) : <div className="empty">{truckCards.length ? 'No truck matches.' : 'No trucks yet. Trucks are added on the Staff page (give a driver a truck).'}</div>}</div>
                  </>
                    : <>
                      <div className="ph"><h2>{view === 'instock' ? 'In stock' : view === 'outstock' ? 'Out of stock' : 'Store'} <small>bought − used, per item</small></h2>
                        <div className="bar"><div className="seg">{[['stock', 'All'], ['instock', 'In stock'], ['outstock', 'Out of stock']].map(([k, l]) => <button key={k} aria-pressed={view === k} className={view === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</div><button className="btn" onClick={xStock}><Icon name="down" />Export Excel</button></div></div>
                      <Msg msg={msg} />
                      {filters('Item name', false)}
                      <div className="cap">{stockList.length} items</div>
                      <div className="scroll"><table className="tbl">
                        <colgroup><col /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /></colgroup>
                        <thead><tr><th>Item</th><th>Bought</th><th>Used</th><th>Left</th><th>Last bought</th><th>Last used</th><th></th></tr></thead>
                        <tbody>{stockList.length ? stockList.map(s => <tr key={s.key} onClick={() => go2('orders', s.item)}>
                          <td><div className="it">{s.photo ? Th(s.photo, 72) : noPic(36)}<div><b>{s.item}</b><small>{s.unit}</small></div></div></td>
                          <td>{n0(s.bought)}</td><td>{n0(s.used)}</td><td>{leftBadge(s)}</td><td>{fmt(s.last)}</td><td>{fmt(s.lastUsed) || <span className="dash">&mdash;</span>}</td>
                          <td className="acts-c">{s.left > 0 ? <button className="btn sm" onClick={e => { e.stopPropagation(); openIssue(null, { item: s.item }); }}><Icon name="wrench" />Use</button>
                            : <button className="btn sm" onClick={e => { e.stopPropagation(); openOrder(null); setOV('item', s.item); setOV('unit', s.unit); }}><Icon name="plus" />Buy more</button>}</td></tr>)
                          : <tr><td colSpan="7" className="empty">{stock.length ? 'No items here.' : 'The store is empty. Add items in the Order Book.'}</td></tr>}</tbody>
                      </table></div>
                    </>}
        </section>
      </div>

      {/* ORDER BOOK pop-up */}
      <Modal open={!!order} onClose={() => !busy && setOrder(null)}>
        {order && <form onSubmit={e => { e.preventDefault(); if (!busy) saveOrder(); }}>
          <div className="dt"><div><h2>{order.editing ? order.editing.id + ' · ' + order.editing.item : 'Add items to store'}</h2><div className="hint">{order.editing ? 'Added ' + fmt((order.editing.created || '').slice(0, 10)) + (order.editing.updated ? ' · last changed ' + fmt(order.editing.updated.slice(0, 10)) : '') : 'Order Book · the quantity goes into the store'}</div></div></div>
          <div className="sec"><h3>Item</h3><div className="grid">
            {oi('item', 'Item name', { wide: true, list: 'pItems', ph: 'e.g. Oil filter 1R-0750' })}
            {oi('qty', 'Quantity', { type: 'number', step: 'any', min: '0' })}
            <label>Unit<select value={order.v.unit} onChange={e => setOV('unit', e.target.value)}>{D.units.map(u => <option key={u}>{u}</option>)}</select></label>
            {oi('date', 'Date bought', { type: 'date' })}
            {oi('authorizedBy', 'Authorized by', { list: 'pAuth', ph: 'Name' })}
            {oi('shop', 'Shop bought from', { list: 'pShops', ph: 'e.g. Ndola Truck Parts' })}
            <div className="cost">{oi('cost', 'Total cost (optional)', { type: 'number', step: 'any', min: '0' })}<label>Currency<select value={order.v.currency} onChange={e => setOV('currency', e.target.value)}>{D.currencies.map(c => <option key={c}>{c}</option>)}</select></label></div>
            <label className="wide">Notes<textarea value={order.v.notes} onChange={e => setOV('notes', e.target.value)} placeholder="Part number, warranty, which job it is for..." /></label>
            {sKey(order.v.item) && stockBy.get(sKey(order.v.item)) && <div className="wide hint">In the store now: <b>{n0(stockBy.get(sKey(order.v.item)).left)} {stockBy.get(sKey(order.v.item)).unit}</b>. This adds to it.</div>}
          </div></div>
          <div className="sec"><h3>Invoice</h3>
            <div className="files">
              {order.v.invoice ? <div className="fl"><img src={thumb(order.v.invoice, 200)} alt="" onClick={() => setPic({ list: [order.v.invoice], i: 0 })} /><button type="button" className="x" title="Remove" onClick={() => setOV('invoice', null)}><Icon name="x" /></button></div>
                : <button type="button" className="add" onClick={() => invRef.current.click()} disabled={!!busy}><Icon name="file" /><span>Add invoice</span><small>{D.cloud ? 'Photo or PDF' : 'Photo'}</small></button>}
            </div>
            <input type="file" ref={invRef} hidden accept={D.cloud ? 'image/*,application/pdf' : 'image/*'} onChange={e => addFiles(e, 'invoice')} />
          </div>
          <div className="sec"><h3>Product photos <small>({order.v.photos.length}/6)</small></h3>
            <div className="files">
              {order.v.photos.map((f, i) => <div key={(f.id || '') + i} className="fl"><img src={thumb(f, 200)} alt="" onClick={() => setPic({ list: order.v.photos, i })} /><button type="button" className="x" title="Remove" onClick={() => setOV('photos', order.v.photos.filter((_, j) => j !== i))}><Icon name="x" /></button></div>)}
              {order.v.photos.length < 6 && <button type="button" className="add" onClick={() => phRef.current.click()} disabled={!!busy}><Icon name="image" /><span>Add photos</span><small>You can pick several</small></button>}
            </div>
            <input type="file" ref={phRef} hidden multiple accept="image/*" onChange={e => addFiles(e, 'photo')} />
          </div>
          {busy && <div className="msg">{busy}</div>}
          {ferr && <div className="msg err">{ferr}</div>}
          <div className="acts"><button type="button" className="btn" style={{ color: 'var(--rfg)', visibility: order.editing ? 'visible' : 'hidden' }} onClick={() => delOrder(order.editing)}>Delete</button>
            <span className="bar"><button type="button" className="btn" onClick={() => setOrder(null)} disabled={!!busy}>Cancel</button><button className="btn pri" disabled={saving || !!busy}>{saving ? 'Saving...' : 'Save'}</button></span></div>
          <datalist id="pItems">{stock.map(s => <option key={s.key} value={s.item}>{n0(s.left) + ' ' + s.unit + ' left'}</option>)}</datalist>
          <datalist id="pShops">{shops.map(s => <option key={s} value={s} />)}</datalist>
          <datalist id="pAuth">{authNames.map(s => <option key={s} value={s} />)}</datalist>
        </form>}
      </Modal>

      {/* WORKSHOP BOOK pop-up */}
      <Modal open={!!issue} onClose={() => setIssue(null)}>
        {issue && <form onSubmit={e => { e.preventDefault(); saveIssue(); }}>
          <div className="dt"><div><h2>{issue.editing ? issue.editing.id + ' · ' + issue.editing.truck : 'Workshop: use item'}</h2><div className="hint">Workshop Book · requested from the warehouse · taken off the store</div></div></div>
          <div className="sec"><div className="grid">
            <label className="wide">Item<select value={sel ? sel.item : issue.v.item} onChange={e => setIV('item', e.target.value)}>
              <option value="">Pick an item from the store</option>
              {stock.filter(s => s.left > 0 || (sel && s.key === sel.key)).map(s => <option key={s.key} value={s.item}>{s.item} · {n0(s.left)} {s.unit} left</option>)}
            </select></label>
            {sel && <div className="wide pick">{sel.photo ? Th(sel.photo, 96) : noPic(48)}<div><b>{sel.item}</b><div>{leftBadge({ ...sel, left: selLeft })}</div></div></div>}
            {ii('qty', 'Quantity' + (sel ? ' (' + sel.unit + ')' : ''), { type: 'number', step: 'any', min: '0' })}
            {ii('date', 'Used date', { type: 'date' })}
            {ii('truck', 'Truck number', { list: 'pTrucks', ph: 'e.g. BCH 6077 ZM' })}
            {ii('mechanic', 'Mechanic who requested', { list: 'pMech', ph: 'Name' })}
            {ii('authorizedBy', 'Authorized by', { list: 'pAuth2', ph: 'Name', wide: true })}
            <label className="wide">Notes<textarea value={issue.v.notes} onChange={e => setIV('notes', e.target.value)} placeholder="What was done, km reading, old part returned..." /></label>
            {sel && +issue.v.qty > selLeft && <div className="wide msg err" style={{ margin: 0 }}>Only {n0(selLeft)} {sel.unit} left in the store.</div>}
          </div></div>
          {ferr && <div className="msg err">{ferr}</div>}
          <div className="acts"><button type="button" className="btn" style={{ color: 'var(--rfg)', visibility: issue.editing ? 'visible' : 'hidden' }} onClick={() => delIssue(issue.editing)}>Delete</button>
            <span className="bar"><button type="button" className="btn" onClick={() => setIssue(null)}>Cancel</button><button className="btn pri" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></span></div>
          <datalist id="pTrucks">{D.trucks.map(t => <option key={t.id} value={t.id}>{t.driver ? 'Driver: ' + t.driver : ''}</option>)}</datalist>
          <datalist id="pMech">{mechNames.map(s => <option key={s} value={s} />)}</datalist>
          <datalist id="pAuth2">{authNames.map(s => <option key={s} value={s} />)}</datalist>
        </form>}
      </Modal>

      {/* TRUCK MAINTENANCE pop-up */}
      <Modal open={!!truck} onClose={() => setTruck(null)} className="wide-dlg">
        {truck && <>
          <div className="dt"><div><h2>{truckChip(tInfo.id)} <span style={{ marginLeft: 6 }}>Maintenance</span></h2>
            <div className="hint">{[tInfo.driver && 'Driver: ' + tInfo.driver, tInfo.trailer && 'Trailer: ' + tInfo.trailer, tLines.length + ' record(s)', tLines.length && 'items used: ' + n0(tLines.reduce((a, i) => a + (+i.qty || 0), 0))].filter(Boolean).join(' · ')}</div></div>
            <span className="bar"><button className="btn" onClick={() => xIssues(tLines, 'maintenance_' + cmp(tInfo.id))} disabled={!tLines.length}><Icon name="down" />Excel</button><button className="btn pri" onClick={() => { const id = tInfo.id; setTruck(null); openIssue(null, { truck: id }); }}><Icon name="plus" />Use item for this truck</button></span></div>
          <div className="scroll" style={{ maxHeight: '60vh', border: '1px solid var(--line)', borderRadius: 12 }}><table className="tbl">
            <colgroup><col style={{ width: 100 }} /><col style={{ width: 82 }} /><col /><col style={{ width: 70 }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '22%' }} /></colgroup>
            <thead><tr><th>Date</th><th>WS No.</th><th>Item changed</th><th>Qty</th><th>Mechanic</th><th>Authorized by</th><th>Notes</th></tr></thead>
            <tbody>{tLines.length ? tLines.map(o => <tr key={o.id}><td>{fmt(o.date)}</td><td className="mono">{o.id}</td>
              <td><div className="it">{photoOf(o.item) ? Th(photoOf(o.item), 72) : noPic(36)}<b>{o.item}</b></div></td><td><b>{n0(o.qty)}</b></td><td>{o.mechanic}</td><td>{o.authorizedBy}</td><td style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</td></tr>)
              : <tr><td colSpan="7" className="empty">Nothing used on this truck yet.</td></tr>}</tbody>
          </table></div>
          <div className="acts"><span /><button className="btn" onClick={() => setTruck(null)}>Close</button></div>
        </>}
      </Modal>

      {/* Picture / invoice viewer */}
      <Modal open={!!pic} onClose={() => setPic(null)} className="viewer">
        {pic && (() => { const f = pic.list[pic.i]; return <>
          <div className="dt"><div><h2>{f.type === 'pdf' ? 'Invoice (PDF)' : f.name || 'Picture'}</h2><div className="hint">{pic.list.length > 1 ? (pic.i + 1) + ' of ' + pic.list.length : ''}{f.id ? ' · Cloudinary ID: ' + f.id : ''}</div></div>
            <span className="bar"><a className="btn" href={f.url} target="_blank" rel="noreferrer" download={f.url.startsWith('data:') ? (f.name || 'picture') + '.jpg' : undefined}>Open full size</a><button className="btn" onClick={() => setPic(null)}>Close</button></span></div>
          <div className="vw">
            {pic.list.length > 1 && <button className="nv" onClick={() => setPic({ ...pic, i: (pic.i - 1 + pic.list.length) % pic.list.length })}><Icon name="left" /></button>}
            {f.type === 'pdf' ? <iframe title="Invoice" src={f.url} /> : <img src={big(f)} alt="" />}
            {pic.list.length > 1 && <button className="nv" onClick={() => setPic({ ...pic, i: (pic.i + 1) % pic.list.length })}><Icon name="right" /></button>}
          </div>
        </>; })()}
      </Modal>

      {/* APIs */}
      <Modal open={apis} onClose={() => setApis(false)}>
        <h2 style={{ marginBottom: 6 }}>Procurement APIs</h2>
        <p className="hint" style={{ margin: '0 0 12px' }}>Links other pages can read. They need the same login and return JSON.</p>
        <div className="api">{[
          ['GET /api/proc', 'everything: order book, workshop book, store, trucks'],
          ['GET /api/proc/stock', 'STORE - every item with bought / used / left'],
          ['GET /api/proc/stock?status=in', 'IN STOCK'],
          ['GET /api/proc/stock?status=out', 'OUT OF STOCK'],
          ['GET /api/proc/orders', 'ORDER BOOK - items added to the store'],
          ['GET /api/proc/issues', 'WORKSHOP BOOK - items requested from the warehouse'],
          ['GET /api/proc/truck/BCH 6077 ZM', 'TRUCKS MAINTENANCE - everything one truck used']
        ].map(([a, b]) => <div key={a}><a href={a.slice(4)} target="_blank" rel="noreferrer">{a}</a> <span>· {b}</span></div>)}</div>
        <div className="acts"><span /><button type="button" className="btn" onClick={() => setApis(false)}>Close</button></div>
      </Modal>
    </div>
  );

  // Click a store item -> Order Book filtered to that item
  function go2(v, text) { nav(v === 'orders' ? '/procurement' : '/procurement#' + v); setTimeout(() => setQ(text), 0); }
}
