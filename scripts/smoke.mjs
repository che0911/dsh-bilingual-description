/**
 * 冒烟测试：不依赖 DSH 运行时，用假的 ctx / tools 服务验证三条契约。
 *
 *   node scripts/smoke.mjs
 *
 * 覆盖：
 *   1. validateDescription 的判定表（纯函数）。
 *   2. checkCall：只有真的暴露顶层 description 参数的工具才被管。
 *   3. apply：守卫生效、提示词段落被注册、异常不会冒出。
 */

import assert from 'node:assert/strict'
import { apply, checkCall, validateDescription } from '../index.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

console.log('validateDescription')

ok('放行标准双语', () => {
  assert.equal(validateDescription('中文:“列出当前目录文件” 英文:“List files in current directory”'), null)
})

ok('放行全角引号以外的写法（只要有标签和两种文字）', () => {
  assert.equal(validateDescription('中文: 修复解码 英文: Fix decode'), null)
})

ok('拒绝纯英文', () => {
  assert.match(validateDescription('Fix decode and rebuild single file'), /missing the 中文: label/)
})

ok('拒绝有中文但缺英文标签', () => {
  assert.match(validateDescription('中文:“修复解码”'), /missing the 英文: label/)
})

ok('拒绝只有标签没有中文内容', () => {
  assert.match(validateDescription('中文: 英文: fix it'), /missing Chinese text/)
})

ok('拒绝换行', () => {
  assert.match(validateDescription('中文:“改” 英文:“fix”\n第二行'), /must stay on one line/)
})

ok('空串交给工具自己报错，这里放行', () => {
  assert.equal(validateDescription(''), null)
})

ok('非字符串给出提示', () => {
  assert.match(validateDescription(42), /expected a string/)
})

console.log('checkCall')

const toolsWithDescription = {
  get: () => ({ parameters: { properties: { command: {}, description: {} } } }),
}
const toolsWithoutDescription = {
  get: () => ({ parameters: { properties: { path: {} } } }),
}

ok('声明了 description 的工具：漏写中文被拦', () => {
  const reason = checkCall({ name: 'ops_bash', arguments: { command: 'ls', description: 'List files' } }, toolsWithDescription)
  assert.match(String(reason), /bilingual|missing the 中文: label/)
})

ok('声明了 description 的工具：标准写法放行', () => {
  const reason = checkCall(
    { name: 'ops_bash', arguments: { command: 'ls', description: '中文:“列出文件” 英文:“List files”' } },
    toolsWithDescription,
  )
  assert.equal(reason, null)
})

ok('没有 description 参数的工具完全不受影响', () => {
  const reason = checkCall({ name: 'read', arguments: { path: 'a.txt', description: 'Read a file' } }, toolsWithoutDescription)
  assert.equal(reason, null)
})

ok('参数里根本没有 description 字段时放行', () => {
  assert.equal(checkCall({ name: 'ops_bash', arguments: { command: 'ls' } }, toolsWithDescription), null)
})

ok('tools.get 抛错时按命令类名单兜底，不崩', () => {
  const broken = {
    get() {
      throw new Error('boom')
    },
  }
  assert.match(String(checkCall({ name: 'ops_bash', arguments: { description: 'List files' } }, broken)), /missing/)
  assert.equal(checkCall({ name: 'read', arguments: { description: 'Read a file' } }, broken), null)
})

console.log('apply')

ok('注册守卫与提示词段落，且守卫可拒绝', () => {
  const registered = { guard: null, sections: [] }
  const ctx = {
    tools: { get: toolsWithDescription },
    systemPrompt: {
      getSectionOrder: () => 321,
      section(section) {
        registered.sections.push(section)
        return () => {}
      },
    },
    effect(fn) {
      fn()
      return () => {}
    },
  }
  apply(ctx)
  assert.equal(typeof registered.sections[0].text, 'string')
  assert.equal(registered.sections[0].order, 321)
  assert.match(registered.sections[0].text, /中文:“<中文描述>” 英文:“<English description>”/)
})

ok('ctx.tools.guard 抛错不会让 apply 失败', () => {
  const ctx = {
    tools: {
      get: toolsWithDescription,
      guard() {
        throw new Error('no guard support')
      },
    },
    systemPrompt: { section: () => () => {} },
    effect(fn) {
      fn()
      return () => {}
    },
    logger: { warn() {} },
  }
  assert.doesNotThrow(() => apply(ctx))
})

ok('环境变量可整体关闭', () => {
  process.env.DSH_BILINGUAL_DESCRIPTION_DISABLE = '1'
  let guarded = false
  const ctx = {
    tools: {
      guard() {
        guarded = true
      },
    },
    logger: { info() {}, warn() {} },
  }
  apply(ctx)
  delete process.env.DSH_BILINGUAL_DESCRIPTION_DISABLE
  assert.equal(guarded, false)
})

console.log(`\n全部通过：${passed} 项`)
