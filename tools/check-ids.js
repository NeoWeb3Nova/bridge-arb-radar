'use strict';
// 静态检查：app.js 里 $('#xxx') 引用的 id，是否都在 index.html 中存在。
// 前端一旦 id 漂移，运行时就是静默的 null 报错（事件绑不上、渲染不更新），
// 靠肉眼翻两个文件很难发现，这里用脚本兜底。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
// app.js 里模板字符串注入的 id（钱包抽屉等运行时创建的元素）也算已定义
const injectedIds = new Set([...js.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
// 1) $('#id') / $('#id tbody') 这类选择器；2) 选择器数组里的 '#id'
const refs = new Set([
  ...[...js.matchAll(/\$\$?\('#([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
  ...[...js.matchAll(/'#([A-Za-z0-9_-]+)'/g)].map((m) => m[1]),
]);

const missing = [...refs].filter((id) => !htmlIds.has(id) && !injectedIds.has(id));
const unused = [...htmlIds].filter((id) => !refs.has(id) && !/^view-/.test(id) && !/^sp-/.test(id));

console.log(`index.html 中 id 数：${htmlIds.size}`);
console.log(`app.js 中静态引用数：${refs.size}`);
if (missing.length) {
  console.log('\n✗ app.js 引用了但 index.html 不存在的 id：');
  for (const id of missing) console.log('  - #' + id);
} else {
  console.log('\n✓ 所有静态引用的 id 都存在');
}
if (unused.length) {
  console.log('\n⚠ index.html 有但 app.js 未静态引用的 id（可能是动态拼接或纯样式钩子）：');
  for (const id of unused) console.log('  - #' + id);
}
process.exit(missing.length ? 1 : 0);
