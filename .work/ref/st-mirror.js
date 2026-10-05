/* 银月自检台用的「迷你 ST」。
 * 下面每个函数都是从本机 ST 源码（E:\share\SillyTavern，1.14.0）逐字搬过来的，
 * 只去掉了 import/export，出处标在函数头上 —— 免得"测试台自己也是猜的"。
 */
(function () {
  'use strict';

  var logs = [];
  var saveCount = 0;
  var renderTriggerCount = 0;

  // power-user.js:279-289 —— ST 的 reasoning 默认值（本机 settings.json 里没有这个键，
  // 所以运行时生效的就是这一份：auto_parse 默认 false）
  var power_user = {
    trim_spaces: true,
    reasoning: {
      name: 'DeepSeek',
      auto_parse: false,
      add_to_prompts: false,
      auto_expand: false,
      show_hidden: false,
      prefix: '<think>\n',
      suffix: '\n</think>',
      separator: '\n\n',
      max_additions: 1,
    },
  };
  var extension_settings = { regex: [] };
  var preset_regexes = [];  // oai_settings.extensions.regex_scripts（预设层）
  var scoped_regexes = [];  // characters[chid].data.extensions.regex_scripts（角色卡层）
  var chat = [];

  // scripts/utils.js:1269
  function escapeRegex(string) {
    return String(string).replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  // scripts/utils.js:840-845
  function trimSpaces(input) {
    if (!input || typeof input !== 'string') return input;
    return power_user.trim_spaces ? input.trim() : input;
  }

  // scripts/utils.js:1279-1294
  function regexFromString(input) {
    try {
      var m = String(input).match(/(\/?)(.+)\1([a-z]*)/i);
      if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) return RegExp(input);
      return new RegExp(m[2], m[3]);
    } catch (e) {
      return;
    }
  }

  // scripts/reasoning.js:1231-1258
  function parseReasoningFromString(str, options) {
    var strict = !options || options.strict !== false;
    if (!power_user.reasoning.prefix || !power_user.reasoning.suffix) return null;
    try {
      var regex = new RegExp(
        (strict ? '^\\s*?' : '') +
          escapeRegex(power_user.reasoning.prefix) +
          '(.*?)' +
          escapeRegex(power_user.reasoning.suffix),
        's',
      );
      var didReplace = false;
      var reasoning = '';
      var content = String(str).replace(regex, function (_match, captureGroup) {
        didReplace = true;
        reasoning = captureGroup;
        return '';
      });
      if (didReplace) {
        reasoning = trimSpaces(reasoning);
        content = trimSpaces(content);
      }
      return { reasoning: reasoning, content: content };
    } catch (e) {
      return null;
    }
  }

  // scripts/extensions/regex/engine.js:226-237
  var regex_placement = { MD_DISPLAY: 0, USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 };

  // scripts/extensions/regex/engine.js:336-393
  function runRegexScript(script, rawString) {
    var newString = rawString;
    if (!script || script.disabled || !script.findRegex || !rawString) return newString;
    var findRegex = regexFromString(script.findRegex);
    if (!findRegex) return newString;
    return rawString.replace(findRegex, function () {
      var args = Array.prototype.slice.call(arguments);
      var replaceString = String(script.replaceString).replace(/{{match}}/gi, '$0');
      return replaceString.replace(/\$(\d+)/g, function (_x, num) {
        var v = args[Number(num)];
        return v === undefined ? '' : v;
      });
    });
  }

  // scripts/extensions/regex/engine.js:11-16,43-45
  // SCRIPT_TYPES = { GLOBAL: 0, PRESET: 2, SCOPED: 1 }，Object.values 展开后是 全局 → 预设 → 角色卡
  function getRegexScripts() {
    return [].concat(extension_settings.regex || [], preset_regexes || [], scoped_regexes || []);
  }

  // scripts/extensions/regex/engine.js:279-326
  function getRegexedString(rawString, placement, params) {
    params = params || {};
    if (typeof rawString !== 'string') return '';
    var finalString = rawString;
    if (!rawString || placement === undefined) return finalString;
    getRegexScripts().forEach(function (script) {
      var markdownOnly = !!script.markdownOnly;
      var promptOnly = !!script.promptOnly;
      if (
        (markdownOnly && params.isMarkdown) ||
        (promptOnly && params.isPrompt) ||
        (!markdownOnly && !promptOnly && !params.isMarkdown && !params.isPrompt)
      ) {
        if ((script.placement || []).indexOf(placement) !== -1) {
          finalString = runRegexScript(script, finalString);
        }
      }
    });
    return finalString;
  }

  // ---- tavern_regex.ts:136-194（酒馆助手的格式 ↔ 酒馆原生格式）----
  function to_tavern_regex(d) {
    var p = d.placement || [];
    return {
      id: d.id,
      script_name: d.scriptName,
      enabled: !d.disabled,
      find_regex: d.findRegex,
      trim_strings: d.trimStrings || [],
      replace_string: d.replaceString,
      source: {
        user_input: p.indexOf(1) !== -1,
        ai_output: p.indexOf(2) !== -1,
        slash_command: p.indexOf(3) !== -1,
        world_info: p.indexOf(5) !== -1,
        reasoning: p.indexOf(6) !== -1,
      },
      destination: { display: !!d.markdownOnly, prompt: !!d.promptOnly },
      run_on_edit: !!d.runOnEdit,
      min_depth: typeof d.minDepth === 'number' ? d.minDepth : null,
      max_depth: typeof d.maxDepth === 'number' ? d.maxDepth : null,
    };
  }

  function from_tavern_regex(t) {
    var s = t.source || {};
    var placement = [];
    if (s.user_input) placement.push(1);
    if (s.ai_output) placement.push(2);
    if (s.slash_command) placement.push(3);
    if (s.world_info) placement.push(5);
    if (s.reasoning) placement.push(6);
    return {
      id: t.id,
      scriptName: t.script_name,
      disabled: !t.enabled,
      runOnEdit: !!t.run_on_edit,
      findRegex: t.find_regex,
      trimStrings: t.trim_strings || [],
      replaceString: t.replace_string,
      placement: placement,
      substituteRegex: 0,
      minDepth: typeof t.min_depth === 'number' ? t.min_depth : null,
      maxDepth: typeof t.max_depth === 'number' ? t.max_depth : null,
      markdownOnly: !!t.destination.display,
      promptOnly: !!t.destination.prompt,
    };
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  // tavern_regex.ts:115-134
  function get_tavern_regexes_without_clone(option) {
    option = option || {};
    var data;
    if (option.type === 'preset') data = preset_regexes;
    else if (option.type === 'character') data = scoped_regexes;
    else data = extension_settings.regex || [];
    return (data || []).map(to_tavern_regex);
  }

  // tavern_regex.ts:209-242
  function getTavernRegexes(option) {
    option = option || { type: 'global' };
    if (option.type === undefined) option.type = 'global';
    return clone(get_tavern_regexes_without_clone(option));
  }

  // tavern_regex.ts:249-258（写完会重排整个聊天 —— 自检台把次数记下来）
  function render_tavern_regexes_debounced() {
    renderTriggerCount += 1;
    var idxList = Array.prototype.map.call(document.querySelectorAll('#chat > .mes'), function (el) {
      return Number(el.getAttribute('mesid'));
    });
    idxList.forEach(function (idx) {
      renderMessage(idx);
    });
  }

  // tavern_regex.ts:260-329
  function replaceTavernRegexes(regexes, option) {
    option = option || {};
    var converted = regexes.map(from_tavern_regex);
    var type = option.type || 'global';
    if (type === 'preset') preset_regexes = converted;
    else if (type === 'character') scoped_regexes = converted;
    else extension_settings.regex = converted;
    return Promise.resolve().then(render_tavern_regexes_debounced);
  }

  // tavern_regex.ts:335-343
  function updateTavernRegexesWith(updater, option) {
    var regexes = getTavernRegexes(option);
    return Promise.resolve(updater(regexes)).then(function (next) {
      return replaceTavernRegexes(next, option).then(function () {
        return next;
      });
    });
  }

  // ---- 消息流水线：script.js:6019-6020 + scripts/reasoning.js:1291-1350 ----
  function receiveMessage(idx, rawText, presetReasoning) {
    var message = { mes: String(rawText), extra: {} };
    if (presetReasoning) {
      message.extra.reasoning = String(presetReasoning);
      message.extra.reasoning_type = 'model';
    }
    // script.js:6020 —— 收到 AI 回复、入账之前那一趟（isMarkdown / isPrompt 都为假）
    message.mes = getRegexedString(message.mes, regex_placement.AI_OUTPUT, {});
    // reasoning.js:1293-1339
    if (power_user.reasoning.auto_parse) {
      if (!message.extra.reasoning) {
        // reasoning.js:1311-1314：已经有 reasoning 就直接跳过
        var parsed = parseReasoningFromString('' + message.mes);
        if (parsed) {
          if (parsed.reasoning) {
            message.extra.reasoning = getRegexedString(parsed.reasoning, regex_placement.REASONING, {});
            message.extra.reasoning_type = 'parsed';
          }
          if (parsed.content !== message.mes) message.mes = parsed.content;
        }
      }
    }
    chat[idx] = message;
    renderMessage(idx);
    return message;
  }

  // 渲染成 ST 的 DOM 结构（.mes_reasoning_details + .mes_text）
  function renderMessage(idx) {
    var m = chat[idx];
    if (!m) return;
    var existing = document.querySelector('#chat > .mes[mesid="' + idx + '"]');
    if (existing) existing.remove();
    var mes = document.createElement('div');
    mes.className = 'mes';
    mes.setAttribute('mesid', String(idx));
    if (m.extra && m.extra.reasoning) {
      var details = document.createElement('details');
      details.className = 'mes_reasoning_details';
      details.setAttribute('data-state', 'done');
      var summary = document.createElement('summary');
      summary.className = 'mes_reasoning_summary';
      var title = document.createElement('span');
      title.className = 'mes_reasoning_header_title';
      summary.appendChild(title);
      var body = document.createElement('div');
      body.className = 'mes_reasoning';
      body.textContent = String(m.extra.reasoning);
      details.appendChild(summary);
      details.appendChild(body);
      mes.appendChild(details);
    }
    var text = document.createElement('div');
    text.className = 'mes_text';
    // messageFormatting 那一趟：isMarkdown = true（只跑勾了「仅格式显示」的正则）
    text.textContent = getRegexedString(m.mes, regex_placement.AI_OUTPUT, { isMarkdown: true });
    mes.appendChild(text);
    document.getElementById('chat').appendChild(mes);
  }

  // ---- 流式：script.js:3307-3357（onProgressStreaming，**每个 token 都跑**）
  //      + scripts/reasoning.js:407-454（#autoParseReasoningFromMessage）+ 381-398（process）----
  function makeStreamSession(idx) {
    var session = {
      idx: idx,
      state: 'none', // none | thinking | done
      isParsing: false,
      parsingStartIndex: 0,
      reasoning: '',
      tokens: 0,
      apply: function (rawText, isFinal) {
        this.tokens += 1;
        if (!chat[idx]) chat[idx] = { mes: '', extra: {} };
        var message = chat[idx];
        // script.js:3323 → cleanUpMessage → :6020（「改消息本身」的正则就在这一趟）
        var processed = getRegexedString(String(rawText), regex_placement.AI_OUTPUT, {});
        var mesChanged = message.mes !== processed;
        message.mes = processed;
        // ---- scripts/reasoning.js:407-454 ----
        if (power_user.reasoning.auto_parse && power_user.reasoning.prefix && power_user.reasoning.suffix) {
          var prefix = power_user.reasoning.prefix;
          var suffix = power_user.reasoning.suffix;
          var parseTarget = message.mes;
          if (this.parsingStartIndex) {
            message.mes = trimSpaces(parseTarget.slice(this.parsingStartIndex));
          } else {
            if (this.state === 'none') {
              if (parseTarget.indexOf(prefix) === 0 && parseTarget.length > prefix.length) {
                this.isParsing = true;
                this.state = 'thinking';
              }
            }
            if (this.isParsing) {
              this.reasoning = parseTarget.slice(prefix.length);
              message.mes = '';
              if (this.reasoning.indexOf(suffix) !== -1) {
                this.reasoning = this.reasoning.slice(0, this.reasoning.indexOf(suffix));
                this.parsingStartIndex = parseTarget.indexOf(suffix) + suffix.length;
                message.mes = trimSpaces(parseTarget.slice(this.parsingStartIndex));
                this.isParsing = false;
              }
            }
          }
        }
        // scripts/reasoning.js:388（updateReasoning persist）
        if (this.reasoning) {
          message.extra.reasoning = this.reasoning;
          message.extra.reasoning_type = 'parsed';
        }
        this.render();
        return message;
      },
      finish: function () {
        if (this.state === 'thinking') this.state = 'done';
        this.render();
      },
      render: function () {
        var message = chat[idx];
        var existing = document.querySelector('#chat > .mes[mesid="' + idx + '"]');
        if (existing) existing.remove();
        var mes = document.createElement('div');
        mes.className = 'mes';
        mes.setAttribute('mesid', String(idx));
        if (message.extra && message.extra.reasoning) {
          var details = document.createElement('details');
          details.className = 'mes_reasoning_details';
          details.setAttribute('data-state', this.state === 'thinking' ? 'thinking' : 'done');
          var summary = document.createElement('summary');
          summary.className = 'mes_reasoning_summary';
          var body = document.createElement('div');
          body.className = 'mes_reasoning';
          body.textContent = String(message.extra.reasoning);
          details.appendChild(summary);
          details.appendChild(body);
          mes.appendChild(details);
        }
        var text = document.createElement('div');
        text.className = 'mes_text';
        text.textContent = getRegexedString(message.mes, regex_placement.AI_OUTPUT, { isMarkdown: true });
        mes.appendChild(text);
        document.getElementById('chat').appendChild(mes);
      },
    };
    return session;
  }

  // ---- 酒馆助手 / ST 全局桩 ----
  window.getScriptId = function () {
    return 'sm-test';
  };
  window.errorCatched = function (fn) {
    return function () {
      return fn.apply(this, arguments);
    };
  };
  window.toastr = {
    success: function (m) { logs.push('[toastr] ' + m); },
    warning: function (m) { logs.push('[toastr:warn] ' + m); },
    error: function (m) { logs.push('[toastr:err] ' + m); },
  };
  window.$ = function (fn) {
    if (typeof fn === 'function') fn();
    return { on: function () {}, map: function () { return { get: function () { return []; } }; } };
  };
  window.SillyTavern = {
    getContext: function () {
      return {
        powerUserSettings: power_user,
        extension_settings: extension_settings,
        saveSettingsDebounced: function () { saveCount += 1; },
        parseReasoningFromString: parseReasoningFromString,
        chat: chat,
        event_types: { MESSAGE_RECEIVED: 'message_received', MESSAGE_UPDATED: 'message_updated' },
      };
    },
  };
  window.TavernHelper = {
    getTavernRegexes: getTavernRegexes,
    updateTavernRegexesWith: updateTavernRegexesWith,
  };

  window.__mirror = {
    power_user: power_user,
    extension_settings: extension_settings,
    chat: chat,
    receive: receiveMessage,
    beginStream: makeStreamSession,
    resetChat: function () {
      chat.length = 0;
      var c = document.getElementById('chat');
      if (c) c.innerHTML = '';
    },
    renderMessage: renderMessage,
    parseReasoningFromString: parseReasoningFromString,
    escapeRegex: escapeRegex,
    regexFromString: regexFromString,
    getRegexedString: getRegexedString,
    getGlobalRegexes: function () { return extension_settings.regex || []; },
    setGlobalRegexes: function (list) { extension_settings.regex = list; },
    setPresetRegexes: function (list) { preset_regexes = list; },
    setScopedRegexes: function (list) { scoped_regexes = list; },
    setReasoning: function (partial) { Object.assign(power_user.reasoning, partial); },
    stats: function () { return { saveCount: saveCount, renderTriggerCount: renderTriggerCount }; },
    logs: logs,
    // 造一条「别人的」原生格式正则
    nativeRegex: function (name, findRegex, opts) {
      opts = opts || {};
      return {
        id: 'x-' + name,
        scriptName: name,
        findRegex: findRegex,
        replaceString: opts.replaceString || '<div class="foreign">$1</div>',
        trimStrings: [],
        placement: opts.placement || [2],
        disabled: !!opts.disabled,
        markdownOnly: opts.markdownOnly !== false,
        promptOnly: !!opts.promptOnly,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      };
    },
  };
})();
