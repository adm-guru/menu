
const BASE_DB_NAME = 'siaga_guru_db';
const AUTH_DB_NAME = 'siaga_guru_auth';
const DB_VERSION = 9;
const AUTH_DB_VERSION = 1;
let db;
let authDb;
let activeWorkspaceDbName = BASE_DB_NAME;
let activeLocalUser = null;
let deferredPrompt = null;
const DEFAULT_UI_SCALE='70';
try{document.documentElement.dataset.uiScale=localStorage.getItem('siaga_ui_scale')||DEFAULT_UI_SCALE}catch(_){document.documentElement.dataset.uiScale=DEFAULT_UI_SCALE}

const SIAGA_DESKTOP_RUNTIME = (()=>{
  try{
    const params = new URLSearchParams(window.location.search || '');
    if(params.get('desktop') === '1') return true;
    return window.location.hostname === '127.0.0.1' && window.location.port === '17631';
  }catch(_err){
    return false;
  }
})();
document.documentElement.dataset.runtime = SIAGA_DESKTOP_RUNTIME ? 'desktop' : 'web';
window.__SIAGA_DESKTOP__ = SIAGA_DESKTOP_RUNTIME;
if(SIAGA_DESKTOP_RUNTIME){
  document.title = 'SIAGA GURU Desktop';
  document.getElementById('installBtn')?.classList.add('hidden');
}

const STARTUP_TIMEOUT_MS = 7000;
const DB_OPEN_TIMEOUT_MS = 5000;

function withTimeout(promise,ms,label='Proses'){
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(()=>clearTimeout(timer)),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} melebihi batas waktu ${ms}ms`)),ms);
    })
  ]);
}

function dismissSplash(immediate=false){
  const splash=document.getElementById('appSplash');
  if(!splash) return;
  if(immediate){
    splash.classList.add('is-hidden');
    setTimeout(()=>splash.remove(),380);
    return;
  }
  requestAnimationFrame(()=>splash.classList.add('is-hidden'));
  setTimeout(()=>splash.remove(),700);
}

function forceShowLoginGate(message=''){
  const gate=document.getElementById('loginGate');
  if(!gate) return;
  document.body.classList.add('login-required');
  gate.classList.remove('hidden','login-leaving');
  gate.setAttribute('aria-hidden','false');
  const loginWrap=document.getElementById('loginModeWrap');
  const setupWrap=document.getElementById('setupAccountWrap');
  loginWrap?.classList.remove('hidden');
  setupWrap?.classList.add('hidden');
  if(message) setLoginMessage('loginMessage',message);
}


const pageTitles = {
  dashboard:'Beranda', students:'Data Siswa', attendance:'Absensi',
  journal:'Jurnal Mengajar', grades:'Daftar Nilai', homeroom:'Wali Kelas',
  reports:'Laporan', backup:'Backup & Restore', settings:'Pengaturan'
};

function openDB(dbName=activeWorkspaceDbName){
  if(db && db.name===dbName) return Promise.resolve(db);
  if(db){ try{db.close();}catch(_){} }
  activeWorkspaceDbName=dbName;

  const operation=new Promise((resolve,reject)=>{
    const req=indexedDB.open(dbName,DB_VERSION);

    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('profile')) d.createObjectStore('profile',{keyPath:'id'});
      if(!d.objectStoreNames.contains('students')) d.createObjectStore('students',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('attendance')) d.createObjectStore('attendance',{keyPath:'id'});
      if(!d.objectStoreNames.contains('journals')) d.createObjectStore('journals',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('assessments')) d.createObjectStore('assessments',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('grades')) d.createObjectStore('grades',{keyPath:'id'});
      if(!d.objectStoreNames.contains('homeroomProfiles')) d.createObjectStore('homeroomProfiles',{keyPath:'studentId'});
      if(!d.objectStoreNames.contains('homeroomNotes')) d.createObjectStore('homeroomNotes',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('teachingContexts')) d.createObjectStore('teachingContexts',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('academicSessions')) d.createObjectStore('academicSessions',{keyPath:'id'});
      if(!d.objectStoreNames.contains('appMeta')) d.createObjectStore('appMeta',{keyPath:'id'});
      if(!d.objectStoreNames.contains('studentEnrollments')) d.createObjectStore('studentEnrollments',{keyPath:'id'});
      if(!d.objectStoreNames.contains('syncQueue')) d.createObjectStore('syncQueue',{keyPath:'id',autoIncrement:true});
    };

    req.onsuccess=()=>{
      db=req.result;
      db.onversionchange=()=>{
        try{db.close()}catch(_){}
        db=null;
      };
      resolve(db);
    };
    req.onerror=()=>reject(req.error||new Error(`Database ${dbName} gagal dibuka`));
    req.onblocked=()=>reject(new Error(`Database ${dbName} sedang dipakai tab lain`));
  });

  return withTimeout(operation,DB_OPEN_TIMEOUT_MS,`Membuka database ${dbName}`);
}

function openAuthDB(){
  if(authDb) return Promise.resolve(authDb);

  const operation=new Promise((resolve,reject)=>{
    const req=indexedDB.open(AUTH_DB_NAME,AUTH_DB_VERSION);

    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('users')) d.createObjectStore('users',{keyPath:'username'});
      if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta',{keyPath:'id'});
    };

    req.onsuccess=()=>{
      authDb=req.result;
      authDb.onversionchange=()=>{
        try{authDb.close()}catch(_){}
        authDb=null;
      };
      resolve(authDb);
    };
    req.onerror=()=>reject(req.error||new Error('Database akun gagal dibuka'));
    req.onblocked=()=>reject(new Error('Database akun sedang dipakai tab lain'));
  });

  return withTimeout(operation,DB_OPEN_TIMEOUT_MS,'Membuka database akun');
}
function authStore(name,mode='readonly'){return authDb.transaction(name,mode).objectStore(name)}
function authGet(storeName,key){
  return new Promise((resolve,reject)=>{const r=authStore(storeName).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
}
function authGetAll(storeName){
  return new Promise((resolve,reject)=>{const r=authStore(storeName).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});
}
function authPut(storeName,value){
  return new Promise((resolve,reject)=>{const r=authStore(storeName,'readwrite').put(value);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
}
function authDelete(storeName,key){
  return new Promise((resolve,reject)=>{const r=authStore(storeName,'readwrite').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)});
}

function store(name, mode='readonly'){ return db.transaction(name,mode).objectStore(name); }

function idbGet(storeName,key){
  return new Promise((resolve,reject)=>{
    const r=store(storeName).get(key); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
function idbGetAll(storeName){
  return new Promise((resolve,reject)=>{
    const r=store(storeName).getAll(); r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error);
  });
}
function idbPut(storeName,value){
  const prepared=cloudDecorateRecord(storeName,value);
  return new Promise((resolve,reject)=>{const r=store(storeName,'readwrite').put(prepared);r.onsuccess=async()=>{try{await enqueueCloudChange(storeName,prepared,'upsert')}catch(err){console.warn('Antrean cloud gagal',err)}resolve(r.result)};r.onerror=()=>reject(r.error)});
}
function idbAdd(storeName,value){
  const prepared=cloudDecorateRecord(storeName,value);
  return new Promise((resolve,reject)=>{const r=store(storeName,'readwrite').add(prepared);r.onsuccess=async()=>{try{const queued={...prepared};if(queued.id==null)queued.id=r.result;await enqueueCloudChange(storeName,queued,'upsert')}catch(err){console.warn('Antrean cloud gagal',err)}resolve(r.result)};r.onerror=()=>reject(r.error)});
}
async function idbDelete(storeName,key){
  let previous=null;try{previous=await idbGet(storeName,key)}catch(_){}
  await new Promise((resolve,reject)=>{const r=store(storeName,'readwrite').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)});
  try{await enqueueCloudChange(storeName,previous||{id:key,cloudId:null},'delete')}catch(err){console.warn('Antrean hapus cloud gagal',err)}
}
function idbClear(storeName){
  return new Promise((resolve,reject)=>{
    const r=store(storeName,'readwrite').clear(); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error);
  });
}

const CLOUD_SYNCABLE_STORES=new Set([
  'profile','students','attendance','journals','assessments','grades',
  'homeroomProfiles','homeroomNotes','teachingContexts',
  'academicSessions','studentEnrollments'
]);
let cloudRuntime={mode:'local',enabled:false,config:null,suppressQueue:false};

function makeCloudId(){
  try{if(globalThis.crypto?.randomUUID) return crypto.randomUUID();}catch(_){}
  return 'sg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
}
function cloudDecorateRecord(storeName,value){
  if(!CLOUD_SYNCABLE_STORES.has(storeName)||!value||typeof value!=='object') return value;
  const next={...value};
  if(!next.cloudId) next.cloudId=makeCloudId();
  next.updatedAt=new Date().toISOString();
  next.syncState=cloudRuntime.enabled?'pending':(next.syncState||'local');
  return next;
}
async function enqueueCloudChange(storeName,record,operation='upsert'){
  if(!cloudRuntime.enabled||cloudRuntime.suppressQueue||!CLOUD_SYNCABLE_STORES.has(storeName)) return;
  if(!db?.objectStoreNames.contains('syncQueue')) return;
  const queueItem={storeName,operation,cloudId:record?.cloudId||null,localKey:record?.id??record?.studentId??null,payload:operation==='delete'?null:record,createdAt:new Date().toISOString(),attempts:0,state:'pending'};
  await new Promise((resolve,reject)=>{const r=store('syncQueue','readwrite').add(queueItem);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
}
async function cloudQueueCount(){
  if(!db?.objectStoreNames.contains('syncQueue')) return 0;
  return new Promise((resolve,reject)=>{const r=store('syncQueue').count();r.onsuccess=()=>resolve(r.result||0);r.onerror=()=>reject(r.error)});
}
async function getCloudConfig(){
  const meta=await getAppMeta();
  const cfg=meta.cloudConfig||{};
  return {
    mode:cfg.mode||'local',
    enabled:cfg.mode==='cloud',
    supabaseUrl:cfg.supabaseUrl||'',
    anonKey:cfg.anonKey||'',
    schoolCode:cfg.schoolCode||'',
    deviceId:cfg.deviceId||makeCloudId(),
    lastSyncAt:cfg.lastSyncAt||null,
    connectionState:cfg.connectionState||'idle',
    autoSync:cfg.autoSync!==false,
    lastRemoteRevision:Number(cfg.lastRemoteRevision||0),
    syncConflict:cfg.syncConflict||null,
    lastAutoSyncAt:cfg.lastAutoSyncAt||null
  };
}
async function saveCloudConfig(patch={}){
  const meta=await getAppMeta();
  const previous=await getCloudConfig();
  const next={...previous,...patch};
  await idbPut('appMeta',{...meta,id:'main',cloudConfig:next});
  cloudRuntime={mode:next.mode,enabled:next.mode==='cloud',config:next,suppressQueue:false};
  await renderCloudStatus();
  return next;
}
async function initializeCloudRuntime(){
  try{
    const cfg=await getCloudConfig();
    const meta=await getAppMeta();
    if(!meta.cloudConfig?.deviceId){
      await idbPut('appMeta',{...meta,id:'main',cloudConfig:{...cfg,deviceId:cfg.deviceId}});
    }
    cloudRuntime={mode:cfg.mode,enabled:cfg.mode==='cloud',config:cfg,suppressQueue:false};
  }catch(err){
    console.warn('Cloud runtime tidak dapat diinisialisasi',err);
    cloudRuntime={mode:'local',enabled:false,config:null,suppressQueue:false};
  }
  await renderCloudStatus();
}
async function prepareCloudData(){
  const cfg=await getCloudConfig();
  if(cfg.mode!=='cloud') throw new Error('Aktifkan mode Cloud + Offline terlebih dahulu.');
  cloudRuntime.suppressQueue=true;
  const prepared=[];
  try{
    for(const storeName of CLOUD_SYNCABLE_STORES){
      if(!db.objectStoreNames.contains(storeName)) continue;
      const rows=await idbGetAll(storeName);
      for(const row of rows){
        const next={...row,cloudId:row.cloudId||makeCloudId(),updatedAt:row.updatedAt||new Date().toISOString(),syncState:'pending'};
        await new Promise((resolve,reject)=>{const r=store(storeName,'readwrite').put(next);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
        prepared.push([storeName,next]);
      }
    }
  }finally{cloudRuntime.suppressQueue=false;}
  for(const [storeName,row] of prepared) await enqueueCloudChange(storeName,row,'upsert');
  await renderCloudStatus();
}
function normalizeSupabaseUrl(url){return String(url||'').trim().replace(/\/+$/,'')}
async function testCloudConnection(){
  const cfg=await getCloudConfig();
  const url=normalizeSupabaseUrl(document.getElementById('cloudSupabaseUrl')?.value||cfg.supabaseUrl);
  const key=String(document.getElementById('cloudSupabaseAnonKey')?.value||cfg.anonKey||'').trim();
  if(!url||!key) throw new Error('Project URL dan anon/publishable key harus diisi.');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);

  try{
    const headers={apikey:key};
    // Legacy anon keys are JWTs (eyJ...). New sb_publishable_ keys should not
    // be sent as the user's Bearer token.
    if(key.startsWith('eyJ')) headers.Authorization=`Bearer ${key}`;

    const res=await fetch(`${url}/rest/v1/`,{
      method:'GET',
      headers,
      signal:controller.signal,
      cache:'no-store'
    });

    if(!res.ok){
      let detail='';
      try{
        const body=await res.text();
        detail=body?` • ${body.slice(0,140)}`:'';
      }catch(_){}
      throw new Error(`Supabase merespons HTTP ${res.status}${detail}`);
    }

    await saveCloudConfig({
      supabaseUrl:url,
      anonKey:key,
      schoolCode:String(document.getElementById('cloudSchoolCode')?.value||cfg.schoolCode||'').trim(),
      connectionState:'connected'
    });
    return true;
  }finally{
    clearTimeout(timer);
  }
}
async function renderCloudStatus(){
  const chip=document.getElementById('cloudSyncChip'); const badge=document.getElementById('cloudStatusBadge');
  if(!chip&&!badge) return;
  let cfg; try{cfg=await getCloudConfig()}catch(_){cfg={mode:'local',deviceId:'',lastSyncAt:null,connectionState:'idle',autoSync:true,syncConflict:null,lastRemoteRevision:0}}
  cloudRuntime={mode:cfg.mode,enabled:cfg.mode==='cloud',config:cfg,suppressQueue:false};
  const isCloud=cfg.mode==='cloud'; const hasConflict=Boolean(cfg.syncConflict);
  chip?.classList.toggle('cloud',isCloud); chip?.classList.toggle('local',!isCloud); chip?.classList.toggle('conflict',hasConflict);
  badge?.classList.toggle('cloud',isCloud); badge?.classList.toggle('local',!isCloud); badge?.classList.toggle('conflict',hasConflict);
  const chipLabel=document.getElementById('cloudSyncChipLabel'); const chipSub=document.getElementById('cloudSyncChipSub');
  if(chipLabel) chipLabel.textContent=hasConflict?'Perlu Pilihan':isCloud?'Cloud + Offline':'Lokal';
  if(chipSub) chipSub.textContent=hasConflict?'Data berbeda':isCloud?(cfg.connectionState==='connected'?(cfg.autoSync?'Auto sync aktif':'Sync manual'):'Belum terhubung'):'Perangkat ini';
  if(badge) badge.textContent=hasConflict?'Konflik Aman':isCloud?'Cloud + Offline':'Mode Lokal';
  document.getElementById('cloudConfigWrap')?.classList.toggle('hidden',!isCloud);
  document.querySelectorAll('[data-cloud-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.cloudMode===cfg.mode));
  const pairs=[['cloudSupabaseUrl',cfg.supabaseUrl],['cloudSupabaseAnonKey',cfg.anonKey],['cloudSchoolCode',cfg.schoolCode],['cloudDeviceId',cfg.deviceId]];
  for(const [id,val] of pairs){const el=document.getElementById(id);if(el&&!el.matches(':focus')) el.value=val||''}
  const rs=document.getElementById('cloudRemoteState'); const rd=document.getElementById('cloudRemoteDetail');
  if(rs) rs.textContent=!isCloud?'Belum aktif':hasConflict?'Perlu pilihan':cfg.connectionState==='connected'?'Terhubung':'Menunggu konfigurasi';
  if(rd) rd.textContent=!isCloud?'Supabase belum dikonfigurasi':hasConflict?'Perubahan PC dan HP sama-sama terdeteksi':cfg.connectionState==='connected'?(cfg.autoSync?'Sinkron otomatis siap':'Sinkron manual aktif'):'Isi Project URL dan key';
  try{const q=document.getElementById('cloudQueueCount');if(q)q.textContent=String(await cloudQueueCount())}catch(_){}
  const last=document.getElementById('cloudLastSync'); if(last) last.textContent=cfg.lastSyncAt?new Date(cfg.lastSyncAt).toLocaleString('id-ID'):'Belum pernah';

  const auto=document.getElementById('cloudAutoSyncEnabled'); if(auto) auto.checked=Boolean(cfg.autoSync);
  const autoState=document.getElementById('cloudAutoSyncState');
  if(autoState) autoState.textContent=hasConflict?'Dijeda: perlu pilihan':!isCloud?'Aktifkan Cloud + Offline':!cfg.autoSync?'Sinkron otomatis dimatikan':navigator.onLine?'Aktif • cek ±90 detik':'Menunggu internet';
  const conflictBox=document.getElementById('cloudConflictBox'); conflictBox?.classList.toggle('hidden',!hasConflict);
  const conflictText=document.getElementById('cloudConflictText');
  if(conflictText&&hasConflict){
    const when=cfg.syncConflict.remoteUpdatedAt?new Date(cfg.syncConflict.remoteUpdatedAt).toLocaleString('id-ID'):'waktu tidak diketahui';
    conflictText.textContent=`Cloud berubah dari perangkat lain (${when}), sementara perangkat ini juga memiliki perubahan. Pilih versi yang ingin dipertahankan.`;
  }

  const session=getCloudSession();
  const authBadge=document.getElementById('cloudAuthBadge');
  const authIdentity=document.getElementById('cloudAuthIdentity');
  const signOut=document.getElementById('cloudSignOutBtn');
  const signIn=document.getElementById('cloudSignInBtn');
  const signUp=document.getElementById('cloudSignUpBtn');
  const logged=Boolean(session?.access_token && session?.user);
  if(authBadge){authBadge.textContent=logged?'Cloud login aktif':'Belum login';authBadge.classList.toggle('online',logged);authBadge.classList.toggle('offline',!logged)}
  authIdentity?.classList.toggle('hidden',!logged);
  signOut?.classList.toggle('hidden',!logged);
  signIn?.classList.toggle('hidden',logged);
  signUp?.classList.toggle('hidden',logged);
  const emailEl=document.getElementById('cloudAuthUserEmail'); if(emailEl)emailEl.textContent=session?.user?.email||'-';
  const uidEl=document.getElementById('cloudAuthUserId'); if(uidEl)uidEl.textContent=session?.user?.id?`UID ${session.user.id.slice(0,8)}…`:'-';
}
function getCloudSession(){
  return activeLocalUser?.cloudSession||null;
}
async function saveCloudSession(session){
  if(!activeLocalUser) throw new Error('Akun lokal belum aktif.');
  activeLocalUser={...activeLocalUser,cloudSession:session||null};
  await authPut('users',activeLocalUser);
  await renderCloudStatus();
}
async function supabaseFetch(path,{method='GET',body=null,auth=True,prefer='',retryAuth=true}={}){
  const cfg=await getCloudConfig();
  const url=normalizeSupabaseUrl(cfg.supabaseUrl);
  if(!url||!cfg.anonKey) throw new Error('Konfigurasi Supabase belum lengkap.');
  const headers={apikey:cfg.anonKey,'Content-Type':'application/json'};
  const session=getCloudSession();
  if(auth){
    if(!session?.access_token) throw new Error('Silakan login Cloud terlebih dahulu.');
    headers.Authorization=`Bearer ${session.access_token}`;
  }else{headers.Authorization=`Bearer ${cfg.anonKey}`}
  if(prefer) headers.Prefer=prefer;
  const res=await fetch(`${url}${path}`,{method,headers,body:body==null?undefined:JSON.stringify(body)});
  let data=null; const text=await res.text();
  try{data=text?JSON.parse(text):null}catch(_){data=text}
  if(!res.ok){
    if(res.status===401 && auth && retryAuth && getCloudSession()?.refresh_token){
      await refreshCloudSession();
      return supabaseFetch(path,{method,body,auth,prefer,retryAuth:false});
    }
    const msg=data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${res.status}`;
    const err=new Error(msg);err.status=res.status;throw err;
  }
  return data;
}
async function refreshCloudSession(){
  const current=getCloudSession();
  if(!current?.refresh_token) throw new Error('Sesi Cloud berakhir. Silakan login kembali.');
  const data=await supabaseFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:current.refresh_token},auth:false,retryAuth:false});
  if(!data?.access_token) throw new Error('Sesi Cloud tidak dapat diperbarui.');
  const merged={...current,...data,user:data.user||current.user};
  await saveCloudSession(merged);
  return merged;
}
async function cloudSignUp(email,password){
  const data=await supabaseFetch('/auth/v1/signup',{method:'POST',body:{email,password},auth:false});
  if(data?.access_token) await saveCloudSession(data);
  return data;
}
async function cloudSignIn(email,password){
  const data=await supabaseFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});
  if(!data?.access_token) throw new Error('Supabase tidak memberikan sesi login.');
  await saveCloudSession(data);
  return data;
}
async function cloudSignOut(){
  const session=getCloudSession();
  if(session?.access_token){try{await supabaseFetch('/auth/v1/logout',{method:'POST'})}catch(_){}}
  await saveCloudSession(null);
}
async function clearCloudQueue(){
  if(db?.objectStoreNames.contains('syncQueue')) await idbClear('syncQueue');
}
async function markAllCloudRecordsSynced(){
  cloudRuntime.suppressQueue=true;
  try{
    for(const name of CLOUD_SYNCABLE_STORES){
      if(!db.objectStoreNames.contains(name))continue;
      const rows=await idbGetAll(name);
      for(const row of rows){
        if(row && typeof row==='object'){
          const next={...row,syncState:'synced'};
          await new Promise((resolve,reject)=>{const r=store(name,'readwrite').put(next);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)});
        }
      }
    }
  }finally{cloudRuntime.suppressQueue=false}
}
async function hasMeaningfulLocalWorkspace(){
  const names=['students','attendance','journals','assessments','grades','homeroomNotes','teachingContexts'];
  for(const name of names){
    if(!db?.objectStoreNames.contains(name)) continue;
    try{if((await idbGetAll(name)).length>0) return true}catch(_){}
  }
  return false;
}
async function cloudPushSnapshot(){
  const cfg=await getCloudConfig();
  const session=getCloudSession();
  if(cfg.mode!=='cloud') throw new Error('Mode Cloud + Offline belum aktif.');
  if(!session?.user?.id) throw new Error('Silakan login Cloud terlebih dahulu.');
  const snapshot=await collectWorkspaceSnapshot();
  const now=new Date().toISOString();
  const payload=[{user_id:session.user.id,school_code:cfg.schoolCode||null,device_id:cfg.deviceId||null,data:snapshot,updated_at:now}];
  const rows=await supabaseFetch('/rest/v1/workspace_snapshots?on_conflict=user_id',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=representation'});
  const row=rows?.[0]||null;
  await clearCloudQueue();
  await markAllCloudRecordsSynced();
  await saveCloudConfig({lastSyncAt:row?.updated_at||now,lastAutoSyncAt:new Date().toISOString(),lastRemoteRevision:Number(row?.revision||cfg.lastRemoteRevision+1||1),connectionState:'connected',syncConflict:null});
  return row;
}
async function cloudGetSnapshot(){
  const session=getCloudSession();
  if(!session?.user?.id) throw new Error('Silakan login Cloud terlebih dahulu.');
  const userId=encodeURIComponent(session.user.id);
  const rows=await supabaseFetch(`/rest/v1/workspace_snapshots?select=data,updated_at,device_id,school_code,revision&user_id=eq.${userId}&limit=1`);
  return Array.isArray(rows)?rows[0]||null:null;
}
async function cloudPullSnapshot(){
  const remote=await cloudGetSnapshot();
  if(!remote?.data) throw new Error('Belum ada data ruang kerja di Cloud.');
  const cfg=await getCloudConfig();
  await applyWorkspaceSnapshot(remote.data,{preserveCloud:true});
  await clearCloudQueue();
  await markAllCloudRecordsSynced();
  await saveCloudConfig({lastSyncAt:remote.updated_at||new Date().toISOString(),lastAutoSyncAt:new Date().toISOString(),lastRemoteRevision:Number(remote.revision||0),connectionState:'connected',schoolCode:cfg.schoolCode||remote.school_code||'',syncConflict:null});
  return remote;
}
async function cloudSmartSync(){
  const cfg=await getCloudConfig();
  if(cfg.mode!=='cloud') throw new Error('Mode Cloud + Offline belum aktif.');
  if(!getCloudSession()?.access_token) throw new Error('Silakan login Cloud terlebih dahulu.');
  if(!navigator.onLine) throw new Error('Perangkat sedang offline. Data tetap aman di perangkat.');
  const pending=await cloudQueueCount();
  const remote=await cloudGetSnapshot();
  const meaningful=await hasMeaningfulLocalWorkspace();
  if(!remote){
    await cloudPushSnapshot();
    return 'Ruang kerja pertama berhasil dikirim ke Cloud.';
  }
  const remoteRevision=Number(remote.revision||0);
  const lastRevision=Number(cfg.lastRemoteRevision||0);
  const remoteNew=remoteRevision>lastRevision;
  const fromOtherDevice=Boolean(remote.device_id && remote.device_id!==cfg.deviceId);

  if(!meaningful && remote?.data){
    await cloudPullSnapshot();
    return 'Ruang kerja Cloud dipulihkan ke perangkat ini.';
  }
  if(pending>0 && remoteNew && fromOtherDevice){
    const conflict={remoteRevision,remoteUpdatedAt:remote.updated_at||null,remoteDeviceId:remote.device_id||null,detectedAt:new Date().toISOString()};
    await saveCloudConfig({syncConflict:conflict,connectionState:'connected'});
    throw new Error('Perubahan ditemukan di PC dan HP. Sinkron otomatis dijeda agar data tidak tertimpa.');
  }
  if(pending>0){
    await cloudPushSnapshot();
    return `${pending} perubahan berhasil dikirim ke Cloud.`;
  }
  if(remoteNew){
    await cloudPullSnapshot();
    return 'Perubahan terbaru dari perangkat lain sudah diterapkan.';
  }
  await saveCloudConfig({lastAutoSyncAt:new Date().toISOString(),connectionState:'connected'});
  return 'Data sudah sinkron.';
}
let cloudAutoSyncBusy=false;
let cloudAutoSyncLastNotice='';
async function cloudAutoSync(trigger='auto'){
  if(cloudAutoSyncBusy || !activeLocalUser || !db || !navigator.onLine) return null;
  let cfg; try{cfg=await getCloudConfig()}catch(_){return null}
  if(cfg.mode!=='cloud' || !cfg.autoSync || cfg.syncConflict || !getCloudSession()?.access_token) return null;
  cloudAutoSyncBusy=true;
  try{
    const message=await cloudSmartSync();
    if(trigger!=='interval' && message && message!==cloudAutoSyncLastNotice){
      cloudAutoSyncLastNotice=message;
      if(!/Data sudah sinkron/.test(message)) showToast(message);
    }
    return message;
  }catch(err){
    console.warn('[SIAGA GURU Sync]',trigger,err);
    if(/Perubahan ditemukan/.test(err.message||'')) showToast('Sinkron dijeda: perubahan ada di PC dan HP. Buka Pengaturan > Cloud.');
    return null;
  }finally{
    cloudAutoSyncBusy=false;
    try{await renderCloudStatus()}catch(_){}
  }
}


function showToast(msg){
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(window.__siagaToastTimer);
  window.__siagaToastTimer=setTimeout(()=>el.classList.remove('show'),3200);
}

function navigate(page){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById(page)?.classList.add('active');
  document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active', x.dataset.page===page));
  document.getElementById('pageTitle').textContent=pageTitles[page]||'SIAGA GURU';
  window.scrollTo({top:0,behavior:'smooth'});
}
document.addEventListener('click',e=>{
  const pageBtn=e.target.closest('[data-page]'); if(pageBtn) navigate(pageBtn.dataset.page);
  const go=e.target.closest('[data-go]'); if(go) navigate(go.dataset.go);
});


// ===== SIAGA GURU v1.9 - MESIN PERIODE AKADEMIK =====
function suggestedAcademicPeriod(){
  const d=new Date(), y=d.getFullYear(), m=d.getMonth()+1;
  return m>=7 ? {year:`${y}/${y+1}`,semester:'Ganjil'} : {year:`${y-1}/${y}`,semester:'Genap'};
}
function makePeriodKey(year,semester){ return `${String(year||'').trim()}__${String(semester||'').trim()}`; }
async function getAcademicSessions(){ return await idbGetAll('academicSessions'); }
async function getAppMeta(){ return await idbGet('appMeta','main')||{id:'main'}; }
async function activePeriodKey(){
  const meta=await getAppMeta();
  if(meta.activePeriodKey) return meta.activePeriodKey;
  const sessions=await getAcademicSessions();
  return sessions[0]?.id||'';
}
async function getActivePeriod(){
  const key=await activePeriodKey();
  return (await getAcademicSessions()).find(x=>x.id===key)||null;
}
async function ensureSessionForProfile(profile={},activate=false){
  const fallback=suggestedAcademicPeriod();
  const year=String(profile.year||fallback.year).trim();
  const semester=String(profile.semester||fallback.semester).trim();
  const id=makePeriodKey(year,semester);
  let session=await idbGet('academicSessions',id);
  if(!session){
    session={id,year,semester,label:`${year} • ${semester}`,createdAt:new Date().toISOString(),uiPresetVersion:'3.3'};
    await idbPut('academicSessions',session);
  }
  const meta=await getAppMeta();
  if(activate || !meta.activePeriodKey){
    await idbPut('appMeta',{...meta,id:'main',activePeriodKey:id});
  }
  return session;
}
async function ensureAcademicPeriods(){
  const profile=await idbGet('profile','main')||{};
  let sessions=await getAcademicSessions();
  let active;
  if(!sessions.length){
    active=await ensureSessionForProfile(profile,true);
  }else{
    const meta=await getAppMeta();
    active=sessions.find(x=>x.id===meta.activePeriodKey)||sessions[0];
    await idbPut('appMeta',{...meta,id:'main',activePeriodKey:active.id});
  }
  // Sinkronkan field kompatibilitas profil dengan periode aktif.
  const p=await idbGet('profile','main')||{id:'main'};
  if(active && (p.year!==active.year || p.semester!==active.semester)){
    await idbPut('profile',{...p,id:'main',year:active.year,semester:active.semester});
  }
  return active;
}
async function migrateLegacyPeriodData(){
  const key=await activePeriodKey();
  if(!key) return;
  const stores=['attendance','journals','assessments','grades','homeroomNotes','teachingContexts'];
  for(const storeName of stores){
    const all=await idbGetAll(storeName);
    for(const item of all){
      if(!item.periodKey){
        await idbPut(storeName,{...item,periodKey:key});
      }
    }
  }
}
async function periodFiltered(storeName){
  const key=await activePeriodKey();
  const all=await idbGetAll(storeName);
  return all.filter(x=>x.periodKey===key);
}

function enrollmentKey(periodKey,studentId){ return `${periodKey}__${studentId}`; }
async function getStudentEnrollments(periodKey=null){
  const key=periodKey||await activePeriodKey();
  const all=await idbGetAll('studentEnrollments');
  return all.filter(x=>x.periodKey===key);
}
async function ensureEnrollment(studentId,className='',periodKey=null,status='Aktif'){
  const key=periodKey||await activePeriodKey();
  if(!key || !studentId) return null;
  const id=enrollmentKey(key,studentId);
  const old=await idbGet('studentEnrollments',id);
  const value={
    ...(old||{}), id, periodKey:key, studentId:Number(studentId),
    className:String(className??old?.className??'').trim(),
    status:status||old?.status||'Aktif',
    updatedAt:new Date().toISOString()
  };
  await idbPut('studentEnrollments',value);
  return value;
}
async function getActiveStudents(){
  const students=await idbGetAll('students');
  const enrollments=await getStudentEnrollments();
  const map=new Map(enrollments.map(e=>[Number(e.studentId),e]));
  return students.map(s=>{
    const e=map.get(Number(s.id));
    return {...s,className:e?.className??s.className??'',enrollmentStatus:e?.status||'Aktif',enrollmentId:e?.id||null};
  });
}
async function getCurrentRoster(){
  return (await getActiveStudents()).filter(s=>(s.enrollmentStatus||'Aktif')==='Aktif');
}
async function removeStudentEnrollments(studentId){
  const all=await idbGetAll('studentEnrollments');
  for(const e of all.filter(x=>Number(x.studentId)===Number(studentId))) await idbDelete('studentEnrollments',e.id);
}
async function migrateLegacyEnrollments(){
  const sessions=await getAcademicSessions();
  const students=await idbGetAll('students');
  const existing=await idbGetAll('studentEnrollments');
  const existingIds=new Set(existing.map(e=>e.id));
  const attendance=await idbGetAll('attendance');
  const grades=await idbGetAll('grades');
  for(const session of sessions){
    for(const s of students){
      const id=enrollmentKey(session.id,s.id);
      if(existingIds.has(id)) continue;
      const classCandidates=[
        ...attendance.filter(a=>a.periodKey===session.id && Number(a.studentId)===Number(s.id)).map(a=>a.className),
        ...grades.filter(g=>g.periodKey===session.id && Number(g.studentId)===Number(s.id)).map(g=>g.className)
      ].filter(Boolean);
      const inferred=classCandidates[0]||s.className||'';
      await idbPut('studentEnrollments',{id,periodKey:session.id,studentId:Number(s.id),className:inferred,status:'Aktif',updatedAt:new Date().toISOString()});
    }
  }
}


async function migrateAttendanceKeys(){
  const all=await idbGetAll('attendance');
  const fallback=await activePeriodKey();
  for(const a of all){
    const pKey=a.periodKey||fallback;
    const expected=attendanceKey(a.date,a.studentId,pKey);
    if(a.id!==expected){
      await idbDelete('attendance',a.id);
      await idbPut('attendance',{...a,id:expected,periodKey:pKey});
    }
  }
}

async function syncProfileWithActivePeriod(){
  const active=await getActivePeriod(); if(!active) return;
  const p=await idbGet('profile','main')||{id:'main'};
  await idbPut('profile',{...p,id:'main',year:active.year,semester:active.semester});
  const f=document.getElementById('profileForm');
  if(f?.elements.year) f.elements.year.value=active.year;
  if(f?.elements.semester) f.elements.semester.value=active.semester;
}
async function populatePeriodUI(){
  const sessions=(await getAcademicSessions()).sort((a,b)=>(b.year||'').localeCompare(a.year||'') || (a.semester==='Genap'?1:-1));
  const activeKey=await activePeriodKey();
  const switcher=document.getElementById('periodSwitcher');
  if(switcher){
    switcher.innerHTML=sessions.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.year)} • ${escapeHTML(s.semester)}</option>`).join('');
    switcher.value=activeKey;
  }
  const active=sessions.find(s=>s.id===activeKey);
  const badge=document.getElementById('activePeriodBadge');
  if(badge) badge.textContent=active?`${active.year} • ${active.semester}`:'-';

  const list=document.getElementById('academicPeriodList');
  if(list){
    list.innerHTML=sessions.map(s=>`
      <div class="academic-period-item ${s.id===activeKey?'active':''}">
        <div class="academic-period-main"><strong>${escapeHTML(s.year)} • Semester ${escapeHTML(s.semester)}</strong><small>Dibuat ${new Date(s.createdAt||Date.now()).toLocaleDateString('id-ID')}</small></div>
        ${s.id===activeKey?'<span class="period-active-label">AKTIF</span>':`<button type="button" class="btn btn-secondary activate-period-btn" data-period-id="${escapeHTML(s.id)}">Aktifkan</button>`}
        <span class="period-history-note">${s.id===activeKey?'Data baru tersimpan ke periode ini':'Riwayat tetap tersimpan'}</span>
      </div>`).join('');
  }
}
async function refreshAllPeriodViews(){
  await syncProfileWithActivePeriod();
  await populatePeriodUI();
  await renderTeachingContexts();
  await renderStudents();
  await renderAttendance();
  await renderJournals();
  await populateAssessmentSelect();
  await populateGradeClassFilter();
  await renderGradeModule();
  await populateHomeroomClassFilter();
  await renderHomeroom();
  await populateReportFilters();
  await renderReport();
  await renderTeacherOverview();
  await renderSmartDashboard();
}
async function setActivePeriod(periodId){
  const session=await idbGet('academicSessions',periodId);
  if(!session) return;
  const meta=await getAppMeta();
  await idbPut('appMeta',{...meta,id:'main',activePeriodKey:periodId});
  await refreshAllPeriodViews();
  showToast(`Periode aktif: ${session.year} • ${session.semester}`);
}

document.getElementById('periodSwitcher')?.addEventListener('change',e=>setActivePeriod(e.target.value));
document.getElementById('academicPeriodList')?.addEventListener('click',e=>{
  const btn=e.target.closest('.activate-period-btn'); if(btn) setActivePeriod(btn.dataset.periodId);
});
document.getElementById('academicPeriodForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const year=document.getElementById('newPeriodYear').value.trim();
  const semester=document.getElementById('newPeriodSemester').value;
  if(!/^\d{4}\/\d{4}$/.test(year)){showToast('Format tahun ajaran: 2026/2027');return;}
  const id=makePeriodKey(year,semester);
  if(await idbGet('academicSessions',id)){showToast('Periode tersebut sudah tersedia');return;}

  const oldKey=await activePeriodKey();
  const copy=document.getElementById('copyTeachingContexts').checked;
  const copyStudents=document.getElementById('copyStudentPlacements')?.checked!==false;
  const oldContexts=copy ? await periodFiltered('teachingContexts') : [];
  const oldEnrollments=copyStudents ? await getStudentEnrollments(oldKey) : [];

  await idbPut('academicSessions',{id,year,semester,label:`${year} • ${semester}`,createdAt:new Date().toISOString()});
  const meta=await getAppMeta();
  await idbPut('appMeta',{...meta,id:'main',activePeriodKey:id});

  if(copy){
    for(const t of oldContexts){
      const c={...t,periodKey:id}; delete c.id; await idbAdd('teachingContexts',c);
    }
  }
  if(copyStudents){
    for(const e of oldEnrollments){
      await idbPut('studentEnrollments',{...e,id:enrollmentKey(id,e.studentId),periodKey:id,updatedAt:new Date().toISOString()});
    }
  }
  e.target.reset();
  document.getElementById('copyTeachingContexts').checked=true;
  if(document.getElementById('copyStudentPlacements')) document.getElementById('copyStudentPlacements').checked=true;
  await refreshAllPeriodViews();
  showToast(`Periode ${year} • ${semester} dibuat`);
});

let pendingProvinceLogo=null;
let pendingSchoolLogo=null;
let pendingTeacherPhoto=null;

async function loadProfile(){
  const p=await idbGet('profile','main');
  const f=document.getElementById('profileForm');
  if(p){
    Object.keys(p).forEach(k=>{ if(f?.elements[k]) f.elements[k].value=p[k]??''; });
    pendingProvinceLogo=p.provinceLogo||null;
    pendingSchoolLogo=p.schoolLogo||null;
    pendingTeacherPhoto=p.teacherPhoto||null;
  }
  updateProfileMediaPreview(p||{});
  await renderTeacherOverview();
}

function setPreview(imgId,placeholderId,data){
  const img=document.getElementById(imgId), ph=document.getElementById(placeholderId);
  if(!img || !ph) return;
  if(data){
    img.src=data; img.classList.remove('hidden'); ph.classList.add('hidden');
  }else{
    img.removeAttribute('src'); img.classList.add('hidden'); ph.classList.remove('hidden');
  }
}
function updateProfileMediaPreview(p={}){
  setPreview('provinceLogoPreview','provinceLogoPlaceholder',p.provinceLogo||pendingProvinceLogo);
  setPreview('schoolLogoPreview','schoolLogoPlaceholder',p.schoolLogo||pendingSchoolLogo);
  setPreview('teacherPhotoPreview','teacherPhotoPlaceholder',p.teacherPhoto||pendingTeacherPhoto);
}

async function resizeImageToDataURL(file,maxSize=600,quality=.84){
  if(!file) return null;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Gunakan gambar PNG, JPG, atau WEBP.');
  const data=await new Promise((resolve,reject)=>{
    const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(r.error); r.readAsDataURL(file);
  });
  const img=await new Promise((resolve,reject)=>{
    const x=new Image(); x.onload=()=>resolve(x); x.onerror=()=>reject(new Error('Gambar tidak dapat dibaca')); x.src=data;
  });
  let w=img.naturalWidth,h=img.naturalHeight;
  const scale=Math.min(1,maxSize/Math.max(w,h)); w=Math.max(1,Math.round(w*scale)); h=Math.max(1,Math.round(h*scale));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d',{alpha:true});
  ctx.clearRect(0,0,w,h);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,0,0,w,h);

  const type=(file.type||'').toLowerCase();
  if(type==='image/png'){
    return c.toDataURL('image/png');
  }
  if(type==='image/webp'){
    return c.toDataURL('image/webp',quality);
  }
  return c.toDataURL('image/jpeg',quality);
}


document.getElementById('provinceLogoInput')?.addEventListener('change',async e=>{
  try{
    pendingProvinceLogo=await resizeImageToDataURL(e.target.files?.[0],500,.86);
    updateProfileMediaPreview({provinceLogo:pendingProvinceLogo,schoolLogo:pendingSchoolLogo,teacherPhoto:pendingTeacherPhoto});
  }catch(err){ showToast(err.message||'Gagal memuat logo provinsi'); }
});
document.getElementById('removeProvinceLogoBtn')?.addEventListener('click',()=>{
  pendingProvinceLogo=null; updateProfileMediaPreview({provinceLogo:null,schoolLogo:pendingSchoolLogo,teacherPhoto:pendingTeacherPhoto});
});

document.getElementById('schoolLogoInput')?.addEventListener('change',async e=>{
  try{
    pendingSchoolLogo=await resizeImageToDataURL(e.target.files?.[0],500,.86);
    updateProfileMediaPreview({schoolLogo:pendingSchoolLogo,teacherPhoto:pendingTeacherPhoto});
    showToast('Logo siap disimpan');
  }catch(err){showToast(err.message);}
});
document.getElementById('teacherPhotoInput')?.addEventListener('change',async e=>{
  try{
    pendingTeacherPhoto=await resizeImageToDataURL(e.target.files?.[0],600,.84);
    updateProfileMediaPreview({schoolLogo:pendingSchoolLogo,teacherPhoto:pendingTeacherPhoto});
    showToast('Foto siap disimpan');
  }catch(err){showToast(err.message);}
});
document.getElementById('removeSchoolLogoBtn')?.addEventListener('click',()=>{
  pendingSchoolLogo=null; updateProfileMediaPreview({provinceLogo:pendingProvinceLogo,schoolLogo:null,teacherPhoto:pendingTeacherPhoto});
});
document.getElementById('removeTeacherPhotoBtn')?.addEventListener('click',()=>{
  pendingTeacherPhoto=null; updateProfileMediaPreview({provinceLogo:pendingProvinceLogo,schoolLogo:pendingSchoolLogo,teacherPhoto:null});
});

document.getElementById('profileForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const old=await idbGet('profile','main')||{};
  const data={...old,...Object.fromEntries(new FormData(e.target).entries())};
  data.id='main';
  data.provinceLogo=pendingProvinceLogo;
  data.schoolLogo=pendingSchoolLogo;
  data.teacherPhoto=pendingTeacherPhoto;
  await idbPut('profile',data);
  try{ await syncActiveUserIdentityFromProfile(data); await refreshMultiUserUI(); }catch(_){}
  await ensureSessionForProfile(data,true);
  await populatePeriodUI();
  updateProfileMediaPreview(data);
  await renderTeacherOverview();
  try{ await renderReport(); }catch(_){}
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Profil berhasil disimpan');
});

async function renderTeacherOverview(){
  const p=await idbGet('profile','main')||{};
  const contexts=await getTeachingContexts();
  const students=await getActiveStudents();

  document.getElementById('welcomeText').textContent=`Selamat datang, ${p.teacher || 'Guru Hebat'}.`;
  const school=document.getElementById('dashSchoolName'); if(school) school.textContent=p.school||'Sekolah belum diatur';
  const topSchoolName=document.getElementById('topSchoolName'); if(topSchoolName) topSchoolName.textContent=p.school||'SIAGA GURU';
  const name=document.getElementById('dashTeacherName'); if(name) name.textContent=p.teacher||'Guru Hebat';
  const role=document.getElementById('dashTeacherRole'); if(role) role.textContent=[p.role,p.subject].filter(Boolean).join(' • ')||'Guru';

  const logo=document.getElementById('dashSchoolLogo'), logoFb=document.getElementById('dashSchoolLogoFallback');
  const topLogo=document.getElementById('topSchoolLogo'), topLogoFb=document.getElementById('topSchoolLogoFallback');
  if(logo && logoFb){
    if(p.schoolLogo){logo.src=p.schoolLogo;logo.classList.remove('hidden');logoFb.classList.add('hidden');}
    else{logo.classList.add('hidden');logoFb.classList.remove('hidden');}
  }
  if(topLogo && topLogoFb){
    if(p.schoolLogo){topLogo.src=p.schoolLogo;topLogo.classList.remove('hidden');topLogoFb.classList.add('hidden');}
    else{topLogo.classList.add('hidden');topLogoFb.classList.remove('hidden');}
  }
  const photo=document.getElementById('dashTeacherPhoto'), initial=document.getElementById('dashTeacherInitial');
  if(photo && initial){
    if(p.teacherPhoto){photo.src=p.teacherPhoto;photo.classList.remove('hidden');initial.classList.add('hidden');}
    else{
      photo.classList.add('hidden'); initial.classList.remove('hidden');
      initial.textContent=(p.teacher||'G').trim().charAt(0).toUpperCase()||'G';
    }
  }

  const uniqueClasses=new Set(contexts.map(x=>x.className).filter(Boolean));
  students.forEach(s=>{if(s.className) uniqueClasses.add(s.className);});
  document.getElementById('dashAssignmentCount').textContent=contexts.length;
  document.getElementById('dashClassCount').textContent=uniqueClasses.size;

  const chips=document.getElementById('dashAssignmentChips');
  if(chips){
    const top=contexts.slice(0,5);
    chips.innerHTML=top.length
      ? top.map(x=>`<span class="assignment-chip">${escapeHTML(x.className)} • ${escapeHTML(x.subject)}</span>`).join('')+(contexts.length>5?`<span class="assignment-chip">+${contexts.length-5} lainnya</span>`:'')
      : '<span class="muted" style="font-size:11px">Tambahkan kelas yang diampu di Pengaturan.</span>';
  }
}

const selectedStudentIds=new Set();

function updateStudentSelectionUI(){
  const count=selectedStudentIds.size;
  const el=document.getElementById('selectedStudentCount'); if(el) el.textContent=count;
  const all=document.getElementById('selectAllStudents');
  if(all){
    const boxes=[...document.querySelectorAll('.student-select')];
    const checked=boxes.filter(b=>b.checked).length;
    all.checked=boxes.length>0 && checked===boxes.length;
    all.indeterminate=checked>0 && checked<boxes.length;
  }
}

async function renderStudents(filter=''){
  const list=await getActiveStudents();
  const q=filter.trim().toLowerCase();
  const filtered=list.filter(s=>!q || (s.name||'').toLowerCase().includes(q) || (s.nis||'').toLowerCase().includes(q));
  const tbody=document.getElementById('studentTableBody');
  tbody.innerHTML='';
  filtered.forEach((s,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="check-col"><input class="student-select" type="checkbox" data-student-id="${s.id}" ${selectedStudentIds.has(Number(s.id))?'checked':''}></td><td>${i+1}</td><td>${escapeHTML(s.name||'')}</td><td>${escapeHTML(s.nis||'-')}</td><td>${escapeHTML(s.gender||'-')}</td><td>${escapeHTML(s.className||'-')}</td><td><span class="student-status ${(s.enrollmentStatus||'Aktif')==='Aktif'?'active':'inactive'}">${escapeHTML(s.enrollmentStatus||'Aktif')}</span></td>
      <td><button class="table-action edit" data-id="${s.id}">Edit</button><button class="table-action delete" data-id="${s.id}">Hapus</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('studentEmpty').style.display = filtered.length ? 'none' : 'block';
  updateStudentSelectionUI();
  document.getElementById('statStudents').textContent=list.length;
  try{ await renderTeacherOverview(); }catch(_){}
  try{ await renderSmartDashboard(); }catch(_){}
  if(document.getElementById('attendanceDate')?.value) {
    renderAttendance().catch(()=>{});
  }
}
function escapeHTML(v){ return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

const studentDialog=document.getElementById('studentDialog');
const studentForm=document.getElementById('studentForm');

document.getElementById('addStudentBtn').addEventListener('click',()=>{
  studentForm.reset(); studentForm.elements.id.value=''; document.getElementById('studentDialogTitle').textContent='Tambah Siswa'; studentDialog.showModal();
});
document.getElementById('studentTableBody').addEventListener('click',async e=>{
  const btn=e.target.closest('button[data-id]'); if(!btn) return;
  const id=Number(btn.dataset.id);
  if(btn.classList.contains('delete')){
    if(confirm('Hapus data siswa ini?')){
      await idbDelete('students',id);
      selectedStudentIds.delete(id);
      try{ await removeStudentEnrollments(id); }catch(_){}
      try{ await idbDelete('homeroomProfiles',id); }catch(_){}
      try{
        const notes=(await getHomeroomNotes()).filter(n=>Number(n.studentId)===id);
        for(const n of notes) await idbDelete('homeroomNotes',n.id);
      }catch(_){}
      await renderStudents(document.getElementById('studentSearch').value);
      try{ await renderHomeroom(); }catch(_){}
      showToast('Data siswa dihapus');
    }
  }else{
    const all=await getActiveStudents(); const s=all.find(x=>x.id===id); if(!s) return;
    studentForm.elements.id.value=s.id; studentForm.elements.name.value=s.name||''; studentForm.elements.nis.value=s.nis||'';
    studentForm.elements.gender.value=s.gender||''; studentForm.elements.className.value=s.className||'';
    document.getElementById('studentDialogTitle').textContent='Edit Siswa'; studentDialog.showModal();
  }
});
document.getElementById('saveStudentBtn').addEventListener('click',async e=>{
  e.preventDefault();
  if(!studentForm.reportValidity()) return;
  const d=Object.fromEntries(new FormData(studentForm).entries());
  const className=String(d.className||'').trim();
  let studentId;
  if(d.id){
    d.id=Number(d.id); studentId=d.id;
    await idbPut('students',d);
  }else{
    delete d.id; studentId=await idbAdd('students',d);
  }
  await ensureEnrollment(studentId,className);
  studentDialog.close(); await renderStudents(); showToast('Data siswa tersimpan');
});
document.getElementById('studentSearch').addEventListener('input',e=>renderStudents(e.target.value));

document.getElementById('studentTableBody')?.addEventListener('change',e=>{
  const cb=e.target.closest('.student-select'); if(!cb) return;
  const id=Number(cb.dataset.studentId);
  if(cb.checked) selectedStudentIds.add(id); else selectedStudentIds.delete(id);
  updateStudentSelectionUI();
});
document.getElementById('selectAllStudents')?.addEventListener('change',e=>{
  document.querySelectorAll('.student-select').forEach(cb=>{
    cb.checked=e.target.checked;
    const id=Number(cb.dataset.studentId);
    if(cb.checked) selectedStudentIds.add(id); else selectedStudentIds.delete(id);
  });
  updateStudentSelectionUI();
});

const bulkManageStudentDialog=document.getElementById('bulkManageStudentDialog');
document.getElementById('bulkManageStudentBtn')?.addEventListener('click',async()=>{
  if(!selectedStudentIds.size){showToast('Pilih siswa terlebih dahulu');return;}
  const active=await getActivePeriod();
  document.getElementById('bulkSelectedInfo').textContent=`${selectedStudentIds.size} siswa dipilih`;
  document.getElementById('bulkPeriodInfo').textContent=active?`${active.year} • ${active.semester}`:'Periode aktif';
  document.getElementById('bulkStudentAction').value='move_class';
  document.getElementById('bulkTargetClass').value='';
  document.getElementById('bulkMutationNote').value='';
  document.getElementById('bulkTargetClassWrap').classList.remove('hidden');
  bulkManageStudentDialog.showModal();
});
document.getElementById('bulkStudentAction')?.addEventListener('change',e=>{
  document.getElementById('bulkTargetClassWrap').classList.toggle('hidden',e.target.value!=='move_class');
});
document.getElementById('executeBulkStudentBtn')?.addEventListener('click',async e=>{
  e.preventDefault();
  const action=document.getElementById('bulkStudentAction').value;
  const targetClass=document.getElementById('bulkTargetClass').value.trim();
  const note=document.getElementById('bulkMutationNote').value.trim();
  const ids=[...selectedStudentIds];
  if(!ids.length){showToast('Tidak ada siswa terpilih');return;}
  if(action==='move_class' && !targetClass){showToast('Isi kelas tujuan');return;}

  if(action==='move_class'){
    for(const id of ids) await ensureEnrollment(id,targetClass);
    showToast(`${ids.length} siswa dipindahkan ke ${targetClass}`);
  }else{
    const statusMap={active:'Aktif',pindah:'Pindah',keluar:'Keluar',lulus:'Lulus'};
    const status=statusMap[action]||'Aktif';
    const profiles=await getHomeroomProfiles();
    for(const id of ids){
      const old=profiles.find(p=>Number(p.studentId)===Number(id))||{studentId:Number(id)};
      await idbPut('homeroomProfiles',{...old,studentId:Number(id),status,mutationDate:localISODate(),mutationNote:note,updatedAt:new Date().toISOString()});
      const enrollment=await ensureEnrollment(id,(await getActiveStudents()).find(s=>Number(s.id)===Number(id))?.className||'');
      if(enrollment) await idbPut('studentEnrollments',{...enrollment,status});
    }
    showToast(`${ids.length} siswa diperbarui menjadi ${status}`);
  }
  selectedStudentIds.clear();
  bulkManageStudentDialog.close();
  await renderStudents(document.getElementById('studentSearch').value);
  try{await renderHomeroom();await populateReportFilters();await renderReport();await renderSmartDashboard();}catch(_){}
});

const bulkDialog=document.getElementById('bulkDialog');
document.getElementById('bulkStudentBtn').addEventListener('click',()=>{document.getElementById('bulkText').value=''; bulkDialog.showModal();});
document.getElementById('bulkSaveBtn').addEventListener('click',async e=>{
  e.preventDefault();
  const text=document.getElementById('bulkText').value.trim(); if(!text){showToast('Daftar siswa masih kosong');return;}
  const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(const row of rows){
    const [name,nis='',gender='',className='']=row.split('|').map(x=>x.trim());
    if(name){ const id=await idbAdd('students',{name,nis,gender,className}); await ensureEnrollment(id,className); }
  }
  bulkDialog.close(); await renderStudents(); showToast(`${rows.length} siswa ditambahkan`);
});



// ===== SIAGA GURU v1.7 - KELAS & MAPEL YANG DIAMPU =====
async function getTeachingContexts(){ return await periodFiltered('teachingContexts'); }

async function renderTeachingContexts(){
  const list=await getTeachingContexts();
  const box=document.getElementById('teachingList');
  const empty=document.getElementById('teachingEmpty');
  const badge=document.getElementById('assignmentCountBadge');
  if(badge) badge.textContent=`${list.length} data`;
  if(!box || !empty) return;

  list.sort((a,b)=>(a.className||'').localeCompare(b.className||'','id') || (a.subject||'').localeCompare(b.subject||'','id'));
  box.innerHTML='';
  empty.style.display=list.length?'none':'block';

  list.forEach(x=>{
    const el=document.createElement('div');
    el.className='teaching-item';
    el.innerHTML=`
      <div><strong>${escapeHTML(x.className||'-')}</strong><small>Kelas</small></div>
      <div><strong>${escapeHTML(x.subject||'-')}</strong><small>Mata pelajaran</small></div>
      <div class="teaching-jp">${Number(x.weeklyJP||0)}<span>JP / Minggu</span></div>
      <button type="button" class="table-action delete teaching-delete" data-teaching-id="${x.id}">Hapus</button>`;
    box.appendChild(el);
  });
  await renderTeacherOverview();
}

document.getElementById('teachingForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries());
  data.className=String(data.className||'').trim();
  data.subject=String(data.subject||'').trim();
  data.weeklyJP=Number(data.weeklyJP||0);
  data.periodKey=await activePeriodKey();
  if(!data.className || !data.subject){showToast('Kelas dan mata pelajaran wajib diisi');return;}
  const exists=(await getTeachingContexts()).some(x=>x.className.toLowerCase()===data.className.toLowerCase() && x.subject.toLowerCase()===data.subject.toLowerCase());
  if(exists){showToast('Kelas dan mata pelajaran tersebut sudah ada');return;}
  await idbAdd('teachingContexts',data);
  e.target.reset(); e.target.elements.weeklyJP.value=3;
  await renderTeachingContexts();
  try{await populateJournalClassFilter();await populateGradeClassFilter();await populateHomeroomClassFilter();await populateReportFilters();}catch(_){}
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Kelas mengajar ditambahkan');
});

document.getElementById('teachingList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('.teaching-delete'); if(!btn) return;
  if(!confirm('Hapus data kelas/mapel ini?')) return;
  await idbDelete('teachingContexts',Number(btn.dataset.teachingId));
  await renderTeachingContexts();
  try{await populateJournalClassFilter();await populateGradeClassFilter();await populateHomeroomClassFilter();await populateReportFilters();}catch(_){}
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Data mengajar dihapus');
});

async function allKnownClasses(){
  const students=await getActiveStudents();
  const contexts=await getTeachingContexts();
  return [...new Set([...students.map(s=>s.className),...contexts.map(x=>x.className)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
}


// ===== SIAGA GURU v1.1 - MODUL ABSENSI =====
const attendanceState = new Map();

function localISODate(d=new Date()){
  const off=d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
}
function formatDateID(v){
  if(!v) return '';
  const [y,m,d]=v.split('-');
  return `${d}/${m}/${y}`;
}
function attendanceKey(date,studentId,periodKey='legacy'){ return `${periodKey}__${date}__${studentId}`; }

async function getAttendanceForDate(date){
  const all=await getAllAttendance();
  return all.filter(x=>x.date===date);
}
async function getAllAttendance(){ return await periodFiltered('attendance'); }

function statusLabel(s){
  return ({H:'Hadir',S:'Sakit',I:'Izin',A:'Alpa',T:'Terlambat'})[s]||'';
}

async function renderAttendance(){
  const dateEl=document.getElementById('attendanceDate');
  if(!dateEl) return;
  if(!dateEl.value) dateEl.value=localISODate();

  const date=dateEl.value;
  const students=await getCurrentRoster();
  const saved=await getAttendanceForDate(date);
  attendanceState.clear();
  saved.forEach(x=>attendanceState.set(Number(x.studentId),{status:x.status,note:x.note||''}));

  const list=document.getElementById('attendanceList');
  const empty=document.getElementById('attendanceEmpty');
  list.innerHTML='';

  if(!students.length){
    empty.style.display='block';
    list.style.display='none';
    updateAttendanceSummary();
    await renderAttendanceHistory();
    await renderMonthlyAttendance();
    return;
  }

  empty.style.display='none';
  list.style.display='grid';

  students.sort((a,b)=>(a.name||'').localeCompare(b.name||'','id'));
  students.forEach((s,idx)=>{
    const current=attendanceState.get(Number(s.id)) || {status:'',note:''};
    const initials=(s.name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    const row=document.createElement('div');
    row.className='attendance-row';
    row.dataset.studentId=s.id;
    row.innerHTML=`
      <div class="attendance-student">
        <div class="student-avatar">${escapeHTML(initials)}</div>
        <div class="student-main">
          <strong>${escapeHTML(s.name||'')}</strong>
          <small>${escapeHTML(s.nis||'Tanpa NIS')} • ${escapeHTML(s.className||'Kelas belum diisi')}</small>
        </div>
      </div>
      <div class="status-pills" role="group" aria-label="Status kehadiran ${escapeHTML(s.name||'')}">
        ${['H','S','I','A','T'].map(st=>`<button type="button" class="status-pill ${current.status===st?'active':''}" data-status="${st}" title="${statusLabel(st)}">${st}</button>`).join('')}
      </div>
      <input class="input attendance-note" maxlength="120" placeholder="Catatan (opsional)" value="${escapeHTML(current.note||'')}">
    `;
    list.appendChild(row);
  });

  document.getElementById('attendanceHint').textContent=`${students.length} siswa • ${formatDateID(date)}`;
  updateAttendanceSummary();
  await renderAttendanceHistory();
  await renderMonthlyAttendance();
}

function updateAttendanceSummary(){
  const counts={H:0,S:0,I:0,A:0,T:0};
  attendanceState.forEach(v=>{ if(counts[v.status]!==undefined) counts[v.status]++; });
  for(const k of Object.keys(counts)){
    const el=document.getElementById('sum'+k); if(el) el.textContent=counts[k];
  }
  const today=document.getElementById('attendanceDate')?.value===localISODate();
  if(today) document.querySelector('#dashboard .stat-card:nth-child(2) strong').textContent=counts.H;
}

document.getElementById('attendanceList')?.addEventListener('click',e=>{
  const pill=e.target.closest('.status-pill'); if(!pill) return;
  const row=pill.closest('.attendance-row');
  const id=Number(row.dataset.studentId);
  row.querySelectorAll('.status-pill').forEach(x=>x.classList.remove('active'));
  pill.classList.add('active');
  const prev=attendanceState.get(id)||{};
  attendanceState.set(id,{...prev,status:pill.dataset.status,note:row.querySelector('.attendance-note').value||''});
  updateAttendanceSummary();
});

document.getElementById('attendanceList')?.addEventListener('input',e=>{
  if(!e.target.classList.contains('attendance-note')) return;
  const row=e.target.closest('.attendance-row');
  const id=Number(row.dataset.studentId);
  const prev=attendanceState.get(id)||{status:''};
  attendanceState.set(id,{...prev,note:e.target.value||''});
});

document.getElementById('markAllPresentBtn')?.addEventListener('click',()=>{
  document.querySelectorAll('#attendanceList .attendance-row').forEach(row=>{
    const id=Number(row.dataset.studentId);
    row.querySelectorAll('.status-pill').forEach(x=>x.classList.toggle('active',x.dataset.status==='H'));
    const prev=attendanceState.get(id)||{};
    attendanceState.set(id,{...prev,status:'H',note:row.querySelector('.attendance-note').value||''});
  });
  updateAttendanceSummary();
  showToast('Semua siswa ditandai hadir');
});

document.getElementById('saveAttendanceBtn')?.addEventListener('click',async()=>{
  const date=document.getElementById('attendanceDate').value;
  const students=await getCurrentRoster();
  if(!students.length){ showToast('Belum ada siswa aktif pada periode ini'); return; }
  const periodKey=await activePeriodKey();

  let missing=0;
  for(const s of students){
    const row=document.querySelector(`.attendance-row[data-student-id="${s.id}"]`);
    const state=attendanceState.get(Number(s.id));
    if(!state?.status){ missing++; continue; }
    const record={
      id:attendanceKey(date,s.id,periodKey),
      date,
      studentId:Number(s.id),
      studentName:s.name||'',
      className:s.className||'',
      status:state.status,
      note:row?.querySelector('.attendance-note')?.value||state.note||'',
      periodKey,
      updatedAt:new Date().toISOString()
    };
    await idbPut('attendance',record);
  }
  if(missing){
    showToast(`${missing} siswa belum diberi status`);
  }else{
    showToast('Absensi berhasil disimpan');
  }
  await renderAttendance();
  try{ await renderSmartDashboard(); }catch(_){}
});

document.getElementById('attendanceDate')?.addEventListener('change',()=>renderAttendance());

async function renderAttendanceHistory(){
  const box=document.getElementById('attendanceHistory'); if(!box) return;
  const all=await getAllAttendance();
  const grouped={};
  all.forEach(x=>{
    if(!grouped[x.date]) grouped[x.date]={H:0,S:0,I:0,A:0,T:0,total:0};
    grouped[x.date][x.status]=(grouped[x.date][x.status]||0)+1;
    grouped[x.date].total++;
  });
  const dates=Object.keys(grouped).sort().reverse().slice(0,5);
  if(!dates.length){
    box.innerHTML='<div class="empty-state" style="padding:22px 8px"><p>Belum ada riwayat absensi.</p></div>';
    return;
  }
  box.innerHTML=dates.map(d=>{
    const g=grouped[d];
    return `<div class="history-item">
      <div><strong>${formatDateID(d)}</strong><br><small>${g.total} siswa tercatat</small></div>
      <div class="history-badges">
        <span class="history-badge">H ${g.H||0}</span>
        <span class="history-badge">S ${g.S||0}</span>
        <span class="history-badge">I ${g.I||0}</span>
        <span class="history-badge">A ${g.A||0}</span>
        <span class="history-badge">T ${g.T||0}</span>
      </div>
    </div>`;
  }).join('');
}

async function renderMonthlyAttendance(){
  const box=document.getElementById('monthlyAttendanceSummary'); if(!box) return;
  const date=document.getElementById('attendanceDate')?.value||localISODate();
  const ym=date.slice(0,7);
  const all=(await getAllAttendance()).filter(x=>x.date?.startsWith(ym));
  const counts={H:0,S:0,I:0,A:0,T:0};
  const days=new Set();
  all.forEach(x=>{if(counts[x.status]!==undefined)counts[x.status]++;days.add(x.date)});
  box.innerHTML=`
    <div class="monthly-row"><span>Hari tersimpan</span><strong>${days.size}</strong></div>
    <div class="monthly-row"><span>Total Hadir</span><strong>${counts.H}</strong></div>
    <div class="monthly-row"><span>Sakit + Izin</span><strong>${counts.S+counts.I}</strong></div>
    <div class="monthly-row"><span>Alpa</span><strong>${counts.A}</strong></div>
    <div class="monthly-row"><span>Terlambat</span><strong>${counts.T}</strong></div>`;
}


// ===== SIAGA GURU v1.2 - MODUL JURNAL MENGAJAR =====
const journalDialog = document.getElementById('journalDialog');
const journalForm = document.getElementById('journalForm');

function monthISO(d=new Date()){
  const off=d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,7);
}
function journalStatusClass(status){
  if(status==='Terlaksana') return 'done';
  if(status==='Sebagian') return 'partial';
  return 'pending';
}
function datePartsID(v){
  if(!v) return {day:'--',month:'',year:''};
  const d=new Date(v+'T00:00:00');
  const months=['JAN','FEB','MAR','APR','MEI','JUN','JUL','AGU','SEP','OKT','NOV','DES'];
  return {day:String(d.getDate()).padStart(2,'0'),month:months[d.getMonth()],year:d.getFullYear()};
}
async function getJournals(){ return await periodFiltered('journals'); }

async function populateJournalClassFilter(){
  const select=document.getElementById('journalClassFilter');
  if(!select) return;
  const current=select.value;
  const journals=await getJournals();
  const studentClasses=(await getActiveStudents()).map(x=>x.className).filter(Boolean);
  const teachingClasses=(await getTeachingContexts()).map(x=>x.className).filter(Boolean);
  const profile=await idbGet('profile','main');
  const classes=[...new Set([...journals.map(x=>x.className),...studentClasses,...teachingClasses,profile?.className].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
  select.innerHTML='<option value="">Semua Kelas</option>'+classes.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if(classes.includes(current)) select.value=current;
}

async function openJournalDialog(journal=null){
  journalForm.reset();
  const profile=await idbGet('profile','main');
  journalForm.elements.id.value=journal?.id||'';
  journalForm.elements.date.value=journal?.date||localISODate();
  journalForm.elements.className.value=journal?.className||profile?.className||'';
  journalForm.elements.subject.value=journal?.subject||profile?.subject||'';
  journalForm.elements.jp.value=journal?.jp||2;
  journalForm.elements.topic.value=journal?.topic||'';
  journalForm.elements.objective.value=journal?.objective||'';
  journalForm.elements.method.value=journal?.method||'';
  journalForm.elements.status.value=journal?.status||'Terlaksana';
  journalForm.elements.notes.value=journal?.notes||'';
  document.getElementById('journalDialogTitle').textContent=journal?'Edit Jurnal':'Tambah Jurnal';
  journalDialog.showModal();
}

document.getElementById('addJournalBtn')?.addEventListener('click',()=>openJournalDialog());
document.getElementById('journalEmptyAddBtn')?.addEventListener('click',()=>openJournalDialog());

document.getElementById('saveJournalBtn')?.addEventListener('click',async e=>{
  e.preventDefault();
  if(!journalForm.reportValidity()) return;
  const data=Object.fromEntries(new FormData(journalForm).entries());
  data.jp=Number(data.jp||0);
  data.periodKey=await activePeriodKey();
  data.updatedAt=new Date().toISOString();
  if(data.id){
    data.id=Number(data.id);
    const current=(await getJournals()).find(x=>x.id===data.id);
    data.createdAt=current?.createdAt||data.updatedAt;
    await idbPut('journals',data);
  }else{
    delete data.id;
    data.createdAt=data.updatedAt;
    await idbAdd('journals',data);
  }
  journalDialog.close();
  await renderJournals();
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Jurnal berhasil disimpan');
});

document.getElementById('journalCards')?.addEventListener('click',async e=>{
  const btn=e.target.closest('button[data-journal-id]');
  if(!btn) return;
  const id=Number(btn.dataset.journalId);
  const journals=await getJournals();
  const journal=journals.find(x=>x.id===id);
  if(!journal) return;
  if(btn.classList.contains('delete-journal')){
    if(confirm('Hapus jurnal pembelajaran ini?')){
      await idbDelete('journals',id);
      await renderJournals();
      showToast('Jurnal dihapus');
    }
  }else{
    await openJournalDialog(journal);
  }
});

['journalSearch','journalMonthFilter','journalClassFilter'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input',()=>renderJournals());
  document.getElementById(id)?.addEventListener('change',()=>renderJournals());
});
document.getElementById('clearJournalFilter')?.addEventListener('click',async()=>{
  document.getElementById('journalSearch').value='';
  document.getElementById('journalMonthFilter').value=monthISO();
  document.getElementById('journalClassFilter').value='';
  await renderJournals();
});

async function renderJournals(){
  const all=await getJournals();
  await populateJournalClassFilter();

  const q=(document.getElementById('journalSearch')?.value||'').trim().toLowerCase();
  const month=document.getElementById('journalMonthFilter')?.value||'';
  const classFilter=document.getElementById('journalClassFilter')?.value||'';

  let filtered=all.filter(j=>{
    const hay=[j.topic,j.className,j.subject,j.notes,j.objective,j.method].join(' ').toLowerCase();
    if(q && !hay.includes(q)) return false;
    if(month && !String(j.date||'').startsWith(month)) return false;
    if(classFilter && j.className!==classFilter) return false;
    return true;
  });
  filtered.sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id));

  const cards=document.getElementById('journalCards');
  const empty=document.getElementById('journalEmpty');
  if(!cards || !empty) return;
  cards.innerHTML='';

  if(!filtered.length){
    empty.style.display='block';
  }else{
    empty.style.display='none';
    filtered.forEach(j=>{
      const p=datePartsID(j.date);
      const card=document.createElement('article');
      card.className='journal-card';
      card.innerHTML=`
        <div class="journal-date"><strong>${p.day}</strong><span>${p.month} ${p.year}</span></div>
        <div class="journal-main">
          <div class="journal-topline">
            <h3>${escapeHTML(j.topic||'Tanpa materi')}</h3>
            <span class="journal-badge ${journalStatusClass(j.status)}">${escapeHTML(j.status||'')}</span>
          </div>
          <div class="journal-meta">
            <span>🏫 ${escapeHTML(j.className||'-')}</span>
            <span>📘 ${escapeHTML(j.subject||'-')}</span>
            <span>◷ ${Number(j.jp||0)} JP</span>
            ${j.method?`<span>💡 ${escapeHTML(j.method)}</span>`:''}
          </div>
          ${j.objective?`<p class="journal-text"><strong>Tujuan:</strong> ${escapeHTML(j.objective)}</p>`:''}
          ${j.notes?`<p class="journal-text"><strong>Catatan:</strong> ${escapeHTML(j.notes)}</p>`:''}
        </div>
        <div class="journal-card-actions">
          <button class="table-action edit-journal" data-journal-id="${j.id}">Edit</button>
          <button class="table-action delete delete-journal" data-journal-id="${j.id}">Hapus</button>
        </div>`;
      cards.appendChild(card);
    });
  }

  await renderJournalStats(all);
  await renderJournalRecent(all);
}

async function renderJournalStats(all=null){
  all=all||await getJournals();
  const currentMonth=monthISO();
  const monthRows=all.filter(j=>String(j.date||'').startsWith(currentMonth));
  const classes=new Set(monthRows.map(j=>j.className).filter(Boolean));
  const done=monthRows.filter(j=>j.status==='Terlaksana').length;
  const jp=monthRows.reduce((sum,j)=>sum+Number(j.jp||0),0);

  document.getElementById('journalMonthCount').textContent=monthRows.length;
  document.getElementById('journalDoneCount').textContent=done;
  document.getElementById('journalClassCount').textContent=classes.size;
  document.getElementById('journalJPCount').textContent=jp;

  const dashStat=document.querySelector('#dashboard .stat-card:nth-child(3) strong');
  if(dashStat) dashStat.textContent=monthRows.length;

  const box=document.getElementById('journalMonthlySummary');
  if(box){
    const statusCounts={
      Terlaksana:monthRows.filter(j=>j.status==='Terlaksana').length,
      Sebagian:monthRows.filter(j=>j.status==='Sebagian').length,
      Tertunda:monthRows.filter(j=>j.status==='Tertunda').length
    };
    box.innerHTML=`
      <div class="monthly-row"><span>Total jurnal</span><strong>${monthRows.length}</strong></div>
      <div class="monthly-row"><span>Total jam pelajaran</span><strong>${jp} JP</strong></div>
      <div class="monthly-row"><span>Terlaksana</span><strong>${statusCounts.Terlaksana}</strong></div>
      <div class="monthly-row"><span>Sebagian / tertunda</span><strong>${statusCounts.Sebagian+statusCounts.Tertunda}</strong></div>
      <div class="monthly-row"><span>Kelas aktif</span><strong>${classes.size}</strong></div>`;
  }
}

async function renderJournalRecent(all=null){
  all=all||await getJournals();
  const box=document.getElementById('journalRecent'); if(!box) return;
  const recent=[...all].sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id)).slice(0,5);
  if(!recent.length){
    box.innerHTML='<div class="empty-state" style="padding:22px 8px"><p>Belum ada jurnal tersimpan.</p></div>';
    return;
  }
  box.innerHTML=recent.map(j=>{
    const p=datePartsID(j.date);
    return `<div class="journal-recent-item">
      <div class="journal-recent-date">${p.day}</div>
      <div class="journal-recent-main"><strong>${escapeHTML(j.topic||'-')}</strong><small>${escapeHTML(j.className||'-')} • ${escapeHTML(j.subject||'-')}</small></div>
      <span class="journal-badge ${journalStatusClass(j.status)}">${escapeHTML(j.status||'')}</span>
    </div>`;
  }).join('');
}


// ===== SIAGA GURU v1.3 - MODUL NILAI =====
const assessmentDialog = document.getElementById('assessmentDialog');
const assessmentForm = document.getElementById('assessmentForm');

async function getAssessments(){ return await periodFiltered('assessments'); }
async function getGrades(){ return await periodFiltered('grades'); }
function gradeKey(assessmentId,studentId){ return `${assessmentId}__${studentId}`; }

async function populateGradeClassFilter(){
  const select=document.getElementById('gradeClassFilter');
  if(!select) return;
  const current=select.value;
  const students=await getActiveStudents();
  const assessments=await getAssessments();
  const teachingClasses=(await getTeachingContexts()).map(x=>x.className).filter(Boolean);
  const classes=[...new Set([...students.map(s=>s.className),...assessments.map(a=>a.className),...teachingClasses].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
  select.innerHTML='<option value="">Semua Kelas</option>'+classes.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if(classes.includes(current)) select.value=current;
}

async function populateAssessmentSelect(preferredId=null){
  const select=document.getElementById('assessmentSelect');
  if(!select) return;
  const current=preferredId ?? select.value;
  const list=(await getAssessments()).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id));
  select.innerHTML='<option value="">Pilih penilaian...</option>'+list.map(a=>`<option value="${a.id}">${escapeHTML(a.name)}${a.className?' • '+escapeHTML(a.className):''}</option>`).join('');
  if(current && list.some(a=>String(a.id)===String(current))) select.value=String(current);
}

async function openAssessmentDialog(a=null){
  assessmentForm.reset();
  const profile=await idbGet('profile','main');
  assessmentForm.elements.id.value=a?.id||'';
  assessmentForm.elements.name.value=a?.name||'';
  assessmentForm.elements.type.value=a?.type||'Formatif';
  assessmentForm.elements.className.value=a?.className||profile?.className||'';
  assessmentForm.elements.subject.value=a?.subject||profile?.subject||'';
  assessmentForm.elements.date.value=a?.date||localISODate();
  assessmentForm.elements.kkm.value=a?.kkm??75;
  assessmentForm.elements.notes.value=a?.notes||'';
  document.getElementById('assessmentDialogTitle').textContent=a?'Edit Penilaian':'Buat Penilaian';
  assessmentDialog.showModal();
}

document.getElementById('addAssessmentBtn')?.addEventListener('click',()=>openAssessmentDialog());
document.getElementById('gradeEmptyAddBtn')?.addEventListener('click',()=>openAssessmentDialog());

document.getElementById('saveAssessmentBtn')?.addEventListener('click',async e=>{
  e.preventDefault();
  if(!assessmentForm.reportValidity()) return;
  const data=Object.fromEntries(new FormData(assessmentForm).entries());
  data.kkm=Math.max(0,Math.min(100,Number(data.kkm||0)));
  data.periodKey=await activePeriodKey();
  data.updatedAt=new Date().toISOString();
  let id;
  if(data.id){
    data.id=Number(data.id);
    const current=(await getAssessments()).find(x=>x.id===data.id);
    data.createdAt=current?.createdAt||data.updatedAt;
    id=await idbPut('assessments',data);
  }else{
    delete data.id;
    data.createdAt=data.updatedAt;
    id=await idbAdd('assessments',data);
  }
  assessmentDialog.close();
  await populateAssessmentSelect(id);
  await populateGradeClassFilter();
  document.getElementById('assessmentSelect').value=String(id);
  await renderGradeModule();
  showToast('Penilaian berhasil disimpan');
});

document.getElementById('assessmentSelect')?.addEventListener('change',()=>renderGradeModule());
document.getElementById('gradeClassFilter')?.addEventListener('change',()=>renderGradeModule());
document.getElementById('gradeSearch')?.addEventListener('input',()=>renderGradeTableOnly());

document.getElementById('editAssessmentBtn')?.addEventListener('click',async()=>{
  const id=Number(document.getElementById('assessmentSelect').value);
  if(!id){ showToast('Pilih penilaian terlebih dahulu'); return; }
  const a=(await getAssessments()).find(x=>x.id===id);
  if(a) openAssessmentDialog(a);
});

document.getElementById('deleteAssessmentBtn')?.addEventListener('click',async()=>{
  const id=Number(document.getElementById('assessmentSelect').value);
  if(!id){ showToast('Pilih penilaian terlebih dahulu'); return; }
  const a=(await getAssessments()).find(x=>x.id===id);
  if(!a) return;
  if(!confirm(`Hapus penilaian "${a.name}" beserta seluruh nilainya?`)) return;
  await idbDelete('assessments',id);
  const grades=(await getGrades()).filter(g=>Number(g.assessmentId)===id);
  for(const g of grades) await idbDelete('grades',g.id);
  await populateAssessmentSelect();
  await renderGradeModule();
  showToast('Penilaian dihapus');
});

function clampScore(v){
  if(v==='' || v===null || v===undefined) return '';
  const n=Number(v);
  if(Number.isNaN(n)) return '';
  return Math.max(0,Math.min(100,n));
}
function computeFinal(raw,remedial){
  const a=clampScore(raw), b=clampScore(remedial);
  if(a==='' && b==='') return '';
  if(a==='') return b;
  if(b==='') return a;
  return Math.max(Number(a),Number(b));
}

async function renderGradeTableOnly(){
  const assessmentId=Number(document.getElementById('assessmentSelect')?.value||0);
  const body=document.getElementById('gradeTableBody');
  const wrap=document.getElementById('gradeTableWrap');
  const empty=document.getElementById('gradeEmpty');
  if(!body || !wrap || !empty) return;

  const assessments=await getAssessments();
  const a=assessments.find(x=>x.id===assessmentId);

  if(!a){
    body.innerHTML='';
    wrap.style.display='none';
    empty.style.display='block';
    updateGradeStats([],75,0);
    return;
  }

  const students=await getCurrentRoster();
  const grades=await getGrades();
  const classFilter=document.getElementById('gradeClassFilter')?.value||'';
  const q=(document.getElementById('gradeSearch')?.value||'').trim().toLowerCase();

  let filtered=students.filter(s=>{
    if(a.className && s.className && s.className!==a.className) return false;
    if(classFilter && s.className!==classFilter) return false;
    if(q && !(`${s.name||''} ${s.nis||''}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((x,y)=>(x.name||'').localeCompare(y.name||'','id'));

  if(!students.length){
    body.innerHTML='';
    wrap.style.display='none';
    empty.style.display='block';
    empty.querySelector('h3').textContent='Belum ada data siswa';
    empty.querySelector('p').textContent='Tambahkan data siswa terlebih dahulu sebelum mengisi nilai.';
    updateGradeStats([],Number(a.kkm||75),0);
    return;
  }

  empty.style.display='none';
  wrap.style.display='block';
  body.innerHTML='';

  const currentGrades=[];
  filtered.forEach((s,i)=>{
    const g=grades.find(x=>Number(x.assessmentId)===assessmentId && Number(x.studentId)===Number(s.id))||{};
    const finalScore=computeFinal(g.rawScore,g.remedialScore);
    currentGrades.push({studentId:s.id,rawScore:g.rawScore??'',remedialScore:g.remedialScore??'',finalScore});
    const tr=document.createElement('tr');
    tr.dataset.studentId=s.id;
    tr.innerHTML=`
      <td>${i+1}</td>
      <td><strong>${escapeHTML(s.name||'')}</strong></td>
      <td>${escapeHTML(s.nis||'-')}</td>
      <td>${escapeHTML(s.className||'-')}</td>
      <td><input class="input grade-input grade-raw" type="number" min="0" max="100" step="1" value="${g.rawScore??''}" placeholder="-"></td>
      <td><input class="input grade-input grade-remedial" type="number" min="0" max="100" step="1" value="${g.remedialScore??''}" placeholder="-"></td>
      <td class="grade-final">${finalScore===''?'-':finalScore}</td>
      <td class="grade-status-cell">${gradeStatusHTML(finalScore,Number(a.kkm||75))}</td>`;
    body.appendChild(tr);
  });

  document.getElementById('gradeAssessmentTitle').textContent=a.name;
  document.getElementById('gradeAssessmentMeta').textContent=`${a.type} • ${a.className||'Semua kelas'} • ${a.subject||'Mapel belum diisi'} • KKTP/KKM ${a.kkm}`;
  updateGradeStats(currentGrades,Number(a.kkm||75),filtered.length);
}

function gradeStatusHTML(finalScore,kkm){
  if(finalScore==='') return '<span class="grade-empty-badge">Belum diisi</span>';
  return Number(finalScore)>=kkm
    ? '<span class="grade-pass">Tuntas</span>'
    : '<span class="grade-fail">Belum Tuntas</span>';
}

document.getElementById('gradeTableBody')?.addEventListener('input',async e=>{
  if(!e.target.classList.contains('grade-input')) return;
  const row=e.target.closest('tr');
  const raw=clampScore(row.querySelector('.grade-raw').value);
  const rem=clampScore(row.querySelector('.grade-remedial').value);
  if(e.target.value!=='' && clampScore(e.target.value)!==Number(e.target.value)) e.target.value=clampScore(e.target.value);
  const finalScore=computeFinal(raw,rem);
  row.querySelector('.grade-final').textContent=finalScore===''?'-':finalScore;
  const assessmentId=Number(document.getElementById('assessmentSelect').value);
  const a=(await getAssessments()).find(x=>x.id===assessmentId);
  row.querySelector('.grade-status-cell').innerHTML=gradeStatusHTML(finalScore,Number(a?.kkm||75));
  await updateGradeStatsFromVisibleRows(Number(a?.kkm||75));
});

async function updateGradeStatsFromVisibleRows(kkm){
  const rows=[...document.querySelectorAll('#gradeTableBody tr')];
  const list=rows.map(row=>{
    const raw=row.querySelector('.grade-raw').value;
    const rem=row.querySelector('.grade-remedial').value;
    return {rawScore:raw,remedialScore:rem,finalScore:computeFinal(raw,rem)};
  });
  updateGradeStats(list,kkm,rows.length);
}

function updateGradeStats(list,kkm,total){
  const vals=list.map(x=>x.finalScore).filter(x=>x!=='' && x!==null && x!==undefined).map(Number);
  const avg=vals.length?Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*10)/10:0;
  const max=vals.length?Math.max(...vals):0;
  const min=vals.length?Math.min(...vals):0;
  const passed=vals.filter(v=>v>=kkm).length;
  const failed=vals.filter(v=>v<kkm).length;

  document.getElementById('gradeAvg').textContent=avg;
  document.getElementById('gradeMax').textContent=max;
  document.getElementById('gradeMin').textContent=min;
  document.getElementById('gradeFilled').textContent=`${vals.length}/${total||0}`;

  const box=document.getElementById('gradeSummaryBox');
  if(box){
    box.innerHTML=`
      <div class="monthly-row"><span>Nilai terisi</span><strong>${vals.length}/${total||0}</strong></div>
      <div class="monthly-row"><span>Rata-rata kelas</span><strong>${avg}</strong></div>
      <div class="monthly-row"><span>Tuntas</span><strong>${passed}</strong></div>
      <div class="monthly-row"><span>Belum tuntas</span><strong>${failed}</strong></div>
      <div class="monthly-row"><span>KKTP / KKM</span><strong>${kkm}</strong></div>`;
  }
}

document.getElementById('saveGradesBtn')?.addEventListener('click',async()=>{
  const assessmentId=Number(document.getElementById('assessmentSelect').value);
  if(!assessmentId){ showToast('Pilih penilaian terlebih dahulu'); return; }
  const rows=[...document.querySelectorAll('#gradeTableBody tr')];
  if(!rows.length){ showToast('Tidak ada siswa untuk disimpan'); return; }

  const assessments=await getAssessments();
  const a=assessments.find(x=>x.id===assessmentId);
  for(const row of rows){
    const studentId=Number(row.dataset.studentId);
    const raw=clampScore(row.querySelector('.grade-raw').value);
    const rem=clampScore(row.querySelector('.grade-remedial').value);
    const finalScore=computeFinal(raw,rem);
    const id=gradeKey(assessmentId,studentId);

    if(raw==='' && rem===''){
      const existing=(await getGrades()).find(x=>x.id===id);
      if(existing) await idbDelete('grades',id);
      continue;
    }
    const student=(await getActiveStudents()).find(s=>Number(s.id)===studentId);
    await idbPut('grades',{
      id,assessmentId,studentId,
      studentName:student?.name||'',
      className:student?.className||'',
      rawScore:raw===''?'':Number(raw),
      remedialScore:rem===''?'':Number(rem),
      finalScore:finalScore===''?'':Number(finalScore),
      passed:finalScore!==''?Number(finalScore)>=Number(a?.kkm||75):false,
      periodKey:await activePeriodKey(),
      updatedAt:new Date().toISOString()
    });
  }
  await renderGradeModule();
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Nilai berhasil disimpan');
});

async function renderAssessmentList(){
  const box=document.getElementById('assessmentList');
  if(!box) return;
  const selected=Number(document.getElementById('assessmentSelect')?.value||0);
  const list=(await getAssessments()).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id)).slice(0,8);
  if(!list.length){
    box.innerHTML='<div class="empty-state" style="padding:22px 8px"><p>Belum ada penilaian tersimpan.</p></div>';
    return;
  }
  box.innerHTML=list.map(a=>`
    <div class="assessment-list-item ${Number(a.id)===selected?'active':''}" data-assessment-jump="${a.id}">
      <div class="assessment-list-main">
        <strong>${escapeHTML(a.name)}</strong>
        <small>${escapeHTML(a.className||'Semua kelas')} • ${formatDateID(a.date||'')}</small>
      </div>
      <span class="assessment-type-badge">${escapeHTML(a.type||'')}</span>
    </div>`).join('');
}

document.getElementById('assessmentList')?.addEventListener('click',async e=>{
  const item=e.target.closest('[data-assessment-jump]');
  if(!item) return;
  document.getElementById('assessmentSelect').value=String(item.dataset.assessmentJump);
  await renderGradeModule();
});

async function renderGradeModule(){
  await populateAssessmentSelect();
  await populateGradeClassFilter();
  await renderGradeTableOnly();
  await renderAssessmentList();

  const gradeCount=(await getGrades()).filter(g=>g.finalScore!=='' && g.finalScore!==null && g.finalScore!==undefined).length;
  const dash=document.querySelector('#dashboard .stat-card:nth-child(4) strong');
  if(dash) dash.textContent=gradeCount;
}


// ===== SIAGA GURU v1.4 - MODUL WALI KELAS =====
const homeroomDialog = document.getElementById('homeroomDialog');
const homeroomForm = document.getElementById('homeroomForm');
const legerDialog = document.getElementById('legerDialog');

async function getHomeroomProfiles(){ return await idbGetAll('homeroomProfiles'); }
async function getHomeroomNotes(){ return await periodFiltered('homeroomNotes'); }

async function populateHomeroomClassFilter(){
  const select=document.getElementById('homeroomClassFilter');
  if(!select) return;
  const current=select.value;
  const students=await getActiveStudents();
  const teachingClasses=(await getTeachingContexts()).map(x=>x.className).filter(Boolean);
  const classes=[...new Set([...students.map(s=>s.className),...teachingClasses].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));
  select.innerHTML='<option value="">Semua Kelas</option>'+classes.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if(classes.includes(current)) select.value=current;
}

async function buildStudentMetrics(){
  const students=await getActiveStudents();
  const attendance=await getAllAttendance();
  const grades=await getGrades();
  const profiles=await getHomeroomProfiles();
  const notes=await getHomeroomNotes();

  const map=new Map();
  for(const s of students){
    const att=attendance.filter(a=>Number(a.studentId)===Number(s.id));
    const attCount={H:0,S:0,I:0,A:0,T:0};
    att.forEach(a=>{ if(attCount[a.status]!==undefined) attCount[a.status]++; });

    const studentGrades=grades.filter(g=>Number(g.studentId)===Number(s.id) && g.finalScore!=='' && g.finalScore!==null && g.finalScore!==undefined);
    const gradeVals=studentGrades.map(g=>Number(g.finalScore)).filter(v=>!Number.isNaN(v));
    const avg=gradeVals.length ? Math.round((gradeVals.reduce((a,b)=>a+b,0)/gradeVals.length)*10)/10 : 0;
    const passed=studentGrades.filter(g=>g.passed).length;
    const noteCount=notes.filter(n=>Number(n.studentId)===Number(s.id)).length;
    const profile=profiles.find(p=>Number(p.studentId)===Number(s.id))||{status:'Aktif'};

    const attentionScore=(attCount.A*3)+(attCount.T*1)+(avg>0 && avg<75 ? 3 : 0)+(noteCount>0 ? 1 : 0);
    map.set(Number(s.id),{
      student:s,attCount,avg,passed,gradeCount:studentGrades.length,noteCount,profile,
      attentionScore
    });
  }
  return map;
}

async function renderHomeroom(){
  await populateHomeroomClassFilter();
  const metrics=await buildStudentMetrics();
  const classFilter=document.getElementById('homeroomClassFilter')?.value||'';
  const q=(document.getElementById('homeroomSearch')?.value||'').trim().toLowerCase();

  let rows=[...metrics.values()].filter(m=>{
    const s=m.student;
    if(classFilter && s.className!==classFilter) return false;
    if(q && !(`${s.name||''} ${s.nis||''}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>(a.student.name||'').localeCompare(b.student.name||'','id'));

  const tbody=document.getElementById('homeroomTableBody');
  const empty=document.getElementById('homeroomEmpty');
  const wrap=document.getElementById('homeroomTableWrap');
  tbody.innerHTML='';

  if(!rows.length){
    empty.style.display='block';
    wrap.style.display='none';
  }else{
    empty.style.display='none';
    wrap.style.display='block';
    rows.forEach((m,i)=>{
      const s=m.student, st=m.profile.status||'Aktif';
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${i+1}</td>
        <td><strong>${escapeHTML(s.name||'')}</strong></td>
        <td>${escapeHTML(s.nis||'-')}</td>
        <td>${escapeHTML(s.className||'-')}</td>
        <td><div class="attendance-inline">
          <span class="attendance-chip">H ${m.attCount.H}</span>
          <span class="attendance-chip">S ${m.attCount.S}</span>
          <span class="attendance-chip">I ${m.attCount.I}</span>
          <span class="attendance-chip">A ${m.attCount.A}</span>
          <span class="attendance-chip">T ${m.attCount.T}</span>
        </div></td>
        <td><strong>${m.gradeCount?m.avg:'-'}</strong></td>
        <td>${m.noteCount}</td>
        <td><span class="student-status ${st==='Aktif'?'active':'inactive'}">${escapeHTML(st)}</span></td>
        <td><button class="table-action homeroom-detail-btn" data-student-id="${s.id}">Detail</button></td>`;
      tbody.appendChild(tr);
    });
  }

  const all=[...metrics.values()];
  document.getElementById('homeTotalStudents').textContent=all.length;
  document.getElementById('homeActiveStudents').textContent=all.filter(m=>(m.profile.status||'Aktif')==='Aktif').length;
  document.getElementById('homeAttentionStudents').textContent=all.filter(m=>m.attentionScore>=3).length;
  document.getElementById('homeNotesCount').textContent=(await getHomeroomNotes()).length;

  await renderHomeroomAttention(all);
  await renderHomeroomRecentNotes();
}

async function renderHomeroomAttention(allMetrics=null){
  const box=document.getElementById('homeroomAttentionList');
  if(!box) return;
  const list=(allMetrics||[...((await buildStudentMetrics()).values())])
    .filter(m=>m.attentionScore>=3)
    .sort((a,b)=>b.attentionScore-a.attentionScore)
    .slice(0,6);

  if(!list.length){
    box.innerHTML='<div class="empty-state" style="padding:22px 8px"><p>Belum ada siswa yang terdeteksi perlu perhatian khusus.</p></div>';
    return;
  }
  box.innerHTML=list.map(m=>`
    <div class="attention-item">
      <div><strong>${escapeHTML(m.student.name||'')}</strong><small>${escapeHTML(m.student.className||'-')} • A ${m.attCount.A} • T ${m.attCount.T} • Rata-rata ${m.gradeCount?m.avg:'-'}</small></div>
      <div class="attention-score">Skor ${m.attentionScore}</div>
    </div>`).join('');
}

async function renderHomeroomRecentNotes(){
  const box=document.getElementById('homeroomRecentNotes'); if(!box) return;
  const students=await getActiveStudents();
  const notes=(await getHomeroomNotes()).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id)).slice(0,6);
  if(!notes.length){
    box.innerHTML='<div class="empty-state" style="padding:22px 8px"><p>Belum ada catatan wali kelas.</p></div>';
    return;
  }
  box.innerHTML=notes.map(n=>{
    const s=students.find(x=>Number(x.id)===Number(n.studentId));
    return `<div class="history-item">
      <div><strong>${escapeHTML(s?.name||'Siswa')}</strong><br><small>${formatDateID(n.date||'')} • ${escapeHTML(n.category||'Catatan')}</small></div>
      <div style="max-width:52%;font-size:12px;color:var(--muted);text-align:right">${escapeHTML(n.note||'')}</div>
    </div>`;
  }).join('');
}

document.getElementById('homeroomClassFilter')?.addEventListener('change',()=>renderHomeroom());
document.getElementById('homeroomSearch')?.addEventListener('input',()=>renderHomeroom());

document.getElementById('homeroomTableBody')?.addEventListener('click',async e=>{
  const btn=e.target.closest('.homeroom-detail-btn');
  if(!btn) return;
  await openHomeroomDialog(Number(btn.dataset.studentId));
});

async function openHomeroomDialog(studentId){
  const students=await getActiveStudents();
  const s=students.find(x=>Number(x.id)===Number(studentId));
  if(!s) return;
  const profiles=await getHomeroomProfiles();
  const p=profiles.find(x=>Number(x.studentId)===Number(studentId))||{studentId,status:'Aktif'};
  const metrics=(await buildStudentMetrics()).get(Number(studentId));

  homeroomForm.reset();
  homeroomForm.elements.studentId.value=studentId;
  homeroomForm.elements.parentName.value=p.parentName||'';
  homeroomForm.elements.parentPhone.value=p.parentPhone||'';
  homeroomForm.elements.address.value=p.address||'';
  homeroomForm.elements.status.value=p.status||'Aktif';
  homeroomForm.elements.mutationDate.value=p.mutationDate||'';
  homeroomForm.elements.mutationNote.value=p.mutationNote||'';

  const initials=(s.name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  document.getElementById('homeroomDialogTitle').textContent=s.name||'Detail Siswa';
  document.getElementById('homeroomStudentSummary').innerHTML=`
    <div class="student-summary-avatar">${escapeHTML(initials)}</div>
    <div class="student-summary-main"><strong>${escapeHTML(s.name||'')}</strong><small>NIS ${escapeHTML(s.nis||'-')} • ${escapeHTML(s.className||'-')} • JK ${escapeHTML(s.gender||'-')}</small></div>
    <div class="student-summary-stats">Kehadiran: H ${metrics.attCount.H} / A ${metrics.attCount.A} / T ${metrics.attCount.T}<br>Rata-rata nilai: ${metrics.gradeCount?metrics.avg:'-'}</div>`;

  document.getElementById('homeroomNoteDate').value=localISODate();
  document.getElementById('homeroomNoteCategory').value='Akademik';
  document.getElementById('homeroomNoteText').value='';
  await renderStudentHomeroomNotes(studentId);
  homeroomDialog.showModal();
}

document.getElementById('saveHomeroomBtn')?.addEventListener('click',async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(homeroomForm).entries());
  data.studentId=Number(data.studentId);
  data.updatedAt=new Date().toISOString();
  await idbPut('homeroomProfiles',data);
  homeroomDialog.close();
  await renderHomeroom();
  showToast('Data wali kelas berhasil disimpan');
});

document.getElementById('addHomeroomNoteBtn')?.addEventListener('click',async()=>{
  const studentId=Number(homeroomForm.elements.studentId.value);
  const date=document.getElementById('homeroomNoteDate').value||localISODate();
  const category=document.getElementById('homeroomNoteCategory').value;
  const note=document.getElementById('homeroomNoteText').value.trim();
  if(!studentId || !note){ showToast('Isi catatan terlebih dahulu'); return; }
  await idbAdd('homeroomNotes',{studentId,date,category,note,periodKey:await activePeriodKey(),createdAt:new Date().toISOString()});
  document.getElementById('homeroomNoteText').value='';
  await renderStudentHomeroomNotes(studentId);
  await renderHomeroom();
  try{ await renderSmartDashboard(); }catch(_){}
  showToast('Catatan wali kelas ditambahkan');
});

async function renderStudentHomeroomNotes(studentId){
  const box=document.getElementById('studentHomeroomNotes');
  const notes=(await getHomeroomNotes()).filter(n=>Number(n.studentId)===Number(studentId)).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id));
  if(!notes.length){
    box.innerHTML='<div class="empty-state" style="padding:18px 8px"><p>Belum ada catatan untuk siswa ini.</p></div>';
    return;
  }
  box.innerHTML=notes.map(n=>`
    <div class="student-note-item">
      <div><small>${formatDateID(n.date||'')}</small></div>
      <div><span class="note-category">${escapeHTML(n.category||'Catatan')}</span><p>${escapeHTML(n.note||'')}</p></div>
      <button type="button" class="table-action delete delete-home-note" data-note-id="${n.id}">Hapus</button>
    </div>`).join('');
}

document.getElementById('studentHomeroomNotes')?.addEventListener('click',async e=>{
  const btn=e.target.closest('.delete-home-note');
  if(!btn) return;
  if(!confirm('Hapus catatan ini?')) return;
  await idbDelete('homeroomNotes',Number(btn.dataset.noteId));
  const studentId=Number(homeroomForm.elements.studentId.value);
  await renderStudentHomeroomNotes(studentId);
  await renderHomeroom();
  showToast('Catatan dihapus');
});

document.getElementById('openLegerBtn')?.addEventListener('click',async()=>{
  await renderLeger();
  legerDialog.showModal();
});
document.getElementById('closeLegerBtn')?.addEventListener('click',()=>legerDialog.close());

async function renderLeger(){
  const tbody=document.getElementById('legerTableBody');
  const classFilter=document.getElementById('homeroomClassFilter')?.value||'';
  const metrics=await buildStudentMetrics();
  const rows=[...metrics.values()].filter(m=>!classFilter || m.student.className===classFilter).sort((a,b)=>(a.student.name||'').localeCompare(b.student.name||'','id'));
  tbody.innerHTML=rows.map((m,i)=>{
    const s=m.student, st=m.profile.status||'Aktif';
    return `<tr>
      <td>${i+1}</td><td>${escapeHTML(s.name||'')}</td><td>${escapeHTML(s.className||'-')}</td>
      <td>${m.attCount.H}</td><td>${m.attCount.S}</td><td>${m.attCount.I}</td><td>${m.attCount.A}</td><td>${m.attCount.T}</td>
      <td>${m.gradeCount?m.avg:'-'}</td><td>${m.passed}/${m.gradeCount}</td><td>${escapeHTML(st)}</td>
    </tr>`;
  }).join('');
}


// ===== SIAGA GURU v1.5 - LAPORAN & CETAK =====
function cleanFileName(v){
  return String(v||'laporan').toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'');
}
function escapeXML(v){
  return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function reportDateID(){
  const d=new Date();
  return d.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
}
function statusText(v){ return v || '-'; }

async function populateReportFilters(){
  const students=await getActiveStudents();
  const assessments=await getAssessments();
  const classSelect=document.getElementById('reportClass');
  const assessmentSelect=document.getElementById('reportAssessment');
  const currentClass=classSelect?.value||'';
  const currentAssessment=assessmentSelect?.value||'';

  const teachingClasses=(await getTeachingContexts()).map(x=>x.className).filter(Boolean);
  const classes=[...new Set([
    ...students.map(s=>s.className),
    ...assessments.map(a=>a.className),
    ...teachingClasses
  ].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));

  if(classSelect){
    classSelect.innerHTML='<option value="">Semua Kelas</option>'+classes.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    if(classes.includes(currentClass)) classSelect.value=currentClass;
  }

  if(assessmentSelect){
    const sorted=[...assessments].sort((a,b)=>(b.date||'').localeCompare(a.date||'') || Number(b.id)-Number(a.id));
    assessmentSelect.innerHTML='<option value="">Pilih penilaian...</option>'+sorted.map(a=>`<option value="${a.id}">${escapeHTML(a.name)}${a.className?' • '+escapeHTML(a.className):''}</option>`).join('');
    if(sorted.some(a=>String(a.id)===String(currentAssessment))) assessmentSelect.value=currentAssessment;
  }
}

function updateReportFilterVisibility(){
  const type=document.getElementById('reportType')?.value||'students';
  const monthWrap=document.getElementById('reportMonthWrap');
  const assessmentWrap=document.getElementById('reportAssessmentWrap');
  if(monthWrap) monthWrap.classList.toggle('hidden', !['attendance','journal'].includes(type));
  if(assessmentWrap) assessmentWrap.classList.toggle('hidden', type!=='grades');
}

async function reportBase(){
  const profile=await idbGet('profile','main')||{};
  const activeSession=await getActivePeriod();
  const header=document.getElementById('reportHeader');
  const meta=document.getElementById('reportMeta');
  const signature=document.getElementById('reportSignature');
  const footer=document.getElementById('reportFooter');

  const logoProv = profile.provinceLogo
    ? `<img src="${profile.provinceLogo}" alt="Logo Provinsi">`
    : `<div class="report-logo-fallback">LOGO<br>PROVINSI</div>`;
  const logoSchool = profile.schoolLogo
    ? `<img src="${profile.schoolLogo}" alt="Logo Sekolah">`
    : `<div class="report-logo-fallback">LOGO<br>SEKOLAH</div>`;

  if(header){
    header.innerHTML=`
      <div class="report-kop">
        <div class="report-logo-box">${logoProv}</div>
        <div class="report-kop-main">
          ${profile.authorityName ? `<div class="report-authority">${escapeHTML(profile.authorityName)}</div>` : ''}
          <div class="report-school-name">${escapeHTML((profile.school||'SEKOLAH').toUpperCase())}</div>
          <div class="report-school-address">${profile.schoolAddress ? escapeHTML(profile.schoolAddress) : '&nbsp;'}</div>
          <div class="report-school-extra">
            ${profile.schoolId ? `NPSN/ID: ${escapeHTML(profile.schoolId)}` : ''}
            ${profile.schoolId && profile.teacherPhone ? ' • ' : ''}
            ${profile.teacherPhone ? `Kontak: ${escapeHTML(profile.teacherPhone)}` : ''}
          </div>
        </div>
        <div class="report-logo-box">${logoSchool}</div>
      </div>
      <div class="report-kop-line"><span></span><i></i></div>`;
  }

  if(meta){
    meta.innerHTML=`
      <table class="report-identity-table">
        <tbody>
          <tr>
            <th>Nama Guru</th><td>${escapeHTML(profile.teacher||'-')}</td>
            <th>Semester</th><td>${escapeHTML(activeSession?.semester||profile.semester||'-')}</td>
          </tr>
          <tr>
            <th>NIP / ID Guru</th><td>${escapeHTML(profile.teacherId||'-')}</td>
            <th>Tahun Ajaran</th><td>${escapeHTML(activeSession?.year||profile.year||'-')}</td>
          </tr>
          <tr>
            <th>Mata Pelajaran</th><td>${escapeHTML(profile.subject||'-')}</td>
            <th>Kelas / Peran</th><td>${escapeHTML(profile.className||profile.role||'-')}</td>
          </tr>
          <tr>
            <th>Kepala Sekolah</th><td>${escapeHTML(profile.principalName||'-')}</td>
            <th>NIP Kepala Sekolah</th><td>${escapeHTML(profile.principalId||'-')}</td>
          </tr>
        </tbody>
      </table>`;
  }

  if(signature){
    const city=profile.reportCity||'........................';
    const today=new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
    signature.innerHTML=`
      <div class="signature-box">
        <div class="signature-heading">Mengetahui,<br>Kepala Sekolah</div>
        <div class="signature-space"></div>
        <strong>${escapeHTML(profile.principalName||'........................................')}</strong>
        <small>NIP. ${escapeHTML(profile.principalId||'........................................')}</small>
      </div>
      <div class="signature-box">
        <div class="signature-heading">${escapeHTML(city)}, ${escapeHTML(today)}<br>Guru / Wali Kelas</div>
        <div class="signature-space"></div>
        <strong>${escapeHTML(profile.teacher||'........................................')}</strong>
        <small>NIP. ${escapeHTML(profile.teacherId||'........................................')}</small>
      </div>`;
  }

  if(footer){
    footer.innerHTML=`
      <span>SIAGA GURU • Sistem Informasi Administrasi Guru</span>
      <span>Dicetak ${escapeHTML(new Date().toLocaleString('id-ID'))}</span>`;
  }

  return profile;
}

function reportTitleHTML(title,subtitle=''){
  return `<div class="report-title-wrap"><div class="report-title">${escapeHTML(title)}</div>${subtitle?`<div class="report-subtitle">${escapeHTML(subtitle)}</div>`:''}</div>`;
}

async function buildStudentsReport(){
  const students=await getActiveStudents();
  const classFilter=document.getElementById('reportClass')?.value||'';
  const rows=students.filter(s=>!classFilter || s.className===classFilter).sort((a,b)=>(a.name||'').localeCompare(b.name||'','id'));
  const title=`Daftar Siswa${classFilter?' - '+classFilter:''}`;
  if(!rows.length) return {title,html:reportTitleHTML(title)+`<div class="report-empty">Belum ada data siswa.</div>`};

  const body=rows.map((s,i)=>`<tr>
    <td class="num">${i+1}</td><td>${escapeHTML(s.name||'')}</td><td>${escapeHTML(s.nis||'-')}</td>
    <td class="num">${escapeHTML(s.gender||'-')}</td><td>${escapeHTML(s.className||'-')}</td>
  </tr>`).join('');

  return {title,html:reportTitleHTML(title,`${rows.length} siswa`)+`
    <table class="report-table"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>JK</th><th>Kelas</th></tr></thead><tbody>${body}</tbody></table>`};
}

async function buildAttendanceReport(){
  const students=await getActiveStudents();
  const attendance=await getAllAttendance();
  const classFilter=document.getElementById('reportClass')?.value||'';
  const month=document.getElementById('reportMonth')?.value||monthISO();

  const rows=students.filter(s=>!classFilter || s.className===classFilter).sort((a,b)=>(a.name||'').localeCompare(b.name||'','id')).map(s=>{
    const att=attendance.filter(a=>Number(a.studentId)===Number(s.id) && String(a.date||'').startsWith(month));
    const c={H:0,S:0,I:0,A:0,T:0};
    att.forEach(a=>{if(c[a.status]!==undefined)c[a.status]++;});
    return {s,c,total:att.length};
  });

  const title=`Rekap Absensi${classFilter?' - '+classFilter:''}`;
  const monthText=month ? new Date(month+'-01T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}) : '';
  if(!rows.length) return {title,html:reportTitleHTML(title,monthText)+`<div class="report-empty">Belum ada data siswa.</div>`};

  const body=rows.map((r,i)=>`<tr>
    <td class="num">${i+1}</td><td>${escapeHTML(r.s.name||'')}</td><td>${escapeHTML(r.s.nis||'-')}</td><td>${escapeHTML(r.s.className||'-')}</td>
    <td class="num">${r.c.H}</td><td class="num">${r.c.S}</td><td class="num">${r.c.I}</td><td class="num">${r.c.A}</td><td class="num">${r.c.T}</td><td class="num">${r.total}</td>
  </tr>`).join('');

  return {title,html:reportTitleHTML(title,monthText)+`
    <table class="report-table"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>Kelas</th><th>H</th><th>S</th><th>I</th><th>A</th><th>T</th><th>Total</th></tr></thead><tbody>${body}</tbody></table>`};
}

async function buildJournalReport(){
  const journals=await getJournals();
  const classFilter=document.getElementById('reportClass')?.value||'';
  const month=document.getElementById('reportMonth')?.value||monthISO();
  const rows=journals.filter(j=>(!classFilter || j.className===classFilter) && (!month || String(j.date||'').startsWith(month))).sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const title=`Jurnal Mengajar${classFilter?' - '+classFilter:''}`;
  const monthText=month ? new Date(month+'-01T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}) : '';
  if(!rows.length) return {title,html:reportTitleHTML(title,monthText)+`<div class="report-empty">Belum ada jurnal pada periode ini.</div>`};

  const body=rows.map((j,i)=>`<tr>
    <td class="num">${i+1}</td><td>${formatDateID(j.date||'')}</td><td>${escapeHTML(j.className||'-')}</td><td>${escapeHTML(j.subject||'-')}</td>
    <td class="num">${Number(j.jp||0)}</td><td>${escapeHTML(j.topic||'-')}</td><td>${escapeHTML(j.objective||'-')}</td>
    <td>${escapeHTML(j.method||'-')}</td><td>${escapeHTML(j.status||'-')}</td><td>${escapeHTML(j.notes||'-')}</td>
  </tr>`).join('');

  return {title,html:reportTitleHTML(title,monthText)+`
    <table class="report-table"><thead><tr><th>No</th><th>Tanggal</th><th>Kelas</th><th>Mapel</th><th>JP</th><th>Materi</th><th>Tujuan</th><th>Metode</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${body}</tbody></table>`};
}

async function buildGradesReport(){
  const assessmentId=Number(document.getElementById('reportAssessment')?.value||0);
  const assessments=await getAssessments();
  const a=assessments.find(x=>x.id===assessmentId);
  if(!a){
    return {title:'Daftar Nilai',html:reportTitleHTML('Daftar Nilai')+`<div class="report-empty">Pilih penilaian terlebih dahulu.</div>`};
  }
  const students=await getActiveStudents();
  const grades=await getGrades();
  const classFilter=document.getElementById('reportClass')?.value||a.className||'';
  const rows=students.filter(s=>(!classFilter || s.className===classFilter) && (!a.className || !s.className || s.className===a.className)).sort((x,y)=>(x.name||'').localeCompare(y.name||'','id')).map(s=>{
    const g=grades.find(x=>Number(x.assessmentId)===assessmentId && Number(x.studentId)===Number(s.id))||{};
    const finalScore=computeFinal(g.rawScore,g.remedialScore);
    return {s,g,finalScore};
  });
  const vals=rows.map(r=>r.finalScore).filter(x=>x!=='' && x!==null && x!==undefined).map(Number);
  const avg=vals.length?Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*10)/10:0;
  const pass=vals.filter(v=>v>=Number(a.kkm||75)).length;

  const title=`Daftar Nilai - ${a.name}`;
  const summary=`<div class="report-summary-cards">
    <div class="report-summary-card"><small>KKTP/KKM</small><strong>${a.kkm}</strong></div>
    <div class="report-summary-card"><small>Rata-rata</small><strong>${avg}</strong></div>
    <div class="report-summary-card"><small>Tuntas</small><strong>${pass}</strong></div>
    <div class="report-summary-card"><small>Terisi</small><strong>${vals.length}/${rows.length}</strong></div>
  </div>`;

  const body=rows.map((r,i)=>`<tr>
    <td class="num">${i+1}</td><td>${escapeHTML(r.s.name||'')}</td><td>${escapeHTML(r.s.nis||'-')}</td><td>${escapeHTML(r.s.className||'-')}</td>
    <td class="num">${r.g.rawScore??'-'}</td><td class="num">${r.g.remedialScore??'-'}</td><td class="num">${r.finalScore===''?'-':r.finalScore}</td>
    <td class="num">${r.finalScore===''?'-':(Number(r.finalScore)>=Number(a.kkm||75)?'Tuntas':'Belum Tuntas')}</td>
  </tr>`).join('');

  return {title,html:reportTitleHTML(title,`${a.type} • ${a.subject||'-'} • ${formatDateID(a.date||'')}`)+summary+`
    <table class="report-table"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>Kelas</th><th>Nilai Awal</th><th>Remedial</th><th>Nilai Akhir</th><th>Ketuntasan</th></tr></thead><tbody>${body}</tbody></table>`};
}

async function buildHomeroomReport(){
  const classFilter=document.getElementById('reportClass')?.value||'';
  const metrics=await buildStudentMetrics();
  const rows=[...metrics.values()].filter(m=>!classFilter || m.student.className===classFilter).sort((a,b)=>(a.student.name||'').localeCompare(b.student.name||'','id'));
  const title=`Leger Wali Kelas${classFilter?' - '+classFilter:''}`;
  if(!rows.length) return {title,html:reportTitleHTML(title)+`<div class="report-empty">Belum ada data siswa.</div>`};

  const body=rows.map((m,i)=>`<tr>
    <td class="num">${i+1}</td><td>${escapeHTML(m.student.name||'')}</td><td>${escapeHTML(m.student.nis||'-')}</td><td>${escapeHTML(m.student.className||'-')}</td>
    <td class="num">${m.attCount.H}</td><td class="num">${m.attCount.S}</td><td class="num">${m.attCount.I}</td><td class="num">${m.attCount.A}</td><td class="num">${m.attCount.T}</td>
    <td class="num">${m.gradeCount?m.avg:'-'}</td><td class="num">${m.passed}/${m.gradeCount}</td><td>${escapeHTML(m.profile.status||'Aktif')}</td><td class="num">${m.noteCount}</td>
  </tr>`).join('');

  return {title,html:reportTitleHTML(title)+`
    <table class="report-table"><thead><tr><th>No</th><th>Nama</th><th>NIS</th><th>Kelas</th><th>H</th><th>S</th><th>I</th><th>A</th><th>T</th><th>Rata-rata</th><th>Tuntas</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${body}</tbody></table>`};
}

async function renderReport(){
  await reportBase();
  await populateReportFilters();
  updateReportFilterVisibility();
  const type=document.getElementById('reportType')?.value||'students';
  let result;
  if(type==='attendance') result=await buildAttendanceReport();
  else if(type==='journal') result=await buildJournalReport();
  else if(type==='grades') result=await buildGradesReport();
  else if(type==='homeroom') result=await buildHomeroomReport();
  else result=await buildStudentsReport();

  document.getElementById('reportContent').innerHTML=result.html;
  document.getElementById('reportPaper').dataset.reportTitle=result.title;
}

document.getElementById('reportType')?.addEventListener('change',async()=>{
  updateReportFilterVisibility();
  await renderReport();
});
['reportClass','reportMonth','reportAssessment'].forEach(id=>{
  document.getElementById(id)?.addEventListener('change',()=>renderReport());
});
document.getElementById('refreshReportBtn')?.addEventListener('click',()=>renderReport());

document.getElementById('printReportBtn')?.addEventListener('click',async()=>{
  await renderReport();
  setTimeout(()=>window.print(),80);
});

function tableToExcelHTML(table,title,profile){
  const pre=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="UTF-8"><style>
  table{border-collapse:collapse;font-family:Arial;font-size:10pt}th,td{border:1px solid #000;padding:5px}th{background:#eaeaea}
  h2,h3,p{text-align:center;margin:4px}
  </style></head><body>
  <h2>${escapeXML(profile.school||'SEKOLAH')}</h2><h3>${escapeXML(title)}</h3>
  <p>${escapeXML(profile.teacher||'')} | ${escapeXML(profile.subject||'')} | ${escapeXML(profile.year||'')}</p>`;
  return pre+table.outerHTML+'</body></html>';
}

document.getElementById('exportExcelBtn')?.addEventListener('click',async()=>{
  await renderReport();
  const table=document.querySelector('#reportContent table');
  if(!table){ showToast('Tidak ada tabel untuk diekspor'); return; }
  const profile=await idbGet('profile','main')||{};
  const title=document.getElementById('reportPaper').dataset.reportTitle||'Laporan';
  const html=tableToExcelHTML(table,title,profile);
  const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${cleanFileName(title)}.xls`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('File Excel berhasil dibuat');
});

// ===== SIAGA GURU v1.6 - IMPORT EXCEL / CSV =====
const importStudentDialog=document.getElementById('importStudentDialog');
let importStudentRows=[];
let importStudentHeaders=[];
let importStudentPreview=[];

function normalizeHeader(v){
  return String(v??'').trim().toLowerCase().replace(/[\s_\-./()]+/g,' ').replace(/\s+/g,' ');
}
function normalizeGender(v){
  const s=String(v??'').trim().toLowerCase();
  if(['l','lk','laki','laki laki','laki-laki','male','pria'].includes(s)) return 'L';
  if(['p','pr','perempuan','female','wanita'].includes(s)) return 'P';
  return String(v??'').trim().toUpperCase().slice(0,1);
}
function detectColumn(headers,synonyms){
  const n=headers.map(normalizeHeader);
  for(const syn of synonyms){const i=n.indexOf(normalizeHeader(syn));if(i>=0)return i;}
  for(const syn of synonyms){const s=normalizeHeader(syn);const i=n.findIndex(h=>h.includes(s)||s.includes(h));if(i>=0)return i;}
  return -1;
}
function decodeCSV(text){
  text=String(text||'').replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"'){if(quoted&&next==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];}
    else cell+=ch;
  }
  row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);return rows;
}
function u16(a,o){return a[o]|(a[o+1]<<8)}
function u32(a,o){return (a[o]|(a[o+1]<<8)|(a[o+2]<<16)|(a[o+3]<<24))>>>0}
async function inflateRaw(bytes){
  if(typeof DecompressionStream==='undefined') throw new Error('Browser belum mendukung pembacaan XLSX offline. Gunakan Chrome/Edge terbaru atau simpan file sebagai CSV.');
  const ds=new DecompressionStream('deflate-raw');
  const stream=new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntries(buf){
  const data=new Uint8Array(buf);let eocd=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){if(u32(data,i)===0x06054b50){eocd=i;break;}}
  if(eocd<0) throw new Error('File XLSX tidak valid.');
  const count=u16(data,eocd+10);let ptr=u32(data,eocd+16);const dec=new TextDecoder('utf-8');const files={};
  for(let i=0;i<count;i++){
    if(u32(data,ptr)!==0x02014b50) throw new Error('Struktur XLSX tidak dikenali.');
    const method=u16(data,ptr+10),compSize=u32(data,ptr+20),nameLen=u16(data,ptr+28),extraLen=u16(data,ptr+30),commentLen=u16(data,ptr+32),localOffset=u32(data,ptr+42);
    const name=dec.decode(data.slice(ptr+46,ptr+46+nameLen));
    if(u32(data,localOffset)!==0x04034b50) throw new Error('Data XLSX rusak.');
    const localNameLen=u16(data,localOffset+26),localExtraLen=u16(data,localOffset+28),start=localOffset+30+localNameLen+localExtraLen;
    const comp=data.slice(start,start+compSize);let out;
    if(method===0) out=comp; else if(method===8) out=await inflateRaw(comp); else throw new Error('Kompresi XLSX ini belum didukung.');
    files[name]=dec.decode(out);ptr+=46+nameLen+extraLen+commentLen;
  }
  return files;
}
function xmlDecode(v){return String(v??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'")}
function colIndex(ref){const m=String(ref||'').match(/[A-Z]+/i);if(!m)return 0;let n=0;for(const ch of m[0].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1}
async function parseXLSX(file){
  const files=await unzipEntries(await file.arrayBuffer());let shared=[];
  if(files['xl/sharedStrings.xml']){
    const xml=files['xl/sharedStrings.xml'];
    shared=[...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>xmlDecode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join('')));
  }
  let sheetPath='xl/worksheets/sheet1.xml';
  const wb=files['xl/workbook.xml'],rels=files['xl/_rels/workbook.xml.rels'];
  if(wb&&rels){
    const sm=wb.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/);
    if(sm){const rid=sm[1];const rm=[...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].find(x=>x[1]===rid);if(rm){let t=rm[2].replace(/^\/+/, '');sheetPath=t.startsWith('xl/')?t:'xl/'+t.replace(/^\.\//,'');}}
  }
  const sx=files[sheetPath]||files['xl/worksheets/sheet1.xml'];if(!sx) throw new Error('Worksheet pertama tidak ditemukan.');
  const rows=[];
  for(const rm of sx.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];
    for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const attrs=cm[1],inner=cm[2],ref=(attrs.match(/\br="([^"]+)"/)||[])[1]||'A1',type=(attrs.match(/\bt="([^"]+)"/)||[])[1]||'';let value='';
      if(type==='inlineStr') value=xmlDecode([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''));
      else {const vm=inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);value=vm?xmlDecode(vm[1]):'';if(type==='s')value=shared[Number(value)]??'';}
      row[colIndex(ref)]=value;
    }
    rows.push(row.map(v=>v??''));
  }
  return rows.filter(r=>r.some(v=>String(v).trim()!==''));
}
function resetStudentImport(){
  importStudentRows=[];importStudentHeaders=[];importStudentPreview=[];
  const f=document.getElementById('studentImportFile');if(f)f.value='';
  document.getElementById('importMappingWrap').classList.add('hidden');document.getElementById('importPreviewWrap').classList.add('hidden');
  const er=document.getElementById('importError');er.classList.add('hidden');er.textContent='';document.getElementById('executeImportStudentBtn').disabled=true;
}
document.getElementById('importStudentBtn')?.addEventListener('click',()=>{resetStudentImport();importStudentDialog.showModal();});
document.getElementById('closeImportStudentBtn')?.addEventListener('click',()=>importStudentDialog.close());
document.getElementById('cancelImportStudentBtn')?.addEventListener('click',()=>importStudentDialog.close());
async function loadStudentImportFile(file){
  try{
    if(!file)return;const ext=file.name.toLowerCase().split('.').pop();let rows;
    if(ext==='csv')rows=decodeCSV(await file.text());else if(ext==='xlsx')rows=await parseXLSX(file);else throw new Error('Format belum didukung. Gunakan .xlsx atau .csv.');
    if(rows.length<2)throw new Error('File tidak memiliki data yang cukup.');
    importStudentHeaders=rows[0].map(v=>String(v??'').trim());importStudentRows=rows.slice(1).filter(r=>r.some(v=>String(v??'').trim()!==''));
    setupStudentImportMapping();await buildStudentImportPreview();document.getElementById('importMappingWrap').classList.remove('hidden');document.getElementById('importPreviewWrap').classList.remove('hidden');
  }catch(err){const el=document.getElementById('importError');el.textContent='Gagal membaca file: '+err.message;el.classList.remove('hidden');}
}
document.getElementById('studentImportFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)loadStudentImportFile(f)});
const importDrop=document.getElementById('studentImportDropzone');
importDrop?.addEventListener('dragover',e=>{e.preventDefault();importDrop.classList.add('dragover')});importDrop?.addEventListener('dragleave',()=>importDrop.classList.remove('dragover'));importDrop?.addEventListener('drop',e=>{e.preventDefault();importDrop.classList.remove('dragover');const f=e.dataTransfer.files?.[0];if(f)loadStudentImportFile(f)});
function setupStudentImportMapping(){
  for(const id of ['mapName','mapNis','mapGender','mapClass']){const sel=document.getElementById(id);sel.innerHTML='<option value="-1">-- Tidak dipakai --</option>'+importStudentHeaders.map((h,i)=>`<option value="${i}">${escapeHTML(h||'Kolom '+(i+1))}</option>`).join('');}
  const d={mapName:detectColumn(importStudentHeaders,['nama siswa','nama lengkap','nama']),mapNis:detectColumn(importStudentHeaders,['nis','nisn','nomor induk','no induk']),mapGender:detectColumn(importStudentHeaders,['jk','jenis kelamin','gender','kelamin']),mapClass:detectColumn(importStudentHeaders,['kelas','rombel','rombongan belajar'])};
  for(const [id,idx] of Object.entries(d))document.getElementById(id).value=String(idx);
}
['mapName','mapNis','mapGender','mapClass','importDefaultClass','importDuplicateMode'].forEach(id=>{document.getElementById(id)?.addEventListener('change',()=>buildStudentImportPreview());document.getElementById(id)?.addEventListener('input',()=>buildStudentImportPreview());});
function mappedStudentFromRow(row){
  const idx=id=>Number(document.getElementById(id).value),pick=i=>i>=0?String(row[i]??'').trim():'';
  return {name:pick(idx('mapName')),nis:pick(idx('mapNis')),gender:normalizeGender(pick(idx('mapGender'))),className:pick(idx('mapClass'))||document.getElementById('importDefaultClass').value.trim()};
}
async function buildStudentImportPreview(){
  if(!importStudentRows.length)return;const existing=await idbGetAll('students');const nisMap=new Map(existing.filter(s=>String(s.nis||'').trim()!=='').map(s=>[String(s.nis).trim().toLowerCase(),s]));const seen=new Set();const mode=document.getElementById('importDuplicateMode').value;
  importStudentPreview=[];let duplicates=0,invalid=0,valid=0;
  for(const row of importStudentRows){const s=mappedStudentFromRow(row);let state='ok',message='Siap';if(!s.name){state='bad';message='Nama kosong';invalid++;}else{const key=String(s.nis||'').trim().toLowerCase(),old=key&&nisMap.has(key),dup=key&&seen.has(key);if(key)seen.add(key);if(dup){state='bad';message='NIS ganda di file';invalid++;}else if(old){duplicates++;state='warn';message=mode==='skip'?'Duplikat - dilewati':'Duplikat - diperbarui';if(mode==='update')valid++;}else valid++;}importStudentPreview.push({s,state,message});}
  document.getElementById('importRowsRead').textContent=importStudentRows.length;document.getElementById('importRowsValid').textContent=valid;document.getElementById('importRowsDuplicate').textContent=duplicates;document.getElementById('importRowsInvalid').textContent=invalid;
  const body=document.getElementById('importPreviewBody');body.innerHTML=importStudentPreview.slice(0,100).map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHTML(r.s.name||'-')}</td><td>${escapeHTML(r.s.nis||'-')}</td><td>${escapeHTML(r.s.gender||'-')}</td><td>${escapeHTML(r.s.className||'-')}</td><td><span class="import-status ${r.state}">${escapeHTML(r.message)}</span></td></tr>`).join('');
  if(importStudentPreview.length>100)body.insertAdjacentHTML('beforeend',`<tr><td colspan="6" style="text-align:center;color:var(--muted)">Preview dibatasi 100 baris. Total ${importStudentPreview.length} baris.</td></tr>`);
  document.getElementById('executeImportStudentBtn').disabled=valid===0;
}
document.getElementById('executeImportStudentBtn')?.addEventListener('click',async()=>{
  if(!importStudentPreview.length)return;
  const existing=await idbGetAll('students');
  const nisMap=new Map(existing.filter(s=>String(s.nis||'').trim()!=='').map(s=>[String(s.nis).trim().toLowerCase(),s]));
  const mode=document.getElementById('importDuplicateMode').value;
  let added=0,updated=0,skipped=0;
  for(const r of importStudentPreview){
    if(r.state==='bad'){skipped++;continue}
    const s={...r.s},key=String(s.nis||'').trim().toLowerCase(),old=key?nisMap.get(key):null;
    if(old){
      if(mode==='skip'){skipped++;continue}
      await idbPut('students',{...old,...s,id:old.id});
      await ensureEnrollment(old.id,s.className||old.className||'');
      updated++;
    }else{
      const id=await idbAdd('students',s);
      await ensureEnrollment(id,s.className||'');
      if(key)nisMap.set(key,{...s,id});
      added++;
    }
  }
  await renderStudents();try{await renderAttendance()}catch(_){}try{await renderGradeModule()}catch(_){}try{await renderHomeroom()}catch(_){}try{await populateReportFilters();await renderReport()}catch(_){}
  importStudentDialog.close();showToast(`Import selesai: ${added} baru, ${updated} diperbarui, ${skipped} dilewati`);
});
document.getElementById('downloadStudentTemplateBtn')?.addEventListener('click',()=>{
  const csv=[['Nama Siswa','NIS','JK','Kelas'],['Ahmad Fauzan','1001','L','X AKL'],['Siti Aisyah','1002','P','X AKL']].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='template-import-siswa-siaga-guru.csv';a.click();URL.revokeObjectURL(a.href);showToast('Template berhasil diunduh');
});


// ===== SIAGA GURU v1.8 - DASHBOARD PINTAR =====
function smartInitials(name){
  return String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?';
}
function smartRelativeTime(iso){
  if(!iso) return '';
  const d=new Date(iso), now=new Date();
  const diff=Math.max(0,now-d);
  const mins=Math.floor(diff/60000);
  if(mins<1) return 'baru saja';
  if(mins<60) return `${mins} mnt`;
  const hrs=Math.floor(mins/60);
  if(hrs<24) return `${hrs} jam`;
  const days=Math.floor(hrs/24);
  return `${days} hari`;
}
async function renderSmartDashboard(){
  const profile=await idbGet('profile','main')||{};
  const students=await getCurrentRoster();
  const attendance=await getAllAttendance();
  const journals=await getJournals();
  const assessments=await getAssessments();
  const grades=await getGrades();
  const contexts=await getTeachingContexts();
  const notes=await getHomeroomNotes();

  const today=localISODate();
  const todayDate=document.getElementById('smartTodayDate');
  if(todayDate){
    todayDate.textContent=new Date(today+'T00:00:00').toLocaleDateString('id-ID',{weekday:'long',day:'2-digit',month:'short'});
  }

  // Absensi hari ini
  const attToday=attendance.filter(a=>a.date===today);
  const activeStudents=students.length;
  const uniqueAtt=new Set(attToday.map(a=>Number(a.studentId))).size;
  const attStatus=document.getElementById('smartAttendanceStatus');
  const attDetail=document.getElementById('smartAttendanceDetail');
  if(attStatus) attStatus.textContent=activeStudents && uniqueAtt>=activeStudents?'Lengkap':(uniqueAtt?'Sebagian':'Belum');
  if(attDetail) attDetail.textContent=`${uniqueAtt}/${activeStudents} siswa tercatat`;
  const attStatusMirror=document.getElementById('smartAttendanceStatusMirror'); if(attStatusMirror) attStatusMirror.textContent=attStatus?.textContent||'Belum';
  const attDetailMirror=document.getElementById('smartAttendanceDetailMirror'); if(attDetailMirror) attDetailMirror.textContent=attDetail?.textContent||'-';

  // Jurnal hari ini
  const journalToday=journals.filter(j=>j.date===today);
  const journalTodayEl=document.getElementById('smartJournalToday');
  if(journalTodayEl) journalTodayEl.textContent=journalToday.length;
  const journalDetail=document.getElementById('smartJournalDetail');
  if(journalDetail) journalDetail.textContent=journalToday.length
    ? journalToday.slice(0,2).map(j=>j.className||'-').join(', ')
    : 'Belum ada jurnal';

  // Progres nilai
  let expected=0, filled=0;
  for(const a of assessments){
    const eligible=students.filter(s=>!a.className || !s.className || s.className===a.className);
    expected += eligible.length;
    filled += grades.filter(g=>Number(g.assessmentId)===Number(a.id) && g.finalScore!=='' && g.finalScore!==null && g.finalScore!==undefined).length;
  }
  const gradePct=expected?Math.min(100,Math.round((filled/expected)*100)):0;
  const gradeProgress=document.getElementById('smartGradeProgress');
  if(gradeProgress) gradeProgress.textContent=`${gradePct}%`;
  const gradeDetail=document.getElementById('smartGradeDetail');
  if(gradeDetail) gradeDetail.textContent=assessments.length?`${filled}/${expected} nilai terisi`:'Belum ada penilaian';

  // Siswa perlu perhatian
  let metricsMap=new Map();
  try{ metricsMap=await buildStudentMetrics(); }catch(_){}
  const attention=[...metricsMap.values()].filter(m=>m.attentionScore>=3).sort((a,b)=>b.attentionScore-a.attentionScore);
  const attentionCount=document.getElementById('smartAttentionCount');
  if(attentionCount) attentionCount.textContent=attention.length;
  const attentionDetail=document.getElementById('smartAttentionDetail');
  if(attentionDetail) attentionDetail.textContent=attention.length?`${attention[0].student.name||'Siswa'} skor ${attention[0].attentionScore}`:'Tidak ada indikator';

  const attentionList=document.getElementById('smartAttentionList');
  if(attentionList){
    attentionList.innerHTML=attention.length?attention.slice(0,5).map(m=>`
      <div class="smart-list-item">
        <div class="smart-list-avatar">${escapeHTML(smartInitials(m.student.name))}</div>
        <div class="smart-list-main"><strong>${escapeHTML(m.student.name||'')}</strong><small>${escapeHTML(m.student.className||'-')} • A ${m.attCount.A} • T ${m.attCount.T} • Nilai ${m.gradeCount?m.avg:'-'}</small></div>
        <div class="smart-list-side smart-alert">Skor ${m.attentionScore}</div>
      </div>`).join(''):'<div class="smart-empty">Belum ada siswa yang terdeteksi perlu perhatian khusus.</div>';
  }

  // Checklist administrasi
  const hasProfile=Boolean(profile.teacher && profile.school && profile.year);
  const hasStudents=students.length>0;
  const hasTeaching=contexts.length>0;
  const todayAttendanceComplete=activeStudents>0 && uniqueAtt>=activeStudents;
  const month=monthISO();
  const hasJournalThisMonth=journals.some(j=>String(j.date||'').startsWith(month));
  const hasAssessment=assessments.length>0;

  const checklist=[
    {done:hasProfile,title:'Profil guru & sekolah',sub:hasProfile?'Sudah lengkap':'Lengkapi identitas utama',go:'settings'},
    {done:hasTeaching,title:'Kelas & mapel',sub:hasTeaching?`${contexts.length} beban mengajar`:'Tambahkan kelas yang diampu',go:'settings'},
    {done:hasStudents,title:'Data siswa',sub:hasStudents?`${students.length} siswa tersimpan`:'Import atau tambahkan siswa',go:'students'},
    {done:todayAttendanceComplete,title:'Absensi hari ini',sub:todayAttendanceComplete?'Sudah lengkap':`${uniqueAtt}/${activeStudents} tercatat`,go:'attendance'},
    {done:hasJournalThisMonth,title:'Jurnal bulan ini',sub:hasJournalThisMonth?'Sudah ada jurnal':'Belum ada jurnal bulan ini',go:'journal'},
    {done:hasAssessment,title:'Penilaian',sub:hasAssessment?`${assessments.length} penilaian`:'Belum membuat penilaian',go:'grades'}
  ];
  const doneCount=checklist.filter(x=>x.done).length;
  const checklistScore=document.getElementById('smartChecklistScore');
  if(checklistScore) checklistScore.textContent=`${Math.round(doneCount/checklist.length*100)}%`;

  const checklistBox=document.getElementById('smartChecklist');
  if(checklistBox){
    checklistBox.innerHTML=checklist.map(x=>`
      <div class="smart-check-item">
        <div class="smart-check-icon ${x.done?'done':'todo'}">${x.done?'✓':'!'}</div>
        <div class="smart-check-main"><strong>${escapeHTML(x.title)}</strong><small>${escapeHTML(x.sub)}</small></div>
        <button type="button" data-go="${x.go}">${x.done?'Lihat':'Lengkapi'}</button>
      </div>`).join('');
  }

  // Aktivitas terbaru
  const activities=[];
  journals.forEach(j=>activities.push({
    time:j.updatedAt||j.createdAt||`${j.date||today}T08:00:00`,
    icon:'▤',title:j.topic||'Jurnal Mengajar',
    sub:`Jurnal • ${j.className||'-'}`
  }));
  assessments.forEach(a=>activities.push({
    time:a.updatedAt||a.createdAt||`${a.date||today}T08:00:00`,
    icon:'★',title:a.name||'Penilaian',
    sub:`${a.type||'Penilaian'} • ${a.className||'Semua kelas'}`
  }));
  notes.forEach(n=>activities.push({
    time:n.createdAt||`${n.date||today}T08:00:00`,
    icon:'✎',title:n.category||'Catatan Wali',
    sub:n.note||'Catatan siswa'
  }));
  attToday.slice(0,1).forEach(a=>activities.push({
    time:a.updatedAt||new Date().toISOString(),
    icon:'✓',title:'Absensi hari ini',
    sub:`${uniqueAtt}/${activeStudents} siswa tercatat`
  }));
  activities.sort((a,b)=>new Date(b.time)-new Date(a.time));

  const recentBox=document.getElementById('smartRecentActivity');
  if(recentBox){
    recentBox.innerHTML=activities.length?activities.slice(0,6).map(a=>`
      <div class="smart-list-item">
        <div class="smart-list-avatar">${a.icon}</div>
        <div class="smart-list-main"><strong>${escapeHTML(a.title)}</strong><small>${escapeHTML(a.sub)}</small></div>
        <div class="smart-list-side">${escapeHTML(smartRelativeTime(a.time))}</div>
      </div>`).join(''):'<div class="smart-empty">Belum ada aktivitas tersimpan.</div>';
  }
}


// ===== SIAGA GURU v2.0 - ONBOARDING, BANTUAN & PRIVASI =====
const helpDialog=document.getElementById('helpDialog');
document.getElementById('helpBtn')?.addEventListener('click',()=>helpDialog?.showModal());
document.getElementById('closeHelpBtn')?.addEventListener('click',()=>helpDialog?.close());
helpDialog?.addEventListener('click',e=>{
  const btn=e.target.closest('[data-help-go]'); if(!btn) return;
  helpDialog.close(); navigate(btn.dataset.helpGo);
});

// Onboarding
const onboardingDialog=document.getElementById('onboardingDialog');
let onboardingStep=1;
function renderOnboardingStep(){
  document.querySelectorAll('[data-ob-step]').forEach(el=>el.classList.toggle('active',Number(el.dataset.obStep)===onboardingStep));
  document.querySelectorAll('[data-ob-dot]').forEach(el=>el.classList.toggle('active',Number(el.dataset.obDot)<=onboardingStep));
  document.getElementById('onboardingPrevBtn')?.classList.toggle('hidden',onboardingStep===1);
  const next=document.getElementById('onboardingNextBtn');
  if(next) next.textContent=onboardingStep===1?'Mulai':(onboardingStep===3?'Selesai':'Lanjut');
}
async function maybeShowOnboarding(){
  const meta=await getAppMeta();
  if(meta.onboardingComplete) return;
  const profile=await idbGet('profile','main')||{};
  const students=await idbGetAll('students');
  if(profile.teacher || profile.school || students.length){
    await idbPut('appMeta',{...meta,id:'main',onboardingComplete:true});
    return;
  }
  const suggested=suggestedAcademicPeriod();
  document.getElementById('obYear').value=suggested.year;
  document.getElementById('obSemester').value=suggested.semester;
  onboardingStep=1; renderOnboardingStep();
  onboardingDialog?.showModal();
}
document.getElementById('onboardingPrevBtn')?.addEventListener('click',()=>{
  onboardingStep=Math.max(1,onboardingStep-1); renderOnboardingStep();
});
document.getElementById('onboardingNextBtn')?.addEventListener('click',async()=>{
  if(onboardingStep<3){onboardingStep++;renderOnboardingStep();return;}
  const school=document.getElementById('obSchool').value.trim();
  const teacher=document.getElementById('obTeacher').value.trim();
  const subject=document.getElementById('obSubject').value.trim();
  const className=document.getElementById('obClass').value.trim();
  const year=document.getElementById('obYear').value.trim();
  const semester=document.getElementById('obSemester').value;
  if(!school || !teacher){showToast('Isi nama sekolah dan nama guru');return;}
  if(!/^\d{4}\/\d{4}$/.test(year)){showToast('Format tahun ajaran: 2026/2027');return;}
  const old=await idbGet('profile','main')||{};
  const profile={...old,id:'main',school,teacher,subject,className,year,semester};
  await idbPut('profile',profile);
  await ensureSessionForProfile(profile,true);
  if(className && subject){
    const key=await activePeriodKey();
    const exists=(await getTeachingContexts()).some(x=>x.className.toLowerCase()===className.toLowerCase() && x.subject.toLowerCase()===subject.toLowerCase());
    if(!exists) await idbAdd('teachingContexts',{className,subject,weeklyJP:3,periodKey:key});
  }
  const meta=await getAppMeta();
  await idbPut('appMeta',{...meta,id:'main',onboardingComplete:true});
  onboardingDialog.close();
  await loadProfile();
  await refreshAllPeriodViews();
  showToast('SIAGA GURU siap digunakan');
});
document.getElementById('skipOnboardingBtn')?.addEventListener('click',async()=>{
  const meta=await getAppMeta();
  await idbPut('appMeta',{...meta,id:'main',onboardingComplete:true});
  onboardingDialog?.close();
});

// PIN lokal. Ini akses gate, bukan enkripsi.
async function digestPin(pin){
  const text=String(pin||'');
  try{
    if(globalThis.crypto?.subtle){
      const data=new TextEncoder().encode(`SIAGA-GURU::${text}`);
      const hash=await crypto.subtle.digest('SHA-256',data);
      return 'sha256:'+Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch(_){}
  let h=2166136261;
  for(const ch of `SIAGA-GURU::${text}`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return 'local:'+('00000000'+(h>>>0).toString(16)).slice(-8);
}
async function refreshPrivacyUI(){
  const meta=await getAppMeta();
  const enabled=Boolean(meta.pinEnabled && meta.pinHash);
  const toggle=document.getElementById('pinLockEnabled'); if(toggle) toggle.checked=enabled;
  document.getElementById('lockNowBtn')?.classList.toggle('hidden',!enabled);
  const now=document.getElementById('privacyLockNowBtn'); if(now) now.disabled=!enabled;
}
async function verifyPin(pin){
  const meta=await getAppMeta();
  return Boolean(meta.pinHash && (await digestPin(pin))===meta.pinHash);
}
async function showAppLock(){
  const meta=await getAppMeta();
  if(!meta.pinEnabled || !meta.pinHash){showToast('Kunci PIN belum diaktifkan');return;}
  const dialog=document.getElementById('appLockDialog');
  const input=document.getElementById('unlockPinInput');
  if(input) input.value='';
  if(dialog && !dialog.open) dialog.showModal();
  setTimeout(()=>input?.focus(),50);
}
document.getElementById('saveSecurityPinBtn')?.addEventListener('click',async()=>{
  const input=document.getElementById('securityPinInput');
  const pin=input.value.trim();
  if(!/^\d{4,8}$/.test(pin)){showToast('PIN harus 4–8 angka');return;}
  const meta=await getAppMeta();
  await idbPut('appMeta',{...meta,id:'main',pinHash:await digestPin(pin),pinEnabled:true});
  input.value='';
  await refreshPrivacyUI();
  showToast('PIN lokal berhasil disimpan');
});
document.getElementById('pinLockEnabled')?.addEventListener('change',async e=>{
  const meta=await getAppMeta();
  if(e.target.checked){
    if(!meta.pinHash){e.target.checked=false;showToast('Buat PIN terlebih dahulu');return;}
    await idbPut('appMeta',{...meta,id:'main',pinEnabled:true});
    await refreshPrivacyUI();
  }else{
    if(!meta.pinEnabled) return;
    const current=prompt('Masukkan PIN saat ini untuk menonaktifkan kunci:');
    if(current===null || !(await verifyPin(current))){
      e.target.checked=true; showToast('PIN tidak sesuai'); return;
    }
    await idbPut('appMeta',{...meta,id:'main',pinEnabled:false,pinHash:null});
    await refreshPrivacyUI();
    showToast('Kunci PIN dinonaktifkan');
  }
});
document.getElementById('privacyLockNowBtn')?.addEventListener('click',showAppLock);
document.getElementById('lockNowBtn')?.addEventListener('click',showAppLock);
document.getElementById('unlockAppBtn')?.addEventListener('click',async()=>{
  const input=document.getElementById('unlockPinInput');
  if(await verifyPin(input.value.trim())){
    document.getElementById('appLockDialog')?.close();
    input.value='';
  }else{
    showToast('PIN tidak sesuai'); input.value=''; input.focus();
  }
});
document.getElementById('unlockPinInput')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();document.getElementById('unlockAppBtn')?.click();}
});
document.getElementById('appLockDialog')?.addEventListener('cancel',e=>e.preventDefault());

async function initPrivacyLock(){
  await refreshPrivacyUI();
  const meta=await getAppMeta();
  if(meta.loginEnabled) return;
  if(meta.pinEnabled && meta.pinHash) await showAppLock();
}


// ===== SIAGA GURU v3.0 - MULTI GURU LOKAL =====
let selectedAuthUsername='';

async function digestLoginSecret(value){
  const text=`SIAGA-GURU-LOGIN::${String(value||'')}`;
  try{
    if(globalThis.crypto?.subtle){
      const data=new TextEncoder().encode(text);
      const hash=await crypto.subtle.digest('SHA-256',data);
      return 'sha256:'+Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch(_){}
  let h=2166136261;
  for(const ch of text){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return 'local:'+('00000000'+(h>>>0).toString(16)).slice(-8);
}
function normalizeLoginUsername(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'')}
function initials(v){return String(v||'G').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'G'}
function authSessionUsername(){return sessionStorage.getItem('siaga_active_user')||localStorage.getItem('siaga_active_user')||''}
function clearLoginSession(){sessionStorage.removeItem('siaga_active_user');localStorage.removeItem('siaga_active_user')}
function workspaceNameFor(username){return `${BASE_DB_NAME}__u_${normalizeLoginUsername(username)}_${Date.now().toString(36)}`}
function setLoginMessage(id,message,type='error'){
  const el=document.getElementById(id);if(!el)return;
  if(!message){el.textContent='';el.classList.add('hidden');el.classList.remove('success');return}
  el.textContent=message;el.classList.remove('hidden');el.classList.toggle('success',type==='success');
}

async function legacyWorkspaceInfo(){
  await openDB(BASE_DB_NAME);
  const profile=await idbGet('profile','main')||{};
  const meta=await idbGet('appMeta','main')||{};
  const students=await idbGetAll('students');
  const journals=await idbGetAll('journals');
  return {profile,meta,hasData:Boolean(profile.teacher||profile.school||students.length||journals.length)};
}
async function migrateLegacyAccountToAuth(){
  const migration=await authGet('meta','migration');
  if(migration?.done)return;
  const users=await authGetAll('users');
  const legacy=await legacyWorkspaceInfo();
  if(!users.length && legacy.meta.loginEnabled && legacy.meta.loginUsername && legacy.meta.loginHash){
    const username=normalizeLoginUsername(legacy.meta.loginUsername);
    await authPut('users',{
      username,
      displayName:legacy.profile.teacher||legacy.meta.loginUsername,
      loginHash:legacy.meta.loginHash,
      dbName:BASE_DB_NAME,
      schoolName:legacy.profile.school||'',
      subject:legacy.profile.subject||'',
      role:legacy.profile.role||'',
      teacherPhoto:legacy.profile.teacherPhoto||null,
      schoolLogo:legacy.profile.schoolLogo||null,
      accentTheme:'ocean',
      appearance:'light',
      createdAt:new Date().toISOString(),
      migratedFromV29:true,
      uiPresetVersion:'3.3'
    });
  }
  await authPut('meta',{id:'migration',done:true,legacyHasData:legacy.hasData,updatedAt:new Date().toISOString()});
}


async function readWorkspaceProfile(dbName){
  return new Promise((resolve)=>{
    try{
      const req=indexedDB.open(dbName);
      req.onerror=()=>resolve(null);
      req.onsuccess=()=>{
        const d=req.result;
        if(!d.objectStoreNames.contains('profile')){d.close();resolve(null);return;}
        const tx=d.transaction('profile','readonly');
        const r=tx.objectStore('profile').get('main');
        r.onsuccess=()=>{const val=r.result||null;d.close();resolve(val)};
        r.onerror=()=>{d.close();resolve(null)};
      };
    }catch(_){resolve(null)}
  });
}

async function syncActiveUserIdentityFromProfile(profile=null){
  if(!activeLocalUser)return;
  const p=profile||await idbGet('profile','main')||{};
  let uiMeta={};
  try{uiMeta=await getAppMeta()||{}}catch(_){}
  activeLocalUser={
    accentTheme:activeLocalUser.accentTheme||uiMeta.uiAccent||'aurora',
    appearance:activeLocalUser.appearance||uiMeta.uiAppearance||'dark',
    ...activeLocalUser,
    displayName:p.teacher||activeLocalUser.displayName||activeLocalUser.username,
    schoolName:p.school||'',
    subject:p.subject||'',
    role:p.role||'',
    teacherPhoto:p.teacherPhoto||null,
    schoolLogo:p.schoolLogo||null,
    lastUsedAt:new Date().toISOString()
  };
  await authPut('users',activeLocalUser);
}

async function enrichAuthUsersFromWorkspaces(){
  const users=await authGetAll('users');
  for(const u of users){
    if((u.schoolName||u.subject||u.teacherPhoto||u.schoolLogo) || !u.dbName) continue;
    const p=await readWorkspaceProfile(u.dbName);
    if(!p) continue;
    await authPut('users',{
      ...u,
      displayName:p.teacher||u.displayName||u.username,
      schoolName:p.school||'',
      subject:p.subject||'',
      role:p.role||'',
      teacherPhoto:p.teacherPhoto||null,
      schoolLogo:p.schoolLogo||null
    });
  }
}

function accountVisualAvatar(user,cls='login-account-avatar'){
  const name=user.displayName||user.username||'Guru';
  if(user.teacherPhoto){
    return `<span class="${cls} has-photo"><img src="${user.teacherPhoto}" alt=""></span>`;
  }
  return `<span class="${cls}">${escapeHTML(initials(name))}</span>`;
}

async function renderLoginAccounts(){
  await enrichAuthUsersFromWorkspaces();
  const users=(await authGetAll('users')).sort((a,b)=>(a.displayName||a.username).localeCompare(b.displayName||b.username,'id'));
  const box=document.getElementById('loginAccountList');
  if(box){
    box.innerHTML=users.map(u=>`
      <button type="button" class="login-account-card ${u.username===selectedAuthUsername?'active':''}" data-auth-user="${escapeHTML(u.username)}">
        <span class="login-account-visual">
          ${accountVisualAvatar(u)}
          ${u.schoolLogo?`<img class="login-school-badge" src="${u.schoolLogo}" alt="">`:''}
        </span>
        <span class="login-account-copy">
          <strong>${escapeHTML(u.displayName||u.username)}</strong>
          <small>${escapeHTML(u.schoolName||'Sekolah belum diatur')}</small>
          <em>${escapeHTML(u.subject||u.role||'Guru')} • @${escapeHTML(u.username)}</em>
        </span>
        <span class="login-card-arrow">›</span>
      </button>`).join('');
  }
  return users;
}
async function renderAccountManager(){
  const users=await authGetAll('users');
  const box=document.getElementById('accountManagerList');
  if(box){
    box.innerHTML=users.map(u=>`
      <div class="manager-account-item ${activeLocalUser?.username===u.username?'active':''}">
        <div class="manager-visual">${accountVisualAvatar(u,'manager-avatar')}${u.schoolLogo?`<img class="manager-school-logo" src="${u.schoolLogo}" alt="">`:''}</div>
        <div>
          <strong>${escapeHTML(u.displayName||u.username)}</strong>
          <small>${escapeHTML(u.schoolName||'Sekolah belum diatur')} • ${escapeHTML(u.subject||u.role||'Guru')}</small>
          <em>@${escapeHTML(u.username)}</em>
        </div>
        ${activeLocalUser?.username===u.username?'<span class="manager-active-badge">AKTIF</span>':`<button type="button" class="manager-switch-btn" data-switch-user="${escapeHTML(u.username)}">Masuk</button>`}
      </div>`).join('');
  }
}

const APPEARANCE_THEME_NAMES={
  aurora:'Aurora',
  ocean:'Ocean',
  emerald:'Emerald',
  lampung:'Maroon Gold',
  ruby:'Ruby',
  graphite:'Graphite'
};
let systemThemeMedia=null;

function systemPrefersLight(){
  return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}
function resolveAppearanceMode(mode){
  return mode==='system' ? (systemPrefersLight()?'light':'dark') : (mode==='light'?'light':'dark');
}
function normalizeUiScale(value){
  const allowed=['70','80','90','100'];
  const v=String(value||DEFAULT_UI_SCALE);
  return allowed.includes(v)?v:DEFAULT_UI_SCALE;
}
function applyDisplayScale(value,persist=true){
  const scale=normalizeUiScale(value);
  document.documentElement.dataset.uiScale=scale;
  if(persist){try{localStorage.setItem('siaga_ui_scale',scale)}catch(_){}}
  document.querySelectorAll('[data-ui-scale]').forEach(btn=>btn.classList.toggle('active',btn.dataset.uiScale===scale));
  return scale;
}

function applyUserAppearance(user=activeLocalUser){
  const accent=user?.accentTheme||'aurora';
  const mode=user?.appearance||'dark';
  const uiScale=normalizeUiScale(user?.uiScale||localStorage.getItem('siaga_ui_scale')||DEFAULT_UI_SCALE);
  applyDisplayScale(uiScale);
  document.documentElement.dataset.accent=accent;
  document.documentElement.dataset.appearance=mode;
  document.documentElement.classList.toggle('light',resolveAppearanceMode(mode)==='light');

  const themeName=document.getElementById('appearanceThemeName');
  if(themeName) themeName.textContent=APPEARANCE_THEME_NAMES[accent]||'Aurora';

  document.querySelectorAll('[data-accent-theme]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.accentTheme===accent);
  });
  document.querySelectorAll('[data-appearance-mode]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.appearanceMode===mode);
  });

  const themeBtn=document.getElementById('themeBtn');
  if(themeBtn){
    themeBtn.textContent=mode==='system'?'◐':resolveAppearanceMode(mode)==='light'?'☀':'☾';
    themeBtn.title=`Tampilan: ${mode==='system'?'Otomatis':resolveAppearanceMode(mode)==='light'?'Terang':'Gelap'}`;
  }
}
async function saveActiveAppearance(patch={}){
  if(!activeLocalUser)return;
  activeLocalUser={...activeLocalUser,...patch,updatedAt:new Date().toISOString()};
  await authPut('users',activeLocalUser);
  try{
    const meta=await getAppMeta();
    await idbPut('appMeta',{
      ...meta,id:'main',
      uiAccent:activeLocalUser.accentTheme||'aurora',
      uiAppearance:activeLocalUser.appearance||'dark',
      uiScale:activeLocalUser.uiScale||normalizeUiScale(localStorage.getItem('siaga_ui_scale')||DEFAULT_UI_SCALE)
    });
  }catch(_){}
  applyUserAppearance(activeLocalUser);
  await refreshMultiUserUI();
}
function bindSystemAppearanceWatcher(){
  if(!window.matchMedia)return;
  systemThemeMedia=window.matchMedia('(prefers-color-scheme: light)');
  const listener=()=>{
    if(activeLocalUser?.appearance==='system') applyUserAppearance(activeLocalUser);
  };
  try{systemThemeMedia.addEventListener('change',listener)}catch(_){
    try{systemThemeMedia.addListener(listener)}catch(__){}
  }
}
document.addEventListener('click',async e=>{
  const accent=e.target.closest('[data-accent-theme]');
  if(accent){
    await saveActiveAppearance({accentTheme:accent.dataset.accentTheme});
    showToast(`Tema ${APPEARANCE_THEME_NAMES[accent.dataset.accentTheme]||''} diterapkan`);
    return;
  }
  const mode=e.target.closest('[data-appearance-mode]');
  if(mode){
    await saveActiveAppearance({appearance:mode.dataset.appearanceMode});
    showToast('Mode tampilan diperbarui');
    return;
  }
  const scaleBtn=e.target.closest('[data-ui-scale]');
  if(scaleBtn){
    const uiScale=applyDisplayScale(scaleBtn.dataset.uiScale);
    if(activeLocalUser){
      activeLocalUser={...activeLocalUser,uiScale};
      try{await authPut('users',activeLocalUser)}catch(_){}
      try{
        const meta=await getAppMeta();
        await idbPut('appMeta',{...meta,id:'main',uiScale});
      }catch(_){}
    }
    showToast(`Skala desktop ${uiScale}% diterapkan`);
  }
});

async function refreshMultiUserUI(){
  const user=activeLocalUser;
  if(user) applyUserAppearance(user);
  const enabled=Boolean(user);
  const status=document.getElementById('localAccountStatus');
  if(status){
    status.textContent=enabled?`${user.displayName||user.username} • @${user.username}`:'Belum masuk';
    status.classList.toggle('active',enabled);
  }
  document.getElementById('logoutBtn')?.classList.toggle('hidden',!enabled);
  const chip=document.getElementById('activeUserChip');
  chip?.classList.toggle('hidden',!enabled);

  if(user){
    const name=user.displayName||user.username;
    for(const id of ['activeUserName','topUserName']){const el=document.getElementById(id);if(el)el.textContent=name}
    for(const id of ['activeUserUsername','topUsername']){const el=document.getElementById(id);if(el)el.textContent=`@${user.username}`}

    for(const id of ['activeUserAvatar','topUserAvatar']){
      const el=document.getElementById(id);if(!el)continue;
      if(user.teacherPhoto){
        el.innerHTML=`<img src="${user.teacherPhoto}" alt="">`;
        el.classList.add('has-photo');
      }else{
        el.textContent=initials(name);
        el.classList.remove('has-photo');
      }
    }
  }
  await renderAccountManager();
}

async function resetWorkspaceTransientState(){
  try{selectedStudentIds?.clear?.()}catch(_){}
  try{attendanceState.clear()}catch(_){}
  pendingProvinceLogo=null;pendingSchoolLogo=null;pendingTeacherPhoto=null;
}
async function runWorkspaceStep(label,fn,{critical=false}={}){
  try{
    await fn();
    return true;
  }catch(err){
    console.warn(`[SIAGA GURU] ${label} gagal:`,err);
    if(critical) throw err;
    return false;
  }
}

async function initializeWorkspaceData(){
  await runWorkspaceStep('Reset state',()=>resetWorkspaceTransientState());
  await runWorkspaceStep('Periode akademik',()=>ensureAcademicPeriods(),{critical:true});
  await runWorkspaceStep('Migrasi periode',()=>migrateLegacyPeriodData());
  await runWorkspaceStep('Migrasi absensi',()=>migrateAttendanceKeys());
  await runWorkspaceStep('Migrasi kelas siswa',()=>migrateLegacyEnrollments());

  await runWorkspaceStep('Profil guru',()=>loadProfile());
  await runWorkspaceStep('Periode aktif',()=>populatePeriodUI());
  await runWorkspaceStep('Kelas & mapel',()=>renderTeachingContexts());
  await runWorkspaceStep('Data siswa',()=>renderStudents());

  const dateEl=document.getElementById('attendanceDate');
  if(dateEl) dateEl.value=localISODate();
  await runWorkspaceStep('Absensi',()=>renderAttendance());

  const journalMonth=document.getElementById('journalMonthFilter');
  if(journalMonth) journalMonth.value=monthISO();
  await runWorkspaceStep('Jurnal',()=>renderJournals());

  await runWorkspaceStep('Pilihan penilaian',()=>populateAssessmentSelect());
  await runWorkspaceStep('Filter kelas nilai',()=>populateGradeClassFilter());
  await runWorkspaceStep('Nilai',()=>renderGradeModule());

  await runWorkspaceStep('Filter wali kelas',()=>populateHomeroomClassFilter());
  await runWorkspaceStep('Wali kelas',()=>renderHomeroom());

  const reportMonth=document.getElementById('reportMonth');
  if(reportMonth) reportMonth.value=monthISO();
  await runWorkspaceStep('Filter laporan',()=>populateReportFilters());
  await runWorkspaceStep('Laporan',()=>renderReport());

  await runWorkspaceStep('Dashboard pintar',()=>renderSmartDashboard());
  await runWorkspaceStep('Privasi/PIN',()=>initPrivacyLock());
  await runWorkspaceStep('UI akun',()=>refreshMultiUserUI());
  await runWorkspaceStep('Cloud ready',()=>initializeCloudRuntime());
}

async function activateLocalUser(user,remember=false){
  if(!user) throw new Error('Akun tidak ditemukan.');

  const upgraded={accentTheme:'ocean',appearance:'light',uiScale:normalizeUiScale(user?.uiScale||localStorage.getItem('siaga_ui_scale')||DEFAULT_UI_SCALE),...user};
  if(!upgraded.uiPresetVersion || upgraded.uiPresetVersion!=='3.4.2'){
    if(!upgraded.accentTheme || upgraded.accentTheme==='aurora') upgraded.accentTheme='ocean';
    upgraded.appearance=upgraded.appearance||'light';
    upgraded.uiPresetVersion='3.4.2';
    try{await authPut('users',upgraded);}catch(err){console.warn('Gagal menyimpan preset UI',err);}
  }

  activeLocalUser=upgraded;
  applyUserAppearance(activeLocalUser);

  if(remember){
    localStorage.setItem('siaga_active_user',user.username);
    sessionStorage.removeItem('siaga_active_user');
  }else{
    sessionStorage.setItem('siaga_active_user',user.username);
    localStorage.removeItem('siaga_active_user');
  }

  // Hanya pembukaan database yang wajib selesai sebelum masuk.
  await openDB(user.dbName||BASE_DB_NAME);
  await initializeCloudRuntime();

  // Begitu DB tersedia, lepaskan login/splash. Modul dimuat sesudahnya.
  await hideLoginGate();
  dismissSplash(true);

  // Inisialisasi modul sengaja tidak menahan proses login.
  Promise.resolve()
    .then(()=>initializeWorkspaceData())
    .then(()=>runWorkspaceStep('Sinkron identitas akun',()=>syncActiveUserIdentityFromProfile()))
    .then(()=>runWorkspaceStep('Refresh akun aktif',()=>refreshMultiUserUI()))
    .then(async()=>{try{await maybeShowOnboarding()}catch(_){}})
    .then(()=>runWorkspaceStep('Sinkron otomatis',()=>cloudAutoSync('workspace')))
    .catch(err=>{
      console.error('[SIAGA GURU] Sebagian ruang kerja gagal dimuat:',err);
      try{showToast('Aplikasi terbuka. Sebagian data sedang dimuat ulang.')}catch(_){}
    });

  return true;
}


function renderSelectedAccountPreview(user){
  const wrap=document.getElementById('selectedAccountPreview');
  if(!wrap)return;
  if(!user){wrap.classList.add('hidden');return;}
  wrap.classList.remove('hidden');

  const photo=document.getElementById('selectedAccountPhoto');
  const initial=document.getElementById('selectedAccountInitial');
  if(user.teacherPhoto){
    photo.src=user.teacherPhoto;photo.classList.remove('hidden');initial.classList.add('hidden');
  }else{
    photo.removeAttribute('src');photo.classList.add('hidden');initial.classList.remove('hidden');
    initial.textContent=initials(user.displayName||user.username);
  }

  const logo=document.getElementById('selectedSchoolLogo');
  if(user.schoolLogo){logo.src=user.schoolLogo;logo.classList.remove('hidden')}
  else{logo.removeAttribute('src');logo.classList.add('hidden')}

  document.getElementById('selectedAccountName').textContent=user.displayName||user.username;
  document.getElementById('selectedAccountMeta').textContent=[user.schoolName,user.subject||user.role].filter(Boolean).join(' • ')||`@${user.username}`;
}

async function showLoginGate(force=false,mode='login'){
  const gate=document.getElementById('loginGate');if(!gate)return false;
  const users=await renderLoginAccounts();
  const remembered=authSessionUsername();
  if(!force && remembered){
    const user=await authGet('users',remembered);
    if(user){
      await activateLocalUser(user,Boolean(localStorage.getItem('siaga_active_user')));
      return false;
    }
    clearLoginSession();
  }

  document.body.classList.add('login-required');
  gate.classList.remove('hidden','login-leaving');
  gate.setAttribute('aria-hidden','false');

  const loginWrap=document.getElementById('loginModeWrap');
  const setupWrap=document.getElementById('setupAccountWrap');
  const showSetup=mode==='setup' || users.length===0;
  loginWrap?.classList.toggle('hidden',showSetup);
  setupWrap?.classList.toggle('hidden',!showSetup);

  if(showSetup){
    const legacy=await authGet('meta','migration');
    const display=document.getElementById('setupDisplayName');
    const userInput=document.getElementById('setupLoginUsername');
    if(users.length===0 && legacy?.legacyHasData){
      const p=await idbGet('profile','main')||{};
      if(display&&!display.value)display.value=p.teacher||'';
      if(userInput&&!userInput.value)userInput.value=normalizeLoginUsername((p.teacher||'guru').replace(/\s+/g,'.'))||'guru';
    }
    setLoginMessage('setupLoginMessage','');
    setTimeout(()=>display?.focus(),70);
  }else{
    if(!selectedAuthUsername && users.length) selectedAuthUsername=users[0].username;
    await renderLoginAccounts();
    const selected=users.find(u=>u.username===selectedAuthUsername)||users[0];
    if(selected){
      selectedAuthUsername=selected.username;
      document.getElementById('loginUsername').value=selected.username;
      renderSelectedAccountPreview(selected);
    }else{
      renderSelectedAccountPreview(null);
    }
    document.getElementById('loginPassword').value='';
    setLoginMessage('loginMessage','');
    setTimeout(()=>document.getElementById('loginPassword')?.focus(),70);
  }
  return true;
}
async function hideLoginGate(){
  const gate=document.getElementById('loginGate');if(!gate)return;
  gate.classList.add('login-leaving');
  document.body.classList.remove('login-required');
  setTimeout(()=>{gate.classList.add('hidden');gate.classList.remove('login-leaving');gate.setAttribute('aria-hidden','true')},360);
}

document.getElementById('loginAccountList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-auth-user]');if(!btn)return;
  selectedAuthUsername=btn.dataset.authUser;
  document.getElementById('loginUsername').value=selectedAuthUsername;
  const selected=await authGet('users',selectedAuthUsername);
  renderSelectedAccountPreview(selected);
  await renderLoginAccounts();
  document.getElementById('loginPassword').focus();
});
document.getElementById('showAddAccountBtn')?.addEventListener('click',()=>showLoginGate(true,'setup'));
document.getElementById('skipLocalAccountBtn')?.addEventListener('click',()=>showLoginGate(true,'login'));

document.getElementById('localLoginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();

  const form=e.currentTarget;
  const submit=form.querySelector('.login-submit');
  const username=normalizeLoginUsername(document.getElementById('loginUsername').value);
  const password=document.getElementById('loginPassword').value;

  try{
    if(submit){
      submit.disabled=true;
      submit.classList.add('is-loading');
      const label=submit.querySelector('span');
      if(label) label.textContent='Membuka...';
    }

    let user=await authGet('users',username);
    if(user && (!user.accentTheme || !user.appearance || !user.uiPresetVersion)){
      user={accentTheme:'ocean',appearance:'light',...user};
      if(!user.uiPresetVersion){
        if(!user.accentTheme || user.accentTheme==='aurora') user.accentTheme='ocean';
        user.appearance='light';
        user.uiPresetVersion='3.4.1';
      }
      await authPut('users',user);
    }

    if(!user || await digestLoginSecret(password)!==user.loginHash){
      setLoginMessage('loginMessage','Akun atau kata sandi tidak sesuai.');
      document.getElementById('loginPassword').value='';
      document.getElementById('loginPassword').focus();
      return;
    }

    const remember=document.getElementById('rememberLogin').checked;
    setLoginMessage('loginMessage','Login berhasil. Membuka ruang kerja...','success');

    // Tunggu proses aktivasi selesai supaya error tidak hilang di background.
    await activateLocalUser(user,remember);
  }catch(err){
    console.error('[SIAGA GURU] Login gagal membuka ruang kerja:',err);
    clearLoginSession();
    setLoginMessage(
      'loginMessage',
      'Login benar, tetapi ruang kerja belum dapat dibuka. Silakan coba lagi. Data Anda tetap tersimpan.'
    );
  }finally{
    if(submit){
      submit.disabled=false;
      submit.classList.remove('is-loading');
      const label=submit.querySelector('span');
      if(label) label.textContent='Masuk';
    }
  }
});

document.getElementById('localAccountSetupForm')?.addEventListener('submit',async e=>{
  e.preventDefault();

  const form=e.currentTarget;
  const submit=form.querySelector('.login-submit');
  const displayName=document.getElementById('setupDisplayName').value.trim();
  const username=normalizeLoginUsername(document.getElementById('setupLoginUsername').value);
  const password=document.getElementById('setupLoginPassword').value;
  const confirm=document.getElementById('setupLoginConfirm').value;

  if(displayName.length<2){setLoginMessage('setupLoginMessage','Isi nama guru / nama tampilan.');return}
  if(username.length<3){setLoginMessage('setupLoginMessage','Username minimal 3 karakter.');return}
  if(await authGet('users',username)){setLoginMessage('setupLoginMessage','Username sudah digunakan pada perangkat ini.');return}
  if(password.length<6){setLoginMessage('setupLoginMessage','Kata sandi minimal 6 karakter.');return}
  if(password!==confirm){setLoginMessage('setupLoginMessage','Ulangi kata sandi belum sama.');return}

  try{
    if(submit){
      submit.disabled=true;
      const label=submit.querySelector('span');
      if(label) label.textContent='Menyiapkan...';
    }

    const users=await authGetAll('users');
    const migration=await authGet('meta','migration');
    const dbName=(users.length===0 && migration?.legacyHasData)?BASE_DB_NAME:workspaceNameFor(username);
    const user={
      username,displayName,
      loginHash:await digestLoginSecret(password),
      dbName,
      schoolName:'',subject:'',role:'',
      teacherPhoto:null,schoolLogo:null,
      accentTheme:'ocean',appearance:'light',
      createdAt:new Date().toISOString(),
      uiPresetVersion:'3.4.1'
    };

    await authPut('users',user);
    await openDB(dbName);

    const profile=await idbGet('profile','main');
    if(!profile) await idbPut('profile',{id:'main',teacher:displayName});

    setLoginMessage('setupLoginMessage','Akun guru berhasil dibuat. Membuka ruang kerja...','success');
    await activateLocalUser(user,false);
  }catch(err){
    console.error('[SIAGA GURU] Setup akun gagal:',err);
    setLoginMessage('setupLoginMessage','Akun tersimpan, tetapi ruang kerja belum dapat dibuka. Silakan masuk kembali.');
  }finally{
    if(submit){
      submit.disabled=false;
      const label=submit.querySelector('span');
      if(label) label.textContent='Buat Akun & Masuk';
    }
  }
});

document.getElementById('toggleLoginPassword')?.addEventListener('click',()=>{
  const input=document.getElementById('loginPassword');input.type=input.type==='password'?'text':'password';
});
document.getElementById('forgotLocalAccountBtn')?.addEventListener('click',()=>{
  setLoginMessage('loginMessage','Kata sandi tidak dapat dikirim ulang karena akun ini tidak memakai server. Gunakan backup data bila diperlukan; jangan menghapus data browser tanpa backup.');
});
document.getElementById('logoutBtn')?.addEventListener('click',async()=>{
  clearLoginSession();
  activeLocalUser=null;
  await refreshMultiUserUI();
  await showLoginGate(true,'login');
});
document.getElementById('switchLocalUserBtn')?.addEventListener('click',async()=>{
  clearLoginSession();
  await showLoginGate(true,'login');
});
document.getElementById('addLocalUserBtn')?.addEventListener('click',()=>showLoginGate(true,'setup'));
document.getElementById('accountManagerList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-switch-user]');if(!btn)return;
  selectedAuthUsername=btn.dataset.switchUser;
  clearLoginSession();
  await showLoginGate(true,'login');
});
document.getElementById('changeAccountPasswordBtn')?.addEventListener('click',async()=>{
  if(!activeLocalUser){showToast('Belum ada akun aktif');return}
  const old=document.getElementById('currentAccountPassword').value;
  const next=document.getElementById('newAccountPassword').value;
  const confirm=document.getElementById('newAccountPasswordConfirm').value;
  if(await digestLoginSecret(old)!==activeLocalUser.loginHash){showToast('Kata sandi lama tidak sesuai');return}
  if(next.length<6){showToast('Kata sandi baru minimal 6 karakter');return}
  if(next!==confirm){showToast('Konfirmasi kata sandi belum sama');return}
  activeLocalUser={...activeLocalUser,loginHash:await digestLoginSecret(next),updatedAt:new Date().toISOString()};
  await authPut('users',activeLocalUser);
  ['currentAccountPassword','newAccountPassword','newAccountPasswordConfirm'].forEach(id=>document.getElementById(id).value='');
  showToast('Kata sandi berhasil diganti');
});

async function initMultiUser(){
  bindSystemAppearanceWatcher();
  document.documentElement.dataset.accent='ocean';
  document.documentElement.dataset.appearance='light';

  await openAuthDB();

  const migration=await authGet('meta','migration');
  if(!migration?.done){
    await openDB(BASE_DB_NAME);
    await withTimeout(migrateLegacyAccountToAuth(),4000,'Migrasi akun lama');
  }

  await withTimeout(showLoginGate(false,'login'),5000,'Menampilkan login');
}


document.addEventListener('click',async e=>{
  const modeBtn=e.target.closest('[data-cloud-mode]');
  if(!modeBtn)return;
  try{const mode=modeBtn.dataset.cloudMode;await saveCloudConfig({mode});showToast(mode==='cloud'?'Mode Cloud + Offline diaktifkan. Lengkapi konfigurasi Supabase.':'Mode Hanya Perangkat diaktifkan.')}catch(err){showToast(err.message||'Gagal mengubah mode cloud')}
});
document.getElementById('saveCloudConfigBtn')?.addEventListener('click',async()=>{
  try{const current=await getCloudConfig();await saveCloudConfig({mode:'cloud',supabaseUrl:normalizeSupabaseUrl(document.getElementById('cloudSupabaseUrl').value),anonKey:document.getElementById('cloudSupabaseAnonKey').value.trim(),schoolCode:document.getElementById('cloudSchoolCode').value.trim(),deviceId:current.deviceId||makeCloudId(),connectionState:'idle'});showToast('Konfigurasi cloud disimpan')}catch(err){showToast(err.message||'Gagal menyimpan konfigurasi')}
});
document.getElementById('testCloudConnectionBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('testCloudConnectionBtn');
  const box=document.getElementById('cloudTestResult');
  const title=document.getElementById('cloudTestResultTitle');
  const detail=document.getElementById('cloudTestResultDetail');

  const setTestState=(state,headline,message)=>{
    if(box){
      box.classList.remove('idle','testing','success','error');
      box.classList.add(state);
    }
    if(title) title.textContent=headline;
    if(detail) detail.textContent=message;
  };

  try{
    btn.disabled=true;
    btn.textContent='Menguji...';
    setTestState('testing','Sedang menguji koneksi…','Menghubungi Supabase. Mohon tunggu beberapa detik.');

    await testCloudConnection();

    setTestState(
      'success',
      '✓ Koneksi Supabase berhasil',
      'Project URL dan Publishable Key dapat digunakan. Lanjutkan ke login/daftar Akun Cloud.'
    );
    btn.textContent='✓ Terhubung';
    showToast('Koneksi Supabase berhasil');
  }catch(err){
    try{await saveCloudConfig({connectionState:'error'})}catch(_){}
    const msg=err.name==='AbortError'
      ? 'Koneksi timeout. Periksa internet dan Project URL.'
      : (err.message||'Koneksi Supabase gagal');

    setTestState('error','✕ Koneksi belum berhasil',msg);
    btn.textContent='Coba Lagi';
    showToast(msg);
  }finally{
    btn.disabled=false;
    await renderCloudStatus();
  }
});
document.getElementById('prepareCloudDataBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('prepareCloudDataBtn');try{btn.disabled=true;btn.textContent='Menyiapkan...';await prepareCloudData();showToast('Data lokal sudah diberi ID Cloud dan masuk antrean sinkronisasi')}catch(err){showToast(err.message||'Gagal menyiapkan data cloud')}finally{btn.disabled=false;btn.textContent='Siapkan Data Cloud';await renderCloudStatus()}
});
document.getElementById('syncCloudNowBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('syncCloudNowBtn');
  try{btn.disabled=true;btn.textContent='Menyinkronkan...';showToast(await cloudSmartSync())}
  catch(err){showToast(err.message||'Sinkronisasi gagal')}
  finally{btn.disabled=false;btn.textContent='Sinkronkan Sekarang';await renderCloudStatus()}
});

document.getElementById('pushCloudBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('pushCloudBtn');
  try{btn.disabled=true;btn.textContent='Mengirim...';await cloudPushSnapshot();showToast('Ruang kerja berhasil dikirim ke Cloud')}
  catch(err){showToast(err.message||'Gagal mengirim ke Cloud')}
  finally{btn.disabled=false;btn.textContent='Kirim ke Cloud';await renderCloudStatus()}
});

document.getElementById('pullCloudBtn')?.addEventListener('click',async()=>{
  const btn=document.getElementById('pullCloudBtn');
  try{
    if(!confirm('Ambil data Cloud dan ganti data ruang kerja lokal pada akun ini?'))return;
    btn.disabled=true;btn.textContent='Mengambil...';await cloudPullSnapshot();showToast('Data Cloud berhasil diterapkan ke perangkat ini');
  }catch(err){showToast(err.message||'Gagal mengambil data Cloud')}
  finally{btn.disabled=false;btn.textContent='Ambil dari Cloud';await renderCloudStatus()}
});

document.getElementById('cloudSignInBtn')?.addEventListener('click',async()=>{
  const email=document.getElementById('cloudAuthEmail').value.trim();
  const password=document.getElementById('cloudAuthPassword').value;
  try{await cloudSignIn(email,password);showToast('Login Cloud berhasil');document.getElementById('cloudAuthPassword').value='';await renderCloudStatus();setTimeout(()=>cloudAutoSync('login'),450)}
  catch(err){showToast(err.message||'Login Cloud gagal')}
});

document.getElementById('cloudSignUpBtn')?.addEventListener('click',async()=>{
  const email=document.getElementById('cloudAuthEmail').value.trim();
  const password=document.getElementById('cloudAuthPassword').value;
  if(password.length<6){showToast('Kata sandi Cloud minimal 6 karakter');return}
  try{
    const result=await cloudSignUp(email,password);
    if(result?.access_token) showToast('Akun Cloud dibuat dan sudah login');
    else showToast('Akun Cloud dibuat. Cek email jika konfirmasi email diwajibkan.');
    document.getElementById('cloudAuthPassword').value='';await renderCloudStatus();
  }catch(err){showToast(err.message||'Pendaftaran Cloud gagal')}
});

document.getElementById('cloudSignOutBtn')?.addEventListener('click',async()=>{
  try{await cloudSignOut();showToast('Keluar dari akun Cloud')}catch(err){showToast(err.message||'Logout Cloud gagal')}
});



// SIAGA GURU Desktop 1.0.1 — dialog Tentang
const aboutDialog=document.getElementById('aboutDialog');
document.getElementById('aboutBtn')?.addEventListener('click',()=>aboutDialog?.showModal());
document.getElementById('closeAboutBtn')?.addEventListener('click',()=>aboutDialog?.close());
document.getElementById('aboutCloseActionBtn')?.addEventListener('click',()=>aboutDialog?.close());


document.getElementById('cloudAutoSyncEnabled')?.addEventListener('change',async e=>{
  try{
    await saveCloudConfig({autoSync:Boolean(e.target.checked)});
    showToast(e.target.checked?'Sinkron otomatis diaktifkan':'Sinkron otomatis dimatikan');
    if(e.target.checked) setTimeout(()=>cloudAutoSync('enabled'),250);
  }catch(err){showToast(err.message||'Gagal mengubah sinkron otomatis')}
});
document.getElementById('cloudConflictPullBtn')?.addEventListener('click',async()=>{
  if(!confirm('Gunakan data Cloud dan ganti versi data pada perangkat ini?')) return;
  try{await cloudPullSnapshot();showToast('Data Cloud dipakai. Sinkron otomatis aktif kembali.')}catch(err){showToast(err.message||'Gagal mengambil data Cloud')}
});
document.getElementById('cloudConflictPushBtn')?.addEventListener('click',async()=>{
  if(!confirm('Gunakan data perangkat ini dan jadikan sebagai versi Cloud terbaru?')) return;
  try{await cloudPushSnapshot();showToast('Data perangkat dikirim. Sinkron otomatis aktif kembali.')}catch(err){showToast(err.message||'Gagal mengirim data perangkat')}
});

document.getElementById('themeBtn')?.addEventListener('click',async()=>{
  if(!activeLocalUser)return;
  const resolved=resolveAppearanceMode(activeLocalUser.appearance||'dark');
  const next=resolved==='dark'?'light':'dark';
  await saveActiveAppearance({appearance:next});
});

function updateOnline(){
  const el=document.getElementById('onlineStatus');
  el.textContent=navigator.onLine?'Online':'Offline';
}
window.addEventListener('online',()=>{updateOnline();setTimeout(()=>cloudAutoSync('online'),500)});
window.addEventListener('offline',()=>{updateOnline();renderCloudStatus().catch(()=>{})});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') setTimeout(()=>cloudAutoSync('resume'),500)});
setInterval(()=>cloudAutoSync('interval'),90000);
updateOnline();

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  if(SIAGA_DESKTOP_RUNTIME){
    deferredPrompt=null;
    document.getElementById('installBtn')?.classList.add('hidden');
    return;
  }
  deferredPrompt=e;
  document.getElementById('installBtn')?.classList.remove('hidden');
});
document.getElementById('installBtn')?.addEventListener('click',async()=>{
  if(!deferredPrompt || SIAGA_DESKTOP_RUNTIME) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  document.getElementById('installBtn')?.classList.add('hidden');
});

async function collectWorkspaceSnapshot(){
  const rawAppMeta=await idbGet('appMeta','main')||{};
  const safeCloud=rawAppMeta.cloudConfig?{...rawAppMeta.cloudConfig}:null;
  if(safeCloud){
    delete safeCloud.authSession;
    delete safeCloud.accessToken;
    delete safeCloud.refreshToken;
  }
  const {loginHash:_lh,loginUsername:_lu,loginEnabled:_le,...safeAppMeta}=rawAppMeta;
  if(safeCloud) safeAppMeta.cloudConfig=safeCloud;
  return {
    version:9,app:'SIAGA GURU',exportedAt:new Date().toISOString(),
    profile:await idbGet('profile','main'),
    students:await idbGetAll('students'),
    studentEnrollments:await idbGetAll('studentEnrollments'),
    attendance:await idbGetAll('attendance'),
    journals:await idbGetAll('journals'),
    assessments:await idbGetAll('assessments'),
    grades:await idbGetAll('grades'),
    homeroomProfiles:await idbGetAll('homeroomProfiles'),
    homeroomNotes:await idbGetAll('homeroomNotes'),
    teachingContexts:await idbGetAll('teachingContexts'),
    academicSessions:await idbGetAll('academicSessions'),
    appMeta:safeAppMeta
  };
}

async function applyWorkspaceSnapshot(data,{preserveCloud=true}={}){
  if(!data||data.app!=='SIAGA GURU') throw new Error('Snapshot SIAGA GURU tidak dikenali');
  const currentMeta=await idbGet('appMeta','main')||{};
  const currentCloud=currentMeta.cloudConfig||null;
  cloudRuntime.suppressQueue=true;
  try{
    for(const name of ['profile','students','studentEnrollments','attendance','journals','assessments','grades','homeroomProfiles','homeroomNotes','teachingContexts','academicSessions']){
      if(db.objectStoreNames.contains(name)) await idbClear(name);
    }
    await idbClear('appMeta');
    if(db.objectStoreNames.contains('syncQueue')) await idbClear('syncQueue');

    if(data.profile) await idbPut('profile',data.profile);
    for(const s of (data.academicSessions||[])) await idbPut('academicSessions',s);
    const restoredMeta={...(data.appMeta||{}),id:'main'};
    if(preserveCloud && currentCloud) restoredMeta.cloudConfig=currentCloud;
    await idbPut('appMeta',restoredMeta);

    const idMap=new Map();
    for(const s of (data.students||[])){
      const oldId=s.id; const c={...s}; delete c.id;
      const newId=await idbAdd('students',c); idMap.set(Number(oldId),Number(newId));
    }
    for(const e of (data.studentEnrollments||[])){
      const mapped=idMap.get(Number(e.studentId))||Number(e.studentId);
      const pKey=e.periodKey||restoredMeta.activePeriodKey||'legacy';
      await idbPut('studentEnrollments',{...e,studentId:mapped,periodKey:pKey,id:enrollmentKey(pKey,mapped)});
    }
    for(const a of (data.attendance||[])){
      const mapped=idMap.get(Number(a.studentId))||Number(a.studentId);
      const pKey=a.periodKey||restoredMeta.activePeriodKey||'legacy';
      await idbPut('attendance',{...a,studentId:mapped,periodKey:pKey,id:attendanceKey(a.date,mapped,pKey)});
    }
    for(const j of (data.journals||[])){const c={...j};delete c.id;await idbAdd('journals',c)}
    const assessmentMap=new Map();
    for(const a of (data.assessments||[])){const oldId=a.id;const c={...a};delete c.id;const newId=await idbAdd('assessments',c);assessmentMap.set(Number(oldId),Number(newId))}
    for(const g of (data.grades||[])){
      const newAssessmentId=assessmentMap.get(Number(g.assessmentId))||Number(g.assessmentId);
      const newStudentId=idMap.get(Number(g.studentId))||Number(g.studentId);
      await idbPut('grades',{...g,assessmentId:newAssessmentId,studentId:newStudentId,id:gradeKey(newAssessmentId,newStudentId)});
    }
    for(const p of (data.homeroomProfiles||[])){const newStudentId=idMap.get(Number(p.studentId))||Number(p.studentId);await idbPut('homeroomProfiles',{...p,studentId:newStudentId})}
    for(const n of (data.homeroomNotes||[])){const newStudentId=idMap.get(Number(n.studentId))||Number(n.studentId);const c={...n,studentId:newStudentId};delete c.id;await idbAdd('homeroomNotes',c)}
    for(const t of (data.teachingContexts||[])){const c={...t};delete c.id;await idbAdd('teachingContexts',c)}
  }finally{
    cloudRuntime.suppressQueue=false;
  }
  await initializeWorkspaceData();
  return true;
}

document.getElementById('backupBtn').addEventListener('click',async()=>{
  const data=await collectWorkspaceSnapshot();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`siaga-guru-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
  showToast('Backup berhasil diunduh');
});
document.getElementById('restoreBtn').addEventListener('click',async()=>{
  const file=document.getElementById('restoreFile').files[0];if(!file){showToast('Pilih file backup terlebih dahulu');return;}
  try{
    const data=JSON.parse(await file.text());
    await applyWorkspaceSnapshot(data,{preserveCloud:true});
    showToast('Data berhasil dipulihkan');
  }catch(err){showToast('Restore gagal: '+err.message)}
});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

(async function init(){
  // Watchdog: splash tidak boleh menahan aplikasi tanpa batas.
  const watchdog=setTimeout(()=>dismissSplash(true),3500);

  try{
    await withTimeout(initMultiUser(),STARTUP_TIMEOUT_MS,'Memulai SIAGA GURU');
  }catch(err){
    console.error('[SIAGA GURU] Startup dipulihkan:',err);
    clearLoginSession();

    // Usahakan login normal muncul. Bila itu pun gagal, paksa tampilkan form.
    try{
      if(!authDb) await openAuthDB();
      await withTimeout(showLoginGate(true,'login'),3500,'Memulihkan login');
    }catch(recoveryErr){
      console.error('[SIAGA GURU] Recovery login gagal:',recoveryErr);
      forceShowLoginGate(
        'Aplikasi berhasil dimuat, tetapi database lokal sedang sibuk. Tutup tab SIAGA GURU lain lalu muat ulang halaman ini.'
      );
    }
  }finally{
    clearTimeout(watchdog);
    dismissSplash();
  }
})();


window.addEventListener('error',()=>{
  dismissSplash(true);
});
window.addEventListener('unhandledrejection',e=>{
  console.error('[SIAGA GURU] Promise tidak tertangani:',e.reason);
  dismissSplash(true);
});


// ===================================================================
// SIAGA GURU MOBILE 1.0 — bottom sheet menu
// ===================================================================
(function initSiagaMobileMenu(){
  const btn=document.getElementById('mobileMoreBtn');
  const sheet=document.getElementById('mobileMoreSheet');
  const backdrop=document.getElementById('mobileMoreBackdrop');
  const close=document.getElementById('mobileMoreClose');
  if(!btn || !sheet || !backdrop) return;

  const openSheet=()=>{
    sheet.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    sheet.setAttribute('aria-hidden','false');
    backdrop.setAttribute('aria-hidden','false');
    btn.classList.add('active');
    document.body.style.overflow='hidden';
  };
  const closeSheet=()=>{
    sheet.classList.add('hidden');
    backdrop.classList.add('hidden');
    sheet.setAttribute('aria-hidden','true');
    backdrop.setAttribute('aria-hidden','true');
    btn.classList.remove('active');
    document.body.style.overflow='';
  };

  btn.addEventListener('click',openSheet);
  close?.addEventListener('click',closeSheet);
  backdrop.addEventListener('click',closeSheet);
  sheet.addEventListener('click',e=>{
    if(e.target.closest('[data-page]')) setTimeout(closeSheet,20);
  });
  window.addEventListener('keydown',e=>{if(e.key==='Escape') closeSheet()});
})();


// ===================================================================
// SIAGA GURU MOBILE 1.0.1 — PWA & NAV POLISH
// ===================================================================
(function siagaMobile101(){
  const installBtn=document.getElementById('installBtn');
  const isStandalone=()=>{
    try{
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    }catch(_){ return false; }
  };

  if(isStandalone()) installBtn?.classList.add('hidden');

  try{
    window.matchMedia('(display-mode: standalone)').addEventListener('change',e=>{
      if(e.matches) installBtn?.classList.add('hidden');
    });
  }catch(_){}

  window.addEventListener('appinstalled',()=>{
    installBtn?.classList.add('hidden');
  });

  // Saat memilih menu utama, pastikan tombol "Menu" tidak tersisa aktif.
  document.addEventListener('click',e=>{
    const direct=e.target.closest('.mobile-main-nav [data-page]');
    if(direct){
      document.getElementById('mobileMoreBtn')?.classList.remove('active');
    }
  });
})();
