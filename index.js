/**
 * dsh-bilingual-description
 *
 * 让每个工具调用的 `description` 参数都写成中英双语，并保证漏写时调用被拒绝、
 * 模型立刻重写。它不修改任何其它插件的文件，只使用 DSH 的公开扩展点：
 *
 *   1. `ctx.systemPrompt.section()` —— 在每次请求的提示词里声明规则（模型事先知道）。
 *   2. `ctx.tools.guard()`         —— 调用执行前的单调守卫（漏写时拒绝并给出改法）。
 *
 * 两条互补：提示词负责「一次写对」，守卫负责「写不对就拦住」。
 */

export const name = 'dsh-bilingual-description'

/** Cordis 服务：提示词段落（规则）与工具守卫（校验）。 */
export const inject = ['tools', 'systemPrompt']

/** 汉字（含扩展 A 区与兼容区），用于判断是否真的有中文内容。 */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 去掉「中文」「英文」两个标签后是否仍有汉字——标签自身就是汉字，不能用它们自证。 */
function hasChineseText(text) {
  return HAN.test(String(text).replaceAll(CN_LABEL, '').replaceAll(EN_LABEL, ''))
}

/** 标签：必须同时出现，且中文在前。 */
const CN_LABEL = '中文'
const EN_LABEL = '英文'

/** 工具定义里取不到 schema 时，按这些名字兜底判断「是不是命令类工具」。 */
const SHELL_TOOLS = new Set([
  'ops_bash',
  'bash',
  'pwsh',
  'powershell',
  'shell',
  'terminal',
  'run_command',
  'execute_command',
])

/** 提示词里写给模型的规则。 */
const RULE = [
  '## Tool-call `description` must be bilingual (中文 + English)',
  '',
  'Every tool call that takes a `description` argument MUST write it on ONE line, Chinese first, with both labels:',
  '',
  '中文:“<中文描述>” 英文:“<English description>”',
  '',
  '- Both halves are required. An English-only `description` is rejected before the call runs.',
  '- Use full-width quotes “ ” so the value needs no JSON escaping; do not use a slash separator.',
  '- No length limit; keep each half a short active-voice phrase.',
  '- This applies to every workspace and every session, including long-running ones, and to subagents.',
  '',
  'Example: 中文:“列出当前目录文件” 英文:“List files in current directory”',
].join('\n')

/** 读取环境变量中的开关（缺省开启）。 */
function readScope() {
  const raw = String(process.env.DSH_BILINGUAL_DESCRIPTION_SCOPE ?? 'all').trim().toLowerCase()
  return raw === 'shell' ? 'shell' : 'all'
}

/** 额外要求校验的工具名（逗号分隔）。 */
function readExtraTools() {
  const raw = String(process.env.DSH_BILINGUAL_DESCRIPTION_EXTRA_TOOLS ?? '')
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 是否被显式关闭。 */
function isDisabled() {
  const raw = String(process.env.DSH_BILINGUAL_DESCRIPTION_DISABLE ?? '').trim()
  return raw === '1' || raw.toLowerCase() === 'true'
}

/**
 * 校验一条 `description`。
 *
 * @param {unknown} value 工具调用里 `description` 的原始值
 * @returns {string | null} 拒绝理由；`null` 表示放行
 *
 * 纯函数：不读全局状态、不抛异常，方便单测与复用。
 */
export function validateDescription(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    return 'invalid description: expected a string written as 中文:“<中文描述>” 英文:“<English description>” on one line.'
  }
  const text = value.trim()
  // 空字符串交给工具自己的校验去报错，这里只负责「双语的形状」。
  if (text === '') return null

  const problems = []
  if (!text.includes(CN_LABEL)) problems.push('missing the 中文: label')
  if (!text.includes(EN_LABEL)) problems.push('missing the 英文: label')
  if (!hasChineseText(text)) problems.push('missing Chinese text')
  if (!/[A-Za-z]/.test(text)) problems.push('missing English text')
  if (text.includes('\n')) problems.push('must stay on one line')
  if (problems.length === 0) return null

  return (
    `invalid description: ${problems.join('; ')}. ` +
    'Retry this exact call with description written as ' +
    '中文:“<中文描述>” 英文:“<English description>” on one line, Chinese first. ' +
    'Example: 中文:“列出当前目录文件” 英文:“List files in current directory”'
  )
}

/** 从工具定义里取参数 schema，拿不到就返回 undefined。 */
function readDefinition(tools, toolName, agent) {
  try {
    const get = tools && typeof tools.get === 'function' ? tools.get : undefined
    if (!get) return undefined
    const definition = get.call(tools, toolName, agent)
    return definition || undefined
  } catch {
    return undefined
  }
}

/** 该工具是否声明了一个顶层 `description` 参数。 */
function declaresDescription(definition) {
  const properties = definition && definition.parameters && definition.parameters.properties
  return Boolean(properties && Object.hasOwn(properties, 'description'))
}

/**
 * 判断一次调用是否需要校验，并在需要时返回拒绝理由。
 *
 * @param {{ name?: string, arguments?: unknown, agent?: unknown }} exec 调用记录
 * @param {object} tools `ctx.tools` 服务
 */
export function checkCall(exec, tools, options = {}) {
  const scope = options.scope ?? readScope()
  const extra = options.extraTools ?? readExtraTools()
  const toolName = typeof exec?.name === 'string' ? exec.name : ''
  if (!toolName) return null

  const args = exec?.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  if (!Object.hasOwn(args, 'description')) return null

  const definition = readDefinition(tools, toolName, exec?.agent)
  const isDeclared = declaresDescription(definition)
  const isKnownShell = SHELL_TOOLS.has(toolName) || extra.includes(toolName)

  // 定义可读时以 schema 为准：只有真的暴露了顶层 description 参数才管。
  // 定义不可读（老版本/服务不可用）时只退回命令类工具名单，绝不因为 scope=all 就扩大打击面。
  const applies = definition ? isDeclared && (scope === 'all' || isKnownShell) : isKnownShell
  if (!applies) return null

  return validateDescription(args.description)
}

/** 守卫本体：任何异常都放行，绝不因为本插件让调用卡死。 */
function guard(exec, tools) {
  try {
    return checkCall(exec, tools) ?? undefined
  } catch {
    return undefined
  }
}

/** 规则段落排在 bash 指引旁边；老版本没有 getSectionOrder 时用一个靠后的位置。 */
function sectionOrder(systemPrompt) {
  try {
    if (systemPrompt && typeof systemPrompt.getSectionOrder === 'function') {
      const order = systemPrompt.getSectionOrder.call(systemPrompt, 'TOOL_BASH')
      if (typeof order === 'number' && Number.isFinite(order)) return order
    }
  } catch {
    /* 落到默认值 */
  }
  return 500
}

/**
 * Cordis 入口。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (isDisabled()) {
    ctx.logger?.info?.('dsh-bilingual-description: disabled by DSH_BILINGUAL_DESCRIPTION_DISABLE')
    return
  }

  // 1) 每次请求都带上的规则（每个 agent 一份，覆盖子 agent）。
  try {
    if (ctx.systemPrompt) {
      ctx.effect(() =>
        ctx.systemPrompt.section({
          name: 'dsh-bilingual-description',
          order: sectionOrder(ctx.systemPrompt),
          interpolate: false,
          text: RULE,
        }),
      )
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-bilingual-description: prompt section failed: ${String(error)}`)
  }

  // 2) 调用执行前的守卫（全局层，所有 agent 生效）。
  try {
    ctx.tools.guard((exec) => guard(exec, ctx.tools))
  } catch (error) {
    ctx.logger?.warn?.(`dsh-bilingual-description: guard registration failed: ${String(error)}`)
  }
}
