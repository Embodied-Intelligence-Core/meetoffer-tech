'use strict';
/**
 * MeetOffer Tech — 单端口 HTTP 服务（零第三方依赖，Node >= 18）
 *
 * 安全设计：
 *  - 密码只以 SHA-256 哈希存在 config.json 中，明文密码永不落盘、不进开源仓库。
 *  - 会话签名密钥优先读环境变量 SESSION_SECRET；未设置时每次启动随机生成，
 *    因此密钥不会随仓库泄露，也无法被离线伪造 cookie。
 *  - 内容数据 data/posts.json 不在 public/ 下，且 /api/posts 需认证，
 *    未登录者拿不到任何内容（不是前端隐藏，是服务端不返回）。
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'posts.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const COOKIE_NAME = 'mo_auth';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PASSWORD_HASH = config.passwordHash;
const SITE_NAME = config.siteName || 'MeetOffer Tech';
// 不设置环境变量时，每次进程启动都生成新密钥 —— 重启后需重新输密码，但密钥不泄露
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sign(ts) {
  return crypto.createHmac('sha256', SESSION_SECRET).update('auth:' + ts).digest('hex');
}

function makeToken() {
  const ts = Date.now().toString();
  return ts + '.' + sign(ts);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Date.now() - Number(ts) > SESSION_TTL || Number(ts) > Date.now() + 60000) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(ts), 'hex'));
  } catch {
    return false;
  }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw), 'utf8').digest('hex');
}

function isAuthed(req) {
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

async function serveFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    const body = await fsp.readFile(filePath);
    return send(res, 200, body, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJson(res, 400, { error: 'bad request' });
  }
  const p = url.pathname;

  try {
    // 会话状态（前端据此决定显示门禁还是内容）
    if (p === '/api/session' && req.method === 'GET') {
      return sendJson(res, 200, { authenticated: isAuthed(req), siteName: SITE_NAME });
    }

    // 登录
    if (p === '/api/login' && req.method === 'POST') {
      let password = '';
      try {
        const raw = await readBody(req);
        password = (JSON.parse(raw).password || '').toString();
      } catch {
        return sendJson(res, 400, { ok: false, error: '请求格式错误' });
      }
      const ok = (() => {
        try {
          return crypto.timingSafeEqual(
            Buffer.from(hashPassword(password), 'hex'),
            Buffer.from(PASSWORD_HASH, 'hex')
          );
        } catch {
          return false;
        }
      })();
      if (!ok) return sendJson(res, 401, { ok: false, error: '访问密码不正确' });
      const secure = process.env.HTTPS === '1' ? '; Secure' : '';
      return sendJson(res, 200, { ok: true }, {
        'Set-Cookie': `${COOKIE_NAME}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`,
      });
    }

    // 退出
    if (p === '/api/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, {
        'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      });
    }

    // 内容：唯一的数据出口，未认证直接 401
    if (p === '/api/posts' && req.method === 'GET') {
      if (!isAuthed(req)) return sendJson(res, 401, { error: 'unauthorized' });
      try {
        const raw = await fsp.readFile(DATA_FILE, 'utf8');
        return send(res, 200, raw, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
      } catch {
        return sendJson(res, 500, { error: '内容数据未生成，请运行 npm run refresh' });
      }
    }

    if (p === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, site: SITE_NAME });
    }

    // 静态资源：只允许 public/ 下的首页与 assets/，data/ 绝不暴露
    if (p === '/' || p === '/index.html') {
      return await serveFile(res, path.join(PUBLIC, 'index.html'));
    }
    if (p === '/favicon.svg') {
      return await serveFile(res, path.join(PUBLIC, 'assets', 'favicon.svg'));
    }
    if (p.startsWith('/assets/')) {
      const rel = p.slice('/assets/'.length);
      if (rel.includes('..') || rel.includes('\\') || rel.includes(':')) {
        return sendJson(res, 403, { error: 'forbidden' });
      }
      return await serveFile(res, path.join(PUBLIC, 'assets', rel));
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    return sendJson(res, 500, { error: 'internal error', detail: String(err && err.message) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${SITE_NAME}] listening on 0.0.0.0:${PORT}`);
});
