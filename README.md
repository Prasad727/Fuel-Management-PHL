# PHL Fleet App — React version

The app now runs on **React**. Your server, login, Firebase data and all `/api/...` routes stay exactly the same;
only the pages changed. Pages switch instantly (no reload), each page downloads only when first opened,
and the Excel library only downloads when you use an Excel button.

---

## 1. What goes where

```
your app folder/
├── server.js            ← REPLACE (now serves the React app)
├── master.js            (no change)
├── staff.js             (no change)
├── trips.js             (no change)
├── package.json         (your existing one - no change needed)
├── README.md            ← NEW (this guide)
├── .gitignore           ← NEW
├── public/              (no change - login page, logo, theme.css and the OLD pages stay here as a backup)
└── client/              ← NEW FOLDER: the React app
    ├── package.json
    ├── package-lock.json
    ├── vite.config.js
    ├── index.html
    ├── .gitignore
    └── src/
        ├── main.jsx
        ├── App.jsx              ← list of pages (routes)
        ├── theme.css            ← colours + text sizes for the whole app
        ├── components/
        │   ├── Sidebar.jsx      ← the side menu
        │   ├── Icon.jsx
        │   ├── Modal.jsx
        │   └── Msg.jsx
        ├── lib/
        │   ├── api.js
        │   └── util.js
        └── pages/
            ├── Fleet.jsx   + fleet.css
            ├── Fuel.jsx    + fuel.css
            ├── Master.jsx  + master.css
            └── Staff.jsx   + staff.css
```

---

## 2. Install on your computer (first time only)

**Step 1 – Install Node.js** (skip if `node -v` already shows v18 or newer)
1. Go to https://nodejs.org and download the **LTS** version.
2. Install it (Next, Next, Finish).
3. Open a **new** Command Prompt / PowerShell and type `node -v`. You should see something like `v22.x.x`.

**Step 2 – Copy the files** into your app folder exactly as shown in section 1.

**Step 3 – Install the React tools** (downloads React, Vite and the Excel library into `client/node_modules`):
```
cd path\to\your\app\client
npm install
```

**Step 4 – Build the app** (makes the fast, final version in `client/dist`):
```
npm run build
```
You should see `✓ built in ...`.

**Step 5 – Start your server as usual** (from the main app folder):
```
cd ..
node server.js
```
The start-up message now includes **`Pages: React app (client/dist)`**.
Open http://localhost:3000 and log in.

> Every time you change a file in `client/src`, run `npm run build` again (in the `client` folder) and restart the server.

---

## 3. Working on the design (optional, live preview)

While you change pages you don't want to rebuild every time. Use two windows:

- Window 1 (main folder): `node server.js`
- Window 2 (client folder): `npm run dev`

Open **http://localhost:5173**. Every time you save a file in `client/src`, the page updates by itself.
(It uses the server from window 1 for data and login.) When you are happy, run `npm run build`.

---

## 4. Put it online on Render

1. Upload the new files to your Git repository (GitHub) the same way you do now.
   The `.gitignore` keeps `node_modules` and `client/dist` out of Git — Render builds them itself.
2. In Render, open your web service → **Settings**:
   - **Build Command:**
     ```
     npm install && npm install --prefix client && npm run build --prefix client
     ```
   - **Start Command:** `node server.js` (as now)
3. Click **Manual Deploy → Deploy latest commit**.
4. In the deploy log you should see `✓ built in ...` and then `Pages: React app (client/dist)`.

If the build fails with a Node version error: in Render → **Environment**, add `NODE_VERSION` = `20`, and deploy again.

---

## 5. Everyday changes

| I want to… | Change this |
|---|---|
| Change colours or text size everywhere | `client/src/theme.css` (sections 1 and 2) |
| Change one page | `client/src/pages/<Page>.jsx` (and its `.css`) |
| Change the side menu | the `MODULES` list at the top of `client/src/components/Sidebar.jsx` |
| Add a new page (e.g. Procurement) | see below |

**Adding a new page, e.g. Procurement**
1. Copy `client/src/pages/Fuel.jsx` to `Procurement.jsx` and change it.
2. In `client/src/App.jsx` add:
   `const Procurement = lazy(() => import('./pages/Procurement.jsx'));` and
   `<Route path="/procurement" element={<Procurement />} />`
3. In `Sidebar.jsx`, change the Procurement line to `link: '/procurement'` and remove `soon: true`.
4. In `server.js`, add `'/procurement'` to `APP_PAGES`.
5. `npm run build`, restart the server.

---

## 6. Safety net

- The **old pages still work** at `/old/fleet`, `/old/fuel`, `/old/master`, `/old/staff`.
- To switch the whole app back to the old pages, rename or delete the `client/dist` folder and restart the server.
  The server notices there is no React build and shows the old pages again.
- Nothing about your data changes: both versions use the same `/api/...` routes and the same Firebase.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `npm` is not recognised | Node.js is not installed, or open a NEW command window after installing it |
| Start-up says `Pages: old HTML pages` | You did not run `npm run build` in the `client` folder, or `client/dist` is missing |
| Page is blank after an update | Press **Ctrl + F5** once |
| Changes in `client/src` don't show | Run `npm run build` again and restart the server |
| Render deploy shows the old pages | Check the Build Command in section 4 is saved exactly |
