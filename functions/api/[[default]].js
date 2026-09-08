/* 可乐菲出入库系统 - EdgeOne Pages 边缘函数版
 *
 * 架构：EdgeOne Pages Functions (V8) + KV 存储
 * 部署：WorkBuddy EdgeOne Makers / edgeone CLI
 *
 * 数据：整个数据库存为一个 KV key（"klf_db"），JSON 序列化
 * 安全：PBKDF2-SHA256 (100k 迭代) 密码哈希，Bearer Token 会话
 *
 * 注意：需要在 EdgeOne Pages 项目里绑定一个 KV 命名空间，
 *       绑定变量名 KLFEI_KV（或任意名，本代码会自动探测常见名）。
 *
 * Author: WorkBuddy for 可乐菲
 */

/* =========================================================
 * KV 兼容层：自动探测绑定的 KV 变量名
 * ========================================================= */
function getKV(env) {
  // 优先：项目绑定的全局变量（EdgeOne Pages 官方方式）
  try {
    if (typeof KLFEI_KV !== 'undefined' && KLFEI_KV) return { kv: KLFEI_KV, name: 'KLFEI_KV' };
  } catch (e) { /* not defined */ }
  // 其次：env 里找
  const tryNames = ['KLFEI_KV', 'klfei_kv', 'KV', 'kv', 'kv_db', 'KV_DB', 'db_kv', 'DB_KV', 'KLEF_KV', 'klf_kv', 'KLF_KV'];
  if (env) {
    for (const n of tryNames) {
      if (env[n] && typeof env[n].get === 'function') return { kv: env[n], name: n };
    }
    // 兜底：扫 env 里任何带 get/put 方法的值
    for (const k of Object.keys(env)) {
      const v = env[k];
      if (v && typeof v === 'object' && typeof v.get === 'function' && typeof v.put === 'function') {
        return { kv: v, name: k };
      }
    }
  }
  // 再扫全局
  try {
    for (const n of tryNames) {
      const v = globalThis[n];
      if (v && typeof v.get === 'function' && typeof v.put === 'function') return { kv: v, name: n };
    }
  } catch (e) { /* ignore */ }
  return { kv: null, name: null };
}

const DB_KEY = 'klf_db';

/* =========================================================
 * Supabase 存储适配层（KV 审批未通过时的替代方案）
 * 需要在 EdgeOne Pages 项目设置→环境变量 中添加：
 *   SUPABASE_URL  = https://xxxx.supabase.co
 *   SUPABASE_KEY  = service_role 密钥（Secret 类型）
 * 可选：SUPABASE_BUCKET = 存储桶名（默认 klf）
 * 接口与 KV 兼容：get(key) -> string|null，put(key, string)
 * ========================================================= */
function makeSupabaseStore(env) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_KEY || env.SUPABASE_SERVICE_KEY || '';
  if (!baseUrl || !key || !/^https?:\/\//.test(baseUrl)) return null;
  const bucket = env.SUPABASE_BUCKET || 'klf';
  // 注意：读必须走 /object/authenticated/ 前缀（绕开 CDN 缓存，否则会读到旧数据）
  //       写必须走普通 /object/ 路径（authenticated 路径不支持上传，会报 Bucket not found）
  const readUrl = (k) => baseUrl + '/storage/v1/object/authenticated/' + bucket + '/' + k + '.json';
  const writeUrl = (k) => baseUrl + '/storage/v1/object/' + bucket + '/' + k + '.json';
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  return {
    kind: 'supabase',
    async get(k) {
      let r;
      try {
        r = await fetch(readUrl(k), { headers });
      } catch (e) {
        throw new Error('无法连接 Supabase（' + e.message + '），请检查 SUPABASE_URL');
      }
      if (r.status === 404) return null;
      // Supabase 对不存在的对象有时返回 400 + "Object not found" / "NoSuchKey"
      if (r.status === 400) {
        const t = await r.text();
        if (/not found|NoSuchKey|不存在/i.test(t)) return null;
        throw new Error('Supabase 读取失败 400: ' + t.slice(0, 150));
      }
      if (!r.ok) throw new Error('Supabase 读取失败 ' + r.status);
      return await r.text();
    },
    async put(k, v) {
      let r;
      try {
        r = await fetch(writeUrl(k) + '?upsert=true', {
          method: 'POST',
          headers: Object.assign({}, headers, {
            'Content-Type': 'application/json',
            'x-upsert': 'true',
          }),
          body: v,
        });
      } catch (e) {
        throw new Error('无法连接 Supabase（' + e.message + '），请检查 SUPABASE_URL');
      }
      if (!r.ok) {
        const t = await r.text();
        throw new Error('Supabase 写入失败 ' + r.status + ': ' + t.slice(0, 150));
      }
      return true;
    },
  };
}

function emptyDb() {
  return {
    users: [],      // {id, name, pass, salt, role, createdAt}
    items: [],      // {id, code, name, spec, category, unit, qty, minQty, createdAt}
    logs: [],       // {id, time, type, itemId, itemName, spec, unit, before, qty, after, person, remark}
    requests: [],   // {id, type, itemId, itemName, spec, unit, currentQty, qty, reason, applicantId, applicant, time, status, approver, approveTime, note, doneTime, doneQty, doneItemId}
    sessions: {},   // token -> {userId, createdAt, lastSeen}
  };
}

async function loadDb(kv) {
  const raw = await kv.get(DB_KEY);
  if (!raw) return emptyDb();
  try {
    const d = JSON.parse(raw);
    const base = emptyDb();
    return {
      users: Array.isArray(d.users) ? d.users : [],
      items: Array.isArray(d.items) ? d.items : [],
      logs: Array.isArray(d.logs) ? d.logs : [],
      requests: Array.isArray(d.requests) ? d.requests : [],
      sessions: (d.sessions && typeof d.sessions === 'object') ? d.sessions : {},
    };
  } catch (e) {
    return emptyDb();
  }
}

async function saveDb(kv, db) {
  // 日志上限保护（防 KV value 超限）：保留最近 2000 条
  if (db.logs.length > 2000) db.logs = db.logs.slice(-2000);
  await kv.put(DB_KEY, JSON.stringify(db));
}

/* =========================================================
 * 工具函数
 * ========================================================= */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}
function uid() { return Date.now().toString(36) + randHex(6); }
function pad(n) { return String(n).padStart(2, '0'); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 东八区
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/* PBKDF2-SHA256 密码哈希（Web Crypto 原生实现，不占 JS CPU 时间） */
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 100000 },
    keyMaterial, 256
  );
  return bytesToHex(new Uint8Array(bits));
}
async function makePasswordRecord(password) {
  const salt = randHex(16);
  const hash = await hashPassword(password, salt);
  return { salt, hash };
}
async function verifyPassword(password, salt, expectedHash) {
  try {
    const computed = await hashPassword(password, salt);
    return computed === expectedHash;
  } catch (e) { return false; }
}
function newToken() { return randHex(24); }
function isAdmin(u) { return u && u.role === 'admin'; }
function canIn(u) { return u && (u.role === 'admin' || u.role === 'authorized'); }

/* =========================================================
 * 会话与鉴权
 * ========================================================= */
function getToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}
function findUserByToken(db, token) {
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  const u = db.users.find(u => u.id === sess.userId);
  return u || null;
}

/* =========================================================
 * 状态组装（与前端字段一一对应，全部驼峰）
 * ========================================================= */
function pubState(db, u) {
  const seeAll = canIn(u);
  let logs = seeAll
    ? db.logs.slice()
    : db.logs.filter(l => l.person === u.name);
  logs.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  logs = logs.slice(0, 1000);

  let requests = seeAll
    ? db.requests.slice()
    : db.requests.filter(r => r.applicant === u.name || r.type === 'buy');
  requests.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  requests = requests.slice(0, 500);

  const items = db.items.slice().sort((a, b) => (a.code || '').localeCompare(b.code || ''));

  const st = {
    me: { id: u.id, name: u.name, role: u.role },
    items, requests, logs,
    serverTime: nowStr(),
  };
  if (isAdmin(u)) {
    st.users = db.users
      .slice()
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      .map(x => ({ id: x.id, name: x.name, role: x.role, createdAt: x.createdAt }));
    st.pendingCount = db.requests.filter(r => r.status === 'pending').length;
  }
  return st;
}

/* =========================================================
 * 响应工具
 * ========================================================= */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}
const ERR = (msg, status = 400) => json({ error: msg }, status);
const needLogin = () => json({ error: '请先登录', needLogin: true }, 401);

/* =========================================================
 * 主处理器：全部 API
 * ========================================================= */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, ''); // 去尾部斜杠
  const method = request.method;

  /* CORS 预检 */
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
    });
  }

  /* 临时探测：验证 EdgeOne 边缘节点能否连通 Supabase（验证后删除） */
  if (path === '/api/debug-supabase') {
    const target = url.searchParams.get('url') || 'https://zxbrtojycivlohitzztm.supabase.co/auth/v1/health';
    const t0 = Date.now();
    try {
      const r = await fetch(target, { method: 'GET', headers: { apikey: 'probe' } });
      const text = (await r.text()).slice(0, 300);
      return json({ ok: r.ok, status: r.status, ms: Date.now() - t0, target, body: text }, 200);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e), ms: Date.now() - t0, target }, 200);
    }
  }

  /* 存储层选择：优先 KV（若已绑定），否则用 Supabase（若已配置环境变量） */
  let kv = null, kvName = null;
  const kvRes = getKV(env);
  if (kvRes.kv) {
    kv = kvRes.kv; kvName = 'kv(' + kvRes.name + ')';
  } else {
    const sb = makeSupabaseStore(env);
    if (sb) { kv = sb; kvName = 'supabase(' + (env.SUPABASE_BUCKET || 'klf') + ')'; }
  }
  if (!kv) {
    return json({
      error: '云端存储未配置。两种方案任选其一：① 项目设置→KV 存储→绑定命名空间；② 项目设置→环境变量→添加 SUPABASE_URL 和 SUPABASE_KEY',
      hint: 'functions/api/[[default]].js -> 未找到 KV 绑定，也未找到 SUPABASE_URL/SUPABASE_KEY 环境变量',
    }, 500);
  }

  /* 读 body（POST 接口） */
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  let db;
  try {
    db = await loadDb(kv);
  } catch (e) {
    return json({
      error: '读取云端存储失败：' + e.message,
      hint: '若使用 Supabase 方案，请检查环境变量 SUPABASE_URL / SUPABASE_KEY 是否正确、存储桶是否已创建',
    }, 500);
  }
  const token = getToken(request);
  const user = findUserByToken(db, token);

  /* ---------- GET /api/health ---------- */
  if (path === '/api/health' && method === 'GET') {
    return json({
      ok: true,
      db: kvName,
      users: db.users.length, items: db.items.length,
      logs: db.logs.length,
      pendingRequests: db.requests.filter(r => r.status === 'pending').length,
      activeSessions: Object.keys(db.sessions).length,
      serverTime: nowStr(),
      platform: 'edgeone-pages',
    });
  }

  /* ---------- POST /api/setup 初始化管理员 ---------- */
  if (path === '/api/setup' && method === 'POST') {
    if (db.users.length > 0) return json({ error: '系统已初始化，请直接登录', needLogin: true }, 400);
    const name = String(body.name || '').trim();
    const pass = String(body.pass || '');
    if (!name) return ERR('请填写姓名');
    if (pass.length < 4) return ERR('密码至少 4 位');
    if (db.users.find(u => u.name === name)) return ERR('该姓名已存在');
    const id = uid();
    const rec = await makePasswordRecord(pass);
    db.users.push({ id, name, pass: rec.hash, salt: rec.salt, role: 'admin', createdAt: today() });
    const tk = newToken();
    db.sessions[tk] = { userId: id, createdAt: nowStr(), lastSeen: nowStr() };
    await saveDb(kv, db);
    const u = db.users.find(x => x.id === id);
    return json({ token: tk, state: pubState(db, u) });
  }

  /* ---------- POST /api/register 自助注册 ---------- */
  if (path === '/api/register' && method === 'POST') {
    if (db.users.length === 0) return ERR('系统尚未初始化，请联系管理员先创建账号');
    const name = String(body.name || '').trim();
    const pass = String(body.pass || '');
    if (!name) return ERR('请填写姓名（如"王老师"）');
    if (pass.length < 4) return ERR('密码至少 4 位');
    if (db.users.find(u => u.name === name)) return ERR('该姓名已注册，请直接登录');
    const id = uid();
    const rec = await makePasswordRecord(pass);
    db.users.push({ id, name, pass: rec.hash, salt: rec.salt, role: 'normal', createdAt: today() });
    const tk = newToken();
    db.sessions[tk] = { userId: id, createdAt: nowStr(), lastSeen: nowStr() };
    await saveDb(kv, db);
    const u = db.users.find(x => x.id === id);
    return json({ token: tk, state: pubState(db, u) });
  }

  /* ---------- POST /api/login 登录 ---------- */
  if (path === '/api/login' && method === 'POST') {
    const name = String(body.name || '').trim();
    const pass = String(body.pass || '');
    const u = db.users.find(x => x.name === name);
    if (!u) return ERR('用户不存在，请先注册');
    const ok = await verifyPassword(pass, u.salt, u.pass);
    if (!ok) return ERR('密码错误');
    const tk = newToken();
    db.sessions[tk] = { userId: u.id, createdAt: nowStr(), lastSeen: nowStr() };
    await saveDb(kv, db);
    return json({ token: tk, state: pubState(db, u) });
  }

  /* ---------- GET /api/state ---------- */
  if (path === '/api/state' && method === 'GET') {
    if (!user) {
      return json({ needLogin: true, needSetup: db.users.length === 0 }, 401);
    }
    if (token && db.sessions[token]) db.sessions[token].lastSeen = nowStr();
    await saveDb(kv, db);
    return json({ state: pubState(db, user) });
  }

  /* ---------- POST /api/logout ---------- */
  if (path === '/api/logout' && method === 'POST') {
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      await saveDb(kv, db);
    }
    return json({ ok: true });
  }

  /* ---------- POST /api/changepass ---------- */
  if (path === '/api/changepass' && method === 'POST') {
    if (!user) return needLogin();
    const ok = await verifyPassword(String(body.oldPass || ''), user.salt, user.pass);
    if (!ok) return ERR('原密码错误');
    const newPass = String(body.newPass || '');
    if (newPass.length < 4) return ERR('新密码至少 4 位');
    const rec = await makePasswordRecord(newPass);
    user.pass = rec.hash;
    user.salt = rec.salt;
    await saveDb(kv, db);
    return json({ ok: true });
  }

  /* ---------- POST /api/items 物品管理（需入库权限） ---------- */
  if (path === '/api/items' && method === 'POST') {
    if (!user) return needLogin();
    if (!canIn(user)) return json({ error: '需要入库/建档权限' }, 403);
    const action = body.action;

    if (action === 'add') {
      const name = String(body.name || '').trim();
      if (!name) return ERR('请填写物品名称');
      const code = 'WL' + String(db.items.length + 1).padStart(3, '0');
      const initQty = Math.max(0, Number(body.initQty) || 0);
      const id = uid();
      const item = {
        id, code, name,
        spec: String(body.spec || '').trim(),
        category: String(body.category || '').trim(),
        unit: String(body.unit || '').trim() || '件',
        qty: initQty,
        minQty: Math.max(0, Number(body.minQty) || 0),
        createdAt: today(),
      };
      db.items.push(item);
      if (initQty > 0) {
        db.logs.push({
          id: uid(), time: nowStr(), type: 'init', itemId: id, itemName: name,
          spec: item.spec, unit: item.unit,
          before: 0, qty: initQty, after: initQty,
          person: user.name, remark: '期初库存',
        });
      }
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'update') {
      const it = db.items.find(x => x.id === body.id);
      if (!it) return ERR('物品不存在');
      const name = String(body.name || '').trim();
      if (name) it.name = name;
      it.spec = String(body.spec || '').trim();
      it.category = String(body.category || '').trim();
      const unit = String(body.unit || '').trim();
      if (unit) it.unit = unit;
      it.minQty = Math.max(0, Number(body.minQty) || 0);
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'delete') {
      db.items = db.items.filter(x => x.id !== body.id);
      await saveDb(kv, db);
      return json({ ok: true });
    }
    return ERR('未知操作');
  }

  /* ---------- POST /api/inbound 直接入库 ---------- */
  if (path === '/api/inbound' && method === 'POST') {
    if (!user) return needLogin();
    if (!canIn(user)) return json({ error: '需要入库/建档权限' }, 403);
    const it = db.items.find(x => x.id === body.itemId);
    if (!it) return ERR('请选择物品');
    const qty = Number(body.qty);
    if (!qty || qty <= 0) return ERR('数量必须大于 0');
    const before = Number(it.qty);
    const after = before + qty;
    it.qty = after;
    db.logs.push({
      id: uid(), time: nowStr(), type: 'in', itemId: it.id, itemName: it.name,
      spec: it.spec, unit: it.unit,
      before, qty, after,
      person: user.name, remark: String(body.remark || ''),
    });
    await saveDb(kv, db);
    return json({ ok: true, before, after, unit: it.unit, name: it.name });
  }

  /* ---------- POST /api/req 出库/报损申请 ---------- */
  if (path === '/api/req' && method === 'POST') {
    if (!user) return needLogin();
    const type = body.type;
    if (type !== 'out' && type !== 'damage') return ERR('类型错误');
    const it = db.items.find(x => x.id === body.itemId);
    if (!it) return ERR('请选择物品');
    const qty = Number(body.qty);
    if (!qty || qty <= 0) return ERR('数量必须大于 0');
    if (qty > Number(it.qty)) return ERR(`超过当前库存（现存 ${it.qty} ${it.unit}）`);
    db.requests.push({
      id: uid(), type, itemId: it.id, itemName: it.name,
      spec: it.spec, unit: it.unit,
      currentQty: Number(it.qty), qty,
      reason: String(body.reason || '').trim(),
      applicantId: user.id, applicant: user.name,
      time: nowStr(), status: 'pending',
      approver: '', approveTime: '', note: '', doneTime: '', doneQty: null, doneItemId: '',
    });
    await saveDb(kv, db);
    return json({ ok: true });
  }

  /* ---------- POST /api/buy 采买申请 ---------- */
  if (path === '/api/buy' && method === 'POST') {
    if (!user) return needLogin();
    const name = String(body.itemName || '').trim();
    const qty = Number(body.qty);
    if (!name) return ERR('请填写需要采买的物品名称');
    if (!qty || qty <= 0) return ERR('数量必须大于 0');
    db.requests.push({
      id: uid(), type: 'buy', itemId: '', itemName: name,
      spec: String(body.spec || '').trim(),
      unit: String(body.unit || '').trim() || '件',
      currentQty: null, qty,
      reason: String(body.reason || '').trim(),
      applicantId: user.id, applicant: user.name,
      time: nowStr(), status: 'pending',
      approver: '', approveTime: '', note: '', doneTime: '', doneQty: null, doneItemId: '',
    });
    await saveDb(kv, db);
    return json({ ok: true });
  }

  /* ---------- POST /api/cancelreq 撤回申请 ---------- */
  if (path === '/api/cancelreq' && method === 'POST') {
    if (!user) return needLogin();
    const r = db.requests.find(x => x.id === body.id);
    if (!r) return ERR('申请不存在');
    if (r.applicantId !== user.id && !isAdmin(user)) return json({ error: '只能撤回自己的申请' }, 403);
    if (r.status !== 'pending') return ERR('仅待审批的申请可撤回');
    db.requests = db.requests.filter(x => x.id !== body.id);
    await saveDb(kv, db);
    return json({ ok: true });
  }

  /* ---------- POST /api/approve 审批 ---------- */
  if (path === '/api/approve' && method === 'POST') {
    if (!user) return needLogin();
    if (!isAdmin(user)) return json({ error: '需要管理员权限' }, 403);
    const r = db.requests.find(x => x.id === body.id);
    if (!r) return ERR('申请不存在');
    if (r.status !== 'pending') return ERR('该申请已处理');
    const action = body.action;

    if (action === 'reject') {
      r.status = 'rejected';
      r.approveTime = nowStr();
      r.approver = user.name;
      r.note = String(body.note || '').trim();
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'approve') {
      if (r.type === 'out' || r.type === 'damage') {
        const it = db.items.find(x => x.id === r.itemId);
        if (!it) {
          r.status = 'rejected'; r.approveTime = nowStr();
          r.approver = user.name; r.note = '物品已被删除，自动驳回';
          await saveDb(kv, db);
          return ERR('物品已被删除，已自动驳回');
        }
        if (r.qty > Number(it.qty)) {
          r.status = 'rejected'; r.approveTime = nowStr();
          r.approver = user.name; r.note = '库存不足，自动驳回';
          await saveDb(kv, db);
          return ERR(`库存不足（现存 ${it.qty}），已自动驳回`);
        }
        const before = Number(it.qty);
        const after = before - r.qty;
        it.qty = after;
        db.logs.push({
          id: uid(), time: nowStr(), type: r.type, itemId: it.id, itemName: it.name,
          spec: it.spec, unit: it.unit,
          before, qty: r.qty, after,
          person: r.applicant,
          remark: `审批通过 · ${r.reason || (r.type === 'out' ? '出库' : '报损')}`,
        });
        r.status = 'approved';
        r.approveTime = nowStr();
        r.approver = user.name;
        r.note = String(body.note || '').trim();
        await saveDb(kv, db);
        return json({ ok: true });
      }
      if (r.type === 'buy') {
        r.status = 'approved';
        r.approveTime = nowStr();
        r.approver = user.name;
        r.note = String(body.note || '').trim();
        await saveDb(kv, db);
        return json({ ok: true });
      }
    }
    return ERR('未知操作');
  }

  /* ---------- POST /api/buydone 采买到货入库 ---------- */
  if (path === '/api/buydone' && method === 'POST') {
    if (!user) return needLogin();
    if (!isAdmin(user)) return json({ error: '需要管理员权限' }, 403);
    const r = db.requests.find(x => x.id === body.id);
    if (!r) return ERR('申请不存在');
    if (r.type !== 'buy') return ERR('不是采买申请');
    if (r.status !== 'approved') return ERR('请先批准该采买申请');
    let it;
    if (body.mode === 'existing') {
      it = db.items.find(x => x.id === body.itemId);
      if (!it) return ERR('请选择物品');
    } else {
      const name = String(body.newName || '').trim();
      if (!name) return ERR('请填写新物品名称');
      const id = uid();
      it = {
        id, code: 'WL' + String(db.items.length + 1).padStart(3, '0'), name,
        spec: String(body.spec || '').trim(), category: '采买入库',
        unit: String(body.unit || '').trim() || r.unit || '件',
        qty: 0, minQty: Math.max(0, Number(body.minQty) || 0),
        createdAt: today(),
      };
      db.items.push(it);
    }
    const qty = Number(body.qty) || r.qty;
    if (!qty || qty <= 0) return ERR('入库数量必须大于 0');
    const before = Number(it.qty);
    const after = before + qty;
    it.qty = after;
    db.logs.push({
      id: uid(), time: nowStr(), type: 'in', itemId: it.id, itemName: it.name,
      spec: it.spec, unit: it.unit,
      before, qty, after,
      person: r.applicant,
      remark: `采买入库（申请人：${r.applicant}）`,
    });
    r.status = 'done';
    r.doneTime = nowStr();
    r.doneQty = qty;
    r.doneItemId = it.id;
    await saveDb(kv, db);
    return json({ ok: true });
  }

  /* ---------- POST /api/users 用户管理（管理员） ---------- */
  if (path === '/api/users' && method === 'POST') {
    if (!user) return needLogin();
    if (!isAdmin(user)) return json({ error: '需要管理员权限' }, 403);
    const action = body.action;

    if (action === 'add') {
      const name = String(body.name || '').trim();
      const pass = String(body.pass || '');
      if (!name) return ERR('请填写姓名');
      if (pass.length < 4) return ERR('密码至少 4 位');
      if (db.users.find(u => u.name === name)) return ERR('该姓名已存在');
      const role = ['normal', 'authorized', 'admin'].includes(body.role) ? body.role : 'normal';
      const rec = await makePasswordRecord(pass);
      db.users.push({ id: uid(), name, pass: rec.hash, salt: rec.salt, role, createdAt: today() });
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'role') {
      if (body.userId === user.id) return ERR('不能修改自己的角色');
      const t = db.users.find(u => u.id === body.userId);
      if (!t) return ERR('用户不存在');
      t.role = ['normal', 'authorized', 'admin'].includes(body.role) ? body.role : 'normal';
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'resetpass') {
      const t = db.users.find(u => u.id === body.userId);
      if (!t) return ERR('用户不存在');
      const pass = String(body.pass || '');
      if (pass.length < 4) return ERR('密码至少 4 位');
      const rec = await makePasswordRecord(pass);
      t.pass = rec.hash;
      t.salt = rec.salt;
      await saveDb(kv, db);
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (body.userId === user.id) return ERR('不能删除自己');
      db.users = db.users.filter(u => u.id !== body.userId);
      for (const tk of Object.keys(db.sessions)) {
        if (db.sessions[tk].userId === body.userId) delete db.sessions[tk];
      }
      await saveDb(kv, db);
      return json({ ok: true });
    }
    return ERR('未知操作');
  }

  /* ---------- GET /api/backup 备份 ---------- */
  if (path === '/api/backup' && method === 'GET') {
    if (!user) return needLogin();
    if (!isAdmin(user)) return json({ error: '需要管理员权限' }, 403);
    const payload = {
      version: 2,
      platform: 'edgeone-kv',
      exportedAt: nowStr(),
      users: db.users.map(u => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt })),
      items: db.items,
      logs: db.logs,
      requests: db.requests,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="keleifei-backup-${today()}.json"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  /* ---------- POST /api/restore 恢复 ---------- */
  if (path === '/api/restore' && method === 'POST') {
    if (!user) return needLogin();
    if (!isAdmin(user)) return json({ error: '需要管理员权限' }, 403);
    const d = body.data;
    if (!d || !Array.isArray(d.users) || !Array.isArray(d.items) ||
        !Array.isArray(d.logs) || !Array.isArray(d.requests)) {
      return ERR('备份文件格式不正确');
    }
    const newDb = emptyDb();
    newDb.sessions = db.sessions; // 保留现有会话
    for (const u of d.users) {
      const rec = await makePasswordRecord('1234'); // 备份无密码，统一重置为 1234
      newDb.users.push({
        id: u.id || uid(), name: String(u.name || ''), pass: rec.hash, salt: rec.salt,
        role: ['normal', 'authorized', 'admin'].includes(u.role) ? u.role : 'normal',
        createdAt: u.createdAt || today(),
      });
    }
    for (const it of d.items) {
      newDb.items.push({
        id: it.id || uid(), code: it.code || '', name: String(it.name || ''),
        spec: it.spec || '', category: it.category || '',
        unit: it.unit || '件', qty: Number(it.qty) || 0,
        minQty: Number(it.minQty || 0), createdAt: it.createdAt || today(),
      });
    }
    for (const l of d.logs) {
      newDb.logs.push({
        id: l.id || uid(), time: l.time || nowStr(), type: l.type || 'in',
        itemId: l.itemId || '', itemName: String(l.itemName || l.item_name || ''),
        spec: l.spec || '', unit: l.unit || '',
        before: Number(l.before != null ? l.before : l.before_qty) || 0,
        qty: Number(l.qty) || 0,
        after: Number(l.after != null ? l.after : l.after_qty) || 0,
        person: l.person || '', remark: l.remark || '',
      });
    }
    for (const r of d.requests) {
      newDb.requests.push({
        id: r.id || uid(), type: r.type || 'out',
        itemId: r.itemId || r.item_id || '', itemName: String(r.itemName || r.item_name || ''),
        spec: r.spec || '', unit: r.unit || '',
        currentQty: r.currentQty != null ? Number(r.currentQty) : (r.current_qty != null ? Number(r.current_qty) : null),
        qty: Number(r.qty) || 0,
        reason: r.reason || '',
        applicantId: r.applicantId || r.applicant_id || '', applicant: r.applicant || '',
        time: r.time || nowStr(), status: r.status || 'pending',
        approver: r.approver || '', approveTime: r.approveTime || r.approve_time || '',
        note: r.note || '',
        doneTime: r.doneTime || r.done_time || '',
        doneQty: r.doneQty != null ? Number(r.doneQty) : (r.done_qty != null ? Number(r.done_qty) : null),
        doneItemId: r.doneItemId || r.done_item_id || '',
      });
    }
    await saveDb(kv, newDb);
    return json({ ok: true });
  }

  /* ---------- GET /api/diag 诊断 ---------- */
  if (path === '/api/diag' && method === 'GET') {
    if (!user) return needLogin();
    return json({
      ok: true,
      db: kvName,
      platform: 'edgeone-pages',
      serverTime: nowStr(),
      counts: {
        users: db.users.length,
        items: db.items.length,
        logs: db.logs.length,
        requests: db.requests.length,
        sessions: Object.keys(db.sessions).length,
      },
      me: { id: user.id, name: user.name, role: user.role },
    });
  }

  /* ---------- 404 ---------- */
  if (path.startsWith('/api/')) return ERR('接口不存在', 404);
  return ERR('Not Found', 404);
}
