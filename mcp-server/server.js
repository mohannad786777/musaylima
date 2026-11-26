#!/usr/bin/env node
// خادم MCP لأرشيف مسيلمة — بحث مباشر في تفريغات الحلقات من أي مساعد ذكاء اصطناعي.
// بلا أي مكتبات خارجية. يعمل بطريقتين:
//   node server.js --stdio        ← للبرامج المحلية (Claude Desktop, Cursor ...)
//   node server.js                ← خادم HTTP (Streamable HTTP) على المسار /mcp للربط عن بُعد (claude.ai connectors ...)
//
// متغيرات البيئة:
//   PORT       منفذ HTTP (افتراضي 8787)
//   MCP_TOKEN  رمز سري اختياري (أو عدة رموز مفصولة بفواصل، رمز لكل شخص). إن وُضع: يُقبل الطلب على /mcp/<الرمز> أو مع ترويسة Authorization: Bearer <الرمز>
//   DATA_PATH  مسار ملف البيانات (افتراضي ../data.json.gz)
//   DATA_URL   رابط لتنزيل البيانات إن لم يوجد الملف محليًا

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');

const SERVER_INFO = { name: 'musaylima-archive', version: '1.0.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const STDIO = process.argv.includes('--stdio');
const log = (...a) => console.error('[musaylima-mcp]', ...a); // stderr فقط حتى لا يفسد stdio

// ==================== تحميل البيانات ====================
let DB = null;          // الحلقات مع نصوص مطبّعة
let BY_ID = new Map();
let loading = null;

// ترميز مضغوط: كل حرف (ASCII أو عربي من U+0600 إلى U+067F) في بايت واحد → سلسلة latin1 في V8
// يقلّل ذاكرة النصوص إلى النصف تقريبًا، فيتسع الأرشيف كله في خادم مجاني بذاكرة 512 ميغابايت
function pack(s, lossy) {
  const b = Buffer.allocUnsafe(s.length);
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    if (k < 0x80) b[i] = k;
    else if (k >= 0x0600 && k <= 0x067F) b[i] = k - 0x0600 + 0x80;
    else if (lossy) b[i] = 0x20;
    else return null; // حرف خارج النطاق: يُحفظ النص كما هو
  }
  return b.toString('latin1');
}
function unpack(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    out += k < 0x80 ? s[i] : String.fromCharCode(k - 0x80 + 0x0600);
  }
  return out;
}

function normAr(s) {
  if (!s) return '';
  return pack(s
    .replace(/[ً-ٰٟـ​-‏﻿]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase(), true);
}

const fmtTs = sec => { const t = Math.floor(sec); return [t / 3600, (t % 3600) / 60, t % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':'); };
const segText = s => (s.p ? unpack(s.t) : s.t);

// "DD-MM-YYYY" → رقم YYYYMMDD للمقارنة
function dateKey(d) {
  if (!d) return 0;
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  return 0;
}

async function readRaw() {
  const p = process.env.DATA_PATH || path.join(__dirname, '..', 'data.json.gz');
  if (fs.existsSync(p)) {
    log('loading', p);
    const buf = fs.readFileSync(p);
    return p.endsWith('.gz') ? zlib.gunzipSync(buf) : buf;
  }
  const url = process.env.DATA_URL || 'https://raw.githubusercontent.com/mohannad786777/musaylima/main/data.json.gz';
  if (!url) throw new Error('ملف البيانات غير موجود: ' + p + ' (ضع DATA_PATH أو DATA_URL)');
  log('downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('فشل تنزيل البيانات: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
}

// يعيد مقاطع Buffer لكل عنصر من المصفوفة الجذرية في ملف JSON
function* episodeSlices(buf) {
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5C) esc = true;
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7B || c === 0x5B) { if (depth === 1 && c === 0x7B) start = i; depth++; }
    else if (c === 0x7D || c === 0x5D) { depth--; if (depth === 1 && c === 0x7D) yield buf.subarray(start, i + 1); }
  }
}

function ensureData() {
  if (DB) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const t = Date.now();
      let buf = await readRaw();
      DB = [];
      // تحليل الحلقات واحدةً واحدة من المصفوفة بدل تحويل الملف كله إلى نص دفعةً واحدة (يخفض ذروة الذاكرة)
      for (const slice of episodeSlices(buf)) {
        const ep = JSON.parse(slice.toString('utf8'));
        DB.push({
          id: ep.id,
          title: ep.title,
          titleNorm: normAr(ep.title),
          date: ep.date,
          dk: dateKey(ep.date),
          url: ep.url,
          segments: ep.segments.map(s => { const pk = pack(s.txt); return { sec: s.sec, t: pk ?? s.txt, p: pk !== null, n: normAr(s.txt) }; }),
        });
      }
      buf = null;
      BY_ID = new Map(DB.map(e => [e.id, e]));
      const segs = DB.reduce((a, e) => a + e.segments.length, 0);
      log(`ready: ${DB.length} episodes, ${segs} segments in ${Date.now() - t}ms`);
    })().catch(e => { loading = null; throw e; });
  }
  return loading;
}

function link(ep, sec) {
  if (!ep.url) return null;
  const s = Math.max(0, Math.floor(sec || 0));
  return ep.url + (ep.url.includes('?') ? '&' : '?') + 't=' + s + 's';
}

// ==================== الأدوات ====================
const TOOLS = [
  {
    name: 'search_transcripts',
    title: 'البحث في تفريغات الحلقات',
    description:
      'يبحث في نصوص تفريغات جميع حلقات أرشيف مسيلمة (حلقات د. محمد فائد) ويعيد المقاطع المطابقة مع عنوان الحلقة وتاريخها ورابط يوتيوب يبدأ من لحظة المقطع. ' +
      'البحث يتجاهل التشكيل والهمزات والتاء المربوطة/الهاء والألف المقصورة. ' +
      'mode: "phrase" = العبارة متتالية (افتراضي)، "all" = كل الكلمات في نفس المقطع، "any" = أي كلمة. ' +
      'التفريغ آلي (من الكلام المنطوق) فقد ترد الكلمة بإملاء عامي أو مختلف؛ جرّب صيغًا مرادفة إن قلّت النتائج.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'كلمة أو عبارة البحث (حرفان على الأقل)' },
        mode: { type: 'string', enum: ['phrase', 'all', 'any'], default: 'phrase' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'أقصى عدد للمقاطع المعادة' },
        offset: { type: 'integer', minimum: 0, default: 0, description: 'لتصفح الصفحات التالية من النتائج' },
        sort: { type: 'string', enum: ['relevance', 'newest', 'oldest'], default: 'relevance' },
        episode_ids: { type: 'array', items: { type: 'integer' }, description: 'حصر البحث في حلقات معيّنة' },
        date_from: { type: 'string', description: 'من تاريخ DD-MM-YYYY' },
        date_to: { type: 'string', description: 'إلى تاريخ DD-MM-YYYY' },
        include_titles: { type: 'boolean', default: true, description: 'البحث في عناوين الحلقات أيضًا' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_transcript',
    title: 'قراءة تفريغ حلقة',
    description:
      'يقرأ نص تفريغ حلقة معيّنة مع التوقيتات. استعمله بعد البحث لقراءة سياق المقطع كاملًا: ' +
      'أعطِ around_sec (ثانية المقطع) مع window، أو start_sec/end_sec، أو لا شيء لبداية الحلقة. النتائج مقسّمة بصفحات (next_start_sec).',
    inputSchema: {
      type: 'object',
      properties: {
        episode_id: { type: 'integer' },
        around_sec: { type: 'number', description: 'ثانية مركزية لعرض ما قبلها وبعدها' },
        window: { type: 'integer', default: 120, description: 'عدد الثواني قبل وبعد around_sec' },
        start_sec: { type: 'number' },
        end_sec: { type: 'number' },
        max_segments: { type: 'integer', minimum: 1, maximum: 400, default: 80 },
      },
      required: ['episode_id'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_episodes',
    title: 'فهرس الحلقات',
    description: 'يعرض فهرس الحلقات (المعرّف، العنوان، التاريخ، عدد المقاطع، الرابط) مع تصفية اختيارية بكلمة في العنوان أو بمدة زمنية.',
    inputSchema: {
      type: 'object',
      properties: {
        title_query: { type: 'string', description: 'كلمة في عنوان الحلقة' },
        date_from: { type: 'string', description: 'DD-MM-YYYY' },
        date_to: { type: 'string', description: 'DD-MM-YYYY' },
        sort: { type: 'string', enum: ['newest', 'oldest', 'id'], default: 'newest' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'archive_stats',
    title: 'إحصائيات الأرشيف',
    description: 'عدد الحلقات والمقاطع وأقدم وأحدث حلقة.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function dateFilter(args) {
  const from = dateKey(args.date_from), to = dateKey(args.date_to);
  return ep => (!from || ep.dk >= from) && (!to || ep.dk <= to);
}

function countOcc(hay, needle) {
  let c = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
  return c;
}

function searchTranscripts(args) {
  const q = String(args.query || '').trim();
  const nq = normAr(q);
  if (nq.length < 2) throw new Error('عبارة البحث قصيرة جدًا');
  const mode = args.mode || 'phrase';
  const words = nq.split(' ').filter(Boolean);
  const limit = Math.min(Math.max(args.limit || 20, 1), 100);
  const offset = Math.max(args.offset || 0, 0);
  const ids = Array.isArray(args.episode_ids) && args.episode_ids.length ? new Set(args.episode_ids) : null;
  const inRange = dateFilter(args);
  const includeTitles = args.include_titles !== false;

  const score = text => {
    if (mode === 'phrase') return countOcc(text, nq);
    let total = 0, found = 0;
    for (const w of words) { const c = countOcc(text, w); if (c) { found++; total += c; } }
    if (mode === 'all') return found === words.length ? total : 0;
    return found ? total + found * 10 : 0; // any: تفضيل المقاطع التي فيها كلمات أكثر
  };

  const hits = [];
  const episodes = new Map();
  const titleMatches = [];
  for (const ep of DB) {
    if (ids && !ids.has(ep.id)) continue;
    if (!inRange(ep)) continue;
    if (includeTitles && score(ep.titleNorm)) titleMatches.push(ep);
    for (const s of ep.segments) {
      const sc = score(s.n);
      if (!sc) continue;
      hits.push({ ep, s, sc });
      episodes.set(ep.id, (episodes.get(ep.id) || 0) + sc);
    }
  }

  if (args.sort === 'newest') hits.sort((a, b) => b.ep.dk - a.ep.dk || a.s.sec - b.s.sec);
  else if (args.sort === 'oldest') hits.sort((a, b) => a.ep.dk - b.ep.dk || a.s.sec - b.s.sec);
  else hits.sort((a, b) => (episodes.get(b.ep.id) - episodes.get(a.ep.id)) || b.sc - a.sc || a.ep.id - b.ep.id || a.s.sec - b.s.sec);

  const page = hits.slice(offset, offset + limit).map(({ ep, s }) => ({
    episode_id: ep.id,
    episode_title: ep.title,
    date: ep.date,
    timestamp: fmtTs(s.sec),
    sec: s.sec,
    text: segText(s),
    youtube: link(ep, s.sec),
  }));

  const topEpisodes = [...episodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([id, sc]) => ({ episode_id: id, title: BY_ID.get(id).title, date: BY_ID.get(id).date, score: sc }));

  return {
    query: q, mode,
    total_segments: hits.length,
    total_episodes: episodes.size,
    returned: page.length,
    offset,
    next_offset: offset + page.length < hits.length ? offset + page.length : null,
    title_matches: titleMatches.slice(0, 20).map(ep => ({ episode_id: ep.id, title: ep.title, date: ep.date, youtube: ep.url })),
    top_episodes: topEpisodes,
    results: page,
    note: 'نصوص التفريغ آلية من الكلام المنطوق؛ استشهد بالنص كما ورد وأرفق رابط يوتيوب بالتوقيت.',
  };
}

function getTranscript(args) {
  const ep = BY_ID.get(Number(args.episode_id));
  if (!ep) throw new Error('لا توجد حلقة بالمعرّف ' + args.episode_id);
  const max = Math.min(Math.max(args.max_segments || 80, 1), 400);
  let start = 0, end = Infinity;
  if (args.around_sec != null) {
    const w = args.window != null ? args.window : 120;
    start = args.around_sec - w; end = args.around_sec + w;
  } else {
    if (args.start_sec != null) start = args.start_sec;
    if (args.end_sec != null) end = args.end_sec;
  }
  const inRange = ep.segments.filter(s => s.sec >= start && s.sec <= end);
  const page = inRange.slice(0, max);
  const next = inRange.length > max ? inRange[max].sec : null;
  return {
    episode_id: ep.id, title: ep.title, date: ep.date, youtube: ep.url,
    total_segments_in_episode: ep.segments.length,
    returned: page.length,
    next_start_sec: next,
    segments: page.map(s => ({ timestamp: fmtTs(s.sec), sec: s.sec, text: segText(s), youtube: link(ep, s.sec) })),
  };
}

function listEpisodes(args) {
  const tq = args.title_query ? normAr(args.title_query) : '';
  const inRange = dateFilter(args);
  let list = DB.filter(ep => inRange(ep) && (!tq || ep.titleNorm.includes(tq)));
  if (args.sort === 'oldest') list.sort((a, b) => a.dk - b.dk || a.id - b.id);
  else if (args.sort === 'id') list.sort((a, b) => a.id - b.id);
  else list.sort((a, b) => b.dk - a.dk || b.id - a.id);
  const limit = Math.min(Math.max(args.limit || 50, 1), 500);
  const offset = Math.max(args.offset || 0, 0);
  const page = list.slice(offset, offset + limit);
  return {
    total: list.length, returned: page.length, offset,
    next_offset: offset + page.length < list.length ? offset + page.length : null,
    episodes: page.map(ep => ({ episode_id: ep.id, title: ep.title, date: ep.date, segments: ep.segments.length, youtube: ep.url })),
  };
}

function stats() {
  const sorted = [...DB].sort((a, b) => a.dk - b.dk);
  return {
    episodes: DB.length,
    segments: DB.reduce((a, e) => a + e.segments.length, 0),
    oldest: { episode_id: sorted[0].id, title: sorted[0].title, date: sorted[0].date },
    newest: { episode_id: sorted.at(-1).id, title: sorted.at(-1).title, date: sorted.at(-1).date },
  };
}

const HANDLERS = { search_transcripts: searchTranscripts, get_transcript: getTranscript, list_episodes: listEpisodes, archive_stats: stats };

// ==================== بروتوكول MCP (JSON-RPC 2.0) ====================
const INSTRUCTIONS =
  'أرشيف مسيلمة: تفريغات نصية آلية لأكثر من 2500 حلقة يوتيوب للدكتور محمد فائد مع التوقيتات. ' +
  'ابدأ بـ search_transcripts، ثم اقرأ السياق بـ get_transcript (around_sec) قبل نسبة كلام إليه. ' +
  'انقل النص كما ورد في التفريغ، وأرفق مع كل استشهاد عنوان الحلقة وتاريخها ورابط يوتيوب بالتوقيت. لا تنسب إليه ما لم يرد في نتائج الأدوات.';

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  try {
    switch (method) {
      case 'initialize': {
        ensureData().catch(e => log('load error', e.message)); // ابدأ التحميل مبكرًا
        const v = SUPPORTED_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0];
        return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        const fn = HANDLERS[params.name];
        if (!fn) return err(-32602, 'أداة غير معروفة: ' + params.name);
        try {
          await ensureData();
          const data = fn(params.arguments || {});
          return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], structuredContent: data, isError: false });
        } catch (e) {
          return ok({ content: [{ type: 'text', text: 'خطأ: ' + e.message }], isError: true });
        }
      }
      case 'resources/list': return ok({ resources: [] });
      case 'prompts/list': return ok({ prompts: [] });
      default:
        if (isNotification) return null; // notifications/initialized وغيرها
        return err(-32601, 'Method not found: ' + method);
    }
  } catch (e) {
    return isNotification ? null : err(-32603, e.message);
  }
}

async function handleBody(body) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? out : null;
  }
  return handle(body);
}

// ==================== stdio ====================
function runStdio() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      const res = await handleBody(msg);
      if (res) process.stdout.write(JSON.stringify(res) + '\n');
    }
  });
  log('stdio mode');
}

// ==================== HTTP (Streamable HTTP) ====================
function runHttp() {
  const PORT = +process.env.PORT || 8787;
  const TOKENS = new Set((process.env.MCP_TOKEN || '').split(',').map(t => t.trim()).filter(Boolean));
  const TOKEN = TOKENS.size > 0;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };
  const send = (res, code, obj, extra = {}) => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname === '/' || url.pathname === '/health') {
      return send(res, 200, { ok: true, server: SERVER_INFO, data_loaded: !!DB, mcp_endpoint: TOKEN ? '/mcp/<token>' : '/mcp' });
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'mcp') return send(res, 404, { error: 'not found' });
    if (TOKEN) {
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!TOKENS.has(parts[1]) && !TOKENS.has(bearer)) return send(res, 401, { error: 'unauthorized' });
    }
    if (req.method === 'GET') return send(res, 405, { error: 'SSE stream not offered; use POST' }, { Allow: 'POST' });
    if (req.method === 'DELETE') return send(res, 200, {});
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      const out = await handleBody(body);
      if (!out) { res.writeHead(202, cors); return res.end(); }
      send(res, 200, out);
    });
  }).listen(PORT, () => {
    log(`HTTP on :${PORT}  →  POST /mcp${TOKEN ? '/<token>' : ''}`);
    ensureData().catch(e => log('load error', e.message));
  });
}

STDIO ? runStdio() : runHttp();
