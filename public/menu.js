// menu.js - ONE shared side menu for every page (Fleet, Fuel, Fleet Master View, ...)
//
// TO ADD A NEW MODULE: add one line to MODULES below. Nothing else needs changing.
//   name   : text shown in the menu
//   desc   : small text shown in the company-name dropdown
//   link   : page address (must also exist in PAGES in server.js)
//   icon   : truck, grid, check, fuel, box, users  (see ICONS further down)
//   soon   : true -> greyed out with a "SOON" tag
//   group  : makes the item a folder that opens/closes (it does not open a page)
//   parent : puts the item inside the folder with that group name
//   go     : only for Fleet Master View (switches view without reloading)
(function () {
    var MODULES = [
        { name: 'Fleet Master View', desc: 'Current and completed trips', icon: 'grid', group: 'master' },
        { name: 'Current Trips', desc: 'Trips started or on the road', link: '/master', icon: 'truck', go: 'main', parent: 'master' },
        { name: 'Completed Trips', desc: 'Trips with an Offloading 2 date', link: '/master#completed', icon: 'check', go: 'done', parent: 'master' },
        { name: 'Fleet Management', desc: 'Trucks, trips and Excel uploads', link: '/fleet', icon: 'truck' },
        { name: 'Fuel Management', desc: 'Fuel given per trip and truck', link: '/fuel', icon: 'fuel' },
        { name: 'Staff', desc: 'Staff, drivers and their trucks', link: '/staff', icon: 'users' },
        { name: 'Procurement', desc: 'Coming soon', link: '', icon: 'box', soon: true }
    ];

    var ICONS = {
        truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
        grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        fuel: '<path d="M3 22V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17"/><path d="M3 22h12"/><path d="M15 9h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V8l-3-3"/><rect x="6" y="7" width="6" height="4"/>',
        box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
        logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
        chev: '<polyline points="6 9 12 15 18 9"/>'
    };

    var CSS =
        '.pm-ic{width:18px;height:18px;flex:none}' +
        '.pm-brand{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;color:inherit;text-align:left;cursor:pointer;padding:6px;border-radius:12px;font-family:inherit}' +
        '.pm-brand:hover{background:#1a1a18}' +
        '.pm-logo{width:42px;height:42px;border-radius:12px;background:var(--yel);color:var(--yink);display:grid;place-items:center;flex:none}' +
        '.pm-logo .pm-ic{width:22px;height:22px}' +
        '.pm-bt{flex:1;min-width:0}.pm-bt b{display:block;color:#fff;font-size:13.5px;line-height:1.15;letter-spacing:.04em;font-weight:800}.pm-bt small{font-size:12px;color:#8d8c84}' +
        '.pm-brand>.pm-ic{color:#8d8c84;transition:transform .2s}.pm-brand[aria-expanded=true]>.pm-ic{transform:rotate(180deg)}' +
        '.pm-drop{position:absolute;left:14px;right:14px;top:84px;background:#1c1c1a;border:1px solid #2e2e2a;border-radius:14px;padding:8px;z-index:40;box-shadow:0 18px 40px rgba(0,0,0,.45)}' +
        '.pm-drop[hidden]{display:none}' +
        '.pm-sec{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#77766e;padding:8px 10px 6px;font-weight:600}' +
        '.pm-nav{margin-top:22px;display:flex;flex-direction:column;gap:4px}' +
        '.pm-list{display:flex;flex-direction:column;gap:4px}' +
        '.pm-link{display:flex;align-items:center;gap:12px;color:var(--sideink);text-decoration:none;padding:11px 12px;border-radius:11px;font-weight:500;font-size:15px}' +
        '.pm-link:hover{background:#1c1c1a;color:#fff}' +
        '.pm-link.on{background:var(--yel);color:var(--yink)}' +
        '.pm-link.soon{opacity:.6;pointer-events:none}' +
        '.pm-link.pm-sub{margin-left:18px;padding:9px 12px;font-size:14px}' +
        '.pm-head{width:100%;background:none;border:0;cursor:pointer;font-family:inherit;text-align:left}' +
        '.pm-head.has{color:#fff}' +
        '.pm-head .pm-car{margin-left:auto;width:16px;height:16px;transition:transform .2s;opacity:.7}' +
        '.pm-head.open .pm-car{transform:rotate(180deg)}' +
        '.pm-t small{display:block;font-size:12px;color:#77766e;font-weight:400}.pm-link.on small{color:#5c4400}' +
        '.pm-tag{margin-left:auto;font-size:11px;letter-spacing:.08em;border:1px solid #33332f;border-radius:99px;padding:3px 10px;color:#8d8c84}' +
        '.pm-foot{margin-top:auto;border-top:1px solid var(--sideline);padding-top:14px;display:flex;flex-direction:column;gap:6px}' +
        '.pm-btn{background:none;border:0;color:var(--sideink);display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:11px;cursor:pointer;font:500 15px Inter,"Segoe UI",sans-serif;text-align:left;width:100%}' +
        '.pm-btn:hover{background:#1c1c1a;color:#fff}' +
        '.pm-user{display:flex;gap:12px;align-items:center;padding:8px 12px}' +
        '.pm-user i{width:38px;height:38px;border-radius:50%;background:#262623;color:#fff;display:grid;place-items:center;font:600 13px Inter,sans-serif;font-style:normal}' +
        '.pm-user b{display:block;color:#fff;font-size:14.5px;line-height:1.2}.pm-user small{font-size:12.5px;color:#77766e}' +
        '@media(max-width:860px){.pm-nav,.pm-foot{display:none}.pm-brand{width:auto;flex:1}.pm-drop{top:72px}}';

    function svg(name, cls) {
        return '<svg class="pm-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.truck) + '</svg>';
    }
    function here() { var p = location.pathname.replace(/\/$/, '') || '/'; return p === '/' ? '/fleet' : p; }
    function splitLink(l) { var i = (l || '').indexOf('#'); return i < 0 ? [l || '', ''] : [l.slice(0, i), l.slice(i)]; }

    function isActive(m) {
        if (!m.link || m.group) return false;
        var s = splitLink(m.link), path = s[0], hash = s[1];
        if (path !== here()) return false;
        if (hash) return location.hash === hash;
        // a page link is active unless one of its "#..." links is the one open
        return !MODULES.some(function (x) { return location.hash && x.link === path + location.hash; });
    }
    function children(g) { return MODULES.filter(function (x) { return x.parent === g; }); }

    // Folders start open when you are on one of their pages, closed otherwise
    var OPEN = {};
    MODULES.forEach(function (m) {
        if (m.group) OPEN[m.group] = children(m.group).some(function (c) { return splitLink(c.link)[0] === here(); });
    });

    function link(m, inDrop) {
        var s = splitLink(m.link), samePage = s[0] && s[0] === here();
        var href = (!m.link || m.soon) ? '#' : (samePage && s[1] ? s[1] : m.link);
        var go = samePage && m.go ? ' data-go="' + m.go + '"' : '';
        var cls = 'pm-link' + (m.parent ? ' pm-sub' : '') + (isActive(m) ? ' on' : '') + (m.soon ? ' soon' : '');
        return '<a class="' + cls + '" href="' + href + '"' + go + (inDrop ? ' role="menuitem"' : '') + '>' + svg(m.icon) +
            '<span class="pm-t">' + m.name + (inDrop && m.desc ? '<small>' + m.desc + '</small>' : '') + '</span>' +
            (m.soon ? '<span class="pm-tag">SOON</span>' : '') + '</a>';
    }
    function folder(m, inDrop) {
        var open = !!OPEN[m.group], has = children(m.group).some(isActive);
        return '<button type="button" class="pm-link pm-head' + (open ? ' open' : '') + (has ? ' has' : '') + '" data-group="' + m.group + '" aria-expanded="' + open + '">' +
            svg(m.icon) + '<span class="pm-t">' + m.name + (inDrop && m.desc ? '<small>' + m.desc + '</small>' : '') + '</span>' + svg('chev', 'pm-car') + '</button>';
    }
    function list(inDrop) {
        return MODULES.map(function (m) {
            if (m.group) return folder(m, inDrop);
            if (m.parent && !OPEN[m.parent]) return '';
            return link(m, inDrop);
        }).join('');
    }

    // Theme: set right away so the page never flashes the wrong colour
    var theme = 'light'; try { theme = localStorage.getItem('ph_theme') || 'light'; } catch (e) { }
    document.documentElement.setAttribute('data-theme', theme);

    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

    var side = document.getElementById('side');
    if (!side) { console.error('menu.js: add <aside class="side" id="side"></aside> to this page'); return; }

    side.innerHTML =
        '<button class="pm-brand" id="pmBrand" type="button" aria-haspopup="menu" aria-expanded="false">' +
        '<span class="pm-logo">' + svg('truck') + '</span>' +
        '<span class="pm-bt"><b>PROFESSIONAL HAULIERS</b><small>Zambia &ndash; DRC corridor</small></span>' + svg('chev') + '</button>' +
        '<div class="pm-drop" id="pmDrop" role="menu" hidden><div class="pm-sec">Modules</div><div class="pm-list" id="pmDropList"></div></div>' +
        '<nav class="pm-nav" aria-label="Modules"><div class="pm-sec">Operations</div><div class="pm-list" id="pmNavList"></div></nav>' +
        '<div class="pm-foot">' +
        '<button class="pm-btn" id="pmDark" type="button">' + svg('moon') + '<span id="pmDarkLbl"></span></button>' +
        '<button class="pm-btn" id="pmOut" type="button">' + svg('logout') + '<span>Log out</span></button>' +
        '<div class="pm-user"><i>OP</i><div><b>Operations desk</b><small>Password protected</small></div></div>' +
        '</div>';

    function refresh() {
        document.getElementById('pmNavList').innerHTML = list(false);
        document.getElementById('pmDropList').innerHTML = list(true);
    }
    function setDarkLabel() {
        document.getElementById('pmDarkLbl').textContent =
            document.documentElement.getAttribute('data-theme') === 'dark' ? 'Light mode' : 'Dark mode';
    }
    refresh(); setDarkLabel();

    // Folder open / close (Fleet Master View)
    side.addEventListener('click', function (e) {
        var f = e.target.closest('[data-group]');
        if (!f) return;
        e.preventDefault(); e.stopPropagation();
        OPEN[f.dataset.group] = !OPEN[f.dataset.group];
        refresh();
    });

    // Company-name dropdown
    var brand = document.getElementById('pmBrand'), drop = document.getElementById('pmDrop');
    function openDrop(o) { drop.hidden = !o; brand.setAttribute('aria-expanded', o); }
    brand.onclick = function (e) { e.stopPropagation(); openDrop(drop.hidden); };
    document.addEventListener('click', function (e) { if (!drop.contains(e.target)) openDrop(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openDrop(false); });

    // Dark mode
    document.getElementById('pmDark').onclick = function () {
        var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
        try { localStorage.setItem('ph_theme', t); } catch (e) { }
        setDarkLabel();
    };

    // Log out
    document.getElementById('pmOut').onclick = async function () {
        try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
        location.replace('/login');
    };

    window.addEventListener('hashchange', refresh);
    window.PHMenu = { refresh: refresh }; // pages can call PHMenu.refresh() after switching views
})();