# 港话通粤语教练 · dsh-hkchat-coach

中文 · [English](README.en.md)

一个 [DSH](https://www.deepseek.com) 配置型 bundle：把一个**零依赖的本地 MCP server**（`mcp__hkchat__yue_*`）装进每个会话，配一份教学用 Skill。

- **默认零 key 可用**：内置粤语规则库（123 条高频词 / 14 个语气词 / 六调表 / 5 个场景剧本）。
- **有 HKGAI 令牌时升级**：改写与自由场景交给港话通背后的 HKGAI 粤语模型，规则库退为兜底。
- **它不做什么**：不评估发音、不做 TTS/ASR。口型和声调对不对得靠录音对比。

## 五个工具

| 工具 | 用途 |
|---|---|
| `yue_rewrite` | 普通话 → 地道粤语：逐词替换、附粤拼、给出语气词建议 |
| `yue_explain` | 讲清一个词 / 语气词 / 声调 / 懒音现象 |
| `yue_roleplay` | 茶餐厅、街市、问路、约朋友、诊所的分角色对白稿 |
| `yue_quiz` | 出题（词汇/粤拼/声调/语气词）、判分、给解析 |
| `yue_log` | 记录每天练习时长与自测分数，出周报 |

另附 `yue_status`：看当前是「规则库模式」还是「HKGAI 模式」。

## 安装

1. **改路径**：`cordis.patch.yml` 的 `args` 里写死了本目录的绝对路径，换成你机器上的 `<本目录>/server/server.mjs`。（练习记录默认落在 `~/.dsh/hkchat-coach`，要换位置再加 `HKCAT_COACH_HOME`。）

2. **装入 DSH**（在 DSH 会话里执行）：

   ```text
   plugin_manager action=install_bundle target=<本目录绝对路径>
   ```

3. **装 Skill**（推荐）：把 `skills/cantonese-coach` 整个目录复制到 `~/.dsh/skills/`（全局生效）或 `<项目>/.dsh/skills/`（仅该项目）。

4. **重启 DSH**，在 **Plugins** 页确认已启用。**新会话**里才会出现 `mcp__hkchat__*` 工具。

## 目录结构

```text
cordis.patch.yml         插入 dsh-mcp-client 的配置
server/server.mjs        MCP stdio 服务（手写 JSON-RPC，零依赖）
server/engine.mjs        六个工具的实现
server/data.mjs          粤语知识库（词表 / 语气词 / 六调 / 场景）
server/llm.mjs           HKGAI 客户端（无令牌时不启用）
server/test.mjs          引擎与协议自测（29 条）
server/test-hkgai.mjs    HKGAI 链路自测（本地假服务器，5 条）
skills/cantonese-coach/  教学 Skill
locale/ · icon.svg       插件页显示元数据
HANDOVER.md              给组员/老师的交接页（非技术，可直接转发）
README.en.md             英文版说明
```

## 自测

```bash
npm test
```

## 接 HKGAI（可选，本轮不启用）

**2026-11-18 决定：不申请 key，全部功能走本地模式。** 这一节保留给将来复用（或别人接手时可以直接升级），不影响现在的使用。

不要把 key 写进对话或代码。改成文件：

```json
// %USERPROFILE%\.dsh\hkchat-coach\credentials.json
{ "apiKey": "sk-...", "baseUrl": "https://api.hkgai.org/v1", "model": "hkgai-v2" }
```

> MCP 子进程会被 DSH scrub 掉名字像 `*KEY*` / `*TOKEN*` / `*SECRET*` 的环境变量，所以 key **不能**靠 `setx` 透传——必须放文件，或在 `cordis.patch.yml` 的 `env` 里显式写。没有 key 时所有工具照常工作，只是标注 `engine: "local"`。

## 如果拿不到 key

这套东西**照常能用**，只是对外说法必须改，否则报告站不住：

| 能说 | 不能说 |
|---|---|
| 做了一个 DSH 插件，用**内置粤语知识库**提供改写、讲解、对白、自测、记录 | 「已接入港话通」/「答案由港话通生成」 |
| 预留了 HKGAI 接口，填 key 即切换（`server/llm.mjs` + `yue_status` 可自证） | 「用了港话通 App」 |
| 全部输出带 `engine: "local"` 标注，来源可追溯 | 「问过港话通，它说……」 |

怎么争取：

1. **问组员要出处**：那份分析里的「`pip install hkgai`」「Agent Workshop 原生支持 MCP」「`api.hkgai.org/v1`」如果来自模型而不是官方文档，很可能不存在——先让对方指出具体在哪个页面看到的。
2. **机构身份申请**：这类香港本地大模型平台多面向机构/实验室，用学校或课题组身份申请比个人高。
3. **先小流量试**：拿到 key 后先用 `yue_status` 确认连通，再跑 `yue_rewrite` 一次看 `engine` 是否变成 `hkgai`。
4. 申请门槛与计费以官网为准——**我这边没有核实到**（官网是前端渲染，普通抓取读不到正文）。

## 已验证 / 未验证

- 已验证：`npm test`（引擎 29 条 + HKGAI 链路 5 条，后者用本地假服务器验证「有 key 走模型 / 接口挂了自动退回」）、bundle 安装与插件激活、`~/.dsh/skills` 技能发现、PowerShell 管道 MCP 协议冒烟。
- 已验证（2026-11-18 实测）：`https://api.hkgai.org/v1/models` 真实存在，无凭证时返回 `401 {"error":{"message":"未提供令牌","type":"one_api_error"}}`——说明官方网关是 OpenAI 兼容形态，`llm.mjs` 的请求形状与之一致。`chat.hkchat.app` 返回 403（Cloudflare），印证网页版不可爬。
- 未验证：Plugins 页面的图标与文案渲染（本机无浏览器控制）、真实凭证下的连通性（无 key）。官方页面宣传的 `pip install hkgai` 在 PyPI 上不存在（404），文档站 `docs.hkgai.info` 无 DNS 记录——SDK 与文档尚未发布。
