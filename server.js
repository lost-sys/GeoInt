'use strict';
/* GeoInt — serveur sans dépendance (Node 18+).
   Lancer :  ADMIN_CODE=un-code-secret node server.js      (Windows : set ADMIN_CODE=... puis node server.js)
   Le code admin ne sert qu'une fois : à créer le compte « Lost ». Ensuite le pseudo est verrouillé. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || '';
const FILE = path.join(__dirname, 'data.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SECRET_KEY);

// IA du mode économique : la clé reste côté serveur (Render), jamais dans le navigateur.
const ECONOMIC_AI_API_KEY = process.env.ECONOMIC_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const ECONOMIC_AI_MODEL = /^[a-zA-Z0-9._-]+$/.test(process.env.ECONOMIC_AI_MODEL || '')
  ? process.env.ECONOMIC_AI_MODEL
  : 'gemini-3.5-flash-lite';

const defaults = () => ({
  users:{}, sessions:{}, records:[], logs:[], chat:{},
  updates:[{ id:'u1', ts:Date.now(), author:'Lost', title:'GeoInt v11', text:'Salons, rôles avancés, modération, vocal WebRTC et persistance des comptes, messages, rôles et enregistrements.', pinned:true }],
  seq:0,
  channels:[
    { id:'general', name:'Général', type:'text', position:0, readonly:false },
    { id:'annonces', name:'Annonces', type:'text', position:1, readonly:true, permission:'post_announcements' },
    { id:'recrutement', name:'Recrutement', type:'text', position:2, readonly:false },
    { id:'aide', name:'Aide', type:'text', position:3, readonly:false },
    { id:'trouvailles', name:'Trouvailles', type:'text', position:4, readonly:false },
    { id:'vocal-general', name:'Général', type:'voice', position:10 },
    { id:'vocal-jeu', name:'Gaming', type:'voice', position:11 }
  ],
  roles:[
    { id:'owner', name:'Propriétaire', color:'#ff5d5d', position:100, permissions:['*'] },
    { id:'admin', name:'Administrateur', color:'#ff8a3d', position:80, permissions:['manage_roles','manage_users','manage_channels','moderate_chat','moderate_members','mute_members','post_announcements','pin_records','publish_updates','view_logs'] },
    { id:'mod', name:'Modérateur', color:'#5aa9ff', position:60, permissions:['moderate_chat','moderate_members','mute_members','view_logs'] },
    { id:'investigator', name:'Enquêteur', color:'#ffb020', position:40, permissions:['pin_records'] },
    { id:'member', name:'Membre', color:'#8b96a3', position:10, permissions:[] }
  ]
});

function normalizeDB(db){
  const d = db && typeof db === 'object' ? db : defaults();
  d.users ??= {}; d.sessions ??= {}; d.records ??= []; d.logs ??= []; d.chat ??= {}; d.moderation ??= { strikes:{} }; d.moderation.strikes ??= {};
  d.updates ??= defaults().updates; d.seq ??= 0; d.roles ??= defaults().roles; d.channels ??= defaults().channels;
  Object.values(d.users).forEach(u=>{ if(!Array.isArray(u.roles)||!u.roles.length) u.roles=['member']; u.avatar=typeof u.avatar==='string'?u.avatar:''; u.bio=typeof u.bio==='string'?u.bio:''; u.premium=!!u.premium; u.nameGradient=typeof u.nameGradient==='string'?u.nameGradient:'none'; u.serverMuted=!!u.serverMuted; u.serverDeafened=!!u.serverDeafened; u.stats??={totalSeconds:0,searches:0,peopleFound:0,coursesCompleted:0}; u.stats.totalSeconds=Number(u.stats.totalSeconds)||0; u.stats.searches=Number(u.stats.searches)||0; u.stats.peopleFound=Number(u.stats.peopleFound)||0; u.stats.coursesCompleted=Number(u.stats.coursesCompleted)||0; });
  if(d.users.lost){d.users.lost.roles=['owner'];d.users.lost.premium=true;}
  return d;
}

let DB = normalizeDB(fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : defaults());
let saving = Promise.resolve();
const localSave = () => { fs.writeFileSync(FILE, JSON.stringify(DB)); };
const persistNow = async () => {
  if(!USE_SUPABASE){ localSave(); return; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/geoint_state?on_conflict=id`, {
    method:'POST',
    headers:{ apikey:SUPABASE_SECRET_KEY, Authorization:`Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
    body:JSON.stringify({id:'main', data:DB, updated_at:new Date().toISOString()})
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
};
const save = () => {
  // Une écriture échouée ne doit jamais bloquer définitivement la file des sauvegardes.
  const run = () => persistNow();
  const current = saving.then(run, run);
  saving = current.catch(e => { console.error('ERREUR PERSISTANCE:', e); });
  return current;
};

async function loadPersistentDB(){
  if(!USE_SUPABASE){
    console.warn('⚠ SUPABASE_URL / SUPABASE_SECRET_KEY absents : stockage local uniquement. Sur Render Free, data.json sera perdu au redémarrage.');
    return;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/geoint_state?id=eq.main&select=data`, {
    headers:{ apikey:SUPABASE_SECRET_KEY, Authorization:`Bearer ${SUPABASE_SECRET_KEY}` }
  });
  if(!r.ok) throw new Error(`Impossible de lire Supabase (${r.status}): ${await r.text()}`);
  const rows = await r.json();
  if(rows[0]?.data){
    const hadChannels=Array.isArray(rows[0].data.channels);
    DB = normalizeDB(rows[0].data);
    localSave();
    if(!hadChannels) await persistNow();
    console.log('✓ Données GeoInt chargées depuis Supabase');
  }else{
    DB = normalizeDB(DB);
    await persistNow();
    console.log('✓ Base GeoInt initialisée dans Supabase');
  }
}
const ROLE_PERMS = ['manage_roles','manage_users','manage_channels','moderate_chat','moderate_members','mute_members','post_announcements','pin_records','publish_updates','view_logs'];
const VOICE = new Map();
const voiceSignals = new Map();
const channelById = id => DB.channels.find(c=>c.id===id);
const voiceRoom = id => { if(!VOICE.has(id)) VOICE.set(id,new Map()); return VOICE.get(id); };
const signalRoom = id => { if(!voiceSignals.has(id)) voiceSignals.set(id,[]); return voiceSignals.get(id); };
const pruneVoice = id => { const room=VOICE.get(id); if(!room)return; const now=Date.now(); for(const [k,v] of room) if(now-v.lastSeen>6000) room.delete(k); const sig=signalRoom(id); voiceSignals.set(id,sig.filter(x=>now-x.ts<30000)); };
const safeId = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32) || 'salon';
const filterProfanity = text => { const words=['putain','merde','connard','connasse','encule','enculé','enculer','enculée','salope','pute','batard','bâtard','fils de pute','trou du cul','va te faire foutre','nique ta mère','nique ta mere','bite','couille','couilles','branleur','branleuse']; let out=text; for(const w of words){ const re=new RegExp('(?<![A-Za-zÀ-ÿ])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-zÀ-ÿ])','giu'); out=out.replace(re,m=>'*'.repeat(m.length)); } return out; };

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
const roleById = id => DB.roles.find(r => r.id === id);
const userRoles = u => (u?.roles || ['member']).map(roleById).filter(Boolean).sort((a,b)=>b.position-a.position);
const hasPermissionForChat = me => hasPerm(me,'moderate_chat') || hasPerm(me,'pin_records');
const hasPerm = (u, perm) => u?.key === 'lost' || userRoles(u).some(r => r.permissions.includes('*') || r.permissions.includes(perm));
const roleView = r => ({id:r.id,name:r.name,color:r.color,position:r.position,permissions:r.permissions,hoist:!!r.hoist,mentionable:!!r.mentionable});
const channelView = c => ({id:c.id,name:c.name,type:c.type,position:c.position,readonly:!!c.readonly,permission:c.permission||null});
const authUser = req => { const t = (req.headers.authorization || '').replace('Bearer ', ''), s = DB.sessions[sha(t)];
  if (!t || !s || s.exp < Date.now() || !DB.users[s.u]) return null; const u=DB.users[s.u]; return { key:s.u, name:u.name, admin:s.u==='lost', roles:userRoles({...u,key:s.u}), permissions:u?.roles?.flatMap(id=>roleById(id)?.permissions||[])||[] }; };
const chatAntiSpam = new Map();
// Modération automatique en étapes : avertissement, blocage/suppression, puis silence temporaire.
// Les infractions sont conservées par utilisateur et expirent après 24 h.
const MODERATION_RULES = [
  { type:'insulte', re:/(?:\b(?:connard|connasse|encul[eé]?|salope|batard|bâtard|fdp|pute|branleur|branleuse)\b|fils de pute|nique ta m[eè]re|va te faire foutre)/iu },
  { type:'propos agressifs', re:/(?:\b(?:je vais te tuer|je vais te retrouver|je vais te frapper|cr[eè]ve)\b)/iu }
];
const detectModerationViolation = text => MODERATION_RULES.find(rule => rule.re.test(text)) || null;
const applyAutoModeration = async (me, text, roomId, violation) => {
  const now=Date.now(), key=me.key;
  DB.moderation ??= { strikes:{} }; DB.moderation.strikes ??= {};
  const previous=DB.moderation.strikes[key] || { count:0, lastAt:0 };
  const count=(now-(Number(previous.lastAt)||0)>86400000?0:Number(previous.count)||0)+1;
  DB.moderation.strikes[key]={count,lastAt:now,type:violation.type};
  let message, action='avertissement';
  if(count===1){
    message='Modération GeoInt : avertissement. Ton message contient des propos interdits. Répète pas ce comportement.';
  }else if(count===2){
    action='message bloqué';
    message='Modération GeoInt : ton message a été bloqué car il contient des propos interdits. Prochaine infraction : silence temporaire.';
  }else{
    action='silence automatique';
    const minutes=count>=4?30:5;
    const user=DB.users[key];
    if(user && key!=='lost') user.timeoutUntil=Math.max(now,Number(user.timeoutUntil)||0)+minutes*60000;
    message='Modération GeoInt : message bloqué et silence de '+minutes+' minutes pour récidive.';
  }
  log('GeoInt Bot',action,{title:me.name},'salon='+roomId+'; type='+violation.type+'; infraction='+count);
  await save();
  throw E(403,message);
};
const fails = {}, tooMany = k => fails[k] && fails[k].n >= 5 && Date.now() - fails[k].t < 60000;
const bad = k => { const f = fails[k] = fails[k] && Date.now() - fails[k].t < 60000 ? fails[k] : { n: 0 }; f.n++; f.t = Date.now(); };
const lastMsg = {};
const STATIC = { '/course-academy.js': ['course-academy.js', 'text/javascript; charset=utf-8'], '/': ['geoint-v7.html', 'text/html; charset=utf-8'], '/index.html': ['geoint-v7.html', 'text/html; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'] };
const token = async (res, key) => { const t = crypto.randomBytes(32).toString('hex'); DB.sessions[sha(t)] = { u: key, exp: Date.now() + 180 * 864e5 }; await save(); J(res, 200, { token:t, name:DB.users[key].name, admin:key==='lost', roles:userRoles({...DB.users[key],key}).map(roleView) }); };

const httpServer = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
    if (m === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (!p.startsWith('/api/')) {
      const f = STATIC[p]; if (!f || !fs.existsSync(path.join(__dirname, f[0]))) { res.writeHead(404); return res.end('Introuvable'); }
      res.writeHead(200, { 'Content-Type': f[1] }); return res.end(fs.readFileSync(path.join(__dirname, f[0])));
    }
    const B = (m === 'POST' || m === 'PATCH') ? await body(req) : {};
    /* ---- comptes ---- */
    if (p === '/api/register' && m === 'POST') {
      const accountCount = Object.keys(DB.users).length;
      if (accountCount >= 3) throw E(403, 'Limite atteinte : GeoInt autorise au maximum 3 comptes.');
      const name = String(B.pseudo || '').trim(), key = name.toLowerCase();
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) throw E(400, 'Pseudo : 3 à 20 caractères (lettres, chiffres, _ ou -)');
      if (String(B.password || '').length < 8) throw E(400, 'Mot de passe : 8 caractères minimum');
      if (key === 'lost') { if (!ADMIN_CODE || sha(String(B.adminCode || '')) !== sha(ADMIN_CODE)) throw E(403, 'Ce pseudo est réservé au créateur du site'); }
      else if (norm(name) === 'lost' || /admin|staff|moderat/i.test(name)) throw E(403, 'Ce pseudo est réservé');
      if (DB.users[key]) throw E(409, 'Ce pseudo est déjà pris');
      const salt = crypto.randomBytes(16).toString('hex'); DB.users[key] = { name, salt, hash: hash(B.password, salt), created: Date.now(), roles: key==='lost'?['owner']:['member'], avatar:'', bio:'', premium:key==='lost', nameGradient:'none', serverMuted:false, serverDeafened:false, timeoutUntil:0, stats:{totalSeconds:0,searches:0,peopleFound:0,coursesCompleted:0} };
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

    /* ---- IA économique : Gemini côté serveur ---- */
    if (p === '/api/ai/economic' && m === 'POST') {
      if (!ECONOMIC_AI_API_KEY) {
        throw E(503, 'Mode économique non configuré : ajoute ECONOMIC_AI_API_KEY dans les variables d’environnement Render.');
      }
      const incoming = Array.isArray(B.parts) ? B.parts : [];
      if (!incoming.length || incoming.length > 20) throw E(400, 'Contenu IA invalide');
      const parts = incoming.map(part => {
        if (typeof part?.text === 'string') {
          if (part.text.length > 100000) throw E(400, 'Texte IA trop volumineux');
          return { text: part.text };
        }
        const image = part?.inline_data;
        if (image && typeof image.data === 'string' &&
            /^image\/(jpeg|png|webp)$/i.test(image.mime_type || '') &&
            image.data.length <= 3500000 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
          return { inlineData: { mimeType: image.mime_type, data: image.data } };
        }
        throw E(400, 'Partie de requête IA invalide');
      });
      const payload = { contents: [{ role: 'user', parts }] };
      if (B.schema && typeof B.schema === 'object' && !Array.isArray(B.schema)) {
        payload.generationConfig = { responseMimeType: 'application/json', responseSchema: B.schema };
      }
      let upstream;
      try {
        upstream = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + ECONOMIC_AI_MODEL + ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ECONOMIC_AI_API_KEY },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60000)
          }
        );
      } catch (err) {
        console.error('IA économique inaccessible:', err.name || 'erreur réseau');
        throw E(502, 'Service IA économique inaccessible. Réessaie dans un instant.');
      }
      let result = {};
      try { result = await upstream.json(); } catch {}
      if (!upstream.ok) {
        const detail = String(result.error?.message || '').slice(0, 240);
        console.error('IA économique:', upstream.status, detail);
        if (upstream.status === 400) throw E(502, 'Requête refusée par Gemini : vérifie le modèle et le format envoyé.');
        if (upstream.status === 401 || upstream.status === 403) throw E(502, 'Clé Gemini invalide ou accès API non autorisé. Vérifie ECONOMIC_AI_API_KEY sur Render.');
        if (upstream.status === 429) throw E(503, 'Quota Gemini atteint. Réessaie plus tard.');
        throw E(502, 'Gemini a renvoyé une erreur (' + upstream.status + ').');
      }
      const text = (result.candidates?.[0]?.content?.parts || [])
        .map(part => typeof part.text === 'string' ? part.text : '')
        .join('');
      if (!text) throw E(502, 'Gemini a renvoyé une réponse vide. Réessaie.');
      return J(res, 200, { ok: true, text, model: ECONOMIC_AI_MODEL });
    }
    if (p === '/api/me') return J(res, 200, { name:me.name, admin:me.admin, premium:!!DB.users[me.key]?.premium, nameGradient:DB.users[me.key]?.nameGradient||'none', roles:me.roles.map(roleView), permissions:[...new Set(me.permissions)], avatar:DB.users[me.key]?.avatar||'', bio:DB.users[me.key]?.bio||'', timeoutUntil:Number(DB.users[me.key]?.timeoutUntil)||0 });
    if (p === '/api/me/profile' && m === 'PATCH') {
      const u=DB.users[me.key];
      if(B.avatar!==undefined){
        const av=String(B.avatar||'');
        if(av && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(av)) throw E(400,'Photo de profil invalide');
        if(av.length>900000) throw E(400,'Photo de profil trop volumineuse');
        if(!u.premium && /data:image\/gif/i.test(av)) throw E(403,'Les avatars GIF sont réservés à Premium');
        
        u.avatar=av;
      }
      if(B.nameGradient!==undefined){
        const allowed=['none','sunset','ocean','neon','fire','candy','aurora'];
        if(!allowed.includes(B.nameGradient)) throw E(400,'Dégradé invalide');
        if(B.nameGradient!=='none'&&!u.premium) throw E(403,'Les dégradés de pseudo sont réservés à Premium');
        u.nameGradient=B.nameGradient;
      }
      if(B.bio!==undefined) u.bio=String(B.bio||'').slice(0,160);
      await save(); log(me.name,'modification profil', {title:me.name}, 'photo/bio/thème');
      return J(res,200,{ok:true,avatar:u.avatar||'',bio:u.bio||'',nameGradient:u.nameGradient||'none',premium:!!u.premium});
    }
    let prof=p.match(/^\/api\/profile\/([^/]+)$/); if(prof&&m==='GET'){ const key=decodeURIComponent(prof[1]).toLowerCase(),u=DB.users[key]; if(!u)throw E(404,'Utilisateur introuvable'); return J(res,200,{name:u.name,avatar:u.avatar||'',bio:u.bio||'',premium:!!u.premium,nameGradient:u.nameGradient||'none',roles:userRoles({...u,key}).map(roleView),created:u.created,stats:u.stats||{}}); }
    if (p === '/api/me/activity' && m === 'POST') { const sec=Math.max(0,Math.min(300,Number(B.seconds)||0)); DB.users[me.key].stats.totalSeconds+=sec; await save(); return J(res,200,{ok:true,stats:DB.users[me.key].stats}); }
    if (p === '/api/me/stats/search' && m === 'POST') { DB.users[me.key].stats.searches++; DB.users[me.key].stats.peopleFound+=Math.max(0,Math.min(100,Number(B.people)||0)); await save(); return J(res,200,{ok:true,stats:DB.users[me.key].stats}); }
    if (p === '/api/me/stats/course' && m === 'POST') { const cid=String(B.course||'').slice(0,60), key='course_'+cid; if(B.completed&&!DB.users[me.key].stats[key]){DB.users[me.key].stats.coursesCompleted++;DB.users[me.key].stats[key]=true;await save()} return J(res,200,{ok:true,stats:DB.users[me.key].stats}); }


    if (p === '/api/roles' && m === 'GET') return J(res,200,DB.roles.slice().sort((a,b)=>b.position-a.position).map(roleView));
    if (p === '/api/roles' && m === 'POST') { if(!hasPerm(me,'manage_roles')) throw E(403,'Permission requise : gérer les rôles'); const name=String(B.name||'').trim().slice(0,30), color=/^#[0-9a-f]{6}$/i.test(B.color)?B.color:'#8b96a3', permissions=Array.isArray(B.permissions)?B.permissions.filter(x=>ROLE_PERMS.includes(x)||x==='*'):[]; if(!name) throw E(400,'Nom du rôle requis'); const id='r_'+crypto.randomBytes(5).toString('hex'); const max=Math.max(0,...DB.roles.map(r=>r.position)); DB.roles.push({id,name,color,position:Math.min(99,Number.isFinite(+B.position)?Math.max(1,Math.min(99,+B.position)):max+1),permissions,hoist:!!B.hoist,mentionable:!!B.mentionable}); await save(); return J(res,200,roleView(DB.roles.at(-1))); }
    if (p.startsWith('/api/roles/') && m === 'PATCH') { if(!hasPerm(me,'manage_roles')) throw E(403,'Permission requise : gérer les rôles'); const id=p.split('/')[3], role=roleById(id); if(!role||id==='owner') throw E(404,'Rôle non modifiable'); if(B.name!==undefined) role.name=String(B.name).trim().slice(0,30)||role.name; if(/^#[0-9a-f]{6}$/i.test(B.color||'')) role.color=B.color; if(Array.isArray(B.permissions)) role.permissions=B.permissions.filter(x=>ROLE_PERMS.includes(x)||x==='*'); if(B.position!==undefined&&Number.isFinite(+B.position)) role.position=Math.max(1,Math.min(99,+B.position)); if(B.hoist!==undefined)role.hoist=!!B.hoist; if(B.mentionable!==undefined)role.mentionable=!!B.mentionable; await save(); return J(res,200,roleView(role)); }
    if (p.startsWith('/api/roles/') && m === 'DELETE') { if(!hasPerm(me,'manage_roles')) throw E(403,'Permission requise : gérer les rôles'); const id=p.split('/')[3]; if(['owner','member'].includes(id)) throw E(400,'Ce rôle système ne peut pas être supprimé'); const i=DB.roles.findIndex(r=>r.id===id); if(i<0) throw E(404,'Rôle introuvable'); DB.roles.splice(i,1); Object.values(DB.users).forEach(u=>u.roles=(u.roles||[]).filter(x=>x!==id).concat((u.roles||[]).filter(x=>x==='member').length?[]:['member'])); await save(); return J(res,200,{ok:true}); }
    if (p === '/api/users' && m === 'GET') { if(!hasPerm(me,'manage_users')) throw E(403,'Permission requise : gérer les utilisateurs'); return J(res,200,Object.entries(DB.users).map(([key,u])=>({key,name:u.name,roles:userRoles({...u,key}).map(roleView),created:u.created}))); }
    let ur=p.match(/^\/api\/users\/([^/]+)\/roles$/); if(ur && m==='POST'){ if(!hasPerm(me,'manage_users')) throw E(403,'Permission requise : gérer les utilisateurs'); const key=decodeURIComponent(ur[1]).toLowerCase(), u=DB.users[key]; if(!u) throw E(404,'Utilisateur introuvable'); if(key==='lost') throw E(400,'Le propriétaire garde son rôle'); const roles=Array.isArray(B.roles)?B.roles.filter(id=>roleById(id)&&id!=='owner') : ['member']; u.roles=roles.length?roles:['member']; await save(); return J(res,200,{ok:true,name:u.name,roles:userRoles({...u,key}).map(roleView)}); }

    /* ---- salons ---- */
    if (p === '/api/channels' && m === 'GET') return J(res,200,DB.channels.slice().sort((a,b)=>a.position-b.position).map(channelView));
    if (p === '/api/channels' && m === 'POST') { if(!hasPerm(me,'manage_channels')) throw E(403,'Permission requise : gérer les salons'); const name=String(B.name||'').trim().slice(0,40); const type=B.type==='voice'?'voice':'text'; if(!name)throw E(400,'Nom du salon requis'); let id=safeId(name); if(DB.channels.some(c=>c.id===id))id+='-'+crypto.randomBytes(2).toString('hex'); const max=Math.max(-1,...DB.channels.map(c=>c.position)); const c={id,name,type,position:max+1,readonly:type==='text'&&!!B.readonly,permission:type==='text'&&B.permission==='post_announcements'?'post_announcements':null}; DB.channels.push(c); log(me.name,'salon créé',{title:c.name},c.type); await save(); return J(res,200,channelView(c)); }
    let ch=p.match(/^\/api\/channels\/([^/]+)$/); if(ch&&m==='PATCH'){ if(!hasPerm(me,'manage_channels'))throw E(403,'Permission requise : gérer les salons'); const c=channelById(decodeURIComponent(ch[1])); if(!c)throw E(404,'Salon introuvable'); if(B.name!==undefined)c.name=String(B.name).trim().slice(0,40)||c.name; if(B.position!==undefined&&Number.isFinite(+B.position))c.position=Math.max(0,+B.position); if(c.type==='text'){if(B.readonly!==undefined)c.readonly=!!B.readonly;if(B.permission!==undefined)c.permission=B.permission==='post_announcements'?'post_announcements':null;} log(me.name,'salon modifié',{title:c.name}); await save(); return J(res,200,channelView(c)); }
    if(ch&&m==='DELETE'){ if(!hasPerm(me,'manage_channels'))throw E(403,'Permission requise : gérer les salons'); const id=decodeURIComponent(ch[1]); if(id==='general'||id==='vocal-general')throw E(400,'Ce salon système ne peut pas être supprimé'); const i=DB.channels.findIndex(c=>c.id===id); if(i<0)throw E(404,'Salon introuvable'); const removed=DB.channels[i]; DB.channels.splice(i,1); delete DB.chat[id]; VOICE.delete(id); voiceSignals.delete(id); log(me.name,'salon supprimé',{title:removed.name},removed.type); await save(); return J(res,200,{ok:true}); }

    /* ---- modération texte / vocal ---- */
    let mod=p.match(/^\/api\/moderation\/([^/]+)$/); if(mod&&m==='POST'){ const key=decodeURIComponent(mod[1]).toLowerCase(),u=DB.users[key]; if(!u)throw E(404,'Utilisateur introuvable'); if(key==='lost')throw E(400,'Le propriétaire ne peut pas être modéré'); const action=String(B.action||''); if(action==='timeout'){if(!hasPerm(me,'moderate_members'))throw E(403,'Permission requise : modérer les membres');} else if(action==='server_mute'||action==='server_deafen'||action==='clear'){if(!hasPerm(me,'mute_members')&&!hasPerm(me,'moderate_members'))throw E(403,'Permission requise : modérer les membres');} if(action==='timeout'){const mins=Math.max(1,Math.min(1440,+B.minutes||10));u.timeoutUntil=Math.max(Date.now(),Number(u.timeoutUntil)||0)+mins*60000;} else if(action==='untimeout'){if(!hasPerm(me,'moderate_members'))throw E(403,'Permission requise : modérer les membres');u.timeoutUntil=0;} else if(action==='server_mute')u.serverMuted=!!B.value; else if(action==='server_deafen')u.serverDeafened=!!B.value; else if(action==='clear'){u.timeoutUntil=0;u.serverMuted=false;u.serverDeafened=false;} else throw E(400,'Action de modération inconnue'); log(me.name,'modération',{title:u.name},action+(action==='timeout'?` ${Math.max(1,Math.min(1440,+B.minutes||10))} min`:'')); await save(); return J(res,200,{ok:true}); }

    /* ---- vocal WebRTC : signalisation légère, sans stockage persistant ---- */
    let vr=p.match(/^\/api\/voice\/([^/]+)(?:\/([^/]+))?$/); if(vr){
      const id=decodeURIComponent(vr[1]), action=vr[2]||'', c=channelById(id); if(!c||c.type!=='voice')throw E(404,'Salon vocal introuvable');
      const room=voiceRoom(id); pruneVoice(id);
      const view=x=>({key:x.key,name:x.name,roles:x.roles,avatar:DB.users[x.key]?.avatar||'',serverMuted:!!DB.users[x.key]?.serverMuted,serverDeafened:!!DB.users[x.key]?.serverDeafened,timeoutUntil:DB.users[x.key]?.timeoutUntil||0});
      const removeFromOtherRooms=()=>{for(const [rid,r] of VOICE){if(rid!==id)r.delete(me.key)}};
      if(m==='POST'&&action==='join'){removeFromOtherRooms();room.set(me.key,{key:me.key,name:me.name,roles:me.roles.map(roleView),lastSeen:Date.now()});return J(res,200,{peers:[...room.values()].map(view)});}
      if(m==='POST'&&action==='leave'){for(const r of VOICE.values())r.delete(me.key);return J(res,200,{ok:true});}
      if(m==='GET'&&action==='members'){return J(res,200,{peers:[...room.values()].map(view)});}
      if((m==='GET'||m==='POST')&&action==='heartbeat'){if(room.has(me.key))room.get(me.key).lastSeen=Date.now();return J(res,200,{peers:[...room.values()].map(view)});}
      if(m==='GET'&&!action){return J(res,200,{peers:[...room.values()].map(view)});}
      if(m==='POST'&&action==='signal'){if(room.has(me.key))room.get(me.key).lastSeen=Date.now();const to=String(B.to||'');if(!room.has(to))return J(res,200,{ok:false});signalRoom(id).push({id:crypto.randomUUID(),ts:Date.now(),from:me.key,to,type:String(B.type||''),payload:B.payload});return J(res,200,{ok:true});}
      if(m==='GET'&&action==='signals'){if(room.has(me.key))room.get(me.key).lastSeen=Date.now();const sig=signalRoom(id).filter(x=>x.to===me.key&&x.from!==me.key);return J(res,200,{signals:sig});}
    }
    /* ---- mises à jour ---- */
    if (p === '/api/updates' && m === 'GET') return J(res, 200, DB.updates.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.ts-a.ts));
    if (p === '/api/updates' && m === 'POST') {
      if (!hasPerm(me,'publish_updates')) throw E(403, 'Permission insuffisante : publier des mises à jour');
      const title = String(B.title || '').trim().slice(0, 80), text = String(B.text || '').trim().slice(0, 2000);
      if (!title || !text) throw E(400, 'Titre et texte requis');
      DB.updates.unshift({ id: crypto.randomUUID(), ts: Date.now(), author: me.name, title, text, pinned: !!B.pinned });
      DB.updates = DB.updates.slice(0, 200);
      await save(); return J(res, 200, { ok: true });
    }

    /* ---- enregistrements (contenu chiffré côté navigateur) ---- */
    if (p === '/api/records' && m === 'GET') return J(res, 200, DB.records.map(({ salt, iv, data, ...x }) => x));
    if (p === '/api/records' && m === 'POST') {
      const { type, title, meta, salt, iv, data } = B;
      if (!['graphe', 'carte', 'image'].includes(type) || ![salt, iv, data].every(x => typeof x === 'string')) throw E(400, 'Enregistrement invalide');
      const rec = { id: crypto.randomUUID(), type, title: String(title || 'Sans titre').slice(0, 80), author: me.name, ts: Date.now(), meta: String(meta || '').slice(0, 120), pinned: false, salt, iv, data };
      DB.records.unshift(rec); log(me.name, 'création', rec, rec.meta); save().catch(e=>console.error('Sauvegarde enregistrement:',e)); const { salt: a, iv: b, data: c, ...pub } = rec; return J(res, 200, pub);
    }
    let r = p.match(/^\/api\/records\/([\w-]+)(\/pin)?$/);
    if (r) {
      const rec = DB.records.find(x => x.id === r[1]); if (!rec) throw E(404, 'Introuvable');
      if (r[2] && m === 'POST') { if (!hasPerm(me,'pin_records')) throw E(403, 'Permission insuffisante : épingler'); rec.pinned = !!B.pinned; log(me.name, rec.pinned ? 'épinglé' : 'désépinglé', rec); await save(); return J(res, 200, { ok: true }); }
      if (rec.author !== me.name) { log(me.name, 'accès refusé', rec, 'tentative sur un enregistrement privé'); throw E(403, 'Accès réservé au propriétaire'); }
      if (m === 'GET') return J(res, 200, { type: rec.type, title: rec.title, salt: rec.salt, iv: rec.iv, data: rec.data });
      if (m === 'DELETE') { DB.records = DB.records.filter(x => x !== rec); log(me.name, 'suppression', rec); await save(); return J(res, 200, { ok: true }); }
    }
    /* ---- chat ---- */
    let cr=p.match(/^\/api\/chat\/([^/]+)(?:\/([^/]+))(?:\/(reaction))?$/);
    let croot=p.match(/^\/api\/chat\/([^/]+)$/);
    if(croot || cr){
      const roomId=decodeURIComponent((croot||cr)[1]);
      const channel=channelById(roomId);
      if(!channel || channel.type!=='text') throw E(404,'Salon texte introuvable');
      DB.chat[roomId] ??= [];
      if(croot && m==='GET') {
        return J(res,200,DB.chat[roomId].slice(-300).map(x=>({...x,roles:(x.roles||[]).map(roleView),timeoutUntil:Number(DB.users[x.key]?.timeoutUntil)||0})));
      }
      if(croot && m==='POST') {
        if(channel.readonly && !hasPerm(me,'post_announcements')) throw E(403,'Ce salon est en lecture seule');
        if(DB.users[me.key]?.timeoutUntil>Date.now()) throw E(403,'Tu es temporairement limité.');
        const rawText=String(B.text||'').trim().slice(0,2000);
        if(!rawText) throw E(400,'Message vide');
        const violation=detectModerationViolation(rawText);
        if(violation && me.key!=='lost' && !hasPerm(me,'moderate_chat')) await applyAutoModeration(me,rawText,roomId,violation);
        const text=filterProfanity(rawText).slice(0,2000);
        const now=Date.now(), antiKey=me.key+'|'+roomId, recent=chatAntiSpam.get(antiKey)||{times:[],lastAt:0,lastText:''};
        recent.times=recent.times.filter(ts=>now-ts<10000);
        if(now-recent.lastAt<1500) throw E(429,'Anti-spam : attends une seconde avant de renvoyer un message.');
        if(recent.lastText===text.toLowerCase()&&now-recent.lastAt<15000) throw E(429,'Anti-spam : tu viens déjà d’envoyer ce message.');
        if(recent.times.length>=5) throw E(429,'Anti-spam : maximum 5 messages en 10 secondes. Réessaie dans quelques instants.');
        recent.times.push(now); recent.lastAt=now; recent.lastText=text.toLowerCase(); chatAntiSpam.set(antiKey,recent);
        if(chatAntiSpam.size>5000){for(const [k,v] of chatAntiSpam)if(!v.times.some(ts=>now-ts<10000))chatAntiSpam.delete(k);}
        const msg={id:crypto.randomUUID(),key:me.key,u:me.name,avatar:DB.users[me.key]?.avatar||'',premium:!!DB.users[me.key]?.premium,nameGradient:DB.users[me.key]?.nameGradient||'none',admin:me.admin,roles:me.roles.map(roleView),text,ts:Date.now(),pinned:false,reactions:{}};
        DB.chat[roomId].push(msg); DB.chat[roomId]=DB.chat[roomId].slice(-500);
        save().catch(e=>console.error('Sauvegarde message chat:',e)); return J(res,200,msg);
      }
      if(cr && cr[3]==='reaction' && m==='POST') {
        const msg=DB.chat[roomId].find(x=>x.id===cr[2]); if(!msg) throw E(404,'Message introuvable');
        const emoji=String(B.emoji||'').slice(0,8); if(!emoji) throw E(400,'Réaction invalide');
        msg.reactions ??= {}; msg.reactions[emoji] ??= [];
        const a=msg.reactions[emoji], i=a.indexOf(me.key); if(i>=0)a.splice(i,1);else a.push(me.key);
        save().catch(e=>console.error('Sauvegarde réaction chat:',e)); return J(res,200,{ok:true,reactions:msg.reactions});
      }
      if(cr && !cr[3]) {
        const msg=DB.chat[roomId].find(x=>x.id===cr[2]); if(!msg) throw E(404,'Message introuvable');
        if(m==='PATCH' && Object.prototype.hasOwnProperty.call(B,'text')) { if(msg.key!==me.key) throw E(403,'Tu peux modifier uniquement tes propres messages'); const text=String(B.text||'').trim(); if(!text) throw E(400,'Message vide'); if(text.length>500) throw E(400,'500 caractères maximum'); msg.text=text; msg.editedAt=Date.now(); save().catch(e=>console.error('Sauvegarde modification message:',e)); return J(res,200,{ok:true,editedAt:msg.editedAt}); }
        if(m==='DELETE') { if(msg.key!==me.key && !hasPerm(me,'moderate_chat')) throw E(403,'Permission insuffisante : modérer les messages'); DB.chat[roomId]=DB.chat[roomId].filter(x=>x!==msg); await save(); return J(res,200,{ok:true}); }
        if(m==='PATCH') { if(!hasPerm(me,'pin_records')) throw E(403,'Permission insuffisante : épingler'); msg.pinned=!!B.pinned; await save(); return J(res,200,{ok:true}); }
      }
    }
    /* ---- journal ---- */
    if (p === '/api/logs' && m === 'GET') { if(!hasPerm(me,'view_logs')) throw E(403,'Permission insuffisante : voir les logs'); return J(res,200,DB.logs.slice(-300)); }
    if (p === '/api/log' && m === 'POST') {
      if (!['analyse', 'accès refusé', 'ouverture'].includes(B.action)) throw E(400, 'Action inconnue');
      log(me.name, B.action, { title: String(B.title || '').slice(0, 80) }, B.detail); return J(res, 200, { ok: true });
    }
    throw E(404, 'Route inconnue');
  } catch (e) { J(res, e.code && e.code < 600 ? e.code : 500, { error: e.code && e.code < 600 ? e.message : 'Erreur serveur' }); }
});

loadPersistentDB().then(() => {
  httpServer.listen(PORT, '0.0.0.0', () => console.log(`GeoInt prêt sur http://localhost:${PORT}` + (ADMIN_CODE ? '' : '  (⚠ ADMIN_CODE non défini : le compte Lost ne pourra pas être créé)')));
}).catch(err => {
  console.error('ERREUR FATALE : la base persistante est indisponible.', err);
  process.exit(1);
});
