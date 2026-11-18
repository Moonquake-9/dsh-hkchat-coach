#!/usr/bin/env node
// 命令行体验入口：不装 DSH 也能直接玩同一套引擎。
// 用法：node server/cli.mjs <命令> [参数] [--选项 值]
//
//   node server/cli.mjs status
//   node server/cli.mjs rewrite "我想问一下，这个东西多少钱？"
//   node server/cli.mjs explain 係
//   node server/cli.mjs explain 声调
//   node server/cli.mjs roleplay 茶餐廳落單 --turns 4
//   node server/cli.mjs quiz --mode particle --count 5 --answers
//   node server/cli.mjs log --minutes 10 --activity "跟读茶餐厅" --score 8
//   node server/cli.mjs log --summary
//   node server/cli.mjs scenes

import { rewrite, explain, roleplay, quiz, log, status, SCENE_LIST } from './engine.mjs';

const LABELS = {
  input: '输入', engine: '引擎', draft: '草稿', jyutping: '粤拼', register: '语域',
  changes: '逐词替换', particles: '语气词', caveats: '注意', note: '说明',
  from: '普通话', to: '粤语', jp: '粤拼', tone: '调', why: '原因',
  kind: '类型', title: '标题', rows: '表', notes: '备注', drill: '练习',
  name: '名称', contour: '调值', shape: '调型', example: '例', hint: '提示',
  syllable: '音节', usage: '用法', contrast: '对比', particle: '语气词',
  scene: '场景', setting: '设定', turns: '对话', n: '序号', role: '角色',
  yue: '粤语', zh: '普通话', tip: '提示', level: '难度',
  mode: '题型', count: '题量', seed: 'seed', questions: '题目', q: '题干',
  options: '选项', id: '编号', answer: '答案', explain: '解析', gradeNote: '评分',
  score: '得分', correct: '答对', total: '总计', percent: '正确率', passed: '及格',
  review: '复盘', yourAnswer: '你的答案', correctAnswer: '正确答案', ok: '正确',
  advice: '建议', summary: '小结', recent: '最近', minutes: '分钟', activity: '内容',
  date: '日期', entries: '记录数', streak: '连续天数', practiceLog: '记录文件',
  hkgai: 'HKGAI 接口', lexiconEntries: '词库条数', particlesCount: '语气词',
  sceneCount: '剧本', toneCount: '声调', version: '版本', configNote: '状态',
  key: '键', 中文: '中文',
  apiKey: 'API key', baseUrl: '接口地址', model: '模型', credentialFile: '凭据文件',
  dataVersion: '数据版本', scenes: '剧本列表', cantonese: '粤语', tag: '分类',
  related: '相关', soundChanges: '懒音', before: '原音', after: '懒音',
  sessions: '次数', avgScore: '平均分', start: '起始', file: '文件',
  thisWeek: '本周', lastWeek: '上周', streakDays: '连续天数', saved: '已保存',
  at: '时间', target: '目标', byActivity: '按内容', entries: '最近记录',
};

const wide = (s) => [...String(s)].reduce((w, c) => w + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(c) ? 2 : 1), 0);
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - wide(s)));
const label = (k) => LABELS[k] || k;

function table(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cells = rows.map((r) => cols.map((c) => (r[c] === undefined || r[c] === null ? '' : Array.isArray(r[c]) ? r[c].join(' / ') : String(r[c]))));
  const width = cols.map((c, i) => Math.max(wide(label(c)), ...cells.map((r) => wide(r[i]))));
  const line = (vals) => vals.map((v, i) => pad(v, width[i])).join('  ').trimEnd();
  const out = [line(cols.map(label)), width.map((w) => '─'.repeat(w)).join('  ')];
  for (const r of cells) out.push(line(r));
  return out.join('\n');
}

function render(value, indent = '') {
  if (value === null || value === undefined) return indent + '—';
  if (Array.isArray(value)) {
    if (!value.length) return indent + '（无）';
    if (typeof value[0] === 'object' && value[0] !== null) {
      return indent + table(value).split('\n').map((l) => indent + l).join('\n');
    }
    return value.map((v) => indent + '· ' + v).join('\n');
  }
  if (typeof value === 'object') return renderObject(value, indent);
  return indent + String(value);
}

function renderObject(obj, indent = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === 'object' && v !== null) {
      out.push(`${indent}${label(k)}：`);
      out.push(render(v, indent + '  '));
    } else {
      out.push(`${indent}${label(k)}：${v}`);
    }
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[k] = true;
      else { flags[k] = next; i++; }
    } else positional.push(a);
  }
  return { positional, flags };
}

const HELP = `港话通粤语教练 · 命令行体验（同 DSH 里那 6 个工具是同一套引擎）

  node server/cli.mjs status                         看运行状态、词库规模、有没有 key
  node server/cli.mjs rewrite "我想问一下，多少钱？"     普通话 → 粤语草稿 + 逐词替换
  node server/cli.mjs explain 係                     查一个词 / 语气词 / 调值 / 懒音
  node server/cli.mjs explain 声调                    打印粤拼六声调表
  node server/cli.mjs roleplay 茶餐廳落單            内置剧本之一，可加 --turns 4
  node server/cli.mjs quiz --mode particle -count 5  出题（--answers 直接看答案）
  node server/cli.mjs log --minutes 10 --activity 跟读   记一次练习；--summary 看周报
  node server/cli.mjs scenes                         列出内置剧本

题型：vocab（词）· jyutping（音）· tone（调）· particle（语气词）
`;

const { positional, flags } = parseArgs(process.argv.slice(2));
const cmd = (positional[0] || 'help').toLowerCase();

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

try {
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    console.log(HELP);
  } else if (cmd === 'status') {
    const s = status();
    console.log(renderObject(s));
  } else if (cmd === 'scenes' || cmd === 'scene') {
    console.log(render(SCENE_LIST));
  } else if (cmd === 'rewrite') {
    const text = positional.slice(1).join(' ');
    if (!text) fail('用法：node server/cli.mjs rewrite "我想问一下，多少钱？"');
    const r = await rewrite({ text, register: flags.register });
    console.log(`\n输入：${r.input}\n草稿：${r.draft}\n`);
    console.log(renderObject({
      engine: r.engine, jyutping: r.jyutping, changes: r.changes,
      particles: r.particles, caveats: r.caveats, note: r.note,
    }));
    console.log('');
  } else if (cmd === 'explain') {
    const item = positional.slice(1).join(' ');
    if (!item) fail('用法：node server/cli.mjs explain 係');
    console.log('\n' + renderObject(explain({ item })) + '\n');
  } else if (cmd === 'roleplay') {
    const scene = positional.slice(1).join(' ') || '茶餐廳落單';
    const r = await roleplay({ scene, turns: flags.turns, level: flags.level });
    console.log(`\n${r.title || scene}${r.setting ? ' — ' + r.setting : ''}\n`);
    console.log(render(r.turns || r.rows || r));
    if (r.note) console.log(`\n${r.note}`);
    console.log('');
  } else if (cmd === 'quiz') {
    const r = quiz({
      mode: flags.mode || 'vocab',
      count: flags.count || flags.n || 5,
      seed: flags.seed,
      answers: flags.answers === true,
    });
    console.log(`\n题型 ${r.mode} · ${r.count} 题 · seed ${r.seed}${r.note ? ' · ' + r.note : ''}\n`);
    for (const q of r.questions) {
      console.log(`${q.id}. ${q.q}`);
      for (const o of q.options) console.log(`   ${o}`);
      if (q.answer) console.log(`   ✓ 答案 ${q.answer}${q.explain ? '：' + q.explain : ''}`);
      console.log('');
    }
    console.log(r.gradeNote);
  } else if (cmd === 'log') {
    const r = log({
      action: flags.summary === true ? 'summary' : 'add',
      minutes: flags.minutes,
      activity: flags.activity,
      score: flags.score,
      note: flags.note,
      count: flags.count || 10,
    });
    console.log('\n' + renderObject(r) + '\n');
  } else {
    fail(`不认识的命令：${cmd}。试试 node server/cli.mjs help`);
  }
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
}
