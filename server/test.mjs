// 自测：node server/test.mjs
// 只测引擎与语料一致性；MCP 协议层用 PowerShell 管道单独冒烟（见 README）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 先隔离练习记录的落盘目录，再动态导入引擎（import 会被提升，所以不能用静态 import）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hkchat-coach-test-'));
process.env.HKCAT_COACH_HOME = TMP;
process.env.HKGAI_API_KEY = '';
delete process.env.HKGAI_API_KEY;
delete process.env.HKCAT_API_KEY;

const { rewrite, explain, roleplay, quiz, log, status } = await import('./engine.mjs');
const { LEXICON, PARTICLES, TONES, SCENES } = await import('./data.mjs');

let passed = 0;
const failures = [];
async function it(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

console.log('语料一致性');
await it('粤拼音节格式合法（每音节字母 + 1-6）', () => {
  for (const e of LEXICON) {
    assert.match(e.jp, /^([a-z]+[1-6] )*[a-z]+[1-6]$/, `${e.yue} → ${e.jp}`);
  }
});

await it('粤拼音节数与汉字数一致（一字一音）', () => {
  for (const e of LEXICON) {
    const syllables = e.jp.split(' ').length;
    assert.equal(syllables, e.yue.length, `${e.yue}（${e.yue.length} 字）→ ${e.jp}（${syllables} 音节）`);
  }
});

await it('语气词的粤拼后缀与 tone 字段一致', () => {
  for (const p of PARTICLES) {
    assert.equal(Number(p.jp.at(-1)), p.tone, `${p.p} 的 ${p.jp} 与 tone=${p.tone} 不符`);
  }
});

await it('每个场景都有粤语、粤拼、普通话、提示四栏', () => {
  for (const s of SCENES) {
    assert.ok(s.turns.length >= 4, `${s.title} 台词太少`);
    for (const t of s.turns) {
      for (const k of ['role', 'yue', 'jp', 'zh', 'tip']) assert.ok(t[k], `${s.title} 缺 ${k}`);
    }
  }
});

console.log('yue_rewrite');
await it('普通话句子被逐词替换并给出粤拼', async () => {
  const r = await rewrite({ text: '我不知道为什么他不想吃饭。' });
  assert.equal(r.engine, 'local');
  assert.ok(r.draft.includes('唔知'), r.draft);
  assert.ok(r.draft.includes('點解'), r.draft);
  assert.ok(r.draft.includes('食飯'), r.draft);
  assert.ok(r.changes.length >= 3);
  assert.ok(r.changes.every((c) => c.jyutping && c.why));
});

await it('问句给出语气词建议', async () => {
  const r = await rewrite({ text: '你去不去吗？' });
  assert.ok(r.particles.length >= 1, '没有语气词建议');
  assert.ok(r.particles[0].suggestions.every((s) => s.jyutping));
});

await it('空输入报错而不是返回空字符串', async () => {
  await assert.rejects(() => rewrite({ text: '   ' }), /text 不能为空/);
});

console.log('yue_explain');
await it('六个声调表完整', () => {
  const r = explain({ item: '声调' });
  assert.equal(r.kind, 'tones');
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows.map((x) => x.tone), [1, 2, 3, 4, 5, 6]);
});

await it('单音节粤拼能取出声调', () => {
  const r = explain({ item: 'si2' });
  assert.equal(r.tone, 2);
  assert.equal(r.contour, '35');
});

await it('单个语气词给出用法与例句', () => {
  const r = explain({ item: '喎' });
  assert.equal(r.kind, 'particle');
  assert.equal(r.jyutping, 'wo3');
  assert.ok(r.example.yue.length > 0);
});

await it('词汇可以正查也可以反查', () => {
  assert.equal(explain({ item: '谢谢' }).cantonese, '多謝');
  assert.equal(explain({ item: '攰' }).zh, '累');
});

await it('懒音有解释', () => {
  assert.equal(explain({ item: '懒音' }).kind, 'sound-change');
});

await it('查不到时给出可操作提示', () => {
  assert.throws(() => explain({ item: '量子纠缠' }), /内置语料里没有/);
});

console.log('yue_roleplay');
await it('内置场景可按关键词命中', async () => {
  const r = await roleplay({ scene: '茶餐厅' });
  assert.ok(r.turns.length >= 5);
  assert.equal(r.engine, 'local');
  assert.ok(r.turns[0].jyutping && r.turns[0].zh && r.turns[0].tip);
});

await it('turns 能截断成 5 分钟练习量', async () => {
  const r = await roleplay({ scene: '問路', turns: 3 });
  assert.equal(r.turns.length, 3);
});

await it('进阶档不泄露普通话', async () => {
  const r = await roleplay({ scene: '街市', level: 'advanced' });
  assert.ok(r.turns.every((t) => t.zh === undefined && t.jyutping === undefined));
});

await it('未知场景且无 key 时列出可用剧本', async () => {
  await assert.rejects(() => roleplay({ scene: '量子力学研讨' }), /内置剧本只有/);
});

console.log('yue_quiz');
for (const [mode, expected] of [['vocab', 10], ['jyutping', 10], ['tone', 6], ['particle', 10]]) {
  await it(`${mode}：出题、4 选项、默认不给答案`, () => {
    const r = quiz({ mode, count: 10, seed: 'test' });
    assert.equal(r.questions.length, expected);
    assert.equal(new Set(r.questions.map((q) => q.id)).size, expected);
    for (const q of r.questions) {
      assert.equal(q.options.length, 4, `${q.q} 选项数不对`);
      assert.equal(new Set(q.options).size, 4, `${q.q} 选项重复`);
      assert.equal(q.answer, undefined, '默认不应暴露答案');
    }
  });
}

await it('同 seed 出同一套题', () => {
  const a = quiz({ mode: 'vocab', count: 8, seed: 'abc' });
  const b = quiz({ mode: 'vocab', count: 8, seed: 'abc' });
  assert.deepEqual(a.questions, b.questions);
});

await it('同一套题不出现重复题干（各题型）', () => {
  for (const [mode, count] of [['vocab', 30], ['jyutping', 30], ['particle', 10], ['tone', 6]]) {
    const r = quiz({ mode, count, seed: `dup-${mode}` });
    const qs = r.questions.map((q) => q.q);
    assert.equal(new Set(qs).size, r.questions.length, `${mode} 出现重复：${qs.join(' | ')}`);
  }
});

await it('题量超过题型池时截断并说明', () => {
  const t = quiz({ mode: 'tone', count: 30, seed: 'cap' });
  assert.equal(t.count, 6);
  assert.ok(/只有 6 道/.test(t.note || ''), `缺少说明：${t.note}`);
  const p = quiz({ mode: 'particle', count: 30, seed: 'cap' });
  assert.equal(p.count, 10);
  assert.ok(/只有 10 道/.test(p.note || ''));
  const v = quiz({ mode: 'vocab', count: 30, seed: 'cap' });
  assert.equal(v.count, 30);
  assert.equal(v.note, undefined);
});

await it('答题卡能判分并给逐题解析', () => {
  const paper = quiz({ mode: 'vocab', count: 10, seed: 'grade', answers: true });
  const responses = {};
  paper.questions.forEach((q, i) => {
    responses[q.id] = i < 9 ? q.answer : q.answer === 'A' ? 'B' : 'A';
  });
  const r = quiz({ mode: 'vocab', count: 10, seed: 'grade', responses });
  assert.equal(r.score.correct, 9);
  assert.equal(r.score.percent, 90);
  assert.equal(r.score.passed, true);
  assert.equal(r.review.length, 10);
  assert.ok(r.review.every((x) => x.explain));
});

await it('全错时不判及格', () => {
  const paper = quiz({ mode: 'tone', count: 5, seed: 'bad', answers: true });
  const responses = {};
  paper.questions.forEach((q) => {
    responses[q.id] = q.answer === 'A' ? 'B' : 'A';
  });
  const r = quiz({ mode: 'tone', count: 5, seed: 'bad', responses });
  assert.equal(r.score.percent, 0);
  assert.equal(r.score.passed, false);
});

console.log('yue_log');
await it('记录进入周统计', () => {
  log({ action: 'add', minutes: 15, activity: '粤拼跟读', score: 82, note: '第 2/5 调还是分不清' });
  const s = log({ action: 'summary' });
  assert.equal(s.total.sessions, 1);
  assert.equal(s.total.minutes, 15);
  assert.equal(s.thisWeek.sessions, 1);
  assert.equal(s.streakDays, 1);
  assert.ok(s.byActivity[0].avgScore === 82);
  assert.ok(fs.existsSync(path.join(TMP, 'log.jsonl')));
});

await it('非法分钟数被拒绝', () => {
  assert.throws(() => log({ action: 'add', minutes: 0 }), /minutes/);
  assert.throws(() => log({ action: 'add', minutes: 9999 }), /minutes/);
});

console.log('yue_status');
await it('无 key 时明确标注本地模式', () => {
  const s = status();
  assert.equal(s.engine, 'local');
  assert.ok(s.lexiconEntries >= 100, `词表只有 ${s.lexiconEntries} 条`);
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
