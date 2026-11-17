// 此文件由 scripts/build-client.mjs 自动生成，请修改 src/client/ 下的源码后重新构建。
(() => {
  // src/client/api.js
  var STATUS_ROUTE = "/plugins/deepseek-chat/status";
  var SYNC_ROUTE = "/plugins/deepseek-chat/sync";
  var SYNC_SNIPPET = 'copy(JSON.stringify({token:JSON.parse(localStorage.userToken).value,id:(JSON.parse(localStorage["__appKit_userInfo"]).value||{}).id}))';
  function parseCredentials(text) {
    try {
      return text.startsWith("{") ? JSON.parse(text) : { token: text };
    } catch {
      return { token: text };
    }
  }
  function formatSyncError(cause, origin) {
    return cause && (cause.name === "TypeError" || /failed to fetch/i.test(String(cause.message))) ? `Failed to fetch (${origin})` : String(cause?.message ?? cause);
  }
  function createClientApi(request) {
    let originRequest = null;
    function resolveOrigin() {
      if (originRequest) return originRequest;
      originRequest = request(STATUS_ROUTE, { headers: { accept: "application/json" }, cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))).then((payload) => {
        const url = payload && typeof payload.url === "string" ? payload.url : "";
        if (!url) throw new Error("proxy not started");
        return url.replace(/\/$/, "");
      }).catch((error) => {
        originRequest = null;
        throw error;
      });
      return originRequest;
    }
    function postCredentials(url, body) {
      return request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).then((response) => {
        if (response.ok) return response.json();
        if (response.status === 404 || response.status === 405) {
          return Promise.reject({ fallback: true });
        }
        return response.json().catch(() => ({})).then((payload) => {
          throw new Error(payload?.error ? `${response.status} ${payload.error}` : String(response.status));
        });
      });
    }
    function syncCredentials(text, origin) {
      const body = parseCredentials(text);
      return postCredentials(SYNC_ROUTE, body).catch((cause) => {
        if (cause && cause.fallback) return postCredentials(`${String(origin).replace(/\/$/, "")}/__ds/sync`, body);
        throw cause;
      });
    }
    return { resolveOrigin, syncCredentials };
  }

  // src/client/components/chat-glyph.js
  function createChatGlyph(React) {
    const h = React.createElement;
    function ChatGlyph({ size = 16 }) {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          focusable: false,
          style: { display: "block" }
        },
        h("path", { d: "M4.2 5.4h15.6v9.4H9.6l-4.2 3.4v-3.4H4.2z" }),
        h("path", { d: "M8.4 10.1h7.2" })
      );
    }
    return ChatGlyph;
  }

  // src/client/locales.js
  var NS = "deepseekChat";
  var DEFAULTS = {
    "action.open": "DeepSeek chat",
    "panel.title": "DeepSeek chat",
    "panel.subtitle": "Served by the local Host proxy · login is kept by the Host",
    "panel.reload": "Reload",
    "panel.external": "Open in browser",
    "panel.close": "Close",
    "panel.connecting": "Connecting to chat.deepseek.com…",
    "panel.unavailable": "The local proxy is not ready yet.",
    "panel.retry": "Retry",
    "panel.hint": "Sign in inside this panel once; the session is kept on the Host.",
    "panel.sync": "Import login",
    "panel.sync.title": "Import a login from the real site",
    "panel.sync.intro": "The WeChat QR only works on deepseek.com itself, so a WeChat account can sign in on the real site and hand the session over here. Credentials pass through the local Host into the proxied page and are used to authenticate requests to DeepSeek.",
    "panel.sync.step1": "1. On a tab where chat.deepseek.com is already signed in, open DevTools (F12) and switch to Console.",
    "panel.sync.step2": "2. Run this line; it copies your session credentials to the clipboard:",
    "panel.sync.step3": "3. Paste the clipboard content below, then choose “Import and reload”.",
    "panel.sync.copy": "Copy code",
    "panel.sync.copied": "Copied",
    "panel.sync.placeholder": 'Paste {"token":"…","id":…}, or just the token',
    "panel.sync.submit": "Import and reload",
    "panel.sync.busy": "Importing…",
    "panel.sync.cancel": "Cancel",
    "panel.sync.failed": "Import failed: ",
    "panel.sync.restartHint": " The new Host code is not active yet — restart the Harness (dsh web), then refresh this page.",
    "panel.sync.invalid": "No credentials found in that text."
  };
  var zh = {
    "action.open": "DeepSeek 对话",
    "panel.title": "DeepSeek 对话",
    "panel.subtitle": "由本机 Host 代理提供 · 登录状态保存在 Host",
    "panel.reload": "重新加载",
    "panel.external": "在浏览器中打开",
    "panel.close": "关闭",
    "panel.connecting": "正在连接 chat.deepseek.com…",
    "panel.unavailable": "本机代理尚未就绪。",
    "panel.retry": "重试",
    "panel.hint": "在本面板内登录一次即可，会话会保存在 Host 上。",
    "panel.sync": "同步登录态",
    "panel.sync.title": "从正式站点同步登录态",
    "panel.sync.intro": "微信扫码只能在 deepseek.com 域名下完成，所以用微信登录的账号可以先在正式站点登录，再把会话交给这个面板。凭据会经过本机 Host 传入代理页面，并用于向 DeepSeek 发送请求时的身份验证。",
    "panel.sync.step1": "1. 在已登录 chat.deepseek.com 的标签页按 F12，切换到 Console。",
    "panel.sync.step2": "2. 粘贴并运行下面这一行，它会把登录凭据复制到剪贴板：",
    "panel.sync.step3": "3. 把剪贴板内容粘贴到下面，然后点“同步并刷新”。",
    "panel.sync.copy": "复制代码",
    "panel.sync.copied": "已复制",
    "panel.sync.placeholder": '粘贴 {"token":"…","id":…}，或直接粘贴 token',
    "panel.sync.submit": "同步并刷新",
    "panel.sync.busy": "正在同步…",
    "panel.sync.cancel": "取消",
    "panel.sync.failed": "同步失败：",
    "panel.sync.restartHint": "新的 Host 端代码还没生效，请重启 Harness（dsh web）后刷新本页面。",
    "panel.sync.invalid": "没有识别出登录凭据。"
  };
  var en = { ...DEFAULTS };
  function translate(t, key, params) {
    if (typeof t === "function") {
      try {
        const text = t(key, params);
        if (typeof text === "string" && text !== "") return text;
      } catch {
      }
    }
    return DEFAULTS[key] ?? key;
  }

  // src/client/components/chat-panel.js
  function createChatPanel(React, { state, useOpen, api, ChatGlyph, SyncDialog }) {
    const h = React.createElement;
    function ChatPanel(props) {
      const visible = useOpen();
      const t = props.t;
      const [origin, setOrigin] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [reloadKey, setReloadKey] = React.useState(0);
      const [wasOpened, setWasOpened] = React.useState(false);
      const [syncOpen, setSyncOpen] = React.useState(false);
      React.useEffect(() => {
        if (visible) setWasOpened(true);
      }, [visible]);
      const attempt = React.useCallback(() => {
        setFailure(null);
        api.resolveOrigin().then((value) => {
          setOrigin(value);
          setReloadKey((key) => key + 1);
        }).catch(() => setFailure(true));
      }, []);
      React.useEffect(() => {
        if (!visible || origin) return;
        attempt();
      }, [visible, origin, attempt]);
      React.useEffect(() => {
        if (!visible) return void 0;
        const onKeyDown = (event) => {
          if (event.key === "Escape") state.setOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [visible]);
      if (!wasOpened) return null;
      const source = origin ? `${origin}/` : null;
      return h(
        "div",
        {
          className: "dsh-deepseek-chat-backdrop",
          style: visible ? void 0 : { display: "none" },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) state.setOpen(false);
          }
        },
        h(
          "section",
          {
            className: "dsh-deepseek-chat-card",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": translate(t, "panel.title")
          },
          h(
            "header",
            { className: "dsh-deepseek-chat-head" },
            h(ChatGlyph, { size: 16 }),
            h(
              "div",
              { className: "dsh-deepseek-chat-heading" },
              h("span", { className: "dsh-deepseek-chat-title" }, translate(t, "panel.title")),
              h("span", { className: "dsh-deepseek-chat-sub" }, source ?? translate(t, "panel.connecting"))
            ),
            h("span", { className: "dsh-deepseek-chat-spacer" }),
            source ? h(
              "button",
              {
                type: "button",
                className: "dsh-deepseek-chat-btn",
                onClick: () => window.open(source, "_blank", "noopener,noreferrer")
              },
              translate(t, "panel.external")
            ) : null,
            source ? h(
              "button",
              {
                type: "button",
                className: "dsh-deepseek-chat-btn",
                onClick: () => setReloadKey((key) => key + 1)
              },
              translate(t, "panel.reload")
            ) : null,
            source ? h(
              "button",
              {
                type: "button",
                className: "dsh-deepseek-chat-btn",
                onClick: () => setSyncOpen(true)
              },
              translate(t, "panel.sync")
            ) : null,
            h(
              "button",
              {
                type: "button",
                className: "dsh-deepseek-chat-btn",
                onClick: () => state.setOpen(false)
              },
              translate(t, "panel.close")
            )
          ),
          h(
            "div",
            { className: "dsh-deepseek-chat-body" },
            source ? h("iframe", {
              key: `${source}#${reloadKey}`,
              className: "dsh-deepseek-chat-frame",
              src: source,
              title: translate(t, "panel.title"),
              sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals",
              allow: "clipboard-read; clipboard-write",
              referrerPolicy: "no-referrer"
            }) : h(
              "div",
              { className: "dsh-deepseek-chat-empty" },
              h("span", null, failure ? translate(t, "panel.unavailable") : translate(t, "panel.connecting")),
              failure ? h(
                "button",
                { type: "button", className: "dsh-deepseek-chat-btn", onClick: attempt },
                translate(t, "panel.retry")
              ) : null,
              failure ? h("span", { className: "dsh-deepseek-chat-hint" }, translate(t, "panel.hint")) : null
            ),
            syncOpen && source ? h(SyncDialog, {
              t,
              origin: source,
              onClose: () => setSyncOpen(false),
              onApplied: () => {
                setSyncOpen(false);
                setReloadKey((key) => key + 1);
              }
            }) : null
          )
        )
      );
    }
    return ChatPanel;
  }

  // src/client/components/footer-action.js
  function createFooterAction(React, { state, useOpen, ChatGlyph }) {
    const h = React.createElement;
    function FooterAction(props) {
      const visible = useOpen();
      const label = translate(props.t, "action.open");
      const wide = props.wide === true;
      return h(
        "button",
        {
          type: "button",
          className: `dsh-deepseek-chat-trigger ${wide ? "dsh-deepseek-chat-trigger--wide" : "dsh-deepseek-chat-trigger--rail"}`,
          "data-active": visible ? "true" : "false",
          title: label,
          "aria-label": label,
          "aria-pressed": visible ? "true" : "false",
          onClick: () => state.setOpen(!state.getOpen())
        },
        h(ChatGlyph, { size: wide ? 16 : 18 }),
        wide ? h("span", { className: "dsh-deepseek-chat-trigger-label" }, label) : null
      );
    }
    return FooterAction;
  }

  // src/client/components/sync-dialog.js
  function createSyncDialog(React, api) {
    const h = React.createElement;
    function SyncDialog({ t, origin, onClose, onApplied }) {
      const [text, setText] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [copied, setCopied] = React.useState(false);
      const [error, setError] = React.useState(null);
      const submit = React.useCallback(() => {
        const value = text.trim();
        if (!value || busy) return;
        setBusy(true);
        setError(null);
        api.syncCredentials(value, origin).then(() => onApplied()).catch((cause) => {
          setBusy(false);
          setError(formatSyncError(cause, origin));
        });
      }, [text, busy, origin, onApplied]);
      const copy = React.useCallback(() => {
        try {
          void navigator.clipboard.writeText(SYNC_SNIPPET).then(() => setCopied(true)).catch(() => setCopied(false));
        } catch {
          setCopied(false);
        }
      }, []);
      return h(
        "div",
        { className: "dsh-deepseek-chat-sync" },
        h(
          "div",
          {
            className: "dsh-deepseek-chat-sync-card",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": translate(t, "panel.sync.title")
          },
          h("div", { className: "dsh-deepseek-chat-sync-title" }, translate(t, "panel.sync.title")),
          h("p", { className: "dsh-deepseek-chat-sync-line" }, translate(t, "panel.sync.intro")),
          h("p", { className: "dsh-deepseek-chat-sync-line" }, translate(t, "panel.sync.step1")),
          h("p", { className: "dsh-deepseek-chat-sync-line" }, translate(t, "panel.sync.step2")),
          h(
            "div",
            { className: "dsh-deepseek-chat-sync-code" },
            h("code", null, SYNC_SNIPPET),
            h(
              "button",
              { type: "button", className: "dsh-deepseek-chat-btn", onClick: copy },
              translate(t, copied ? "panel.sync.copied" : "panel.sync.copy")
            )
          ),
          h("p", { className: "dsh-deepseek-chat-sync-line" }, translate(t, "panel.sync.step3")),
          h("textarea", {
            className: "dsh-deepseek-chat-sync-input",
            value: text,
            spellCheck: false,
            placeholder: translate(t, "panel.sync.placeholder"),
            onChange: (event) => setText(event.target.value)
          }),
          error ? h(
            "p",
            { className: "dsh-deepseek-chat-sync-error" },
            translate(t, "panel.sync.failed") + error + (/40[134]/.test(error) || /failed to fetch/i.test(error) ? translate(t, "panel.sync.restartHint") : "")
          ) : null,
          h(
            "div",
            { className: "dsh-deepseek-chat-sync-actions" },
            h(
              "button",
              { type: "button", className: "dsh-deepseek-chat-btn", onClick: onClose, disabled: busy },
              translate(t, "panel.sync.cancel")
            ),
            h(
              "button",
              {
                type: "button",
                className: "dsh-deepseek-chat-btn dsh-deepseek-chat-btn--primary",
                onClick: submit,
                disabled: busy || text.trim() === ""
              },
              translate(t, busy ? "panel.sync.busy" : "panel.sync.submit")
            )
          )
        )
      );
    }
    return SyncDialog;
  }

  // src/client/state.js
  function createPanelState() {
    let open = false;
    const listeners = /* @__PURE__ */ new Set();
    function getOpen() {
      return open;
    }
    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    function setOpen(next) {
      if (open === next) return;
      open = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
        }
      }
    }
    return { getOpen, setOpen, subscribe };
  }
  function createUseOpen(React, state) {
    function useOpen() {
      const [visible, setVisible] = React.useState(state.getOpen());
      React.useEffect(() => state.subscribe(() => setVisible(state.getOpen())), []);
      return visible;
    }
    return useOpen;
  }

  // src/client/styles.js
  var STYLES = `
.dsh-deepseek-chat-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.dsh-deepseek-chat-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-trigger[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-brand-primary); }
.dsh-deepseek-chat-trigger--rail { width: 28px; height: 28px; padding: 0; }
.dsh-deepseek-chat-trigger--wide { width: 100%; min-height: 28px; padding: 4px 8px; justify-content: flex-start; font-size: 13px; }
.dsh-deepseek-chat-trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-deepseek-chat-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.35)); pointer-events: auto; }
.dsh-deepseek-chat-card { display: flex; flex-direction: column; width: min(1180px, 96vw); height: min(860px, 90vh); overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32); }
.dsh-deepseek-chat-head { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-heading { display: flex; flex-direction: column; min-width: 0; }
.dsh-deepseek-chat-title { font-size: 13px; font-weight: 600; line-height: 1.3; }
.dsh-deepseek-chat-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.3; color: var(--dsw-alias-label-tertiary); }
.dsh-deepseek-chat-spacer { flex: 1; }
.dsh-deepseek-chat-btn { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-deepseek-chat-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-body { position: relative; flex: 1; min-height: 0; background: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #ffffff; }
.dsh-deepseek-chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; padding: 24px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-deepseek-chat-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-deepseek-chat-btn--primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-deepseek-chat-sync { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.45)); }
.dsh-deepseek-chat-sync-card { display: flex; flex-direction: column; gap: 8px; width: min(560px, 100%); max-height: 100%; overflow: auto; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; }
.dsh-deepseek-chat-sync-title { font-size: 13px; font-weight: 600; }
.dsh-deepseek-chat-sync-line { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-deepseek-chat-sync-code { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-sync-code code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-sync-input { min-height: 84px; resize: vertical; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.dsh-deepseek-chat-sync-error { margin: 0; color: var(--dsw-alias-danger-primary, #d24b4b); }
.dsh-deepseek-chat-sync-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;
  function installStyles(pageDocument) {
    const style = pageDocument.createElement("style");
    style.setAttribute("data-plugin", "dsh-deepseek-chat-panel");
    style.textContent = STYLES;
    pageDocument.head.appendChild(style);
    return () => style.remove();
  }

  // src/client/plugin.js
  function createPlugin(React) {
    const state = createPanelState();
    const useOpen = createUseOpen(React, state);
    const api = createClientApi((...args) => fetch(...args));
    const ChatGlyph = createChatGlyph(React);
    const SyncDialog = createSyncDialog(React, api);
    const FooterAction = createFooterAction(React, { state, useOpen, ChatGlyph });
    const ChatPanel = createChatPanel(React, { state, useOpen, api, ChatGlyph, SyncDialog });
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-chat: dictionaries");
      ctx.effect(() => installStyles(document), "deepseek-chat: styles");
      ctx.slots.inject(
        "sidebar.footer.action",
        () => ctx.slots.register({ name: "sidebar.footer.action", id: "deepseek-chat", locale: NS, order: 10 }, FooterAction)
      );
      ctx.slots.inject(
        "shell.overlay",
        () => ctx.slots.register({ name: "shell.overlay", id: "deepseek-chat-panel", locale: NS, order: 40 }, ChatPanel)
      );
    }
    return { inject: ["slots", "locale"], apply };
  }

  // src/client/index.js
  function factory(require2) {
    return createPlugin(require2("react"));
  }
  window.__ModuleLoader__.load({
    id: "dsh-deepseek-chat-panel",
    factory
  });
})();
