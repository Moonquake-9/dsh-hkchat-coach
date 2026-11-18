// 用本地假服务器验证「有 key 时走 HKGAI、接口坏了自动退回本地」这条链路。
// 不需要真实 HKGAI 账号；真实接口形状若与 OpenAI 兼容不同，需要改 llm.mjs 的 chat()。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hkchat-hkgai-'));
process.env.HKCAT_COACH_HOME = TMP;
process.env.HKGAI_API_KEY = 'test-key-not-real';
process.env.HKGAI_MODEL = 'hkgai-v2';

/** 期望的模型回复：模拟「模型返回一段 JSON」。 */
const GOOD = {
  cantonese: '呢個嘢幾多錢呀？',
  jyutping: 'ni1 go3 je5 gei2 do1 cin2 aa3',
  register: 'casual',
  changes: [{ from: '这个东西', to: '呢個嘢', jyutping: 'ni1 go3 je5', gloss: '这个东西' }],
  particles: [{ p: '呀', jyutping: 'aa3', why: '结尾软化语气' }],
};

let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"boom"}');
      return;
    }
    const content = mode === 'garbage' ? '抱歉，我不太明白。' : '```json\n' + JSON.stringify(GOOD) + '\n```';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
process.env.HKGAI_API_BASE = `http://127.0.0.1:${port}/v1`;

const llm = await import('./llm.mjs');
const engine = await import('./engine.mjs');

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

const sentence = '我想问一下，这个东西多少钱？';

await it('status 认出 key 走 hkgai', () => {
  const s = engine.status();
  assert.equal(s.engine, 'hkgai');
  assert.equal(s.baseUrl, `http://127.0.0.1:${port}/v1`);
});

await it('模型返回合法 JSON 时采用模型结果', async () => {
  mode = 'ok';
  llm.resetConfig();
  const r = await engine.rewrite({ text: sentence });
  assert.equal(r.engine, 'hkgai');
  assert.equal(r.draft, GOOD.cantonese);
  assert.equal(r.jyutping, GOOD.jyutping);
  assert.equal(r.changes[0].to, '呢個嘢');
  assert.equal(r.particles[0].p, '呀');
});

await it('模型输出不是 JSON 时保留本地结果并说明', async () => {
  mode = 'garbage';
  llm.resetConfig();
  const r = await engine.rewrite({ text: sentence });
  assert.equal(r.engine, 'local');
  assert.ok(/无法解析/.test(r.note || ''), `note 缺失：${r.note}`);
});

await it('接口 500 时退回本地并说明', async () => {
  mode = 'fail';
  llm.resetConfig();
  const r = await engine.rewrite({ text: sentence });
  assert.equal(r.engine, 'local');
  assert.ok(/退回本地/.test(r.note || ''), `note 缺失：${r.note}`);
  assert.ok(r.changes.length > 0, '本地规则库结果应保留');
});

await it('自由场景在无 key 时报错并列出内置场景', async () => {
  const saved = process.env.HKGAI_API_KEY;
  delete process.env.HKGAI_API_KEY;
  fs.rmSync(path.join(TMP, 'credentials.json'), { force: true });
  llm.resetConfig();
  await assert.rejects(
    () => engine.roleplay({ scene: '在诊所' }),
    /内置剧本只有|需要 HKGAI key/,
  );
  assert.equal(engine.status().engine, 'local');
  process.env.HKGAI_API_KEY = saved;
  llm.resetConfig();
});

await new Promise((r) => server.close(r));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nHKGAI 链路：${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
