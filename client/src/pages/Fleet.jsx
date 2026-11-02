import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Msg from '../components/Msg.jsx';
import { api } from '../lib/api.js';
import { iso, todayDate, fmt, toIso, readWorkbook, saveBook } from '../lib/util.js';
import '../styles/fleet.css';

// FLEET MANAGEMENT: two tables of trucks (Towards Zambia / Towards DRC). API: GET /api/trips, PUT /api/trips/:table
const NAMES = { zam: 'Towards Zambia', drc: 'Towards DRC' };
const EMPTY = { h: '', ld: '', ll: '', od: '', ol: '', cl: '', cc: '', r: '' };
const now = todayDate();
const pd = s => s ? new Date(s + 'T00:00:00') : null;
const fmtD = s => s ? fmt(s) : '';
// A truck is LOADED when it has a loading date and no offloading date. Otherwise it is EMPTY.
const loaded = t => !!t.ld && !t.od;
const days = t => t.ld ? Math.round(((t.od ? pd(t.od) : now) - pd(t.ld)) / 864e5) : null;
// Colour only for loaded trucks: 7 green, 9 orange, 12+ red
const cls = t => { if (!loaded(t)) return 'w'; const n = days(t); return n >= 12 ? 'r' : n >= 9 ? 'o' : n >= 7 ? 'g' : 'w'; };
const ccName = c => c === 'ZAM' ? 'Zambia' : c === 'DRC' ? 'DRC' : '';
const Dash = ({ v }) => v ? v : <span className="dash">&mdash;</span>;

// The trips API may answer in a few shapes; turn it into { zam:{rows,updated}, drc:{rows,updated} }
function normalize(payload) {
    const src = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    if (!src || typeof src !== 'object') throw new Error('The trips API returned an unexpected response.');
    const table = (v, label) => {
        if (Array.isArray(v)) return { rows: v, updated: '' };
        if (v && Array.isArray(v.rows)) return { rows: v.rows, updated: v.updated || '' };
        throw new Error('The trips API response is missing the ' + label + ' rows.');
    };
    return { zam: table(src.zam || src.towardsZambia || src.towards_zambia, 'Towards Zambia'), drc: table(src.drc || src.towardsDRC || src.towardsDrc || src.towards_drc, 'Towards DRC') };
}

const HEAD = ['ID', 'Horse', 'Loading Date', 'Loading Location', 'Date Offloaded', 'Offloading Location', 'Current Location', 'Current Country', 'Remarks'];

export default function Fleet() {
    const [data, setData] = useState({ zam: { rows: [], updated: '' }, drc: { rows: [], updated: '' } });
    const [tab, setTab] = useState('zam');
    const [f, setF] = useState({ truck: '', loc: '', date: '', sort: '', stat: '' });
    const [msg, setMsg] = useState(null);
    const [form, setForm] = useState(null); // { id|null, values }
    const fileRef = useRef(null);
    const R = data[tab].rows;
    const say = (text, err) => setMsg({ text, err });

    useEffect(() => { api('GET', '/api/trips').then(p => setData(normalize(p))).catch(x => say('Could not load trucks: ' + x.message, true)); }, []);

    async function saveTable(name, arr) {
        const res = await api('PUT', '/api/trips/' + name, { rows: arr });
        const rows = res && Array.isArray(res.rows) ? res.rows : arr;
        setData(d => ({ ...d, [name]: { rows, updated: (res && res.updated) || new Date().toISOString() } }));
        return { ...(res || {}), rows, created: res && res.created != null ? res.created : 0 };
    }

    // Summary cards: each horse counted once (a loaded row wins over an empty one)
    const k = useMemo(() => {
        const best = {};
        data.zam.rows.concat(data.drc.rows).forEach(t => { const b = best[t.h]; if (!b || (loaded(t) && !loaded(b))) best[t.h] = t; });
        const hs = Object.values(best), l = hs.filter(loaded).length;
        return { total: hs.length, l, empty: hs.length - l, z: hs.filter(t => t.cc === 'ZAM').length, d: hs.filter(t => t.cc === 'DRC').length, pc: hs.length ? Math.round(l * 100 / hs.length) : 0 };
    }, [data]);

    const rows = useMemo(() => {
        const q = f.truck.trim().toLowerCase(), lo = f.loc.trim().toLowerCase();
        const r = R.filter(t => {
            if (q && !String(t.h).toLowerCase().includes(q)) return false;
            if (lo && ![t.ll, t.ol, t.cl].join(' ').toLowerCase().includes(lo)) return false;
            if (f.date && t.ld !== f.date && t.od !== f.date) return false;
            if (f.stat === 'open' && !loaded(t)) return false;
            if (f.stat === 'done' && loaded(t)) return false;
            return true;
        });
        const dv = t => { const n = days(t); return n == null ? -1 : n; };
        if (f.sort) r.sort((a, b) => f.sort === 'asc' ? dv(a) - dv(b) : dv(b) - dv(a));
        return r;
    }, [R, f]);

    const setTabTo = t => { setTab(t); setMsg(null); };
    const reset = () => setF({ truck: '', loc: '', date: '', sort: '', stat: '' });

    // Add / edit / delete a truck in the open table
    const openForm = t => setForm({ id: t ? t.id : null, v: { ...EMPTY, ...(t || {}) } });
    async function submit(e) {
        e.preventDefault();
        const o = { id: form.id || '' }; Object.keys(EMPTY).forEach(x => o[x] = String(form.v[x] || '').trim());
        const arr = form.id ? R.map(t => t.id === form.id ? o : t) : R.concat([o]);
        try { await saveTable(tab, arr); say(form.id ? 'Truck updated.' : 'Truck added.'); setForm(null); } catch (x) { say(x.message, true); }
    }
    async function del(t) {
        if (!confirm('Remove this row from ' + NAMES[tab] + '?')) return;
        try { await saveTable(tab, R.filter(x => x.id !== t.id)); say('Row removed.'); } catch (x) { say(x.message, true); }
    }

    // Excel: each button works on the table that is open
    const tpl = () => {
        const n = NAMES[tab];
        saveBook('template_' + n.toLowerCase().replace(/ /g, '_') + '.xlsx', [
            ['Trucks', [HEAD, ['', 'BCB 4521', '2026-10-05', 'Lusaka', '', 'Lubumbashi', 'Kapiri Mposhi', 'Zambia', 'On the road (loaded: has a loading date, no offloaded date)'], ['', 'BCA 5547', '2026-09-20', 'Kolwezi', '2026-10-02', 'Lusaka', 'Lusaka', 'Zambia', 'Offloaded (empty: has an offloaded date)']], 22],
            ['Instructions', [['How this template works (' + n + ')'], ['Every upload REPLACES the whole ' + n + ' table. The file is the full list of trucks for this table.'], ['To add a truck, add a row. To remove a truck, delete its row. To change a truck, edit its row.'], ['ID: leave empty for new rows. A unique ID is created for you. Use Export data to download your rows with their IDs.'], ['Horse is required. Dates: yyyy-mm-dd or normal Excel dates.'], ['Loaded truck = Loading Date filled and Date Offloaded empty. Empty truck = Date Offloaded filled, or no Loading Date.'], ['Current Country: Zambia or DRC. It feeds the Trucks in Zambia and Trucks in DRC cards.'], ['Days turn green at 7, orange at 9 and red at 12 days for loaded trucks.'], ['Delete the two example rows before you upload.']]]
        ]);
    };
    const exp = () => saveBook('fleet_' + NAMES[tab].toLowerCase().replace(/ /g, '_') + '_' + iso(now) + '.xlsx',
        [['Trucks', [HEAD].concat(R.map(t => [t.id, t.h, t.ld, t.ll, t.od, t.ol, t.cl, ccName(t.cc), t.r])), 22]]);

    async function upload(e) {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        const name = tab;
        try {
            const { X, wb } = await readWorkbook(file);
            const list = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
            const inc = [], bad = [];
            const k2 = (r, n) => { for (const c of Object.keys(r)) if (n.includes(c.toLowerCase().replace(/[^a-z]/g, ''))) return r[c]; return ''; };
            list.forEach((r, i) => {
                const line = i + 2, h = String(k2(r, ['horse', 'truck', 'horseno'])).trim(), ld = toIso(k2(r, ['loadingdate', 'dateloaded'])), od = toIso(k2(r, ['dateoffloaded', 'offloadeddate', 'offloadingdate']));
                const c = String(k2(r, ['currentcountry', 'country'])), cc = /drc|congo/i.test(c) ? 'DRC' : /zam/i.test(c) ? 'ZAM' : '';
                if (!h && !ld && !od) return;
                if (!h) return bad.push('row ' + line + ': Horse is missing');
                if (ld === null) return bad.push('row ' + line + ': Loading Date is not a valid date');
                if (od === null) return bad.push('row ' + line + ': Date Offloaded is not a valid date');
                if (od && !ld) return bad.push('row ' + line + ': Date Offloaded needs a Loading Date');
                if (od && od < ld) return bad.push('row ' + line + ': Date Offloaded is before Loading Date');
                inc.push({ id: String(k2(r, ['id', 'tripid', 'uniqueid'])).trim(), h, ld, od, cc, ll: String(k2(r, ['loadinglocation'])).trim(), ol: String(k2(r, ['offloadinglocation'])).trim(), cl: String(k2(r, ['currentlocation'])).trim(), r: String(k2(r, ['remarks', 'remark'])).trim() });
            });
            const why = bad.length ? bad.slice(0, 5).join('; ') + (bad.length > 5 ? '; ...' : '') : '';
            if (!inc.length) return say('Nothing was uploaded. ' + (why || 'The file has no rows. Download the template and fill it in.'), true);
            if (!confirm('Replace the ' + NAMES[name] + ' table (' + data[name].rows.length + ' rows now) with ' + inc.length + ' rows from this file? Rows that are not in the file will be removed.')) return;
            const L = inc.filter(loaded).length, res = await saveTable(name, inc);
            say(NAMES[name] + ' updated: ' + res.rows.length + ' rows (' + L + ' loaded, ' + (res.rows.length - L) + ' empty). ' + res.created + ' new IDs created.' + (bad.length ? ' ' + bad.length + ' rows skipped (' + why + ').' : '') + ' Use Export data to download the rows with their IDs.', bad.length > 0);
        } catch (x) { say('Upload failed: ' + x.message, true); }
    }

    const up = data[tab].updated;
    return (
        <div className="pg-fleet">
            <header className="head">
                <div>
                    <h1>Fleet Management</h1>
                    <div className="today">Today, {fmt(iso(now))}</div>
                    <p>A truck is loaded when it has a loading date and no offloading date. Days are counted from loading to offloading, or to today.</p>
                </div>
                <button className="btn pri" onClick={() => openForm(null)}><Icon name="plus" />Add truck</button>
            </header>
            <div className="body">
                <section className="kpis" aria-label="Fleet summary">
                    <div className="k"><div className="kh">Total trucks<span className="chip y"><Icon name="truck" /></span></div><b>{k.total}</b><span>Unique horses in both tables</span></div>
                    <div className="k"><div className="kh">Loaded<span className="chip g"><Icon name="box" /></span></div><b>{k.l}</b><span>Loading date, not offloaded</span></div>
                    <div className="k"><div className="kh">Empty<span className="chip"><Icon name="box" /></span></div><b>{k.empty}</b><span>Offloaded or not yet loaded</span></div>
                    <div className="k"><div className="kh">In Zambia<span className="chip"><Icon name="pin" /></span></div><b>{k.z}</b><span>From Current Country</span></div>
                    <div className="k"><div className="kh">In DRC<span className="chip"><Icon name="pin" /></span></div><b>{k.d}</b><span>From Current Country</span></div>
                </section>
                <section className="util">
                    <span className="chip y"><Icon name="gauge" /></span>
                    <div><b>Fleet utilisation</b><small>{k.l} of {k.total} trucks carrying cargo</small></div>
                    <div className="track"><div style={{ width: k.pc + '%' }} /></div><strong>{k.pc}%</strong>
                </section>
                <section className="panel">
                    <div className="ph">
                        <div className="tabs" role="tablist">
                            {['zam', 'drc'].map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTabTo(t)}>{NAMES[t]}<span>{data[t].rows.length}</span></button>)}
                        </div>
                        <div className="bar">
                            <button className="btn" title={NAMES[tab]} onClick={() => fileRef.current.click()}><Icon name="up" />Upload Excel</button>
                            <button className="btn" title={NAMES[tab]} onClick={tpl}><Icon name="file" />Download template</button>
                            <button className="btn" title={NAMES[tab]} onClick={exp}><Icon name="down" />Export data</button>
                            <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv" hidden onChange={upload} />
                        </div>
                    </div>
                    <Msg msg={msg} />
                    <div className="tools">
                        <label>Truck<span className="inp"><Icon name="search" /><input type="search" placeholder="Search horse, e.g. BCB 4521" value={f.truck} onChange={e => setF({ ...f, truck: e.target.value })} /></span></label>
                        <label>Location<input type="search" placeholder="Loading, offloading or current" value={f.loc} onChange={e => setF({ ...f, loc: e.target.value })} /></label>
                        <label>Loading date<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
                        <label>Sort by days<select value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })}><option value="">Default order</option><option value="desc">Most days first</option><option value="asc">Fewest days first</option></select></label>
                        <label className="seg-l">Status<span className="seg">{[['', 'All'], ['open', 'Loaded'], ['done', 'Empty']].map(([v, l]) => <button key={v} className={f.stat === v ? 'on' : ''} onClick={() => setF({ ...f, stat: v })}>{l}</button>)}</span></label>
                        <button className="rst" onClick={reset}><Icon name="reset" />Reset</button>
                    </div>
                    <div className="scroll">
                        <table>
                            {/* 8 columns that always fit the screen: each date sits with its place, so there is no side scrolling */}
                            <colgroup><col style={{ width: '13%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col /><col style={{ width: '9%' }} /><col style={{ width: '84px' }} /></colgroup>
                            <thead><tr><th>Horse</th><th>Status</th><th>Loaded</th><th>Offloaded</th><th>Current location</th><th>Remarks</th><th>Days</th><th className="act-h"><span className="sr">Actions</span></th></tr></thead>
                            <tbody>
                                {rows.length ? rows.map(t => {
                                    const n = days(t), L = loaded(t), c = ccName(t.cc);
                                    return <tr key={t.id || t.h} className={cls(t) + (L ? ' L' : '')}>
                                        <td><b className="horse">{t.h}</b><div className="sub mono">{t.id}</div></td>
                                        <td><span className={'st ' + (L ? 'ld' : 'em')}><i />{L ? 'Loaded' : 'Empty'}</span></td>
                                        <td><div><Dash v={fmtD(t.ld)} /></div><div className="sub">{t.ll || '\u00a0'}</div></td>
                                        <td><div><Dash v={fmtD(t.od)} /></div><div className="sub">{t.ol || '\u00a0'}</div></td>
                                        <td><Dash v={t.cl} />{c && <div className="sub">{c}</div>}</td>
                                        <td className="rem" title={t.r || ''}><div className="clamp"><Dash v={t.r} /></div></td>
                                        <td className="days">{n == null ? <Dash /> : <span className="pill">{n}{n === 1 ? ' day' : ' days'}</span>}</td>
                                        <td className="act">
                                            <button className="ib" title="Edit" aria-label={'Edit ' + t.h} onClick={() => openForm(t)}><Icon name="edit" /></button>
                                            <button className="ib del" title="Delete" aria-label={'Delete ' + t.h} onClick={() => del(t)}><Icon name="trash" /></button>
                                        </td>
                                    </tr>;
                                }) : <tr><td colSpan="8" className="empty">No trucks in this table yet. Upload an Excel file or add a truck.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <div className="foot">
                        <div className="lg">Days (loaded trucks): <span>Under 7</span><span className="g">7+ days</span><span className="o">9+ days</span><span className="r">12+ days</span></div>
                        <div>Showing {rows.length} of {R.length} rows &middot; {up ? 'Updated ' + new Date(up).toLocaleString('en-GB') : 'No data uploaded yet'}</div>
                    </div>
                </section>
            </div>

            <Modal open={!!form} onClose={() => setForm(null)}>
                {form && <form onSubmit={submit}>
                    <h2>{(form.id ? 'Edit truck' : 'Add truck') + ' - ' + NAMES[tab]}</h2>
                    <div className="grid">
                        {[['h', 'Horse', 'text', true], ['ld', 'Loading date', 'date'], ['ll', 'Loading location'], ['od', 'Date offloaded', 'date'], ['ol', 'Offloading location'], ['cl', 'Current location']].map(([n, l, t, req]) =>
                            <label key={n}>{l}<input type={t || 'text'} required={!!req} value={form.v[n] || ''} onChange={e => setForm({ ...form, v: { ...form.v, [n]: e.target.value } })} /></label>)}
                        <label>Current country<select value={form.v.cc || ''} onChange={e => setForm({ ...form, v: { ...form.v, cc: e.target.value } })}><option value="">Not set</option><option value="ZAM">Zambia</option><option value="DRC">DRC</option></select></label>
                        <label className="wide">Remarks<input value={form.v.r || ''} onChange={e => setForm({ ...form, v: { ...form.v, r: e.target.value } })} /></label>
                    </div>
                    <div className="acts"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn pri">Save</button></div>
                </form>}
            </Modal>
        </div>
    );
}
