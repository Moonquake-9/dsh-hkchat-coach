# HKChat Cantonese Coach · dsh-hkchat-coach

English · [中文](README.md)

A config-only bundle for [DSH](https://www.deepseek.com): it inserts a **dependency-free local MCP server** (`mcp__hkchat__yue_*`) into every session, together with a teaching Skill.

- **Usable with no API key** — ships its own Cantonese rule base: 123 high-frequency entries, 14 sentence-final particles, the six-tone table, and 5 roleplay scenes.
- **Upgrades when an HKGAI token is available** — rewriting and free-form scenes are delegated to HKGAI (the Cantonese model behind HKChat); the rule base stays as the fallback.
- **What it does not do** — it does not grade pronunciation and has no TTS/ASR. Tones and mouth shape still need recorded comparison.

## Six tools

| Tool | Purpose |
|---|---|
| `yue_rewrite` | Mandarin → idiomatic Cantonese: word-by-word substitution, Jyutping for each change, particle suggestions |
| `yue_explain` | Explains a word / particle / tone / sound-change phenomenon |
| `yue_roleplay` | Role-by-role dialogue scripts: cha chaan teng, wet market, asking directions, making plans, clinic |
| `yue_quiz` | Generates questions (vocabulary / Jyutping / tone / particle), grades answers, explains them |
| `yue_log` | Records daily practice minutes and quiz scores, produces a weekly report |

Plus `yue_status`: tells you whether you are in "rule-base mode" or "HKGAI mode".

## Install

0. **Try it first (optional, no DSH needed)** — you only need Node 20+.

   ```bash
   node server/cli.mjs status
   node server/cli.mjs rewrite "我想问一下，这个东西多少钱？"
   node server/cli.mjs roleplay 茶餐廳落單 --turns 4
   ```

   Same engine as the six tools in DSH; `node server/cli.mjs help` lists every command.

1. **Fix the path** — `cordis.patch.yml` hard-codes this directory in `args`. Replace it with `<this directory>/server/server.mjs` on your machine. (Practice logs default to `~/.dsh/hkchat-coach`; add `HKCAT_COACH_HOME` to move them.) On Windows, one command does it:

   ```powershell
   node -e "const fs=require('fs');const t=fs.readFileSync('cordis.patch.yml','utf8');fs.writeFileSync('cordis.patch.yml',t.replace('D:/Desktop/DSH/dsh-hkchat-coach',process.cwd().replace(/\\/g,'/')))"
   ```

   > Use Node rather than `Get-Content`/`Set-Content`: Windows PowerShell 5.1 reads and writes GBK, which turns the Chinese comments into mojibake.

2. **Install the bundle** (run it inside a DSH session):

   ```text
   plugin_manager action=install_bundle target=<absolute path of this directory>
   ```

3. **Install the Skill** (recommended): copy `skills/cantonese-coach` into `~/.dsh/skills/` (available everywhere) or `<project>/.dsh/skills/` (that project only).

4. **Restart DSH** and confirm it is enabled on the **Plugins** page. The `mcp__hkchat__*` tools only appear in **new** sessions.

## Layout

```text
cordis.patch.yml         config that inserts dsh-mcp-client
server/server.mjs        MCP stdio server (hand-written JSON-RPC, no dependencies)
server/cli.mjs           command-line entry point (no DSH required)
server/engine.mjs        implementation of the six tools
server/data.mjs          the Cantonese knowledge base (lexicon / particles / tones / scenes)
server/llm.mjs           HKGAI client (inactive without a token)
server/test.mjs          engine and protocol tests (29 assertions)
server/test-hkgai.mjs    HKGAI path tests against a local fake server (5 assertions)
skills/cantonese-coach/  the teaching Skill
locale/ · icon.svg       metadata used by the Plugins page
HANDOVER.md              non-technical handover page for teammates/teachers (Chinese)
SHARE.md                 3-minute getting-started page for teammates (Chinese)
```

## Tests

```bash
npm test
```

## Connecting HKGAI (optional, not enabled for now)

**Decision of 2026-11-18: no key was applied for; everything runs in local mode.** This section is kept for future reuse — or for whoever picks the project up later. It does not affect current usage.

Never put the key in a conversation or in code. Use a file instead:

```json
// %USERPROFILE%\.dsh\hkchat-coach\credentials.json
{ "apiKey": "sk-...", "baseUrl": "https://api.hkgai.org/v1", "model": "hkgai-v2" }
```

> DSH scrubs environment variables whose names look like `*KEY*` / `*TOKEN*` / `*SECRET*` before starting an MCP subprocess, so the key **cannot** be passed through `setx` — it has to live in a file, or be written explicitly into the `env` block of `cordis.patch.yml`. Without a key every tool still works; results are just tagged `engine: "local"`.

## If you cannot get a key

The tooling still works. What has to change is the wording you use about it, otherwise the write-up will not hold up:

| You can say | You cannot say |
|---|---|
| "Built a DSH plugin that provides rewriting, explanations, dialogues, quizzes and logging from a **built-in Cantonese knowledge base**" | "It is connected to HKChat" / "HKChat generated the answers" |
| "The HKGAI interface is wired up — add a key and it switches" (`server/llm.mjs` + `yue_status` prove it) | "It uses the HKChat app" |
| "Every result is tagged `engine: \"local\"`, so the source is traceable" | "I asked HKChat and it said…" |

How to improve your chances:

1. **Ask for the source.** If "`pip install hkgai`", "Agent Workshop natively supports MCP" or "`api.hkgai.org/v1`" came from a model rather than official documentation, it may not exist — ask which page it was seen on.
2. **Apply as an institution.** Hong Kong local-model platforms usually serve institutions and labs; a university or research-group identity goes further than an individual one.
3. **Test with a small request first.** Once you have a key, check connectivity with `yue_status`, then run one `yue_rewrite` and see whether `engine` turns into `hkgai`.
4. Application requirements and pricing follow the official site — **not verified here** (the site is client-rendered, so a plain fetch cannot read its body).

## Verified / not verified

- **Verified**: `npm test` (29 engine assertions + 5 HKGAI assertions, the latter using a local fake server to prove "key present → model path" and "endpoint down → automatic fallback"), bundle installation and plugin activation, Skill discovery under `~/.dsh/skills`, and an MCP protocol smoke test over a PowerShell pipe.
- **Verified (measured 2026-11-18)**: `https://api.hkgai.org/v1/models` really exists and returns `401 {"error":{"message":"未提供令牌","type":"one_api_error"}}` without credentials — so the official gateway is OpenAI-compatible and `llm.mjs` uses the same request shape. `chat.hkchat.app` returns 403 (Cloudflare), confirming the web app cannot be scraped.
- **Not verified**: how the icon and copy render on the Plugins page (no browser control on this machine), and connectivity with a real credential (no key). The `pip install hkgai` advertised on the official page does not exist on PyPI (404), and the docs site `docs.hkgai.info` has no DNS record — the SDK and docs are not published yet.
