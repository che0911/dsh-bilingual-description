# 上传文案 · Market copy

> 市场字段中英各一份，下面每个字段都给了双语，直接对位复制。
> Every market field takes both languages — each field below is given in both.

## 名称 / Name

`dsh-bilingual-description`

## 一句话介绍 / One-line intro

- 中文：工具调用描述强制中英双语，漏写直接拦下重写。
- EN: Tool-call descriptions are forced bilingual, and English-only calls are rejected before they run.

## 卡片副标题 / Card subtitle

- 中文：让每个带 description 的工具调用都写成「中文:“…” 英文:“…”」；提示词先讲规则，调用前守卫再校验，漏写即拒绝并原样告知改法。
- EN: Every tool call that takes a description is written as 中文:“…” 英文:“…” — the prompt states the rule, a tool guard verifies it before execution, and a missing half is rejected with the exact rewrite.

## 详细介绍 / Long description

### 中文

工具调用的 `description` 会原样进入轨迹的「参数」面板，是你事后回看「这一步到底做了什么」的唯一线索。可它由模型随手写成一句英文，一旦写进会话就是不可变快照——事后没有任何插件能把它翻译回中文。

能改变它的只有两个位置：**提示词**（事先讲规则）和**守卫**（写错不让跑）。本插件两处都做：

1. **提示词段落**：在每次请求的系统提示里追加一条短规则，位置紧挨内置的 shell 指引，让模型在动笔之前就知道格式；
2. **调用守卫**：调用执行前检查 `description`，不合格就拒绝该次调用，并把重写要求原样返回给模型，下一次即可写对。

要求的格式为单行、全角引号：

```
中文:“<中文描述>” 英文:“<English description>”
```

全角引号的用意是不需要任何 JSON 转义，模型不会因为转义而写歪，也不会把引号吃掉。

**为什么需要「守卫」而不只是提示词**：提示词是建议，长会话里模型很容易顺着自己前几十条英文描述继续写。守卫是硬约束——写错就执行不了，重写成本立刻可见，模型下一轮就会遵守。

**它不会做什么**：

- 不改任何其它插件的文件，只使用 `ctx.systemPrompt.section()` 与 `ctx.tools.guard()` 两个公开扩展点；
- 不硬编码工具名：调用时读取工具定义，只有真的声明了顶层 `description` 参数的工具才校验；
- 读不到工具定义时退回一份命令类工具名单，不扩大打击面；
- 插件内部任何异常都按「放行」处理，绝不会因为自己的原因卡住正常调用。

### English

A tool call's `description` is what lands, verbatim, in the trajectory **parameters** panel — the only trace of what a step actually did. The model writes it as one English sentence, and once it is in the session record it is an immutable snapshot: no plugin can translate it afterwards.

Only two places can influence it: the **prompt** (state the rule) and the **guard** (refuse the call). This plugin does both:

1. **Prompt section** — appends one short rule to every request, next to the built-in shell guidance, so the model knows the format before it writes.
2. **Tool guard** — inspects `description` before execution, rejects a call that fails the check, and hands the exact rewrite back to the model.

Required format, single line, full-width quotes:

```
中文:“<中文描述>” 英文:“<English description>”
```

Full-width quotes mean no JSON escaping is needed, so the model cannot mangle the value while escaping.

**Why a guard and not just a prompt**: a prompt is advice, and in a long session the model drifts back to the style of its previous hundred English-only calls. The guard is a hard constraint — a bad call simply does not run, the cost of rewriting is immediate, and the next attempt follows the rule.

**What it does not do**:

- Touches no other plugin's files; it uses only the public extension points `ctx.systemPrompt.section()` and `ctx.tools.guard()`.
- Hard-codes no tool names: it reads the tool definition at call time and validates only tools that actually declare a top-level `description` parameter.
- Falls back to a known shell-tool list when a definition cannot be read, instead of widening the blast radius.
- Treats any internal error as "allow", so the plugin can never block a normal call.

## 功能亮点 / Highlights

- 中文在前、英文在后，单行、带标签、无需转义 / Chinese first, English second — one line, labelled, no escaping
- 双层生效：提示词预防 + 守卫拦截 / Two layers: prompt prevents, guard blocks
- 只作用于真的带 `description` 参数的工具，`read` / `write` 等完全无感 / Only tools that really declare `description`; `read`, `write` and friends are untouched
- 拦截时返回准确的改法，模型一次重写即可通过 / The rejection carries the exact rewrite, so one retry passes
- 三个环境变量可调：整体关闭、只校验命令类工具、追加额外工具 / Three env switches: disable, shell-tools-only, extra tools
- 自带 16 条断言的冒烟测试，无需 DSH 运行时即可验证 / Ships a 16-assertion smoke test that runs without a DSH runtime
- 零依赖，MIT 许可 / Zero dependencies, MIT

## 截图 / Screenshots

| 文件 / File | 说明 / Description |
| --- | --- |
| `screenshots/01-before-after.png` | 上：改前只有英文；下：改后中文 + 英文（真实轨迹「参数」面板）/ Top: English only before; bottom: Chinese + English after (a real trajectory parameters panel) |
| `screenshots/02-guard-rejection.png` | 漏写中文时的真实返回：拒绝 + 给出重写文案 / A real rejection: the call is refused and the rewrite is returned |

## 安装 / Install

插件市场直接安装，或手动：

```bash
cd ~/.dsh/profiles/<profile>
npm install /path/to/dsh-plugin-bilingual-description
```

- 中文：再把 `"dsh-bilingual-description"` 加进该 profile `package.json` 的 `dsh.profile.bundles`，重启 DSH。
- EN: Then add `"dsh-bilingual-description"` to `dsh.profile.bundles` in that profile's `package.json` and restart DSH.

或从 GitHub 安装 / or from GitHub:

```bash
dsh plugin --profile desktop add github:che0911/dsh-bilingual-description
```

## 兼容性 / Compatibility

- DeepSeek Harness `>= 0.2.0-rc.1`（在 `0.2.2-rc.1` 上实测 / tested on `0.2.2-rc.1`）
- 不依赖任何其它插件 / No other plugin required

## 关键词 / Keywords

`dsh-plugin` `bilingual` `双语` `description` `trajectory` `轨迹` `guard` `工具守卫` `prompt` `提示词` `i18n` `审计` `audit`

## 版本 / Version · 作者 / Author

`0.1.0` · cheche · MIT
