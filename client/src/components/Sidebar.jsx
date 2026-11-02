import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';

// THE SIDE MENU. To add a page: add one line here and one <Route> in App.jsx.
//   group: makes a folder that opens/closes · parent: puts the item inside that folder · soon: greyed out
export const MODULES = [
    { name: 'Fleet Master View', desc: 'Current and completed trips', icon: 'grid', group: 'master' },
    { name: 'Current Trips', desc: 'Trips started or on the road', link: '/master', icon: 'truck', parent: 'master' },
    { name: 'Completed Trips', desc: 'Trips with an Offloading 2 date', link: '/master#completed', icon: 'check', parent: 'master' },
    { name: 'Fleet Management', desc: 'Trucks, trips and Excel uploads', link: '/fleet', icon: 'truck' },
    { name: 'Fuel Management', desc: 'Fuel given per trip and truck', link: '/fuel', icon: 'fuel' },
    { name: 'Staff', desc: 'Staff, drivers and their trucks', link: '/staff', icon: 'users' },
    { name: 'Procurement', desc: 'Store, workshop and truck maintenance', icon: 'box', group: 'proc' },
    { name: 'Order Book', desc: 'Items bought and added to the store', link: '/procurement', icon: 'book', parent: 'proc' },
    { name: 'Store / Stock', desc: 'In stock and out of stock', link: '/procurement#stock', icon: 'box', parent: 'proc' },
    { name: 'Workshop Book', desc: 'Items requested from the warehouse', link: '/procurement#workshop', icon: 'wrench', parent: 'proc' },
    { name: 'Trucks Maintenance', desc: 'What every truck used', link: '/procurement#trucks', icon: 'truck', parent: 'proc' }
];
const split = l => { const i = (l || '').indexOf('#'); return i < 0 ? [l || '', ''] : [l.slice(0, i), l.slice(i)]; };
const kids = g => MODULES.filter(x => x.parent === g);

export default function Sidebar() {
    const loc = useLocation();
    const here = loc.pathname.replace(/\/$/, '') || '/master';
    const path = here === '/' ? '/master' : here;
    const isActive = m => {
        if (!m.link || m.group) return false;
        const [p, h] = split(m.link);
        if (p !== path) return false;
        if (h) return loc.hash === h;
        return !MODULES.some(x => loc.hash && x.link === p + loc.hash);
    };
    const [open, setOpen] = useState(() => Object.fromEntries(MODULES.filter(m => m.group).map(m => [m.group, kids(m.group).some(c => split(c.link)[0] === path)])));
    const [drop, setDrop] = useState(false);
    const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

    useEffect(() => { setDrop(false); }, [loc.pathname, loc.hash]);
    useEffect(() => {
        if (!drop) return;
        const close = () => setDrop(false), esc = e => e.key === 'Escape' && setDrop(false);
        document.addEventListener('click', close); document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
    }, [drop]);

    const toggleDark = () => {
        const t = dark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('ph_theme', t); } catch (e) { }
        setDark(!dark);
    };
    const logout = async () => { try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { } location.replace('/login'); };

    const list = inDrop => MODULES.map(m => {
        if (m.group) {
            const o = !!open[m.group], has = kids(m.group).some(isActive);
            return <button key={m.name} type="button" className={'pm-link pm-head' + (o ? ' open' : '') + (has ? ' has' : '')} aria-expanded={o}
                onClick={e => { e.stopPropagation(); setOpen({ ...open, [m.group]: !o }); }}>
                <Icon name={m.icon} className="pm-ic" /><span className="pm-t">{m.name}{inDrop && m.desc && <small>{m.desc}</small>}</span><Icon name="chev" className="pm-ic pm-car" />
            </button>;
        }
        if (m.parent && !open[m.parent]) return null;
        const cls = 'pm-link' + (m.parent ? ' pm-sub' : '') + (isActive(m) ? ' on' : '') + (m.soon ? ' soon' : '');
        const inner = <><Icon name={m.icon} className="pm-ic" /><span className="pm-t">{m.name}{inDrop && m.desc && <small>{m.desc}</small>}</span>{m.soon && <span className="pm-tag">SOON</span>}</>;
        return m.soon || !m.link ? <a key={m.name} className={cls} href="#" onClick={e => e.preventDefault()}>{inner}</a>
            : <Link key={m.name} className={cls} to={m.link} role={inDrop ? 'menuitem' : undefined}>{inner}</Link>;
    });

    return (
        <aside className="side">
            <button className="pm-brand" type="button" aria-haspopup="menu" aria-expanded={drop} onClick={e => { e.stopPropagation(); setDrop(!drop); }}>
                <span className="pm-logo"><img src="/phl-logo.png" alt="PHL" onError={e => { e.currentTarget.style.display = 'none'; }} /></span>
                <span className="pm-bt"><b>PROFESSIONAL HAULIERS</b><small>Zambia &ndash; DRC corridor</small></span>
                <Icon name="chev" className="pm-ic" />
            </button>
            <div className="pm-drop" role="menu" hidden={!drop} onClick={e => e.stopPropagation()}>
                <div className="pm-sec">Modules</div><div className="pm-list">{list(true)}</div>
            </div>
            <nav className="pm-nav" aria-label="Modules"><div className="pm-sec">Operations</div><div className="pm-list">{list(false)}</div></nav>
            <div className="pm-foot">
                <button className="pm-btn" type="button" onClick={toggleDark}><Icon name="moon" className="pm-ic" /><span>{dark ? 'Light mode' : 'Dark mode'}</span></button>
                <button className="pm-btn" type="button" onClick={logout}><Icon name="logout" className="pm-ic" /><span>Log out</span></button>
                <div className="pm-user"><i>OP</i><div><b>Operations desk</b><small>Password protected</small></div></div>
            </div>
        </aside>
    );
}
