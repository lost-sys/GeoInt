'use strict';
/* GeoInt — serveur sans dépendance (Node 18+).
   Lancer :  ADMIN_CODE=un-code-secret node server.js      (Windows : set ADMIN_CODE=... puis node server.js)
   Le code admin ne sert qu'une fois : à créer le compte « Lost ». Ensuite le pseudo est verrouillé. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000, ADMIN_CODE = process.env.ADMIN_CODE || '', FILE = path.join(__dirname, 'data.json');
const DB = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
DB.users ??= {}; DB.sessions ??= {}; DB.records ??= []; DB.logs ??= []; DB.chat ??= {}; DB.updates ??= [
  { id: 'u1', ts: Date.now(), author: 'Lost', title: 'GeoInt v8', text: 'Ajout des comptes sécurisés, chat multi-salons, enregistrements serveur, épinglage et installation en application.', pinned: true }
]; DB.seq ??= 0;
let tm; const save = () => { clearTimeout(tm); tm = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(DB)), 300); };
const ROOMS = { annonces: { admin: true }, general: {}, recrutement: {}, aide: {}, trouvailles: {} };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const norm = p => p.toLowerCase().replace(/0/g, 'o').replace(/[1i|!]/g, 'l').replace(/5/g, 's').replace(/[_-]/g, '');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const J = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
const E = (code, msg) => Object.assign(new Error(msg), { code });
const log = (author, action, rec, detail) => { DB.logs.push({ ts: Date.now(), author, action, type: rec?.type, title: rec?.title, detail: String(detail || '').slice(0, 120) }); DB.logs = DB.logs.slice(-2000); save(); };
const body = req => new Promise((ok, ko) => { let b = '', n = 0;
  req.on('data', c => { n += c.length; if (n > 3e6) { ko(E(413, 'Contenu trop volumineux')); req.destroy(); } else b += c; });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ko(E(400, 'JSON invalide')); } }); });
const authUser = req => { const t = (req.headers.authorization || '').replace('Bearer ', ''), s = DB.sessions[sha(t)];
  if (!t || !s || s.exp < Date.now() || !DB.users[s.u]) return null; return { key: s.u, name: DB.users[s.u].name, admin: s.u === 'lost' }; };
const fails = {}, tooMany = k => fails[k] && fails[k].n >= 5 && Date.now() - fails[k].t < 60000;
const bad = k => { const f = fails[k] = fails[k] && Date.now() - fails[k].t < 60000 ? fails[k] : { n: 0 }; f.n++; f.t = Date.now(); };
const lastMsg = {};
const STATIC = { '/': ['geoint-v7.html', 'text/html; charset=utf-8'], '/index.html': ['geoint-v7.html', 'text/html; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'] };
const token = (res, key) => { const t = crypto.randomBytes(32).toString('hex'); DB.sessions[sha(t)] = { u: key, exp: Date.now() + 30 * 864e5 }; save(); J(res, 200, { token: t, name: DB.users[key].name, admin: key === 'lost' }); };

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
    if (m === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (!p.startsWith('/api/')) {
      const f = STATIC[p]; if (!f || !fs.existsSync(path.join(__dirname, f[0]))) { res.writeHead(404); return res.end('Introuvable'); }
      res.writeHead(200, { 'Content-Type': f[1] }); return res.end(fs.readFileSync(path.join(__dirname, f[0])));
    }
    const B = m === 'POST' ? await body(req) : {};
    /* ---- comptes ---- */
    if (p === '/api/register' && m === 'POST') {
      const name = String(B.pseudo || '').trim(), key = name.toLowerCase();
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) throw E(400, 'Pseudo : 3 à 20 caractères (lettres, chiffres, _ ou -)');
      if (String(B.password || '').length < 8) throw E(400, 'Mot de passe : 8 caractères minimum');
      if (key === 'lost') { if (!ADMIN_CODE || sha(String(B.adminCode || '')) !== sha(ADMIN_CODE)) throw E(403, 'Ce pseudo est réservé au créateur du site'); }
      else if (norm(name) === 'lost' || /admin|staff|moderat/i.test(name)) throw E(403, 'Ce pseudo est réservé');
      if (DB.users[key]) throw E(409, 'Ce pseudo est déjà pris');
      const salt = crypto.randomBytes(16).toString('hex'); DB.users[key] = { name, salt, hash: hash(B.password, salt), created: Date.now() };
      log(name, 'inscription'); return token(res, key);
    }
    if (p === '/api/login' && m === 'POST') {
      const key = String(B.pseudo || '').trim().toLowerCase(), k = key + '|' + req.socket.remoteAddress;
      if (tooMany(k)) throw E(429, 'Trop d\'essais : réessaie dans une minute');
      const us = DB.users[key];
      if (!us || !crypto.timingSafeEqual(Buffer.from(hash(String(B.password || ''), us.salt)), Buffer.from(us.hash))) { bad(k); throw E(401, 'Pseudo ou mot de passe incorrect'); }
      return token(res, key);
    }
    const me = authUser(req); if (!me) throw E(401, 'Connexion requise');
    if (p === '/api/me') return J(res, 200, { name: me.name, admin: me.admin });
    /* ---- chat ---- */
    let r = p.match(/^\/api\/chat\/(\w+)(?:\/(\d+))?$/);
    if (r) {
      const room = ROOMS[r[1]]; if (!room) throw E(404, 'Salon inconnu'); const list = DB.chat[r[1]] ??= [];
      if (m === 'GET') { const since = +u.searchParams.get('since') || 0; return J(res, 200, list.filter(x => x.id > since).slice(-200)); }
      if (m === 'POST') {
        const text = String(B.text || '').trim().slice(0, 500); if (!text) throw E(400, 'Message vide');
        if (room.admin && !me.admin) throw E(403, 'Seul le créateur peut écrire ici');
        if (Date.now() - (lastMsg[me.key] || 0) < 800) throw E(429, 'Doucement !'); lastMsg[me.key] = Date.now();
        list.push({ id: ++DB.seq, ts: Date.now(), u: me.name, admin: me.admin, text }); DB.chat[r[1]] = list.slice(-500); save(); return J(res, 200, { ok: true });
      }
      if (m === 'DELETE' && r[2]) { const i = list.findIndex(x => x.id === +r[2]); if (i < 0) throw E(404, 'Introuvable');
        if (!me.admin && list[i].u !== me.name) throw E(403, 'Interdit'); list.splice(i, 1); save(); return J(res, 200, { ok: true }); }
    }
    /* ---- mises à jour ---- */
    if (p === '/api/updates' && m === 'GET') return J(res, 200, DB.updates.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.ts-a.ts));
    if (p === '/api/updates' && m === 'POST') {
      if (!me.admin) throw E(403, 'Seul le créateur peut publier des mises à jour');
      const title = String(B.title || '').trim().slice(0, 80), text = String(B.text || '').trim().slice(0, 2000);
      if (!title || !text) throw E(400, 'Titre et texte requis');
      DB.updates.unshift({ id: crypto.randomUUID(), ts: Date.now(), author: me.name, title, text, pinned: !!B.pinned });
      DB.updates = DB.updates.slice(0, 200);
      save(); return J(res, 200, { ok: true });
    }

    /* ---- enregistrements (contenu chiffré côté navigateur) ---- */
    if (p === '/api/records' && m === 'GET') return J(res, 200, DB.records.map(({ salt, iv, data, ...x }) => x));
    if (p === '/api/records' && m === 'POST') {
      const { type, title, meta, salt, iv, data } = B;
      if (!['graphe', 'carte'].includes(type) || ![salt, iv, data].every(x => typeof x === 'string')) throw E(400, 'Enregistrement invalide');
      const rec = { id: crypto.randomUUID(), type, title: String(title || 'Sans titre').slice(0, 80), author: me.name, ts: Date.now(), meta: String(meta || '').slice(0, 120), pinned: false, salt, iv, data };
      DB.records.unshift(rec); log(me.name, 'création', rec, rec.meta); const { salt: a, iv: b, data: c, ...pub } = rec; return J(res, 200, pub);
    }
    r = p.match(/^\/api\/records\/([\w-]+)(\/pin)?$/);
    if (r) {
      const rec = DB.records.find(x => x.id === r[1]); if (!rec) throw E(404, 'Introuvable');
      if (r[2] && m === 'POST') { if (!me.admin) throw E(403, 'Réservé au créateur'); rec.pinned = !!B.pinned; log(me.name, rec.pinned ? 'épinglé' : 'désépinglé', rec); return J(res, 200, { ok: true }); }
      if (rec.author !== me.name) { log(me.name, 'accès refusé', rec, 'tentative sur un enregistrement privé'); throw E(403, 'Accès réservé au propriétaire'); }
      if (m === 'GET') return J(res, 200, { type: rec.type, title: rec.title, salt: rec.salt, iv: rec.iv, data: rec.data });
      if (m === 'DELETE') { DB.records = DB.records.filter(x => x !== rec); log(me.name, 'suppression', rec); return J(res, 200, { ok: true }); }
    }
    /* ---- journal ---- */
    if (p === '/api/logs' && m === 'GET') return J(res, 200, DB.logs.slice(-300));
    if (p === '/api/log' && m === 'POST') {
      if (!['analyse', 'accès refusé', 'ouverture'].includes(B.action)) throw E(400, 'Action inconnue');
      log(me.name, B.action, { title: String(B.title || '').slice(0, 80) }, B.detail); return J(res, 200, { ok: true });
    }
    throw E(404, 'Route inconnue');
  } catch (e) { J(res, e.code && e.code < 600 ? e.code : 500, { error: e.code && e.code < 600 ? e.message : 'Erreur serveur' }); }
}).listen(PORT, () => console.log(`GeoInt prêt sur http://localhost:${PORT}` + (ADMIN_CODE ? '' : '  (⚠ ADMIN_CODE non défini : le compte Lost ne pourra pas être créé)')));