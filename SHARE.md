# 给组员：3 分钟上手

一句话：这是 **DSH 港话通粤语教练** —— 一个 DSH 插件（6 个工具）+ 一个教学 Skill。

港话通 App 没有公开接口，所以接的是它背后的 **HKGAI 模型接口**（可选项，预留着）。
**现在不填 key 也能用**：跑的是内置粤语规则库（123 个高频词、14 个语气词、5 个场景剧本）。

---

## 第一步：30 秒看效果（不用装 DSH）

只要有 Node 20+（`node -v` 能打印版本就行）。

```bash
git clone https://github.com/Moonquake-9/dsh-hkchat-coach.git
cd dsh-hkchat-coach

node server/cli.mjs status                                    # 词库规模、有没有 key
node server/cli.mjs rewrite "我想问一下，这个东西多少钱？"        # 普通话 → 粤语草稿
node server/cli.mjs roleplay 茶餐廳落單 --turns 4               # 点餐对话，带粤拼
node server/cli.mjs quiz --mode particle --count 5 --answers    # 语气词出题 + 解析
node server/cli.mjs explain 声调                                # 粤拼六声调表
```

`node server/cli.mjs help` 看全部命令。这跟 DSH 里那 6 个工具是**同一套引擎**，只是换了个入口。

---

## 第二步：装进 DSH（约 2 分钟）

1. **改路径**——`cordis.patch.yml` 里写死了我本机的绝对路径，换成你自己的。在项目目录的 PowerShell 里跑：

   ```powershell
   node -e "const fs=require('fs');const t=fs.readFileSync('cordis.patch.yml','utf8');fs.writeFileSync('cordis.patch.yml',t.replace('D:/Desktop/DSH/dsh-hkchat-coach',process.cwd().replace(/\\/g,'/')))"
   ```

   > 别用 `Get-Content`/`Set-Content` 改这个文件——PowerShell 5.1 按 GBK 读写，会把中文注释写成乱码。

2. **装插件**——在 DSH 会话里说：

   ```text
   plugin_manager action=install_bundle target=<你的项目目录绝对路径>
   ```

3. **装 Skill**——把 `skills/cantonese-coach` 整个目录复制到 `~/.dsh/skills/`（全局）或 `<你的项目>/.dsh/skills/`（只这个项目）。

4. **重启 DSH**——Plugins 页应该能看到「港话通粤语教练」，**新会话**里才会出现 `mcp__hkchat__*` 工具。

---

## 第一次怎么用

新会话说一句就行：

> 教我粤语，先测一下我的声调

Skill 会按「每日 5–15 分钟」的流程带你走：六调热身 → 场景对话 → 3 个语块 → 自测 → 记一笔。

---

## 它明确不做什么

| 能做到 | 做不到 |
|---|---|
| 讲六调、出题、判分、纠正粤拼写法 | 判断你发音准不准（要录音对比或真人听） |
| 普通话 → 粤语草稿 + 逐词解释 | 100% 地道：逐词替换不管语序和语气 |
| 点餐/问路/约人剧本，带粤拼和提示 | 覆盖 200–300 词（目前 123 条） |

例句是教学用的近似对照，**进语块本前自己抽查一遍**。

---

## 出问题先看这里

- **`node` 找不到** → 装 Node.js LTS，重开终端
- **工具没出现** → 必须是**新会话**；还是没有就去 Plugins 页看这行有没有报错
- **中文表格错位** → 用 Windows Terminal（老的 cmd 显示宽字符会乱）
- **想删掉** → `plugin_manager` 里禁用/移除 `dsh-hkchat-coach`，Skill 目录删掉即可；练习记录在 `~/.dsh/hkchat-coach`

---

想改哪里尽管提——词库、剧本、出题规则都在 `server/data.mjs`，改完 `npm test` 跑一遍就知道有没有写坏。
