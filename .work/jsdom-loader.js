/* jsdom 查找器。
 * DSH 每次命令给的 TEMP 都是新的随机目录（…\Temp\dsh-XXXXXX），
 * 所以不能只认 process.env.TEMP —— 这里按优先级找：.work 下的稳定安装 → TEMP → 所有 dsh-* 残留。
 */
const fs = require('fs');
const path = require('path');

function candidates(root) {
  const out = [path.join(root, '.work', 'node_modules', 'jsdom')];
  const temp = process.env.TEMP || process.env.TMP || '';
  if (temp) {
    out.push(path.join(temp, 'sm-harness', 'node_modules', 'jsdom'));
    try {
      const parent = path.dirname(temp);
      for (const d of fs.readdirSync(parent)) {
        if (d.indexOf('dsh-') === 0) out.push(path.join(parent, d, 'sm-harness', 'node_modules', 'jsdom'));
      }
    } catch (_) {
      /* noop */
    }
  }
  return out;
}

function loadJsdom(root) {
  for (const c of candidates(root || process.cwd())) {
    try {
      if (fs.existsSync(path.join(c, 'package.json'))) return require(c);
    } catch (_) {
      /* 继续找下一个 */
    }
  }
  throw new Error(
    '找不到 jsdom。先装一次（在仓库根目录跑）：\n' +
      '  npm install --prefix .work jsdom --registry=https://registry.npmmirror.com\n',
  );
}

module.exports = { loadJsdom };
