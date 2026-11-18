#!/usr/bin/env node
// 港话通粤语教练 · MCP stdio server（零依赖，手写 JSON-RPC 2.0）
// 协议：换行分隔的 JSON，一行一条消息。支持 initialize / tools/list / tools/call / ping。
import readline from 'node:readline';
import { rewrite, explain, roleplay, quiz, log, status, SCENE_LIST } from './engine.mjs';

const SERVER_INFO = { name: 'hkchat-coach', version: '0.1.0' };
const SUPPORTED = ['2024-11-05', '2025-03-26', '2025-06-18', '2026-07-28'];

const TOOLS = [
  {
    name: 'yue_rewrite',
    description:
      '把一句普通话改写成地道香港粤语，返回粤语草稿、逐词替换对照、粤拼与语气词解释。当用户问「呢句粤语点讲」「这句粤语怎么说」「帮我把这句普通话改成粤语」，或要地道说法、要学语气词时用。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要改写的普通话句子。' },
        register: {
          type: 'string',
          enum: ['casual', 'neutral', 'formal'],
          description: '语体，默认 casual（日常口语）。',
        },
        explainParticles: { type: 'boolean', description: '是否附语气词建议，默认 true。' },
      },
      required: ['text'],
    },
  },
  {
    name: 'yue_explain',
    description:
      '讲解一个粤语知识点：某个词/句的地道说法，单个语气词（啦/喇/喎/咩/咁/嘅…）的用法与例句，某个粤拼音节的声调，六个声调的对照表，或懒音/变调现象。当用户问「呢个语气词点用」「粤拼六个声调」「si2 是第几调」「什么是懒音」时用。',
    inputSchema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: '要讲的词、单个语气词、粤拼音节（如 si1）、或主题（声调 / 懒音）。',
        },
      },
      required: ['item'],
    },
  },
  {
    name: 'yue_roleplay',
    description:
      '输出一段分角色的香港生活场景粤语对话稿（茶餐厅点餐、街市买菜、问路、约朋友、看医生），含粤拼、普通话意思与发音提示。当用户说「练习点餐对话」「模拟问路」「今日练边个场景」时用。',
    inputSchema: {
      type: 'object',
      properties: {
        scene: {
          type: 'string',
          description: `场景名或关键词。内置：${SCENE_LIST.map((s) => s.title).join('、')}。配置 HKGAI key 后可用任意自由场景。`,
        },
        level: {
          type: 'string',
          enum: ['beginner', 'intermediate', 'advanced'],
          description: 'beginner 给粤拼+普通话+提示；intermediate 只给粤拼；advanced 只给粤语。默认 beginner。',
        },
        turns: { type: 'integer', minimum: 1, description: '只取前 N 句，用于 5 分钟碎片练习。' },
      },
    },
  },
  {
    name: 'yue_quiz',
    description:
      '出粤语自测题（词汇 / 粤拼 / 声调 / 语气词）并判分。传 responses 就自动评分并逐题解析。当用户说「考我」「出题」「测一下」「自测」时用。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['vocab', 'jyutping', 'tone', 'particle'], description: '题型，默认 vocab。' },
        count: { type: 'integer', minimum: 3, maximum: 30, description: '题量，默认 10。' },
        seed: { type: 'string', description: '随机种子：同一 seed 出同一套题，便于重测对比。' },
        answers: { type: 'boolean', description: '是否随题给出答案，默认 false（先做后对）。' },
        responses: {
          type: 'object',
          description: '答题卡的映射，例如 {"1":"B","2":"C"}；给了就会判分。',
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: 'yue_log',
    description:
      '记录与统计练习：add 追加一条练习（分钟数、活动、自测分数），list 看最近记录，summary 出本周/上周统计、连续天数与各活动均分。当用户说「记一下我今天练了 15 分钟」「这周练了多少」时用。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'summary'], description: '默认 add。' },
        minutes: { type: 'number', description: '本次练习分钟数（add 必填，1-600）。' },
        activity: { type: 'string', description: '活动类别，如 粤拼跟读 / 真人对话 / 自测 / 听力。' },
        score: { type: 'number', description: '自测正确率百分数 0-100（可选）。' },
        note: { type: 'string', description: '一句话复盘。' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天。' },
        count: { type: 'integer', description: 'list 返回条数，默认 10。' },
      },
    },
  },
  {
    name: 'yue_status',
    description: '自检：当前是「内置规则库模式」还是已接上 HKGAI 粤语模型，以及语料规模、练习记录位置。用户问「港话通接上了吗」「有没有用上 HKGAI」时用。',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  yue_rewrite: (args) => rewrite(args),
  yue_explain: (args) => explain(args),
  yue_roleplay: (args) => roleplay(args),
  yue_quiz: (args) => quiz(args),
  yue_log: (args) => log(args),
  yue_status: () => status(),
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const version = SUPPORTED.includes(requested) ? requested : '2025-06-18';
    reply(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        '港话通粤语教练：用 yue_rewrite 改写成地道粤语、yue_explain 讲知识点、yue_roleplay 出场景剧本、yue_quiz 出题判分、yue_log 记录练习。没有 HKGAI key 时用内置规则库，结果里 engine 字段会标注 local。',
    });
    return;
  }

  if (isNotification) return; // notifications/initialized、cancelled 等无需回应

  if (method === 'ping') {
    reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    const handler = HANDLERS[name];
    if (!handler) {
      replyError(id, -32602, `Unknown tool: ${name}`);
      return;
    }
    try {
      const result = await handler(args);
      reply(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (err) {
      const text = err?.userFacing ? err.message : `工具 ${name} 执行失败：${err?.message || err}`;
      if (!err?.userFacing) process.stderr.write(`[hkchat-coach] ${name} failed: ${err?.stack || err}\n`);
      reply(id, { content: [{ type: 'text', text }], isError: true });
    }
    return;
  }

  if (method === 'resources/list' || method === 'prompts/list') {
    reply(id, method === 'resources/list' ? { resources: [] } : { prompts: [] });
    return;
  }

  replyError(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // 串行处理：保证响应顺序与请求一致（JSON-RPC 允许乱序，但有序更好排查）
  queue = queue.then(() => handle(msg)).catch((err) => {
    process.stderr.write(`[hkchat-coach] handler crashed: ${err?.stack || err}\n`);
    if (msg?.id !== undefined) replyError(msg.id, -32603, String(err?.message || err));
  });
});

rl.on('close', () => process.exit(0));
process.stderr.write(`[hkchat-coach] ready (${SERVER_INFO.name} ${SERVER_INFO.version})\n`);
