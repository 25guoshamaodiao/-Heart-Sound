/* 银月 · reasoning 接管自检台
 *
 * 目标：把「两个都有」和「流式」这两件事变成可断言的事实，而不是嘴上说。
 * 环境：jsdom + .work/ref/st-mirror.js —— 从 ST 1.14.0 源码逐字搬来的迷你 ST：
 *       escapeRegex / parseReasoningFromString / getRegexedString / cleanUpMessage 那一趟 /
 *       流式的 #autoParseReasoningFromMessage / 酒馆助手的格式转换。
 *
 * 跑法：node .work/st-reasoning-test.js   （报告写到 .work/st-reasoning-report.txt）
 */
const fs = require('fs');
const path = require('path');
const { loadJsdom } = require('./jsdom-loader');
const { JSDOM, VirtualConsole } = loadJsdom(path.join(__dirname, '..'));

const ROOT = process.cwd();
const TARGET = path.join(ROOT, '思维链', '银月', 'silver-moon.js');
const MIRROR = path.join(ROOT, '.work', 'ref', 'st-mirror.js');
const OUT = path.join(ROOT, '.work', 'st-reasoning-report.txt');

const SCRIPT_SRC = fs.readFileSync(TARGET, 'utf8');
const MIRROR_SRC = fs.readFileSync(MIRROR, 'utf8');

const NAME_CLOSED = '银月 · 思维链归一（勿删）';
const NAME_STREAM = '银月 · 思维链归一·流式（勿删）';

const results = [];
const lines = [];
function check(name, ok, extra) {
  results.push((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined && extra !== '' ? '  <' + extra + '>' : ''));
  return ok;
}
function section(title) {
  lines.push('');
  lines.push('===== ' + title + ' =====');
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function makeEnv() {
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => logs.push('[jsdomError] ' + (e && e.stack ? e.stack : e)));
  vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));
  vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
  vc.on('log', (...a) => logs.push('[log] ' + a.join(' ')));
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="chat"></div>' +
    '<script>' + MIRROR_SRC + '</script>' +
    '<script>' + SCRIPT_SRC + '</script>' +
    '</body></html>';
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://127.0.0.1/',
  });
  const env = { dom, win: dom.window, logs };
  // 等脚本 init 里那次安装落地，否则场景一开始就改 CONFIG 会变成「装/卸」抢跑
  await tick();
  await tick();
  return env;
}

const ourRegexes = (win) =>
  (win.__mirror.getGlobalRegexes() || []).filter((r) => r.scriptName === NAME_CLOSED || r.scriptName === NAME_STREAM);
const hasNormalize = (win) => ourRegexes(win).length > 0;
// ST 那边的初始配置（镜像里就是 ST 默认值）——「让位时有没有还回去」用它比
const isDefaultReasoning = (win) => {
  const r = win.__mirror.power_user.reasoning;
  return r.prefix === '<think>\n' && r.suffix === '\n</think>' && r.auto_parse === false;
};
const blockInfo = (win, idx) => {
  const el = win.document.querySelector('#chat .mes[mesid="' + idx + '"] .mes_reasoning_details');
  if (!el) return { count: 0, state: null, reasoning: '' };
  const body = el.querySelector('.mes_reasoning');
  return {
    count: win.document.querySelectorAll('#chat .mes[mesid="' + idx + '"] .mes_reasoning_details').length,
    state: el.getAttribute('data-state'),
    reasoning: body ? String(body.textContent || '') : '',
  };
};
const mesText = (win, idx) => {
  const el = win.document.querySelector('#chat .mes[mesid="' + idx + '"] .mes_text');
  return el ? String(el.textContent || '') : '';
};
function leakCount(win, prefix, suffix) {
  const p = String(prefix || '').trim();
  const s = String(suffix || '').trim();
  let n = 0;
  win.document.querySelectorAll('#chat .mes_text').forEach((el) => {
    const t = String(el.textContent || '');
    if ((p && t.indexOf(p) !== -1) || (s && t.indexOf(s) !== -1)) n += 1;
  });
  return n;
}

(async function main() {
  lines.push('target = ' + path.relative(ROOT, TARGET));
  check('脚本源码里没有 </script>（能安全内联）', SCRIPT_SRC.indexOf('</script>') === -1);

  /* ---------------- A0. 默认就该是开着的 ---------------- */
  section('A0. 默认值：adoptLeadingThink 默认开，两条规则都装上');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    check('A0a 暴露了 __silverMoon', !!api);
    check('A0b CONFIG.adoptLeadingThink 默认是 true', api.config.adoptLeadingThink === true);
    await api.refresh();
    const names = ourRegexes(win).map((r) => r.scriptName);
    check('A0c 两条规则都装上了', names.length === 2, JSON.stringify(names));
    check('A0d 顺序：闭合规则在前、流式规则在后（ST 按数组顺序跑）',
      names[0] === NAME_CLOSED && names[1] === NAME_STREAM, JSON.stringify(names));
    check('A0e 两条都落进「改消息本身」那一档（markdownOnly/promptOnly 都是 false）',
      ourRegexes(win).every((r) => r.markdownOnly === false && r.promptOnly === false));
    const stream = ourRegexes(win).find((r) => r.scriptName === NAME_STREAM);
    check('A0f 流式那条只换开标签、不补闭合标签',
      !!stream && stream.replaceString.indexOf('$1') !== -1 && stream.replaceString.indexOf('</thinking>') === -1,
      stream ? JSON.stringify(stream.replaceString) : '');
    lines.push('  闭合规则 = ' + ourRegexes(win)[0].findRegex);
    lines.push('  流式规则 = ' + (stream ? stream.findRegex : '(无)'));
    lines.push('  替换 = ' + JSON.stringify(api.config.canonicalPrefix) + ' + $1 + ' + JSON.stringify(api.config.canonicalSuffix));
    lines.push('  ST 生效的 reasoning = ' + JSON.stringify(api.status().reasoning));
  }

  /* ---------------- A. 关掉之后的基线 ---------------- */
  section('A. 基线（手动关掉 adoptLeadingThink）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    api.config.adoptLeadingThink = false;
    await api.refresh();
    check('A1 关掉后两条都摘掉', !hasNormalize(win), JSON.stringify(ourRegexes(win).map((r) => r.scriptName)));
    check('A2 状态 = off，且把 ST 的 reasoning 配置还回去了（不留半吊子状态）',
      api.status().normalize.state === 'off' && api.status().normalize.configApplied === false && isDefaultReasoning(win),
      JSON.stringify(api.status().reasoning));
    const m = win.__mirror.receive(0, '<think>\n小左推理\n</think>\n\n正文来了');
    check('A3 <think> 没被解析（reasoning 为空）', !m.extra.reasoning, JSON.stringify(m.extra));
    check('A4 正文里还是原始文本', m.mes.indexOf('<think>') === 0, JSON.stringify(m.mes));
    check('A5 没有思维链块', blockInfo(win, 0).count === 0);
  }

  /* ---------------- B. 闭合时的归一化：恰好一个块 ---------------- */
  section('B. 归一化（闭合）：恰好一个块，正文不留 wrapper');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    const st = api.status();
    check('B1 探针通过', !!st.normalize.probe && st.normalize.probe.ok === true, JSON.stringify(st.normalize.probe));
    check('B2 ST 那边的 prefix/suffix 被写成 canonical',
      !!st.reasoning && st.reasoning.prefix === api.config.canonicalPrefix && st.reasoning.auto_parse === true,
      JSON.stringify(st.reasoning));
    check('B2b 接管成功时 configApplied = true（是它占着配置）', st.normalize.configApplied === true);

    const m = win.__mirror.receive(0, '<think>\n小左推理\n</think>\n\n正文来了');
    check('B3 CoT 进了 reasoning 块', String(m.extra.reasoning || '').indexOf('小左推理') !== -1, JSON.stringify(m.extra.reasoning));
    check('B4 正文里只剩正文（包裹被 ST 永久删掉）', m.mes.trim() === '正文来了', JSON.stringify(m.mes));
    check('B5 恰好一个思维链块', blockInfo(win, 0).count === 1, JSON.stringify(blockInfo(win, 0)));
    check('B6 正文里 0 处残留 wrapper', leakCount(win, api.config.canonicalPrefix, api.config.canonicalSuffix) === 0,
      'leak=' + leakCount(win, api.config.canonicalPrefix, api.config.canonicalSuffix));
    const dom = api.selfCheck().dom;
    check('B7 自检：没有「既有块又漏 wrapper」的消息', dom.bothInOneMessage === 0, JSON.stringify(dom));

    const m2 = win.__mirror.receive(1, '[metacognition]\n另一段CoT\n</thinking>\n\n第二段正文');
    check('B8 [metacognition]…</thinking> 也能被归一 + 解析',
      String(m2.extra.reasoning || '').indexOf('另一段CoT') !== -1 && m2.mes.trim() === '第二段正文',
      JSON.stringify(m2.extra.reasoning) + ' / ' + JSON.stringify(m2.mes));
    const once = win.__mirror.getRegexedString('<think>x</think>y', 2, {});
    const twice = win.__mirror.getRegexedString(once, 2, {});
    check('B9 再跑一遍不会把 wrapper 叠起来（幂等）', once === twice, JSON.stringify(once) + ' vs ' + JSON.stringify(twice));
  }

  /* ---------------- C. 只吃开头 ---------------- */
  section('C. 只做「消息开头」那一处');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    const raw1 = '正文先来。<think>中间包裹</think>后面还有。';
    const m1 = win.__mirror.receive(0, raw1);
    check('C1 正文中间的包裹不动', m1.mes === raw1 && !m1.extra.reasoning, JSON.stringify(m1.mes));
    const raw2 = '<thinking_left>小左</thinking_left><thinking_right>小右</thinking_right>';
    const m2 = win.__mirror.receive(1, raw2);
    check('C2 内层块标签（thinking_left/right）不会被误吃', m2.mes === raw2 && !m2.extra.reasoning, JSON.stringify(m2.mes));
    const raw3 = '先有一段正文，然后 <think>没闭合';
    const m3 = win.__mirror.receive(2, raw3);
    check('C3 不在开头的没闭合标签也不动', m3.mes === raw3 && !m3.extra.reasoning, JSON.stringify(m3.mes));
    check('C4 这三条都没造出块', blockInfo(win, 0).count + blockInfo(win, 1).count + blockInfo(win, 2).count === 0);
  }

  /* ---------------- S. 流式（重点） ---------------- */
  section('S. 流式：思维块必须跟着字长出来，不能等出完字');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    const M = win.__mirror;
    const s = M.beginStream(0);
    const tokens = ['<thi', '<think', '<think>', '<think>思', '<think>思考', '<think>思考</think>', '<think>思考</think>正', '<think>思考</think>正文'];
    const seen = tokens.map((t) => {
      s.apply(t, false);
      const b = blockInfo(win, 0);
      return { state: b.state, reasoning: b.reasoning, mes: (M.chat[0] && M.chat[0].mes) || '' };
    });
    lines.push('  每个 token 之后：');
    tokens.forEach((t, i) => {
      lines.push('    ' + JSON.stringify(t) + ' → state=' + seen[i].state + ' 块内=' + JSON.stringify(seen[i].reasoning) + ' 正文=' + JSON.stringify(seen[i].mes));
    });
    check('S1 标签还没闭合时不乱来（前 3 个 token 没有块）',
      seen.slice(0, 3).every((x) => !x.state), JSON.stringify(seen.slice(0, 3).map((x) => x.state)));
    check('S2 开标签一闭合、再出一个字就进「思考中」态（不是等出完字）',
      seen[3].state === 'thinking', JSON.stringify(seen.map((x) => x.state)));
    check('S3 思考中的块里已经有正在写的字', seen[3].reasoning.indexOf('思') !== -1, JSON.stringify(seen[3].reasoning));
    check('S4 块跟着字变长', seen[4].reasoning.length > seen[3].reasoning.length,
      JSON.stringify(seen[3].reasoning) + ' → ' + JSON.stringify(seen[4].reasoning));
    check('S5 闭合标签到了就切回正文流', seen[5].reasoning === '思考' && seen[5].mes === '', JSON.stringify(seen[5]));
    check('S6 之后的正文继续正常流', seen[7].mes === '正文', JSON.stringify(seen[7].mes));
    s.finish();
    const fin = blockInfo(win, 0);
    check('S7 收尾：恰好一个块、状态 done', fin.count === 1 && fin.state === 'done', JSON.stringify(fin));
    check('S8 收尾后正文里也没有残留 wrapper', leakCount(win, api.config.canonicalPrefix, api.config.canonicalSuffix) === 0);
    check('S9 ST 那边持久化下来的 reasoning 干净（没有多出来的空行）',
      M.chat[0].extra.reasoning === '思考', JSON.stringify(M.chat[0].extra));
  }

  /* ---------------- S10. 反证 ---------------- */
  section('S10. 反证：normalizeWhileStreaming = false 就会退化成「出完字才渲染」');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    api.config.normalizeWhileStreaming = false;
    await api.refresh();
    check('S10a 只剩闭合那一条', ourRegexes(win).length === 1, JSON.stringify(ourRegexes(win).map((r) => r.scriptName)));
    const M = win.__mirror;
    const s = M.beginStream(0);
    const states = ['<think>', '<think>思', '<think>思考'].map((t) => {
      s.apply(t, false);
      return blockInfo(win, 0).state;
    });
    check('S10b 流式期间一直没有块（这就是你之前看到的现象）', states.every((x) => !x), JSON.stringify(states));
    s.apply('<think>思考</think>正文', true);
    check('S10c 生成结束的那一刻才出现块', blockInfo(win, 0).count === 1, JSON.stringify(blockInfo(win, 0)));
    s.finish();
    check('S10d 最终结果和开着流式那条时一致（只是慢了一整轮）',
      M.chat[0].extra.reasoning === '思考' && M.chat[0].mes === '正文', JSON.stringify(M.chat[0]));
  }

  /* ---------------- D. 冲突让位（C） ---------------- */
  section('D. 别的正则在管同一批标签 → 让位；takeOver 才接管');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    api.config.adoptLeadingThink = false;
    await api.refresh();
    win.__mirror.setGlobalRegexes([
      win.__mirror.nativeRegex('00-别人家的思维链', '/<think>([\\s\\S]*?)<\\/think>/g', { markdownOnly: true }),
    ]);
    api.config.adoptLeadingThink = true;
    await api.refresh();
    let st = api.status();
    lines.push('  conflicts = ' + JSON.stringify(st.conflicts));
    check('D1 状态 = yielded', st.normalize.state === 'yielded', JSON.stringify(st.normalize.state));
    check('D2 让位时两条都没装', !hasNormalize(win), JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
    check('D2b 让位时必须把 ST 的 reasoning 配置还回去（v1.3 修的 bug）',
      st.normalize.configApplied === false && isDefaultReasoning(win), JSON.stringify(st.reasoning));
    check('D3 冲突里能看到是谁在管哪个标签（而且不会把自己算成冲突）',
      st.conflicts.some((c) => c.regex === '00-别人家的思维链' && c.tag === '<think>') &&
        st.conflicts.every((c) => c.regex !== NAME_CLOSED && c.regex !== NAME_STREAM), JSON.stringify(st.conflicts));
    const m = win.__mirror.receive(0, '<think>CoT</think>正文');
    check('D4 让位时：外观归那条正则管', mesText(win, 0).indexOf('foreign') !== -1, JSON.stringify(mesText(win, 0)));
    check('D5 让位时：银月没插一脚（没有思维块）', blockInfo(win, 0).count === 0);
    {
      // 让位状态下流式跑一条 <think> 包裹的消息：ST 不该把思维链从 mes 里搬走。
      // （真实消息 <dream_plot> 那条踩的就是这个坑：让位了但配置被改了一半。）
      const s = win.__mirror.beginStream(1);
      s.apply('<think>思考中', false);
      s.apply('<think>思考中</think>正文', false);
      s.finish();
      const mes1 = (win.__mirror.chat[1] && win.__mirror.chat[1].mes) || '';
      check('D5b 让位时流式也不搬思维链（正文原封不动）',
        blockInfo(win, 1).count === 0 && mes1.indexOf('<think>') !== -1, JSON.stringify(mes1));
    }

    await api.takeOver();
    st = api.status();
    check('D6 takeOver 后两条都装上了', ourRegexes(win).length === 2, JSON.stringify(ourRegexes(win).map((r) => r.scriptName)));
    check('D7 takeOver 后状态 installed/present', ['installed', 'present'].includes(st.normalize.state), st.normalize.state);
    check('D7b takeOver 之后才占住配置', st.normalize.configApplied === true && st.reasoning.prefix === api.config.canonicalPrefix,
      JSON.stringify(st.reasoning));
    win.__mirror.resetChat();
    const m2 = win.__mirror.receive(0, '<think>CoT</think>正文');
    check('D8 接管后：ST 解析成思维链', String(m2.extra.reasoning || '').indexOf('CoT') !== -1, JSON.stringify(m2.extra.reasoning));
    check('D9 接管后：恰好一个块', blockInfo(win, 0).count === 1, JSON.stringify(blockInfo(win, 0)));
    check('D10 接管后：那条显示正则再也吃不到标签（不会两个）', mesText(win, 0).indexOf('foreign') === -1, JSON.stringify(mesText(win, 0)));
  }

  /* ---------------- E. 探针守卫 ---------------- */
  section('E. ST 不认这对 wrapper 时，坚决不装正则');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    // 模拟「用户自己设了别的模板」，并禁止银月去改 → 探针必挂
    win.__mirror.setReasoning({ auto_parse: false, prefix: '<think>\n', suffix: '\n</think>' });
    api.config.manageReasoningConfig = false;
    await api.refresh();
    const st = api.status();
    check('E1 状态 = probe-failed', st.normalize.state === 'probe-failed', JSON.stringify(st.normalize.state));
    check('E2 探针没过就不装正则', !hasNormalize(win), JSON.stringify(ourRegexes(win).map((r) => r.scriptName)));
    check('E2b 探针没过也要把配置还回去', st.normalize.configApplied === false && isDefaultReasoning(win), JSON.stringify(st.reasoning));
    check('E3 报告里说明了原因', typeof st.normalize.note === 'string' && st.normalize.note.length > 0, st.normalize.note);
    check('E4 探针用的是 canonical 那对', String(st.normalize.probe.sample || '').indexOf(api.config.canonicalPrefix) === 0,
      JSON.stringify(st.normalize.probe.sample));
    const m = win.__mirror.receive(0, '<think>CoT</think>正文');
    check('E5 没装正则时正文原样（不会写进一串没人解析的 wrapper）', m.mes === '<think>CoT</think>正文', JSON.stringify(m.mes));
  }

  /* ---------------- F. 老写法那个 bug 的证据 ---------------- */
  section('F. prefix/suffix 是字面量：老写法的反斜杠是坏的（用 ST 自己的 escapeRegex 验）');
  {
    const env = await makeEnv();
    const win = env.win;
    const M = win.__mirror;
    const sample = '[metacognition]\n内容\n</thinking>';
    M.setReasoning({ auto_parse: true, prefix: '[metacognition]\n', suffix: '\n</thinking>' });
    const okLiteral = M.parseReasoningFromString(sample);
    check('F1 字面量 prefix 能解析出内容', !!okLiteral && okLiteral.reasoning === '内容', JSON.stringify(okLiteral));
    M.setReasoning({ prefix: '\\[metacognition\\]', suffix: '</thinking>' });
    const bad = M.parseReasoningFromString(sample);
    check('F2 老写法（\\[metacognition\\]）解析不到 → 就是原来那个 bug',
      !bad || !bad.reasoning || bad.reasoning !== '内容', JSON.stringify(bad));
    lines.push('  escapeRegex("[metacognition]") = ' + M.escapeRegex('[metacognition]'));
    lines.push('  escapeRegex("\\\\[metacognition\\\\]") = ' + M.escapeRegex('\\[metacognition\\]'));
  }

  /* ---------------- G. 唯一剩下的坑：模型自带 reasoning ---------------- */
  section('G. 消息已带 reasoning 时 ST 会跳过解析（这个坑要能被自检看见）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    await api.refresh();
    const m = win.__mirror.receive(0, '<think>文本里的CoT</think>正文', '模型自带的思维链');
    check('G1 已带 reasoning → ST 跳过解析', m.extra.reasoning === '模型自带的思维链', JSON.stringify(m.extra.reasoning));
    check('G2 于是刚写进去的 wrapper 留在正文里（坑确实存在）', m.mes.indexOf('[metacognition]') !== -1, JSON.stringify(m.mes));
    const dom = api.selfCheck().dom;
    lines.push('  dom = ' + JSON.stringify(dom));
    check('G3 自检报出「正文里漏了 wrapper」', dom.wrapperLeftInBody >= 1, JSON.stringify(dom));
    check('G4 自检报出「同一条消息既有块又漏 wrapper」', dom.bothInOneMessage >= 1, JSON.stringify(dom));
  }

  /* ---------------- H. 不空转 / 幂等 ---------------- */
  section('H. 空转与幂等（updateTavernRegexesWith 会重排整个聊天）');
  {
    const env = await makeEnv();
    const win = env.win;
    const api = win.__silverMoon;
    api.config.adoptLeadingThink = false;
    await api.refresh();
    const before = win.__mirror.stats().renderTriggerCount;
    await api.refresh();
    const afterOff = win.__mirror.stats().renderTriggerCount;
    check('H1 关着的时候不触发全聊天重排', afterOff === before, before + ' → ' + afterOff);

    api.config.adoptLeadingThink = true;
    await api.refresh();
    await api.refresh();
    await api.refresh();
    check('H2 反复 refresh 不会重复添加', ourRegexes(win).length === 2, 'count=' + ourRegexes(win).length);
    check('H3 重复 install 的状态是 present', api.status().normalize.state === 'present', api.status().normalize.state);

    await api.uninstall();
    check('H4 uninstall 之后两条都摘干净了', !hasNormalize(win), JSON.stringify(win.__mirror.getGlobalRegexes().map((r) => r.scriptName)));
  }

  /* ---------------- 报告 ---------------- */
  const report = lines.concat(['', '===== 断言 ====='], results).join('\n');
  fs.writeFileSync(OUT, report, 'utf8');
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(report);
  console.log('');
  console.log(failed.length ? failed.join('\n') : '全部断言通过（' + results.length + ' 条）');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('测试台自己崩了：', e);
  process.exit(2);
});
