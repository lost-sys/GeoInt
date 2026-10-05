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
  d.users ??= {}; d.sessions ??= {}; d.records ??= []; d.logs ??= []; d.chat ??= {};
  d.updates ??= defaults().updates; d.seq ??= 0; d.roles ??= defaults().roles; d.channels ??= defaults().channels;
  Object.values(d.users).forEach(u=>{ if(!Array.isArray(u.roles)||!u.roles.length) u.roles=['member']; });
  if(d.users.lost) d.users.lost.roles=['owner'];
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
  saving = saving.then(persistNow).catch(e=>{ console.error('ERREUR PERSISTANCE:',e); throw e; });
  return saving;
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
const fails = {}, tooMany = k => fails[k] && fails[k].n >= 5 && Date.now() - fails[k].t < 60000;
const bad = k => { const f = fails[k] = fails[k] && Date.now() - fails[k].t < 60000 ? fails[k] : { n: 0 }; f.n++; f.t = Date.now(); };
const lastMsg = {};
const STATIC = { '/': ['geoint-v7.html', 'text/html; charset=utf-8'], '/index.html': ['geoint-v7.html', 'text/html; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
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
    const B = m === 'POST' ? await body(req) : {};
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
      const salt = crypto.randomBytes(16).toString('hex'); DB.users[key] = { name, salt, hash: hash(B.password, salt), created: Date.now(), roles: key==='lost'?['owner']:['member'], avatar:'', bio:'', serverMuted:false, serverDeafened:false, timeoutUntil:0 };
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
    if (p === '/api/me') return J(res, 200, { name:me.name, admin:me.admin, roles:me.roles.map(roleView), permissions:[...new Set(me.permissions)], avatar:DB.users[me.key]?.avatar||'', bio:DB.users[me.key]?.bio||'' });
    if (p === '/api/me/profile' && m === 'PATCH') {
      const u=DB.users[me.key];
      if(B.avatar!==undefined){ const av=String(B.avatar||''); if(av && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(av)) throw E(400,'Photo de profil invalide'); if(av.length>900000) throw E(400,'Photo de profil trop volumineuse'); u.avatar=av; }
      if(B.bio!==undefined) u.bio=String(B.bio||'').slice(0,160);
      await save(); log(me.name,'modification profil', {title:me.name}, 'photo/bio');
      return J(res,200,{ok:true,avatar:u.avatar||'',bio:u.bio||''});
    }
    let prof=p.match(/^\/api\/profile\/([^/]+)$/); if(prof&&m==='GET'){ const key=decodeURIComponent(prof[1]).toLowerCase(),u=DB.users[key]; if(!u)throw E(404,'Utilisateur introuvable'); return J(res,200,{name:u.name,avatar:u.avatar||'',bio:u.bio||'',roles:userRoles({...u,key}).map(roleView),created:u.created}); }
    if (p === '/api/me/password' && m === 'PATCH') { const pw=String(B.password||''); if(pw.length<8)throw E(400,'Mot de passe : 8 caractères minimum'); const u=DB.users[me.key],salt=crypto.randomBytes(16).toString('hex'); u.salt=salt;u.hash=hash(pw,salt); await save(); log(me.name,'mot de passe modifié'); return J(res,200,{ok:true}); }

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
    let mod=p.match(/^\/api\/moderation\/([^/]+)$/); if(mod&&m==='POST'){ const key=decodeURIComponent(mod[1]).toLowerCase(),u=DB.users[key]; if(!u)throw E(404,'Utilisateur introuvable'); if(key==='lost')throw E(400,'Le propriétaire ne peut pas être modéré'); const action=String(B.action||''); if(action==='timeout'){if(!hasPerm(me,'moderate_members'))throw E(403,'Permission requise : modérer les membres');} else if(action==='server_mute'||action==='server_deafen'||action==='clear'){if(!hasPerm(me,'mute_members')&&!hasPerm(me,'moderate_members'))throw E(403,'Permission requise : modérer les membres');} if(action==='timeout'){const mins=Math.max(1,Math.min(1440,+B.minutes||10));u.timeoutUntil=Date.now()+mins*60000;} else if(action==='server_mute')u.serverMuted=!!B.value; else if(action==='server_deafen')u.serverDeafened=!!B.value; else if(action==='clear'){u.timeoutUntil=0;u.serverMuted=false;u.serverDeafened=false;} else throw E(400,'Action de modération inconnue'); log(me.name,'modération',{title:u.name},action+(action==='timeout'?` ${Math.max(1,Math.min(1440,+B.minutes||10))} min`:'')); await save(); return J(res,200,{ok:true}); }

    /* ---- vocal WebRTC : signalisation légère, sans stockage persistant ---- */
    let vr=p.match(/^\/api\/voice\/([^/]+)(?:\/([^/]+))?$/); if(vr){ const id=decodeURIComponent(vr[1]), c=channelById(id); if(!c||c.type!=='voice')throw E(404,'Salon vocal introuvable'); const room=voiceRoom(id); pruneVoice(id); if(m==='POST'&&vr[2]==='join'){room.set(me.key,{key:me.key,name:me.name,roles:me.roles.map(roleView),lastSeen:Date.now()});return J(res,200,{peers:[...room.values()].map(x=>({key:x.key,name:x.name,roles:x.roles,serverMuted:!!DB.users[x.key]?.serverMuted,serverDeafened:!!DB.users[x.key]?.serverDeafened,timeoutUntil:DB.users[x.key]?.timeoutUntil||0}))});} if(m==='POST'&&vr[2]==='leave'){room.delete(me.key);return J(res,200,{ok:true});} if(m==='GET'&&!vr[2]){room.set(me.key,{key:me.key,name:me.name,roles:me.roles.map(roleView),lastSeen:Date.now()});return J(res,200,{peers:[...room.values()].map(x=>({key:x.key,name:x.name,roles:x.roles,serverMuted:!!DB.users[x.key]?.serverMuted,serverDeafened:!!DB.users[x.key]?.serverDeafened,timeoutUntil:DB.users[x.key]?.timeoutUntil||0}))});} if(m==='POST'&&vr[2]==='signal'){const to=String(B.to||''); if(!room.has(to))return J(res,200,{ok:false}); signalRoom(id).push({id:crypto.randomUUID(),ts:Date.now(),from:me.key,to,type:String(B.type||''),payload:B.payload}); return J(res,200,{ok:true});} if(m==='GET'&&vr[2]==='signals'){room.set(me.key,{...(room.get(me.key)||{}),key:me.key,name:me.name,roles:me.roles.map(roleView),lastSeen:Date.now()}); const sig=signalRoom(id).filter(x=>x.to===me.key&&x.from!==me.key); return J(res,200,{signals:sig});} }

    /* ---- chat ---- */
    let r = p.match(/^\/api\/chat\/([^/]+)(?:\/(\d+))?$/);
    if (r) {
      const roomId=decodeURIComponent(r[1]), room=channelById(roomId); if(!room||room.type!=='text') throw E(404,'Salon inconnu'); const list = DB.chat[roomId] ??= [];
      if (m === 'GET') { const since = +u.searchParams.get('since') || 0; return J(res, 200, list.filter(x => x.id > since).slice(-200)); }
      if (m === 'POST') {
        const now=Date.now(); const us=DB.users[me.key]; if(us?.timeoutUntil>now)throw E(403,`Tu es temporairement réduit au silence jusqu'à ${new Date(us.timeoutUntil).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`); if(room.permission && !hasPerm(me,room.permission)) throw E(403,'Permission insuffisante pour ce salon'); if(room.readonly&&!hasPerm(me,'moderate_chat'))throw E(403,'Ce salon est en lecture seule');
        const text=filterProfanity(String(B.text||'').trim().slice(0,500)); if(!text)throw E(400,'Message vide'); if(Date.now()-(lastMsg[me.key]||0)<800)throw E(429,'Doucement !'); lastMsg[me.key]=Date.now();
        list.push({id:++DB.seq,ts:Date.now(),u:me.name,key:me.key,admin:me.admin,roles:me.roles.map(roleView),avatar:DB.users[me.key]?.avatar||'',text,pinned:false,reactions:{}}); DB.chat[roomId]=list.slice(-500); await save(); return J(res,200,{ok:true});
      }
      if(m==='DELETE'&&r[2]){const i=list.findIndex(x=>x.id===+r[2]);if(i<0)throw E(404,'Introuvable');if(!hasPerm(me,'moderate_chat')&&list[i].u!==me.name)throw E(403,'Interdit');const gone=list[i];list.splice(i,1);log(me.name,'message supprimé',{title:room.name},gone.u);await save();return J(res,200,{ok:true});}
      if(m==='PATCH'&&r[2]){const msg=list.find(x=>x.id===+r[2]);if(!msg)throw E(404,'Introuvable');if(!hasPerm(me,'pin_records')&&!hasPermissionForChat(me))throw E(403,'Permission insuffisante'); if(B.pinned!==undefined){msg.pinned=!!B.pinned;log(me.name,msg.pinned?'message épinglé':'message désépinglé',{title:room.name},String(msg.id));} await save();return J(res,200,{ok:true,message:msg});}
      let rr=p.match(/^\/api\/chat\/([^/]+)\/(\d+)\/reaction$/); if(rr&&m==='POST'){const msg=list.find(x=>x.id===+rr[2]);if(!msg)throw E(404,'Message introuvable');const emoji=String(B.emoji||'').slice(0,8);if(!emoji)throw E(400,'Réaction invalide');msg.reactions??={};msg.reactions[emoji]??=[];const a=msg.reactions[emoji],idx=a.indexOf(me.key);idx>=0?a.splice(idx,1):a.push(me.key);await save();return J(res,200,{ok:true,reactions:msg.reactions});}

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
      if (!['graphe', 'carte'].includes(type) || ![salt, iv, data].every(x => typeof x === 'string')) throw E(400, 'Enregistrement invalide');
      const rec = { id: crypto.randomUUID(), type, title: String(title || 'Sans titre').slice(0, 80), author: me.name, ts: Date.now(), meta: String(meta || '').slice(0, 120), pinned: false, salt, iv, data };
      DB.records.unshift(rec); log(me.name, 'création', rec, rec.meta); await save(); const { salt: a, iv: b, data: c, ...pub } = rec; return J(res, 200, pub);
    }
    r = p.match(/^\/api\/records\/([\w-]+)(\/pin)?$/);
    if (r) {
      const rec = DB.records.find(x => x.id === r[1]); if (!rec) throw E(404, 'Introuvable');
      if (r[2] && m === 'POST') { if (!hasPerm(me,'pin_records')) throw E(403, 'Permission insuffisante : épingler'); rec.pinned = !!B.pinned; log(me.name, rec.pinned ? 'épinglé' : 'désépinglé', rec); await save(); return J(res, 200, { ok: true }); }
      if (rec.author !== me.name) { log(me.name, 'accès refusé', rec, 'tentative sur un enregistrement privé'); throw E(403, 'Accès réservé au propriétaire'); }
      if (m === 'GET') return J(res, 200, { type: rec.type, title: rec.title, salt: rec.salt, iv: rec.iv, data: rec.data });
      if (m === 'DELETE') { DB.records = DB.records.filter(x => x !== rec); log(me.name, 'suppression', rec); await save(); return J(res, 200, { ok: true }); }
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
