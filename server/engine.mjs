// 港话通粤语教练 · 引擎
// 纯函数为主，便于单测；有 HKGAI key 时优先请求模型，失败即退回本地规则库并标注。
import fs from 'node:fs';
import path from 'node:path';
import { TONES, TONE_NOTES, PARTICLES, SOUND_CHANGES, LEXICON, SCENES, PHRASE_RULES } from './data.mjs';
import { chat, extractJson, status as llmStatus, HOME } from './llm.mjs';

export const DATA_VERSION = '0.1.0';

const BY_ZH = new Map();
const BY_YUE = new Map();
const BY_JP = new Map();
for (const e of LEXICON) {
  if (!BY_ZH.has(e.zh)) BY_ZH.set(e.zh, e);
  if (!BY_YUE.has(e.yue)) BY_YUE.set(e.yue, e);
  if (!BY_JP.has(e.jp)) BY_JP.set(e.jp, e);
}

const RULES = [...PHRASE_RULES, ...LEXICON.map((e) => ({ from: e.zh, to: e.yue, jp: e.jp }))].sort(
  (a, b) => b.from.length - a.from.length,
);
const RULE_MAP = new Map(RULES.map((r) => [r.from, r]));
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(RULES.map((r) => ESC(r.from)).join('|'), 'g');

const PARTICLE_BY_CHAR = new Map(PARTICLES.map((p) => [p.p, p]));

function fail(message, extra) {
  const err = new Error(message);
  err.userFacing = true;
  if (extra) Object.assign(err, extra);
  return err;
}

// ---------------------------------------------------------------- rewrite

const LLM_REWRITE_SYSTEM = `你是香港粤语导师，母语级粤语（香港口语）。
把用户给的普通话句子改写成地道香港粤语，要求：
- 只用日常口语（可以出现「嘅、咗、喺、嗰、咁、啲、嚟、睇、食、唔、冇」等），不要书面语。
- 保持原意和说话人身份，不要添加原文没有的信息。
- 语气词要解释清楚为什么用这个而不是别的。
只输出一个 JSON 对象，不要任何解释文字，格式：
{"cantonese":"粤语句子","jyutping":"逐字粤拼","register":"casual|neutral|formal","changes":[{"from":"普通话片段","to":"粤语","jyutping":"","why":"不超过25字"}],"particles":[{"p":"啦","jyutping":"laa1","why":"不超过30字"}]}`;

function localRewrite(text) {
  const changes = [];
  const seen = new Set();
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    out += text.slice(last, m.index);
    const rule = RULE_MAP.get(m[0]);
    out += rule.to;
    const key = `${rule.from}→${rule.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      const lex = BY_ZH.get(rule.from);
      changes.push({
        from: rule.from,
        to: rule.to,
        jyutping: rule.jp,
        why: lex?.note || `${lex?.tag || '词汇'}：普通话「${rule.from}」在粤语口语说「${rule.to}」。`,
      });
    }
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return { draft: out, changes };
}

function particleHints(text) {
  const hints = [];
  const push = (from, chars, why) => {
    const suggestions = chars
      .map((c) => PARTICLE_BY_CHAR.get(c))
      .filter(Boolean)
      .map((p) => ({ p: p.p, jyutping: p.jp, why: p.use, example: `${p.ex}（${p.exZh}）` }));
    if (suggestions.length) hints.push({ from, suggestions, why });
  };
  if (/吗[？?]?\s*$/.test(text)) push('句尾「吗」', ['咩', '呀'], '粤语没有「吗」，正反问用「咩」，单纯提问用「呀」。');
  if (/吧[。！!]?\s*$/.test(text)) push('句尾「吧」', ['啦', '囉'], '「吧」的建议义在粤语拆成「啦」（软请求）和「囉」（理所当然）。');
  if (/[的呢][。！!]?\s*$/.test(text)) push('句尾「的 / 呢」', ['嘅', '㗎'], '「的」的所属义用「嘅」，肯定语气用「㗎」。');
  if (/啊[？?。！!]?\s*$/.test(text)) push('句尾「啊」', ['呀', '喇'], '粤语口语更常用「呀」，完成义用「喇」。');
  if (/不/.test(text)) push('否定「不」', ['唔', '冇'], '「唔」配动词/形容词（唔去、唔好），「冇」表不存在（冇钱）。');
  return hints;
}

export async function rewrite({ text, register, explainParticles = true } = {}) {
  if (!text || !String(text).trim()) throw fail('text 不能为空：给我一句想改写的普通话。');
  const input = String(text).trim();
  const local = localRewrite(input);
  const result = {
    input,
    engine: 'local',
    draft: local.draft,
    changes: local.changes,
    particles: explainParticles ? particleHints(input) : [],
    caveats: [
      '逐词替换只处理「词汇层」，不保证语序和语气地道；粤语的「先/添/晒」等语序要靠语块积累。',
      '例句属教学用近似对照，进语块本前先人工抽查。',
    ],
  };

  try {
    const raw = await chat({
      system: LLM_REWRITE_SYSTEM,
      user: JSON.stringify({ sentence: input, register: register || 'casual' }),
      temperature: 0.5,
    });
    const parsed = extractJson(raw);
    if (parsed && parsed.cantonese) {
      result.engine = 'hkgai';
      result.draft = String(parsed.cantonese);
      result.jyutping = parsed.jyutping || '';
      result.register = parsed.register || register || 'casual';
      if (Array.isArray(parsed.changes) && parsed.changes.length) result.changes = parsed.changes;
      if (Array.isArray(parsed.particles) && parsed.particles.length) result.particles = parsed.particles;
      result.localFallbackHints = local.changes;
      result.caveats = ['模型输出仍需人工抽查，尤其是近义语气词的取舍。'];
    } else {
      result.note = 'HKGAI 返回无法解析成 JSON，已保留本地规则库结果。';
    }
  } catch (err) {
    if (err.code !== 'no-key') result.note = `HKGAI 调用失败（${err.message}），已退回本地规则库。`;
  }
  return result;
}

// ---------------------------------------------------------------- explain

function toneTable() {
  return {
    kind: 'tones',
    title: '粤语六声调（Jyutping）',
    rows: TONES.map((t) => ({
      tone: t.n,
      name: t.name,
      contour: t.contour,
      shape: t.zh,
      example: t.ex,
      hint: t.hint,
    })),
    notes: TONE_NOTES,
    drill: '同一个音节 si 的六个调：si1 詩 / si2 史 / si3 試 / si4 時 / si5 市 / si6 事。每天读三轮，先慢后快。',
  };
}

export function explain({ item } = {}) {
  const q = String(item ?? '').trim();
  if (!q) throw fail('item 不能为空：可以给我一个词、一个语气词、一个声调或「懒音」。');

  if (/^(声调|聲調|六调|六聲調|tones?|tone|第六?声调|第?[1-6一二三四五六]\s*调)$/i.test(q)) {
    return toneTable();
  }

  const toneHit = q.match(/^([a-z]+)([1-6])$/i);
  if (toneHit) {
    const t = Number(toneHit[2]);
    const tone = TONES.find((x) => x.n === t);
    return {
      kind: 'tone',
      syllable: q.toLowerCase(),
      tone: tone.n,
      name: tone.name,
      contour: tone.contour,
      shape: tone.zh,
      hint: tone.hint,
      example: tone.ex,
    };
  }

  if (q.length === 1 && PARTICLE_BY_CHAR.has(q)) {
    const p = PARTICLE_BY_CHAR.get(q);
    return {
      kind: 'particle',
      particle: p.p,
      jyutping: p.jp,
      tone: p.tone,
      usage: p.use,
      example: { yue: p.ex, jyutping: p.exJp, zh: p.exZh },
      contrast: PARTICLES.filter((x) => x.p !== p.p)
        .slice(0, 3)
        .map((x) => `${x.p}（${x.jp}）：${x.use}`),
    };
  }

  if (/懒音|懶音|变调|變調|n\/l|ng-|gw-/i.test(q)) {
    const hit = SOUND_CHANGES.find((s) => q.includes(s.name.slice(0, 2))) || SOUND_CHANGES[0];
    return {
      kind: 'sound-change',
      name: hit.name,
      detail: hit.detail,
      example: hit.ex,
      all: SOUND_CHANGES.map((s) => s.name),
      advice: '考试与正式场合按标准粤拼记；听懂懒音即可，不必主动模仿。',
    };
  }

  const exact =
    BY_ZH.get(q) || BY_YUE.get(q) || BY_JP.get(q.toLowerCase()) || BY_ZH.get(q.replace(/们/g, '他們'));
  if (exact) {
    return {
      kind: 'word',
      zh: exact.zh,
      cantonese: exact.yue,
      jyutping: exact.jp,
      tag: exact.tag,
      note: exact.note || '',
      related: LEXICON.filter((e) => e.tag === exact.tag && e.yue !== exact.yue)
        .slice(0, 5)
        .map((e) => `${e.yue}（${e.jp}）＝${e.zh}`),
    };
  }

  const fuzzy = LEXICON.filter(
    (e) => e.yue.includes(q) || e.zh.includes(q) || e.jp.startsWith(q.toLowerCase()),
  ).slice(0, 6);
  if (fuzzy.length) {
    return {
      kind: 'search',
      query: q,
      candidates: fuzzy.map((e) => ({ zh: e.zh, cantonese: e.yue, jyutping: e.jp, tag: e.tag, note: e.note || '' })),
    };
  }

  throw fail(
    `内置语料里没有「${q}」。可以就这样问：yue_explain(item="係")、"咩"、"si1"、"声调"、"懒音"、"茶餐厅"。配置 HKGAI key 后这类开放式问题会交给港话通背后的模型。`,
  );
}

// ---------------------------------------------------------------- roleplay

const LLM_SCENE_SYSTEM = `你是香港粤语导师。按用户给的生活场景写一段两到三人的对话剧本，用于初学者跟读。
要求：香港日常口语、每句 3-12 个字、避免书面语；给逐字粤拼（Jyutping）和普通话意思；每句一句不超过 30 字的发音/用法提示。
只输出 JSON：{"title":"粤语标题","setting":"一句话场景","turns":[{"role":"角色","yue":"","jp":"","zh":"","tip":""}]}`;

function findScene(scene) {
  const q = String(scene ?? '').trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  return (
    SCENES.find((s) => s.key === lower) ||
    SCENES.find((s) => s.title.includes(q) || s.zh.includes(q)) ||
    null
  );
}

export async function roleplay({ scene, level = 'beginner', turns } = {}) {
  let s = findScene(scene);
  let engine = 'local';
  let note;

  if (!s) {
    try {
      const raw = await chat({
        system: LLM_SCENE_SYSTEM,
        user: String(scene || '茶餐厅点餐'),
        temperature: 0.7,
      });
      const parsed = extractJson(raw);
      if (parsed && Array.isArray(parsed.turns)) {
        s = {
          key: 'generated',
          title: parsed.title || String(scene),
          zh: String(scene),
          setting: parsed.setting || '',
          turns: parsed.turns,
        };
        engine = 'hkgai';
        note = '该场景由 HKGAI 生成，例句进语块本前请人工抽查。';
      }
    } catch (err) {
      if (err.code !== 'no-key') note = `HKGAI 调用失败（${err.message}）。`;
    }
  }

  if (!s) {
    throw fail(
      `内置剧本只有：${SCENES.map((x) => x.title).join('、')}。也可以用 yue_roleplay(scene="在诊所") 这类自由场景——但需要 HKGAI key。`,
    );
  }

  const limit = Number.isFinite(Number(turns)) && Number(turns) > 0 ? Number(turns) : s.turns.length;
  const rows = s.turns.slice(0, limit).map((t, i) => {
    const row = { n: i + 1, role: t.role, yue: t.yue };
    if (level !== 'advanced') row.jyutping = t.jp;
    if (level === 'beginner') row.zh = t.zh;
    if (level === 'beginner') row.tip = t.tip;
    return row;
  });

  return {
    scene: s.title,
    zh: s.zh,
    setting: s.setting,
    level,
    engine,
    turns: rows,
    howToPractice: [
      '第一遍只看粤语，读出声，卡住再看粤拼。',
      '第二遍跟读，一句一句，重点抓第 2 / 5 调的升降。',
      '第三遍遮住对方台词，自己扮演另一个角色接话。',
    ],
    ...(note ? { note } : {}),
  };
}

// ---------------------------------------------------------------- quiz

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LETTERS = ['A', 'B', 'C', 'D'];

const PARTICLE_BLANKS = [
  { q: '一齊去___。', a: '啦', hint: '（一起去嘛）' },
  { q: '佢話唔得閒___。', a: '喎', hint: '（他说没空呢）' },
  { q: '你唔知___？', a: '咩', hint: '（你不知道吗）' },
  { q: '係咁___。', a: '㗎', hint: '（就是这样子的）' },
  { q: '得兩蚊___。', a: '咋', hint: '（只有两块钱而已）' },
  { q: '仲要加錢___。', a: '添', hint: '（还要加钱呢）' },
  { q: '佢應該嚟___。', a: '啩', hint: '（他应该会来吧）' },
  { q: '我做晒___。', a: '喇', hint: '（我全做完了）' },
  { q: '你行___。', a: '先', hint: '（你先走）' },
  { q: '等___先。', a: '吓', hint: '（先等一会儿）' },
];

const QUIZ_POOL = LEXICON.filter((e) => e.yue !== e.zh || e.tag !== '功能词');

/** 出题池：不放回抽样，避免同一套题出现重复题干。 */
function candidatePool(mode, rand, n) {
  if (mode === 'tone') return shuffle(TONES, rand).slice(0, Math.min(n, TONES.length));
  if (mode === 'particle') return shuffle(PARTICLE_BLANKS, rand).slice(0, Math.min(n, PARTICLE_BLANKS.length));
  const out = [];
  while (out.length < n) out.push(...shuffle(QUIZ_POOL, rand));
  return out.slice(0, n);
}

function buildQuestion(mode, rand, idx, item) {
  if (mode === 'tone') {
    const tone = item;
    const others = shuffle(TONES.filter((t) => t.n !== tone.n), rand).slice(0, 3);
    const opts = shuffle([tone, ...others], rand);
    return {
      id: String(idx + 1),
      q: `粤拼 si${tone.n} 是第几调、什么调值？`,
      options: opts.map((t) => `${t.n} ${t.name}（调值 ${t.contour}）`),
      answer: LETTERS[opts.findIndex((t) => t.n === tone.n)],
      explain: `${tone.n} ${tone.name}，调值 ${tone.contour}，${tone.zh}。例：${tone.ex}。${tone.hint}。`,
    };
  }

  if (mode === 'particle') {
    const blank = item;
    const correct = PARTICLE_BY_CHAR.get(blank.a);
    const others = shuffle(PARTICLES.filter((p) => p.p !== blank.a), rand).slice(0, 3);
    const opts = shuffle([correct, ...others], rand);
    return {
      id: String(idx + 1),
      q: `填空：${blank.q}${blank.hint}`,
      options: opts.map((p) => `${p.p}（${p.jp}）`),
      answer: LETTERS[opts.findIndex((p) => p.p === correct.p)],
      explain: `「${correct.p}」${correct.jp}：${correct.use}。例：${correct.ex}（${correct.exZh}）`,
    };
  }

  const entry = item;

  if (mode === 'jyutping') {
    const others = shuffle(QUIZ_POOL.filter((e) => e.jp !== entry.jp), rand).slice(0, 3);
    const opts = shuffle([entry, ...others], rand);
    return {
      id: String(idx + 1),
      q: `「${entry.yue}」的粤拼是？`,
      options: opts.map((e) => e.jp),
      answer: LETTERS[opts.findIndex((e) => e.jp === entry.jp)],
      explain: `${entry.yue} = ${entry.jp}（${entry.zh}，${entry.tag}）`,
    };
  }

  // vocab（默认）
  const others = shuffle(QUIZ_POOL.filter((e) => e.yue !== entry.yue), rand).slice(0, 3);
  const opts = shuffle([entry, ...others], rand);
  return {
    id: String(idx + 1),
    q: `「${entry.zh}」地道粤语怎么讲？`,
    options: opts.map((e) => e.yue),
    answer: LETTERS[opts.findIndex((e) => e.yue === entry.yue)],
    explain: `${entry.yue}（${entry.jp}）＝${entry.zh}${entry.note ? `｜${entry.note}` : ''}`,
  };
}

export function quiz({ mode = 'vocab', count = 10, seed, answers = false, responses } = {}) {
  const m = ['vocab', 'jyutping', 'tone', 'particle'].includes(mode) ? mode : 'vocab';
  const cap = m === 'tone' ? TONES.length : m === 'particle' ? PARTICLE_BLANKS.length : 30;
  const requested = Math.min(Math.max(Number(count) || 10, 3), 30);
  const n = Math.min(requested, cap);
  const s = seed === undefined || seed === null || seed === '' ? Math.floor(Math.random() * 1e9) : String(seed);
  const rand = mulberry32(typeof s === 'number' ? s : [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));

  const items = candidatePool(m, rand, n);
  const questions = items.map((it, i) => buildQuestion(m, rand, i, it));

  const reveal = answers === true || responses !== undefined;
  const out = {
    mode: m,
    count: n,
    seed: s,
    questions: questions.map((q) => (reveal ? q : { id: q.id, q: q.q, options: q.options })),
    gradeNote: '80% 及格：vocab 记词、jyutping 记音、tone 记调值、particle 记语气。',
    ...(requested > n
      ? { note: `${m} 题型只有 ${cap} 道不重复的题，已按 ${n} 题出；要更多请换题型或分两次测。` }
      : {}),
  };

  if (responses && typeof responses === 'object') {
    const views = Object.entries(responses).map(([id, got]) =>
      typeof got === 'number' ? LETTERS[got] : String(got).trim().toUpperCase(),
    );
    const key = questions.map((q) => q.answer);
    const review = questions.map((q, i) => {
      const got = views[i] ?? '—';
      return {
        id: q.id,
        q: q.q,
        yourAnswer: got,
        correctAnswer: q.answer,
        ok: got === q.answer,
        explain: q.explain,
      };
    });
    const correct = review.filter((r) => r.ok).length;
    out.score = {
      correct,
      total: n,
      percent: Math.round((correct / n) * 100),
      passed: correct / n >= 0.8,
    };
    out.review = review;
    out.advice =
      correct / n >= 0.8
        ? '达标。把答错的题抄进语块本，明天开口前先读一遍。'
        : '未达标：先只复习错题，把词和粤拼配对读三遍，再重测一次（换个 seed 出新的题）。';
  }

  return out;
}

// ---------------------------------------------------------------- log

function localDate(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const LOG_FILE = path.join(HOME, 'log.jsonl');

function readLog() {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function log({ action = 'add', minutes, activity, score, note, date, count = 10 } = {}) {
  fs.mkdirSync(HOME, { recursive: true });
  const entries = readLog();
  const act = String(action || 'add').toLowerCase();

  if (act === 'add') {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 600) {
      throw fail('minutes 要给 1-600 之间的数字（分钟）。');
    }
    const sc = score === undefined || score === null || score === '' ? null : Number(score);
    if (sc !== null && (!Number.isFinite(sc) || sc < 0 || sc > 100)) {
      throw fail('score 要给 0-100 的百分数，或干脆不填。');
    }
    const entry = {
      at: new Date().toISOString(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : localDate(),
      minutes: mins,
      activity: String(activity || 'general').slice(0, 60),
      score: sc,
      note: String(note || '').slice(0, 300),
    };
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    const all = [...entries, entry];
    return { saved: entry, thisWeek: weekly(all).current, file: LOG_FILE };
  }

  if (act === 'list') {
    const k = Math.min(Math.max(Number(count) || 10, 1), 100);
    return { total: entries.length, file: LOG_FILE, entries: entries.slice(-k) };
  }

  if (act === 'summary') {
    const w = weekly(entries);
    const byActivity = new Map();
    for (const e of entries) {
      const k = e.activity;
      const cur = byActivity.get(k) || { activity: k, sessions: 0, minutes: 0, scores: [] };
      cur.sessions += 1;
      cur.minutes += e.minutes;
      if (typeof e.score === 'number') cur.scores.push(e.score);
      byActivity.set(k, cur);
    }
    return {
      total: { sessions: entries.length, minutes: entries.reduce((a, e) => a + e.minutes, 0) },
      thisWeek: w.current,
      lastWeek: w.last,
      streakDays: streak(entries),
      byActivity: [...byActivity.values()].map((x) => ({
        activity: x.activity,
        sessions: x.sessions,
        minutes: x.minutes,
        avgScore: x.scores.length ? Math.round(x.scores.reduce((a, b) => a + b, 0) / x.scores.length) : null,
      })),
      target: '每周 2 次 × 15 分钟真人对话 + 每天 5-15 分钟听说；自测 ≥80% 算达标。',
      file: LOG_FILE,
    };
  }

  throw fail('action 只能是 add / list / summary。');
}

function weekly(entries) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一起算
  const startOfThis = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const startOfLast = new Date(startOfThis.getTime() - 7 * 86400000);
  const sum = (from, to) => {
    const rows = entries.filter((e) => {
      const d = new Date(`${e.date}T00:00:00`);
      return d >= from && d < to;
    });
    const scores = rows.map((r) => r.score).filter((s) => typeof s === 'number');
    return {
      sessions: rows.length,
      minutes: rows.reduce((a, r) => a + r.minutes, 0),
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      start: localDate(from),
    };
  };
  return { current: sum(startOfThis, new Date(startOfThis.getTime() + 7 * 86400000)), last: sum(startOfLast, startOfThis) };
}

function streak(entries) {
  const days = new Set(entries.map((e) => e.date));
  let n = 0;
  const d = new Date();
  for (;;) {
    const key = localDate(d);
    if (!days.has(key)) break;
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------------------------------------------------------------- status

export function status() {
  return {
    ...llmStatus(),
    dataVersion: DATA_VERSION,
    lexiconEntries: LEXICON.length,
    particles: PARTICLES.length,
    scenes: SCENES.map((s) => s.title),
    practiceLog: LOG_FILE,
  };
}

export const SCENE_LIST = SCENES.map((s) => ({ key: s.key, title: s.title, zh: s.zh }));
