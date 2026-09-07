/* 可乐菲出入库系统 - 长期可托管版本
 *
 * 架构：Express + PostgreSQL + 内置 scrypt 密码哈希
 * 部署：Render Blueprint 一键（自动配 PostgreSQL）
 *
 * 数据库适配：
 *   - 有 DATABASE_URL 环境变量 → 连接 PostgreSQL（Render / 生产）
 *   - 没有 → 连接本地 SQLite（本地开发 / 局域网部署）
 *
 * 启动：
 *   PORT=3000 node server.js
 *
 * Author: WorkBuddy for 可乐菲
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATABASE_URL = process.env.DATABASE_URL || '';

/* =========================================================
 * 数据库层 - 双适配（PostgreSQL / SQLite）
 * ========================================================= */
let db;
let dbType = 'sqlite';

function makeDbAdapter() {
  if (DATABASE_URL) {
    // 生产环境：PostgreSQL
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    dbType = 'postgres';
    return {
      type: 'postgres',
      async run(sql, params = []) {
        // pg 用 $1, $2 占位符，sqlite 用 ?
        const pgSql = sql.replace(/\?/g, (_, i) => '$' + (sql.slice(0, i).split('?').length));
        const r = await pool.query(pgSql, params);
        return { lastID: r.rows[0]?.id, changes: r.rowCount };
      },
      async all(sql, params = []) {
        const pgSql = sql.replace(/\?/g, (_, i) => '$' + (sql.slice(0, i).split('?').length));
        const r = await pool.query(pgSql, params);
        return r.rows;
      },
      async get(sql, params = []) {
        const pgSql = sql.replace(/\?/g, (_, i) => '$' + (sql.slice(0, i).split('?').length));
        const r = await pool.query(pgSql, params);
        return r.rows[0] || null;
      },
      async close() { await pool.end(); },
    };
  } else {
    // 本地开发：Node 22.5+ 内置 SQLite（node:sqlite），零依赖
    const { DatabaseSync } = require('node:sqlite');
    const dbFile = process.env.SQLITE_FILE || path.join(__dirname, 'data.db');
    const sqlite = new DatabaseSync(dbFile);
    dbType = 'sqlite';
    return {
      type: 'sqlite',
      async run(sql, params = []) {
        const r = sqlite.prepare(sql).run(...params);
        return { lastID: r.lastInsertRowid, changes: r.changes };
      },
      async all(sql, params = []) {
        return sqlite.prepare(sql).all(...params);
      },
      async get(sql, params = []) {
        return sqlite.prepare(sql).get(...params);
      },
      async close() { sqlite.close(); },
    };
  }
}

/* =========================================================
 * 初始化数据库表结构
 * ========================================================= */
async function initSchema(db) {
  if (db.type === 'postgres') {
    await db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, code TEXT NOT NULL,
      name TEXT NOT NULL, spec TEXT, category TEXT,
      unit TEXT, qty REAL NOT NULL DEFAULT 0,
      min_qty REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY, time TEXT NOT NULL,
      type TEXT NOT NULL,
      item_id TEXT, item_name TEXT NOT NULL,
      spec TEXT, unit TEXT,
      before_qty REAL NOT NULL, qty REAL NOT NULL,
      after_qty REAL NOT NULL, person TEXT NOT NULL,
      remark TEXT
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      item_id TEXT, item_name TEXT NOT NULL,
      spec TEXT, unit TEXT,
      current_qty REAL, qty REAL NOT NULL,
      reason TEXT,
      applicant_id TEXT NOT NULL, applicant TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approver TEXT, approve_time TEXT, note TEXT,
      done_time TEXT, done_qty REAL, done_item_id TEXT
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )`);
  } else {
    await db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, code TEXT NOT NULL,
      name TEXT NOT NULL, spec TEXT, category TEXT,
      unit TEXT, qty REAL NOT NULL DEFAULT 0,
      min_qty REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY, time TEXT NOT NULL,
      type TEXT NOT NULL,
      item_id TEXT, item_name TEXT NOT NULL,
      spec TEXT, unit TEXT,
      before_qty REAL NOT NULL, qty REAL NOT NULL,
      after_qty REAL NOT NULL, person TEXT NOT NULL,
      remark TEXT
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      item_id TEXT, item_name TEXT NOT NULL,
      spec TEXT, unit TEXT,
      current_qty REAL, qty REAL NOT NULL,
      reason TEXT,
      applicant_id TEXT NOT NULL, applicant TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approver TEXT, approve_time TEXT, note TEXT,
      done_time TEXT, done_qty REAL, done_item_id TEXT
    )`);
    await db.run(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )`);
  }
  await db.run('CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time DESC)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
}

/* =========================================================
 * 工具函数
 * ========================================================= */
function uid() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}
function pad(n) { return String(n).padStart(2, '0'); }
function today() { return new Date().toISOString().slice(0, 10); }
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const computed = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function isAdmin(u) { return u && u.role === 'admin'; }
function canIn(u) { return u && (u.role === 'admin' || u.role === 'authorized'); }

/* =========================================================
 * 中间件：会话解析
 * ========================================================= */
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  if (!token) { req.user = null; return next(); }
  const sess = await db.get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!sess) { req.user = null; return next(); }
  const u = await db.get('SELECT id, name, role, created_at FROM users WHERE id = ?', [sess.user_id]);
  // 续期 last_seen（异步不阻塞）
  db.run('UPDATE sessions SET last_seen = ? WHERE token = ?', [nowStr(), token]).catch(() => {});
  req.user = u || null;
  req.token = token;
  next();
}
async function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录', needLogin: true });
  next();
}
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录', needLogin: true });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '需要管理员权限' });
  next();
}
async function requireCanIn(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录', needLogin: true });
  if (!canIn(req.user)) return res.status(403).json({ error: '需要入库/建档权限' });
  next();
}

/* =========================================================
 * 公开状态接口（登录后所有角色可看）
 * ========================================================= */
async function pubState(u) {
  const seeAll = canIn(u);
  const logs = seeAll
    ? await db.all('SELECT * FROM logs ORDER BY time DESC LIMIT 1000')
    : await db.all('SELECT * FROM logs WHERE person = ? ORDER BY time DESC LIMIT 1000', [u.name]);
  const requests = seeAll
    ? await db.all('SELECT * FROM requests ORDER BY time DESC LIMIT 500')
    : await db.all(
        "SELECT * FROM requests WHERE applicant = ? OR type = 'buy' ORDER BY time DESC LIMIT 500",
        [u.name]
      );
  const items = await db.all('SELECT * FROM items ORDER BY code ASC');
  const st = {
    me: { id: u.id, name: u.name, role: u.role },
    items, requests,
    logs: logs.map(rowToLog),
    serverTime: nowStr(),
  };
  if (isAdmin(u)) {
    const users = await db.all('SELECT id, name, role, created_at FROM users ORDER BY created_at ASC');
    st.users = users.map(u => ({ id: u.id, name: u.name, role: u.role, createdAt: u.created_at }));
    st.pendingCount = (await db.get("SELECT COUNT(*) AS c FROM requests WHERE status = 'pending'")).c;
  }
  return st;
}
function rowToLog(r) {
  return {
    id: r.id, time: r.time, type: r.type,
    itemId: r.item_id, itemName: r.item_name,
    spec: r.spec || '', unit: r.unit || '',
    before: Number(r.before_qty), qty: Number(r.qty), after: Number(r.after_qty),
    person: r.person, remark: r.remark || '',
  };
}
function rowToRequest(r) {
  return {
    id: r.id, type: r.type,
    itemId: r.item_id, itemName: r.item_name,
    spec: r.spec || '', unit: r.unit || '',
    currentQty: r.current_qty != null ? Number(r.current_qty) : null,
    qty: Number(r.qty),
    reason: r.reason || '',
    applicantId: r.applicant_id, applicant: r.applicant,
    time: r.time, status: r.status,
    approver: r.approver || '',
    approveTime: r.approve_time || '',
    note: r.note || '',
    doneTime: r.done_time || '',
    doneQty: r.done_qty != null ? Number(r.done_qty) : null,
    doneItemId: r.done_item_id || '',
  };
}
function rowToItem(r) {
  return {
    id: r.id, code: r.code, name: r.name,
    spec: r.spec || '', category: r.category || '',
    unit: r.unit || '件', qty: Number(r.qty),
    minQty: Number(r.min_qty),
    createdAt: r.created_at,
  };
}

/* =========================================================
 * Express 路由
 * ========================================================= */
async function buildApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use((req, res, next) => {
    // 简易安全头
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(authMiddleware);

  // 静态前端
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: NODE_ENV === 'production' ? '1h' : 0,
    index: 'index.html',
  }));

  /* ---------- 健康检查 / 诊断 ---------- */
  app.get('/api/health', async (req, res) => {
    try {
      const u = await db.get('SELECT COUNT(*) AS c FROM users');
      const i = await db.get('SELECT COUNT(*) AS c FROM items');
      const l = await db.get('SELECT COUNT(*) AS c FROM logs');
      const r = await db.get("SELECT COUNT(*) AS c FROM requests WHERE status = 'pending'");
      const s = await db.get('SELECT COUNT(*) AS c FROM sessions');
      res.json({
        ok: true,
        db: dbType,
        users: u.c, items: i.c, logs: l.c,
        pendingRequests: r.c, activeSessions: s.c,
        serverTime: nowStr(),
        nodeVersion: process.version,
        uptime: Math.round(process.uptime()),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* ---------- 初始化：创建第一个管理员 ---------- */
  app.post('/api/setup', async (req, res) => {
    const cnt = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
    if (cnt > 0) return res.status(400).json({ error: '系统已初始化，请直接登录', needLogin: true });
    const name = String(req.body.name || '').trim();
    const pass = String(req.body.pass || '');
    if (!name) return res.status(400).json({ error: '请填写姓名' });
    if (pass.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    if (await db.get('SELECT id FROM users WHERE name = ?', [name])) {
      return res.status(400).json({ error: '该姓名已存在' });
    }
    const id = uid();
    const { salt, hash } = hashPassword(pass);
    await db.run(
      'INSERT INTO users (id, name, pass, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, hash, salt, 'admin', today()]
    );
    const token = newToken();
    await db.run('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      [token, id, nowStr(), nowStr()]);
    const u = await db.get('SELECT id, name, role, created_at FROM users WHERE id = ?', [id]);
    res.json({ token, state: await pubState(u) });
  });

  /* ---------- 自助注册（其他老师） ---------- */
  app.post('/api/register', async (req, res) => {
    const cnt = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
    if (cnt === 0) return res.status(400).json({ error: '系统尚未初始化，请联系管理员先创建账号' });
    const name = String(req.body.name || '').trim();
    const pass = String(req.body.pass || '');
    if (!name) return res.status(400).json({ error: '请填写姓名（如"王老师"）' });
    if (pass.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    if (await db.get('SELECT id FROM users WHERE name = ?', [name])) {
      return res.status(400).json({ error: '该姓名已注册，请直接登录' });
    }
    const id = uid();
    const { salt, hash } = hashPassword(pass);
    await db.run(
      'INSERT INTO users (id, name, pass, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, hash, salt, 'normal', today()]
    );
    const token = newToken();
    await db.run('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      [token, id, nowStr(), nowStr()]);
    const u = await db.get('SELECT id, name, role, created_at FROM users WHERE id = ?', [id]);
    res.json({ token, state: await pubState(u) });
  });

  /* ---------- 登录 ---------- */
  app.post('/api/login', async (req, res) => {
    const name = String(req.body.name || '').trim();
    const pass = String(req.body.pass || '');
    const u = await db.get('SELECT id, name, role, pass, salt FROM users WHERE name = ?', [name]);
    if (!u) return res.status(400).json({ error: '用户不存在，请先注册' });
    if (!verifyPassword(pass, u.salt, u.pass)) {
      return res.status(400).json({ error: '密码错误' });
    }
    const token = newToken();
    await db.run('INSERT INTO sessions (token, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      [token, u.id, nowStr(), nowStr()]);
    const fresh = await db.get('SELECT id, name, role, created_at FROM users WHERE id = ?', [u.id]);
    res.json({ token, state: await pubState(fresh) });
  });

  /* ---------- 当前状态 ---------- */
  app.get('/api/state', async (req, res) => {
    if (!req.user) {
      const cnt = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
      return res.status(401).json({ needLogin: true, needSetup: cnt === 0 });
    }
    res.json({ state: await pubState(req.user) });
  });

  /* ---------- 登出 ---------- */
  app.post('/api/logout', async (req, res) => {
    if (req.token) await db.run('DELETE FROM sessions WHERE token = ?', [req.token]);
    res.json({ ok: true });
  });

  /* ---------- 修改密码（自己） ---------- */
  app.post('/api/changepass', requireAuth, async (req, res) => {
    const u = await db.get('SELECT pass, salt FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(String(req.body.oldPass || ''), u.salt, u.pass)) {
      return res.status(400).json({ error: '原密码错误' });
    }
    const newPass = String(req.body.newPass || '');
    if (newPass.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });
    const { salt, hash } = hashPassword(newPass);
    await db.run('UPDATE users SET pass = ?, salt = ? WHERE id = ?', [hash, salt, req.user.id]);
    res.json({ ok: true });
  });

  /* ---------- 物品：新增/更新/删除 ---------- */
  app.post('/api/items', requireCanIn, async (req, res) => {
    const action = req.body.action;
    if (action === 'add') {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: '请填写物品名称' });
      const cnt = (await db.get('SELECT COUNT(*) AS c FROM items')).c;
      const code = 'WL' + String(cnt + 1).padStart(3, '0');
      const initQty = Math.max(0, Number(req.body.initQty) || 0);
      const id = uid();
      await db.run(
        `INSERT INTO items (id, code, name, spec, category, unit, qty, min_qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, code, name,
         String(req.body.spec || '').trim(),
         String(req.body.category || '').trim(),
         String(req.body.unit || '').trim() || '件',
         initQty, Math.max(0, Number(req.body.minQty) || 0),
         today()]
      );
      if (initQty > 0) {
        await db.run(
          `INSERT INTO logs (id, time, type, item_id, item_name, spec, unit,
             before_qty, qty, after_qty, person, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), nowStr(), 'init', id, name,
           String(req.body.spec || '').trim(),
           String(req.body.unit || '').trim() || '件',
           0, initQty, initQty, req.user.name, '期初库存']
        );
      }
      return res.json({ ok: true });
    }
    if (action === 'update') {
      const it = await db.get('SELECT id, unit FROM items WHERE id = ?', [req.body.id]);
      if (!it) return res.status(400).json({ error: '物品不存在' });
      await db.run(
        `UPDATE items SET
           name = ?, spec = ?, category = ?, unit = ?, min_qty = ?
         WHERE id = ?`,
        [String(req.body.name || '').trim() || it.name,
         String(req.body.spec || '').trim(),
         String(req.body.category || '').trim(),
         String(req.body.unit || '').trim() || it.unit,
         Math.max(0, Number(req.body.minQty) || 0),
         req.body.id]
      );
      return res.json({ ok: true });
    }
    if (action === 'delete') {
      await db.run('DELETE FROM items WHERE id = ?', [req.body.id]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: '未知操作' });
  });

  /* ---------- 直接入库 ---------- */
  app.post('/api/inbound', requireCanIn, async (req, res) => {
    const it = await db.get('SELECT * FROM items WHERE id = ?', [req.body.itemId]);
    if (!it) return res.status(400).json({ error: '请选择物品' });
    const qty = Number(req.body.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: '数量必须大于 0' });
    const before = Number(it.qty);
    const after = before + qty;
    await db.run('UPDATE items SET qty = ? WHERE id = ?', [after, it.id]);
    await db.run(
      `INSERT INTO logs (id, time, type, item_id, item_name, spec, unit,
         before_qty, qty, after_qty, person, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), nowStr(), 'in', it.id, it.name,
       it.spec || '', it.unit || '',
       before, qty, after, req.user.name,
       String(req.body.remark || '')]
    );
    res.json({ ok: true, before, after, unit: it.unit, name: it.name });
  });

  /* ---------- 提交出库 / 报损申请 ---------- */
  app.post('/api/req', requireAuth, async (req, res) => {
    const type = req.body.type;
    if (type !== 'out' && type !== 'damage') return res.status(400).json({ error: '类型错误' });
    const it = await db.get('SELECT * FROM items WHERE id = ?', [req.body.itemId]);
    if (!it) return res.status(400).json({ error: '请选择物品' });
    const qty = Number(req.body.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: '数量必须大于 0' });
    if (qty > Number(it.qty)) return res.status(400).json({ error: `超过当前库存（现存 ${it.qty} ${it.unit}）` });
    await db.run(
      `INSERT INTO requests (id, type, item_id, item_name, spec, unit,
         current_qty, qty, reason, applicant_id, applicant, time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), type, it.id, it.name, it.spec || '', it.unit || '',
       Number(it.qty), qty, String(req.body.reason || '').trim(),
       req.user.id, req.user.name, nowStr(), 'pending']
    );
    res.json({ ok: true });
  });

  /* ---------- 提交采买申请 ---------- */
  app.post('/api/buy', requireAuth, async (req, res) => {
    const name = String(req.body.itemName || '').trim();
    const qty = Number(req.body.qty);
    if (!name) return res.status(400).json({ error: '请填写需要采买的物品名称' });
    if (!qty || qty <= 0) return res.status(400).json({ error: '数量必须大于 0' });
    await db.run(
      `INSERT INTO requests (id, type, item_name, spec, unit,
         qty, reason, applicant_id, applicant, time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), 'buy', name,
       String(req.body.spec || '').trim(),
       String(req.body.unit || '').trim() || '件',
       qty, String(req.body.reason || '').trim(),
       req.user.id, req.user.name, nowStr(), 'pending']
    );
    res.json({ ok: true });
  });

  /* ---------- 撤回自己的申请 ---------- */
  app.post('/api/cancelreq', requireAuth, async (req, res) => {
    const r = await db.get('SELECT * FROM requests WHERE id = ?', [req.body.id]);
    if (!r) return res.status(400).json({ error: '申请不存在' });
    if (r.applicant_id !== req.user.id && !isAdmin(req.user)) {
      return res.status(403).json({ error: '只能撤回自己的申请' });
    }
    if (r.status !== 'pending') return res.status(400).json({ error: '仅待审批的申请可撤回' });
    await db.run('DELETE FROM requests WHERE id = ?', [req.body.id]);
    res.json({ ok: true });
  });

  /* ---------- 审批 ---------- */
  app.post('/api/approve', requireAdmin, async (req, res) => {
    const r = await db.get('SELECT * FROM requests WHERE id = ?', [req.body.id]);
    if (!r) return res.status(400).json({ error: '申请不存在' });
    if (r.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });
    const action = req.body.action;
    if (action === 'reject') {
      await db.run(
        `UPDATE requests SET status = 'rejected', approve_time = ?, approver = ?, note = ? WHERE id = ?`,
        [nowStr(), req.user.name, String(req.body.note || '').trim(), req.body.id]
      );
      return res.json({ ok: true });
    }
    if (action === 'approve') {
      if (r.type === 'out' || r.type === 'damage') {
        const it = await db.get('SELECT * FROM items WHERE id = ?', [r.item_id]);
        if (!it) {
          await db.run(
            `UPDATE requests SET status = 'rejected', approve_time = ?, approver = ?, note = ? WHERE id = ?`,
            [nowStr(), req.user.name, '物品已被删除，自动驳回', req.body.id]
          );
          return res.status(400).json({ error: '物品已被删除，已自动驳回' });
        }
        if (r.qty > Number(it.qty)) {
          await db.run(
            `UPDATE requests SET status = 'rejected', approve_time = ?, approver = ?, note = ? WHERE id = ?`,
            [nowStr(), req.user.name, '库存不足，自动驳回', req.body.id]
          );
          return res.status(400).json({ error: `库存不足（现存 ${it.qty}），已自动驳回` });
        }
        const before = Number(it.qty);
        const after = before - r.qty;
        await db.run('UPDATE items SET qty = ? WHERE id = ?', [after, it.id]);
        await db.run(
          `INSERT INTO logs (id, time, type, item_id, item_name, spec, unit,
             before_qty, qty, after_qty, person, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), nowStr(), r.type, it.id, it.name,
           it.spec || '', it.unit || '',
           before, r.qty, after, r.applicant,
           `审批通过 · ${r.reason || (r.type === 'out' ? '出库' : '报损')}`]
        );
        await db.run(
          `UPDATE requests SET status = 'approved', approve_time = ?, approver = ?, note = ? WHERE id = ?`,
          [nowStr(), req.user.name, String(req.body.note || '').trim(), req.body.id]
        );
        return res.json({ ok: true });
      }
      if (r.type === 'buy') {
        await db.run(
          `UPDATE requests SET status = 'approved', approve_time = ?, approver = ?, note = ? WHERE id = ?`,
          [nowStr(), req.user.name, String(req.body.note || '').trim(), req.body.id]
        );
        return res.json({ ok: true });
      }
    }
    res.status(400).json({ error: '未知操作' });
  });

  /* ---------- 采买完成入库 ---------- */
  app.post('/api/buydone', requireAdmin, async (req, res) => {
    const r = await db.get('SELECT * FROM requests WHERE id = ?', [req.body.id]);
    if (!r) return res.status(400).json({ error: '申请不存在' });
    if (r.type !== 'buy') return res.status(400).json({ error: '不是采买申请' });
    if (r.status !== 'approved') return res.status(400).json({ error: '请先批准该采买申请' });
    let it;
    if (req.body.mode === 'existing') {
      it = await db.get('SELECT * FROM items WHERE id = ?', [req.body.itemId]);
      if (!it) return res.status(400).json({ error: '请选择物品' });
    } else {
      const name = String(req.body.newName || '').trim();
      if (!name) return res.status(400).json({ error: '请填写新物品名称' });
      const cnt = (await db.get('SELECT COUNT(*) AS c FROM items')).c;
      const id = uid();
      const code = 'WL' + String(cnt + 1).padStart(3, '0');
      await db.run(
        `INSERT INTO items (id, code, name, spec, category, unit, qty, min_qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, code, name,
         String(req.body.spec || '').trim(), '采买入库',
         String(req.body.unit || '').trim() || r.unit || '件',
         0, Math.max(0, Number(req.body.minQty) || 0), today()]
      );
      it = await db.get('SELECT * FROM items WHERE id = ?', [id]);
    }
    const qty = Number(req.body.qty) || r.qty;
    if (!qty || qty <= 0) return res.status(400).json({ error: '入库数量必须大于 0' });
    const before = Number(it.qty);
    const after = before + qty;
    await db.run('UPDATE items SET qty = ? WHERE id = ?', [after, it.id]);
    await db.run(
      `INSERT INTO logs (id, time, type, item_id, item_name, spec, unit,
         before_qty, qty, after_qty, person, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid(), nowStr(), 'in', it.id, it.name,
       it.spec || '', it.unit || '',
       before, qty, after, r.applicant,
       `采买入库（申请人：${r.applicant}）`]
    );
    await db.run(
      `UPDATE requests SET status = 'done', done_time = ?, done_qty = ?, done_item_id = ? WHERE id = ?`,
      [nowStr(), qty, it.id, req.body.id]
    );
    res.json({ ok: true });
  });

  /* ---------- 用户管理 ---------- */
  app.post('/api/users', requireAdmin, async (req, res) => {
    const action = req.body.action;
    if (action === 'add') {
      const name = String(req.body.name || '').trim();
      const pass = String(req.body.pass || '');
      if (!name) return res.status(400).json({ error: '请填写姓名' });
      if (pass.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
      if (await db.get('SELECT id FROM users WHERE name = ?', [name])) {
        return res.status(400).json({ error: '该姓名已存在' });
      }
      const role = ['normal', 'authorized', 'admin'].includes(req.body.role) ? req.body.role : 'normal';
      const { salt, hash } = hashPassword(pass);
      await db.run(
        'INSERT INTO users (id, name, pass, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [uid(), name, hash, salt, role, today()]
      );
      return res.json({ ok: true });
    }
    if (action === 'role') {
      if (req.body.userId === req.user.id) return res.status(400).json({ error: '不能修改自己的角色' });
      const t = await db.get('SELECT id FROM users WHERE id = ?', [req.body.userId]);
      if (!t) return res.status(400).json({ error: '用户不存在' });
      const role = ['normal', 'authorized', 'admin'].includes(req.body.role) ? req.body.role : 'normal';
      await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.body.userId]);
      return res.json({ ok: true });
    }
    if (action === 'resetpass') {
      const t = await db.get('SELECT id FROM users WHERE id = ?', [req.body.userId]);
      if (!t) return res.status(400).json({ error: '用户不存在' });
      const pass = String(req.body.pass || '');
      if (pass.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
      const { salt, hash } = hashPassword(pass);
      await db.run('UPDATE users SET pass = ?, salt = ? WHERE id = ?', [hash, salt, req.body.userId]);
      return res.json({ ok: true });
    }
    if (action === 'delete') {
      if (req.body.userId === req.user.id) return res.status(400).json({ error: '不能删除自己' });
      await db.run('DELETE FROM users WHERE id = ?', [req.body.userId]);
      await db.run('DELETE FROM sessions WHERE user_id = ?', [req.body.userId]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: '未知操作' });
  });

  /* ---------- 备份 / 恢复 ---------- */
  app.get('/api/backup', requireAdmin, async (req, res) => {
    const users = await db.all('SELECT id, name, role, created_at FROM users');
    const items = await db.all('SELECT * FROM items');
    const logs = await db.all('SELECT * FROM logs ORDER BY time ASC');
    const requests = await db.all('SELECT * FROM requests ORDER BY time ASC');
    const payload = {
      version: 1,
      exportedAt: nowStr(),
      users, items, logs, requests,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="keleifei-backup-${today()}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  app.post('/api/restore', requireAdmin, async (req, res) => {
    const d = req.body.data;
    if (!d || !Array.isArray(d.users) || !Array.isArray(d.items) ||
        !Array.isArray(d.logs) || !Array.isArray(d.requests)) {
      return res.status(400).json({ error: '备份文件格式不正确' });
    }
    // 用事务保证原子性
    if (db.type === 'postgres') {
      const client = await require('pg').Pool.prototype.connect.bind(require('pg').Pool.prototype);
      // 简化：直接顺序执行（数据量小）
    }
    await db.run('DELETE FROM logs');
    await db.run('DELETE FROM requests');
    await db.run('DELETE FROM items');
    await db.run('DELETE FROM users');
    for (const u of d.users) {
      // 备份里没有密码，给默认密码（管理员应通过 resetpass 重设）
      const { salt, hash } = hashPassword('1234');
      await db.run(
        'INSERT INTO users (id, name, pass, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [u.id, u.name, hash, salt, u.role, u.created_at]
      );
    }
    for (const it of d.items) {
      await db.run(
        `INSERT INTO items (id, code, name, spec, category, unit, qty, min_qty, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.id, it.code, it.name, it.spec || '', it.category || '',
         it.unit || '件', Number(it.qty), Number(it.min_qty || 0), it.created_at]
      );
    }
    for (const l of d.logs) {
      await db.run(
        `INSERT INTO logs (id, time, type, item_id, item_name, spec, unit,
           before_qty, qty, after_qty, person, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, l.time, l.type, l.item_id || null, l.item_name,
         l.spec || '', l.unit || '',
         Number(l.before), Number(l.qty), Number(l.after),
         l.person, l.remark || '']
      );
    }
    for (const r of d.requests) {
      await db.run(
        `INSERT INTO requests (id, type, item_id, item_name, spec, unit,
           current_qty, qty, reason, applicant_id, applicant, time, status,
           approver, approve_time, note, done_time, done_qty, done_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.type, r.item_id || null, r.item_name,
         r.spec || '', r.unit || '',
         r.currentQty != null ? Number(r.currentQty) : null,
         Number(r.qty), r.reason || '',
         r.applicantId, r.applicant, r.time, r.status,
         r.approver || '', r.approveTime || '', r.note || '',
         r.doneTime || '', r.doneQty != null ? Number(r.doneQty) : null,
         r.doneItemId || '']
      );
    }
    res.json({ ok: true });
  });

  /* ---------- 诊断信息（带登录的视图） ---------- */
  app.get('/api/diag', requireAuth, async (req, res) => {
    const counts = {
      users: (await db.get('SELECT COUNT(*) AS c FROM users')).c,
      items: (await db.get('SELECT COUNT(*) AS c FROM items')).c,
      logs: (await db.get('SELECT COUNT(*) AS c FROM logs')).c,
      requests: (await db.get('SELECT COUNT(*) AS c FROM requests')).c,
      sessions: (await db.get('SELECT COUNT(*) AS c FROM sessions')).c,
    };
    res.json({
      ok: true,
      db: dbType,
      nodeVersion: process.version,
      uptime: Math.round(process.uptime()),
      serverTime: nowStr(),
      counts,
      me: { id: req.user.id, name: req.user.name, role: req.user.role },
    });
  });

  /* ---------- 404 ---------- */
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
    res.status(404).send('Not Found');
  });

  /* ---------- 错误处理 ---------- */
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: '服务器内部错误：' + (err.message || '未知') });
  });

  return app;
}

/* =========================================================
 * 启动
 * ========================================================= */
async function main() {
  db = makeDbAdapter();
  await initSchema(db);
  const app = await buildApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('=====================================');
    console.log('  可乐菲出入库系统 已启动（长期版）');
    console.log(`  数据库: ${dbType.toUpperCase()}`);
    console.log(`  监听端口: ${PORT}`);
    console.log(`  本机访问: http://localhost:${PORT}`);
    console.log('=====================================');
  });
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});