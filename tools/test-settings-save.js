'use strict';
/**
 * 设置保存链路集成测试（不需要浏览器）。
 *
 * 做法：直接从 public/index.html 解析出**真实存在的 input id** 建最小 DOM mock，
 * 再从 public/app.js 里用「括号配对」精确抠出真实代码（常量 + api/withBtn + saveKeys 的回调体）跑用例。
 *
 * 这样能同时验三件事：
 *   1. 保存 payload 是否覆盖全部字段（keys.range / endpoints.range 等新增项）
 *   2. JS 里引用的每个 id 在 HTML 里是否真的存在（HTML/JS id 漂移是重构最容易踩的坑）
 *   3. 接口失败时 withBtn 是否正确兜底（红色 toast + 按钮恢复）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

// ---------- 括号配对截取（兼容 CRLF，不依赖脆弱的正则） ----------
const PAIR = { '{': '}', '[': ']', '(': ')' };
function grabBalanced(src, fromIdx, open) {
  const start = src.indexOf(open, fromIdx);
  if (start < 0) throw new Error('未找到起始括号 ' + open);
  const close = PAIR[open];
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('括号未配对：' + open);
}
function grabConst(name) {
  const at = appSrc.indexOf('const ' + name + ' = ');
  if (at < 0) throw new Error('未找到常量 ' + name);
  return grabBalanced(appSrc, at, name === 'KEY_INPUTS' ? '[' : '{');
}
function grabFn(name) {
  const at = appSrc.indexOf('function ' + name);
  if (at < 0) throw new Error('未找到函数 ' + name);
  // 保留 async 前缀（api 是 async function）
  const asyncPrefix = appSrc.slice(Math.max(0, at - 6), at) === 'async ' ? 'async ' : '';
  // 函数体起点：参数列表的 ) 之后的第一个 { —— 不能直接用第一个 {，否则会命中 `opts = {}` 这类参数默认值
  const paramsEnd = appSrc.indexOf(')', at);
  const bodyStart = appSrc.indexOf('{', paramsEnd);
  return asyncPrefix + appSrc.slice(at, bodyStart) + grabBalanced(appSrc, bodyStart, '{');
}
/** 抠出 $('#saveKeys').onclick = (e) => withBtn(..., async () => { ... }, '#keysMsg') 里的 async 回调体 */
function grabSaveBody() {
  const at = appSrc.indexOf("$('#saveKeys').onclick");
  if (at < 0) throw new Error('未找到 saveKeys 绑定');
  const arrow = appSrc.indexOf('async () =>', at);
  if (arrow < 0) throw new Error('未找到 saveKeys 的 async 回调');
  return grabBalanced(appSrc, arrow, '{');
}

// ---------- 1. 从 HTML 解析真实 id ----------
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
console.log(`\nindex.html 解析到 ${htmlIds.size} 个 id`);

const KEY_GROUPS = vm.runInNewContext('(' + grabConst('KEY_GROUPS') + ')');
const KEY_INPUTS = vm.runInNewContext('(' + grabConst('KEY_INPUTS') + ')');

console.log('\n【A】HTML / JS 的 id 一致性');
const declaredIds = [...Object.keys(KEY_GROUPS.bridge), ...Object.keys(KEY_GROUPS.chain)];
declaredIds.forEach((id) => ok(`KEY_GROUPS 的 #${id} 在 HTML 中存在`, htmlIds.has(id)));
KEY_INPUTS.forEach((id) => ok(`KEY_INPUTS 的 #${id} 在 HTML 中存在`, htmlIds.has(id)));
declaredIds.forEach((id) => ok(`#${id} 也登记在 KEY_INPUTS（否则不显示已填绿底）`, KEY_INPUTS.includes(id)));

console.log('\n【B】saveKeys 代码里引用的 id 全部存在于 HTML');
const saveBody = grabSaveBody();
const usedIds = [...saveBody.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
[...new Set(usedIds)].forEach((id) => ok(`保存逻辑引用的 #${id} 在 HTML 中存在`, htmlIds.has(id)));

// ---------- 2. DOM mock ----------
const elements = {};
[...htmlIds].forEach((id) => {
  const el = {
    id, value: '', textContent: '', className: '', disabled: false, checked: false,
    classList: {
      toggle(cls, on) {
        const set = new Set(String(el.className).split(/\s+/).filter(Boolean));
        if (on) set.add(cls); else set.delete(cls);
        el.className = [...set].join(' ');
      },
    },
  };
  elements[id] = el;
});

const captured = { toast: [], msg: [] };
let posts = [];
let fetchImpl = async () => ({ json: async () => ({ ok: true, settings: {} }) });

const sandbox = {
  $: (sel) => (sel.startsWith('#') ? elements[sel.slice(1)] || null : null),
  document: { querySelector: (s) => sandbox.$(s), querySelectorAll: () => [] },
  fetch: (url, opts) => fetchImpl(url, opts || {}),
  setTimeout: () => 0,
  clearTimeout: () => {},
  console,
  Object, JSON, String, Number, Boolean, Array, Set, Promise, Date, Math, RegExp, Error,
  toast: (m, t) => captured.toast.push({ m, t }),
  setMsg: (sel, text, type) => {
    captured.msg.push({ sel, text, type });
    const el = sandbox.$(sel);
    if (el) { el.textContent = text; el.className = 'msg msg-' + type; }
  },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

const code = [
  'const KEY_GROUPS = ' + grabConst('KEY_GROUPS') + ';',
  'const KEY_INPUTS = ' + grabConst('KEY_INPUTS') + ';',
  grabFn('api'),
  grabFn('withBtn'),
  grabFn('setVal'),
  'const __saveBody = async () => ' + saveBody + ';',
  'return { api, withBtn, setVal, __saveBody };',
].join('\n\n');

// 包一层 IIFE，否则顶层的 return 不是合法语句
const lib = vm.runInNewContext('(function () {\n' + code + '\n})()', sandbox, { filename: 'app-extract.js' });

async function clickSave() {
  const btn = elements.saveKeys;
  btn.textContent = '保存密钥与代理';
  btn.disabled = false;
  await lib.withBtn(btn, '保存中…', lib.__saveBody, '#keysMsg');
  return btn;
}

(async () => {
  console.log('\n【C】全空时保存（Range 缺失应有专门警告）');
  posts = [];
  fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'POST') posts.push(opts.body);
    return { json: async () => ({ ok: true, settings: {} }) };
  };
  await clickSave();
  const p0 = JSON.parse(posts[0]);
  ok('payload 含 endpoints.range（新增字段）', 'range' in p0.endpoints, JSON.stringify(p0.endpoints));
  ok('payload 含 keys.range', 'range' in p0.keys);
  ok('payload 含 keys.etherscan / debank', 'etherscan' in p0.keys && 'debank' in p0.keys);
  ok('Range 未填时 toast 有专门警告', captured.toast.at(-1).m.includes('Range 未配置'), captured.toast.at(-1).m);
  ok('就地提示显示 桥协议 0/1、链上数据 0/2',
    captured.msg.at(-1).text.includes('0/1') && captured.msg.at(-1).text.includes('0/2'), captured.msg.at(-1).text);

  console.log('\n【D】全部填完后保存');
  captured.toast = []; captured.msg = []; posts = [];
  Object.keys({ ...KEY_GROUPS.bridge, ...KEY_GROUPS.chain }).forEach((id) => { elements[id].value = 'k-' + id; });
  elements.sEpRange.value = 'https://range.example/v1/transfers';
  await clickSave();
  const p1 = JSON.parse(posts[0]);
  ok('endpoints.range 值已带上', p1.endpoints.range === 'https://range.example/v1/transfers', p1.endpoints.range);
  ok('keys.range 值已带上', p1.keys.range === 'k-sKeyRange', p1.keys.range);
  ok('已填输入框带 filled（绿底）标记', elements.sKeyRange.className.includes('filled'));
  ok('未填输入框无 filled 标记', !elements.sProxy.className.includes('filled'));
  ok('填全后 toast 不再警告 Range', !captured.toast.at(-1).m.includes('Range 未配置'), captured.toast.at(-1).m);
  ok('就地提示显示 桥协议 1/1、链上数据 2/2',
    captured.msg.at(-1).text.includes('1/1') && captured.msg.at(-1).text.includes('2/2'), captured.msg.at(-1).text);

  console.log('\n【E】清空 Range 后的统计');
  captured.toast = []; captured.msg = [];
  elements.sKeyRange.value = '';
  await clickSave();
  ok('提示回落为 0/1', captured.msg.at(-1).text.includes('0/1'), captured.msg.at(-1).text);
  ok('Range 清空后重新警告', captured.toast.at(-1).m.includes('Range 未配置'), captured.toast.at(-1).m);
  ok('清空后 filled 标记同步移除', !elements.sKeyRange.className.includes('filled'));

  console.log('\n【F】接口失败时的兜底');
  captured.toast = []; captured.msg = [];
  fetchImpl = async () => ({ json: async () => ({ ok: false, error: '服务端炸了' }) });
  const btn = await clickSave();
  ok('弹红色 toast 且带具体错误', captured.toast.at(-1).t === 'err' && captured.toast.at(-1).m === '服务端炸了',
    JSON.stringify(captured.toast.at(-1)));
  ok('按钮旁显示红色就地提示', captured.msg.at(-1).text.startsWith('✗') && captured.msg.at(-1).type === 'err',
    captured.msg.at(-1).text);
  ok('按钮恢复可点、文案还原', btn.disabled === false && btn.textContent === '保存密钥与代理');

  console.log('\n【G】setVal 回归（$ 是 querySelector，id 必须拼 #）');
  elements.sKeyRange.value = '';
  elements.sKeyRange.className = '';
  lib.setVal('sKeyRange', 'abc-key');
  ok('setVal 写入了值（漏写 # 时会静默取不到元素）', elements.sKeyRange.value === 'abc-key', elements.sKeyRange.value);
  ok('setVal 标记了 filled 绿底', elements.sKeyRange.className.includes('filled'), elements.sKeyRange.className);
  lib.setVal('sKeyRange', '');
  ok('清空值后 filled 标记被移除', !elements.sKeyRange.className.includes('filled'), elements.sKeyRange.className);
  let threw = false;
  try { lib.setVal('这个id不存在', 'x'); } catch { threw = true; }
  ok('setVal 遇到不存在的 id 不抛异常（不拖垮整页加载）', !threw);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})();
