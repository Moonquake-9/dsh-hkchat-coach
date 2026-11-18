// HKGAI（港话通背后的粤语模型）开发者接口客户端。
// 走 OpenAI 兼容的 /chat/completions 形状；无 key 时不报错，由引擎退回本地规则库。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = process.env.HKCAT_COACH_HOME || path.join(os.homedir(), '.dsh', 'hkchat-coach');
const CRED_FILE = path.join(HOME, 'credentials.json');

let cached = null;

/**
 * 解析顺序：环境变量 → <home>/credentials.json。
 * 注意：DSH 的 MCP 子进程环境会被 scrub，名字含 KEY/TOKEN/SECRET/PASSWORD 的变量会被丢掉，
 * 所以真实部署里以 credentials.json 为准，环境变量只适合手工调试。
 */
export function getConfig() {
  if (cached) return cached;
  const envKey = process.env.HKGAI_API_KEY || process.env.HKCAT_API_KEY || '';
  const baseUrl = (process.env.HKGAI_API_BASE || 'https://api.hkgai.org/v1').replace(/\/+$/, '');
  const model = process.env.HKGAI_MODEL || 'hkgai-v2';
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  } catch {
    fileCfg = {};
  }
  const apiKey = envKey || fileCfg.apiKey || '';
  cached = {
    apiKey,
    baseUrl: (fileCfg.baseUrl || baseUrl).replace(/\/+$/, ''),
    model: fileCfg.model || model,
    source: envKey ? 'env' : fileCfg.apiKey ? 'file' : 'none',
    credentialFile: CRED_FILE,
  };
  return cached;
}

/** 仅供测试：清掉配置缓存，让下一次 getConfig() 重新读环境变量/文件。 */
export function resetConfig() {
  cached = null;
}

export function status() {
  const c = getConfig();
  return {
    engine: c.apiKey ? 'hkgai' : 'local',
    apiKey: c.apiKey ? `configured (${c.source})` : 'not configured',
    baseUrl: c.baseUrl,
    model: c.model,
    credentialFile: c.credentialFile,
    note: c.apiKey
      ? '改写与自由场景会请求 HKGAI；请求失败时自动退回本地规则库并在结果里标注。'
      : '未配置 key：全部工具用内置规则库工作。把 {"apiKey":"..."} 写进 credentialFile 即可升级。',
  };
}

export async function chat({ system, user, temperature = 0.4, timeoutMs = 60000 }) {
  const c = getConfig();
  if (!c.apiKey) {
    const err = new Error('no-key');
    err.code = 'no-key';
    throw err;
  }
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 400);
    const err = new Error(`HKGAI ${res.status}: ${body || res.statusText}`);
    err.code = 'http';
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .join('')
      .trim();
  }
  throw new Error('HKGAI 返回里找不到 choices[0].message.content');
}

/** 从模型回复里抠出第一个 JSON 对象（模型常带 ```json 包裹或前后废话）。 */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
