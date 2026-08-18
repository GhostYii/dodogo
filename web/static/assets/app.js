"use strict";
(() => {
  // ts/theme.ts
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("dodogo-theme", t);
    } catch {
    }
  }
  function initTheme() {
    const t = currentTheme();
    if (t !== "dark" && t !== "light") applyTheme("light");
  }
  function toggleTheme() {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  }

  // ts/api.ts
  function csrfToken() {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.content : "";
  }
  var ApiError = class extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  };
  function errMsg(e) {
    if (e instanceof ApiError) return e.message;
    if (e instanceof Error) return e.message;
    return String(e);
  }
  async function api(path, opts = {}) {
    const method = (opts.method ?? (opts.form || opts.body !== void 0 ? "POST" : "GET")).toUpperCase();
    const headers = {};
    let body;
    if (opts.form) {
      body = opts.form;
    } else if (opts.body !== void 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const t = csrfToken();
      if (t) headers["X-CSRF-Token"] = t;
    }
    const res = await fetch("/api" + path, {
      method,
      headers,
      body,
      credentials: "same-origin"
    });
    if (res.status === 401) {
      const page = document.body.dataset.page;
      if (page !== "login" && page !== "register" && page !== "setup") {
        location.href = "/login";
      }
      throw new ApiError(10002, "\u672A\u767B\u5F55\u6216\u4F1A\u8BDD\u5DF2\u5931\u6548", 401);
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch {
    }
    if (!res.ok || !payload || payload.code !== 0) {
      throw new ApiError(payload?.code ?? -1, payload?.message || `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`, res.status);
    }
    return payload.data;
  }

  // ts/util.ts
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === void 0 || v === null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style") node.setAttribute("style", v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }
  function isTyping(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }
  function addPasswordToggles(root) {
    root.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.closest(".pwd-wrap")) return;
      const wrap = el("div", { class: "pwd-wrap" });
      input.parentNode?.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = el("button", { class: "pwd-toggle", type: "button", title: "\u663E\u793A\u5BC6\u7801", "aria-label": "\u663E\u793A\u5BC6\u7801" });
      btn.textContent = "\u{1F441}";
      btn.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "\u{1F648}" : "\u{1F441}";
        btn.title = show ? "\u9690\u85CF\u5BC6\u7801" : "\u663E\u793A\u5BC6\u7801";
      });
      wrap.appendChild(btn);
    });
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 10);
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const diff = Date.now() - t;
    const m = Math.floor(diff / 6e4);
    if (m < 1) return "\u521A\u521A";
    if (m < 60) return `${m} \u5206\u949F\u524D`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} \u5C0F\u65F6\u524D`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days} \u5929\u524D`;
    return fmtDate(iso);
  }
  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function initialsOf(name) {
    const t = (name || "?").trim();
    const chars = Array.from(t);
    return (chars[0] || "?") + (chars[1] || "");
  }
  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return `rgba(59,130,246,${alpha})`;
    const n = parseInt(m[1], 16);
    const r = n >> 16 & 255;
    const g = n >> 8 & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function avatar(user, size = "sm") {
    const name = (user?.displayName || user?.username || "?").trim();
    const id = user?.id ?? user?.userId;
    if (user?.avatarPath && id != null) {
      const img = el("img", { class: `avatar avatar-${size}`, alt: name });
      img.src = `/api/avatars/${id}`;
      return img;
    }
    return el("span", { class: `avatar avatar-${size} avatar-initial`, text: initialsOf(name) });
  }
  function priorityText(p) {
    switch (p) {
      case "p0":
        return "\u7D27\u6025";
      case "p1":
        return "\u9AD8";
      case "p2":
        return "\u4E2D";
      case "p3":
        return "\u4F4E";
      default:
        return "\u4E2D";
    }
  }
  function formField(label, control, hint = "") {
    const wrap = el("div", { class: "field" });
    wrap.append(el("label", { text: label }));
    wrap.append(control);
    if (hint) wrap.append(el("div", { class: "field-hint muted", text: hint }));
    return wrap;
  }
  function selectBox(options, current, attrs = {}) {
    const sel = el("select", { class: "select", ...attrs });
    for (const o of options) {
      const opt = el("option", { value: o.value, text: o.text });
      if (o.value === current) opt.selected = true;
      sel.append(opt);
    }
    return sel;
  }

  // ts/toast.ts
  var container = null;
  function toast(message, kind = "info", timeout = 3200) {
    if (!container) {
      container = qs("#toasts") ?? document.body.appendChild(el("div", { id: "toasts", class: "toasts" }));
    }
    const t = el("div", { class: `toast toast-${kind}` });
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 260);
    }, timeout);
  }

  // ts/modal.ts
  var modalStack = [];
  function openModal(opts) {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" });
    if (opts.width) modal.style.maxWidth = opts.width;
    const head = el("div", { class: "modal-head" });
    head.append(el("h3", { class: "modal-title", text: opts.title || "" }));
    const closeBtn = el("button", { class: "modal-close", type: "button", "aria-label": "\u5173\u95ED" });
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", () => closeModal());
    head.append(closeBtn);
    modal.append(head);
    const body = el("div", { class: "modal-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else body.append(opts.body);
    modal.append(body);
    if (opts.footer) {
      const foot = el("div", { class: "modal-foot" });
      foot.append(typeof opts.footer === "string" ? opts.footer : opts.footer);
      modal.append(foot);
    }
    backdrop.append(modal);
    document.body.append(backdrop);
    modalStack.push(backdrop);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) closeModal();
    });
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener("keydown", onKey, true);
    modal.__onClose = opts.onClose;
    modal.__removeKey = () => document.removeEventListener("keydown", onKey, true);
    return modal;
  }
  function closeModal(runCallback = true) {
    const backdrop = modalStack.pop();
    if (!backdrop) return;
    const modal = backdrop.querySelector(".modal");
    if (modal) {
      const m = modal;
      m.__removeKey?.();
      if (runCallback) m.__onClose?.();
    }
    backdrop.remove();
  }
  function confirmDialog(message, opts = {}) {
    return new Promise((resolve) => {
      const body = el("p", { class: "confirm-text", text: message });
      const foot = el("div", { class: "modal-actions" });
      const cancel = el("button", { class: "btn btn-ghost", type: "button", text: "\u53D6\u6D88" });
      const ok = el("button", { class: `btn ${opts.danger ? "btn-danger" : "btn-primary"}`, type: "button", text: opts.okText || "\u786E\u5B9A" });
      cancel.addEventListener("click", () => {
        closeModal();
        resolve(false);
      });
      ok.addEventListener("click", () => {
        closeModal();
        resolve(true);
      });
      foot.append(cancel, ok);
      openModal({ title: opts.title || "\u786E\u8BA4\u64CD\u4F5C", body, footer: foot, width: "420px" });
      ok.focus();
    });
  }
  function promptDialog(title, placeholder = "", value = "") {
    return new Promise((resolve) => {
      const input = el("input", { class: "input", type: "text", placeholder });
      input.value = value;
      const body = el("div");
      body.append(input);
      const foot = el("div", { class: "modal-actions" });
      const cancel = el("button", { class: "btn btn-ghost", type: "button", text: "\u53D6\u6D88" });
      const ok = el("button", { class: "btn btn-primary", type: "button", text: "\u786E\u5B9A" });
      cancel.addEventListener("click", () => {
        closeModal();
        resolve(null);
      });
      ok.addEventListener("click", () => {
        closeModal();
        resolve(input.value.trim() || null);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") ok.click();
      });
      foot.append(cancel, ok);
      openModal({ title, body, footer: foot, width: "420px" });
      input.focus();
    });
  }

  // ts/topbar.ts
  function initTopbar() {
    qs("#theme-toggle")?.addEventListener("click", toggleTheme);
    void loadVersion();
    const chip = qs("#user-chip");
    const menu = qs("#user-menu");
    if (chip && menu) {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      document.addEventListener("click", () => {
        menu.hidden = true;
      });
      qsa("[data-action]", menu).forEach((btn) => {
        btn.addEventListener("click", () => {
          menu.hidden = true;
          void handleUserAction(btn.dataset.action || "");
        });
      });
    }
    const gs = qs("#global-search");
    gs?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = gs.value.trim();
        if (v) location.href = "/search?q=" + encodeURIComponent(v);
      }
    });
    void refreshUnread();
    initUnreadSse();
    initShortcuts();
  }
  async function loadVersion() {
    try {
      const d = await api("/system/status");
      const v = qs("#brand-version");
      if (v && d.version) {
        v.textContent = "v" + d.version;
        v.hidden = false;
      }
    } catch {
    }
  }
  async function handleUserAction(action) {
    if (action === "logout") {
      try {
        await api("/auth/logout", { method: "POST" });
      } catch {
      }
      location.href = "/login";
    } else if (action === "profile") {
      await openProfileModal();
    }
  }
  async function openProfileModal() {
    let me;
    try {
      me = await api("/auth/me");
    } catch {
      return;
    }
    const body = el("div", { class: "profile-form" });
    const avatarRow = el("div", { class: "profile-avatar-row" });
    avatarRow.append(avatar(me, "lg"));
    const fileInput = el("input", { type: "file", accept: "image/*", hidden: "true" });
    const avatarBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u66F4\u6362\u5934\u50CF" });
    avatarBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      try {
        await api("/auth/avatar", { method: "POST", form: fd });
        toast("\u5934\u50CF\u5DF2\u66F4\u65B0", "success");
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    avatarRow.append(avatarBtn, fileInput);
    body.append(avatarRow);
    const nameInput = el("input", { class: "input", type: "text", maxlength: "60" });
    nameInput.value = me.displayName || "";
    body.append(formField("\u6635\u79F0", nameInput));
    const emailInput = el("input", { class: "input", type: "email" });
    emailInput.value = me.email || "";
    body.append(formField("\u90AE\u7BB1", emailInput));
    body.append(el("div", { class: "section-divider" }));
    const oldPwd = el("input", { class: "input", type: "password", placeholder: "\u65E7\u5BC6\u7801" });
    const newPwd = el("input", { class: "input", type: "password", placeholder: "\u65B0\u5BC6\u7801\uFF088-64 \u4F4D\uFF0C\u542B\u5B57\u6BCD\u6570\u5B57\uFF09" });
    const newPwd2 = el("input", { class: "input", type: "password", placeholder: "\u786E\u8BA4\u65B0\u5BC6\u7801" });
    body.append(formField("\u65E7\u5BC6\u7801", oldPwd));
    body.append(formField("\u65B0\u5BC6\u7801", newPwd));
    body.append(formField("\u786E\u8BA4\u65B0\u5BC6\u7801", newPwd2));
    addPasswordToggles(body);
    const foot = el("div", { class: "modal-actions" });
    const save = el("button", { class: "btn btn-primary", type: "button", text: "\u4FDD\u5B58" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await api("/auth/me", {
          method: "PATCH",
          body: { display_name: nameInput.value.trim() || me.username, email: emailInput.value.trim() || null }
        });
        const oldP = oldPwd.value;
        const newP = newPwd.value;
        if (oldP || newP) {
          if (newP !== newPwd2.value) {
            toast("\u4E24\u6B21\u8F93\u5165\u7684\u65B0\u5BC6\u7801\u4E0D\u4E00\u81F4", "error");
            save.disabled = false;
            return;
          }
          await api("/auth/password", { method: "PUT", body: { old_password: oldP, new_password: newP } });
        }
        toast("\u5DF2\u4FDD\u5B58", "success");
        location.reload();
      } catch (e) {
        toast(errMsg(e), "error");
        save.disabled = false;
      }
    });
    foot.append(save);
    openModal({ title: "\u4E2A\u4EBA\u8BBE\u7F6E", body, footer: foot, width: "480px" });
  }
  async function refreshUnread() {
    try {
      const d = await api("/notifications/unread-count");
      const badge = qs("#unread-badge");
      if (!badge) return;
      const n = d.count || 0;
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? "99+" : String(n);
    } catch {
    }
  }
  function initUnreadSse() {
    const es = new EventSource("/api/stream");
    es.addEventListener("notification.new", (ev) => {
      void refreshUnread();
      try {
        const d = JSON.parse(ev.data);
        window.dispatchEvent(new CustomEvent("dodogo:notify", { detail: d }));
      } catch {
      }
    });
    es.onerror = () => {
    };
    setInterval(() => void refreshUnread(), 12e4);
  }
  function showHelp() {
    const rows = [
      ["/", "\u805A\u7126\u5168\u5C40\u641C\u7D22"],
      ["Esc", "\u5173\u95ED\u5F39\u7A97 / \u83DC\u5355"],
      ["Shift + ?", "\u663E\u793A\u672C\u5E2E\u52A9"],
      ["Ctrl + Enter", "\u8BC4\u8BBA\u6846\u4E2D\u63D0\u4EA4\u8BC4\u8BBA"]
    ];
    const body = el("div", { class: "help-list" });
    for (const [k, d] of rows) {
      const row = el("div", { class: "help-row" });
      row.append(el("code", { class: "kbd", text: k }), el("span", { text: d }));
      body.append(row);
    }
    openModal({ title: "\u952E\u76D8\u5FEB\u6377\u952E", body });
  }
  function initShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (isTyping(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        const s = qs("#global-search");
        if (s) {
          s.focus();
          s.select();
        }
      } else if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        showHelp();
      }
    });
  }

  // ts/auth.ts
  function initAuth() {
    const form = qs("#auth-form");
    const page = document.body.dataset.page;
    if (!form || page !== "login" && page !== "register" && page !== "setup") return;
    addPasswordToggles(form);
    const errorEl = qs("#auth-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.hidden = true;
      const fd = new FormData(form);
      const username = String(fd.get("username") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const displayName = String(fd.get("displayName") || "").trim();
      const password = String(fd.get("password") || "");
      const confirm = String(fd.get("confirm") || "");
      const submitBtn = form.querySelector("button[type=submit]");
      const label = submitBtn?.textContent || "\u63D0\u4EA4";
      if (page !== "login") {
        if (password !== confirm) {
          showError(errorEl, "\u4E24\u6B21\u8F93\u5165\u7684\u5BC6\u7801\u4E0D\u4E00\u81F4");
          return;
        }
        if (password.length < 8 || password.length > 64) {
          showError(errorEl, "\u5BC6\u7801\u957F\u5EA6\u9700\u4E3A 8-64 \u5B57\u7B26");
          return;
        }
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
          showError(errorEl, "\u5BC6\u7801\u9700\u540C\u65F6\u5305\u542B\u5B57\u6BCD\u4E0E\u6570\u5B57");
          return;
        }
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "\u8BF7\u7A0D\u5019\u2026";
      }
      try {
        if (page === "login") {
          await api("/auth/login", {
            method: "POST",
            body: {
              identity: String(fd.get("identity") || "").trim(),
              password,
              remember: fd.get("remember") === "on"
            }
          });
          location.href = "/";
        } else {
          await api("/auth/register", {
            method: "POST",
            body: {
              username,
              email: email || void 0,
              display_name: displayName || void 0,
              password
            }
          });
          await api("/auth/login", { method: "POST", body: { identity: username, password, remember: true } });
          toast("\u8D26\u53F7\u521B\u5EFA\u6210\u529F", "success");
          setTimeout(() => {
            location.href = "/";
          }, 350);
        }
      } catch (err) {
        showError(errorEl, errMsg(err));
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = label;
        }
      }
    });
  }
  function showError(errorEl, msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      toast(msg, "error");
    }
  }

  // ts/markdown.ts
  async function mdToHtml(text) {
    try {
      const d = await api("/markdown/preview", { body: { text } });
      return d.html || '<p class="muted">\uFF08\u7A7A\uFF09</p>';
    } catch {
      return '<p class="muted">\u9884\u89C8\u5931\u8D25</p>';
    }
  }

  // ts/card-modal.ts
  var currentCardId = null;
  var detail = null;
  var projectKey = "";
  var labels = [];
  var members = [];
  var milestones = [];
  var versions = [];
  var currentUserId = 0;
  function getOpenCardId() {
    return currentCardId;
  }
  function notifyCardChanged() {
    window.dispatchEvent(new CustomEvent("dodogo:card-changed", { detail: { cardId: currentCardId } }));
  }
  async function openCardDetail(cardId) {
    closeModal(false);
    currentCardId = cardId;
    const body = el("div", { class: "card-detail" });
    body.innerHTML = '<div class="loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    openModal({
      title: "\u5361\u7247\u8BE6\u60C5",
      body,
      width: "880px",
      onClose: () => {
        currentCardId = null;
        detail = null;
      }
    });
    try {
      const d = await api("/cards/" + cardId);
      detail = d;
      await loadMeta(d);
      renderDetail(body, d);
    } catch (e) {
      body.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }
  async function refreshOpenCard() {
    if (currentCardId == null) return;
    const body = qs(".card-detail");
    if (!body) return;
    try {
      const d = await api("/cards/" + currentCardId);
      detail = d;
      await loadMeta(d);
      renderDetail(body, d);
    } catch {
    }
  }
  async function loadMeta(d) {
    try {
      const me = await api("/auth/me");
      currentUserId = me.id;
    } catch {
      currentUserId = 0;
    }
    const idx = (d.number || "").lastIndexOf("-");
    projectKey = idx > 0 ? d.number.slice(0, idx) : "";
    if (!projectKey) return;
    const [ls, ms, vs, mb] = await Promise.all([
      api(`/projects/${projectKey}/labels`).catch(() => []),
      api(`/projects/${projectKey}/milestones`).catch(() => []),
      api(`/projects/${projectKey}/releases`).catch(() => []),
      api(`/projects/${projectKey}/members`).catch(() => [])
    ]);
    labels = ls;
    milestones = ms;
    versions = vs;
    members = mb.map((m) => ({ id: m.userId, username: m.username, displayName: m.displayName, avatarPath: m.avatarPath }));
  }
  function renderDetail(body, d) {
    body.innerHTML = "";
    const header = el("div", { class: "cd-header" });
    header.append(el("span", { class: "cd-number muted", text: d.number }));
    header.append(priorityBadge(d.priority, "md"));
    const statusTxt = d.status === "archived" ? "\uFF08\u5DF2\u5F52\u6863\uFF09" : "";
    if (statusTxt) header.append(el("span", { class: "tag", style: "background:rgba(245,158,11,.15);color:var(--warning)", text: statusTxt }));
    header.append(el("span", { class: "muted cd-updated", text: "\u66F4\u65B0\u4E8E " + fmtDateTime(d.updatedAt) }));
    const titleInput = el("input", { class: "cd-title-input", type: "text", placeholder: "\u5361\u7247\u6807\u9898" });
    titleInput.value = d.title;
    titleInput.addEventListener("change", () => {
      const v = titleInput.value.trim();
      if (v && v !== d.title) {
        titleInput.disabled = true;
        void patchCard({ title: v }).then(() => {
          d.title = v;
        }).finally(() => {
          titleInput.disabled = false;
        });
      } else {
        titleInput.value = d.title;
      }
    });
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") titleInput.blur();
    });
    const main = el("div", { class: "cd-main" });
    main.append(titleInput, buildDescription(d), buildChecklists(d), buildComments(d), buildAttachments(d), buildGit(d), buildActivity(d));
    const grid = el("div", { class: "cd-grid" });
    grid.append(main, buildSidebar(d));
    body.append(header, grid);
  }
  async function patchCard(p) {
    await api(`/cards/${currentCardId}`, { method: "PATCH", body: p });
    notifyCardChanged();
    await refreshOpenCard();
  }
  async function setLabels(labelIds) {
    await api(`/cards/${currentCardId}/labels`, { method: "PUT", body: { label_ids: labelIds } });
    notifyCardChanged();
    await refreshOpenCard();
  }
  function buildDescription(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: "\u63CF\u8FF0" }));
    const view = el("div", { class: "cd-desc-view markdown-body" });
    view.innerHTML = d.descriptionHtml || '<p class="muted">\u6682\u65E0\u63CF\u8FF0\uFF0C\u70B9\u51FB\u7F16\u8F91\u6DFB\u52A0\u3002</p>';
    view.addEventListener("click", () => showEditor());
    const editor = el("div", { class: "cd-desc-editor", hidden: "true" });
    const mirror = el("div", { class: "md-editor" });
    const mirrorPreview = el("div", { class: "markdown-body md-editor-preview" });
    mirrorPreview.innerHTML = d.descriptionHtml || "";
    const ta = el("textarea", { class: "md-editor-input", placeholder: "\u652F\u6301 Markdown\u2026" });
    ta.value = d.description || "";
    const renderPreview = debounce(async (md) => {
      mirrorPreview.innerHTML = md.trim() ? await mdToHtml(md) : "";
      mirrorPreview.scrollTop = ta.scrollTop;
    }, 200);
    ta.addEventListener("input", () => void renderPreview(ta.value));
    ta.addEventListener("scroll", () => {
      mirrorPreview.scrollTop = ta.scrollTop;
    });
    mirror.append(mirrorPreview, ta);
    const actions = el("div", { class: "modal-actions" });
    const save = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "\u4FDD\u5B58" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u53D6\u6D88" });
    function showEditor() {
      view.hidden = true;
      editor.hidden = false;
      ta.focus();
    }
    function hideEditor() {
      view.hidden = false;
      editor.hidden = true;
    }
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const v = ta.value;
        await patchCard({ description: v });
        d.description = v;
        view.innerHTML = await mdToHtml(v);
        hideEditor();
        toast("\u63CF\u8FF0\u5DF2\u4FDD\u5B58", "success");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      save.disabled = false;
    });
    cancel.addEventListener("click", hideEditor);
    actions.append(save, cancel);
    editor.append(mirror, actions);
    sec.append(view, editor);
    return sec;
  }
  function buildSidebar(d) {
    const aside = el("aside", { class: "cd-sidebar" });
    const assigneeOpts = members.map((m) => ({ value: String(m.id), text: m.displayName || m.username }));
    const assigneeSel = selectBox(assigneeOpts, d.assignee ? String(d.assignee.id) : "");
    if (!d.assignee) {
      assigneeSel.prepend(el("option", { value: "", text: "\u672A\u6307\u6D3E\uFF08\u6682\u4E0D\u53EF\u6E05\u9664\uFF09", disabled: "true", selected: "true" }));
    }
    assigneeSel.addEventListener("change", () => {
      if (!assigneeSel.value) return;
      void patchCard({ assignee_id: Number(assigneeSel.value) });
    });
    aside.append(formField("\u6307\u6D3E\u4EBA", assigneeSel));
    const prioSel = selectBox(
      ["p0", "p1", "p2", "p3"].map((p) => ({ value: p, text: `${p.toUpperCase()} \xB7 ${priorityText(p)}` })),
      d.priority
    );
    prioSel.addEventListener("change", () => void patchCard({ priority: prioSel.value }));
    aside.append(formField("\u4F18\u5148\u7EA7", prioSel));
    const labelWrap = el("div", { class: "label-picker" });
    const picked = new Set(d.labels.map((l) => l.id));
    for (const l of labels) {
      const row = el("label", { class: "check-row check-row-sm" });
      const cb = el("input", { type: "checkbox" });
      cb.checked = picked.has(l.id);
      const dot = el("span", { class: "label-dot", style: `background:${l.color}` });
      cb.addEventListener("change", () => {
        if (cb.checked) picked.add(l.id);
        else picked.delete(l.id);
        void setLabels(Array.from(picked));
      });
      row.append(cb, dot, el("span", { text: l.name }));
      labelWrap.append(row);
    }
    const newLabelBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ \u65B0\u5EFA\u6807\u7B7E" });
    newLabelBtn.addEventListener("click", async () => {
      const name = await promptDialog("\u65B0\u5EFA\u6807\u7B7E", "\u6807\u7B7E\u540D\u79F0");
      if (!name) return;
      const colors = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899"];
      const color = colors[Math.floor(Math.random() * colors.length)];
      try {
        const r = await api(`/projects/${projectKey}/labels`, { method: "POST", body: { name, color } });
        labels.push({ id: r.id, name, color });
        picked.add(r.id);
        await setLabels(Array.from(picked));
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    labelWrap.append(newLabelBtn);
    aside.append(formField("\u6807\u7B7E", labelWrap));
    const startInput = el("input", { class: "input", type: "date" });
    startInput.value = d.startDate ? fmtDate(d.startDate) : "";
    startInput.addEventListener("change", () => void patchCard({ start_date: startInput.value || null }));
    aside.append(formField("\u5F00\u59CB\u65E5\u671F", startInput));
    const dueInput = el("input", { class: "input", type: "date" });
    dueInput.value = d.dueDate ? fmtDate(d.dueDate) : "";
    dueInput.addEventListener("change", () => void patchCard({ due_date: dueInput.value || null }));
    aside.append(formField("\u622A\u6B62\u65E5\u671F", dueInput));
    const estInput = el("input", { class: "input", type: "number", min: "0", step: "0.5" });
    estInput.value = d.estimateHours != null ? String(d.estimateHours) : "";
    estInput.addEventListener("change", () => {
      const v = estInput.value;
      void patchCard({ estimate_hours: v === "" ? null : Number(v) });
    });
    aside.append(formField("\u4F30\u7B97\u5DE5\u65F6\uFF08\u5C0F\u65F6\uFF09", estInput));
    const msOpts = [{ value: "", text: "\u4E0D\u5173\u8054" }, ...milestones.map((m) => ({ value: String(m.id), text: m.name }))];
    const msSel = selectBox(msOpts, d.milestone ? String(d.milestone.id) : "");
    msSel.addEventListener("change", () => void patchCard({ milestone_id: msSel.value ? Number(msSel.value) : null }));
    aside.append(formField("\u91CC\u7A0B\u7891", msSel));
    const vOpts = [{ value: "", text: "\u4E0D\u5173\u8054" }, ...versions.map((v) => ({ value: String(v.id), text: v.name }))];
    const vSel = selectBox(vOpts, d.version ? String(d.version.id) : "");
    vSel.addEventListener("change", () => void patchCard({ version_id: vSel.value ? Number(vSel.value) : null }));
    aside.append(formField("\u7248\u672C", vSel));
    const ops = el("div", { class: "cd-ops" });
    const copyBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u590D\u5236\u5361\u7247" });
    copyBtn.addEventListener("click", async () => {
      try {
        await api(`/cards/${d.id}/copy`, { method: "POST" });
        toast("\u5DF2\u590D\u5236", "success");
        notifyCardChanged();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    const archiveBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: d.status === "archived" ? "\u6062\u590D\u5361\u7247" : "\u5F52\u6863\u5361\u7247" });
    archiveBtn.addEventListener("click", async () => {
      if (d.status !== "archived" && !await confirmDialog("\u5F52\u6863\u8BE5\u5361\u7247\uFF1F\u5F52\u6863\u540E\u770B\u677F\u4E2D\u4E0D\u518D\u663E\u793A\u3002", { danger: true })) return;
      try {
        await api(`/cards/${d.id}/archive`, { method: "POST" });
        toast("\u5DF2\u5F52\u6863", "success");
        closeModal();
        notifyCardChanged();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    const delBtn = el("button", { class: "btn btn-danger btn-sm", type: "button", text: "\u5220\u9664\u5361\u7247" });
    delBtn.addEventListener("click", async () => {
      if (!await confirmDialog("\u5220\u9664\u540E\u4E0D\u53EF\u6062\u590D\uFF0C\u786E\u5B9A\u5220\u9664\u8BE5\u5361\u7247\uFF1F", { danger: true, okText: "\u5220\u9664" })) return;
      try {
        await api(`/cards/${d.id}`, { method: "DELETE" });
        toast("\u5DF2\u5220\u9664", "success");
        closeModal();
        notifyCardChanged();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    ops.append(copyBtn, archiveBtn, delBtn);
    aside.append(formField("\u64CD\u4F5C", ops));
    return aside;
  }
  function buildChecklists(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: "\u6E05\u5355" }));
    const total = d.checklists.reduce((s, cl) => s + cl.items.length, 0);
    const done = d.checklists.reduce((s, cl) => s + cl.items.filter((i) => i.done).length, 0);
    const pct = total ? Math.round(done / total * 100) : 0;
    const bar = el("div", { class: "progress" });
    bar.append(el("div", { class: "progress-fill", style: `width:${pct}%` }));
    const barRow = el("div", { class: "checklist-progress" });
    barRow.append(bar, el("span", { class: "muted", text: `${done}/${total}` }));
    sec.append(barRow);
    for (const cl of d.checklists) {
      const clEl = el("div", { class: "checklist" });
      const clHead = el("div", { class: "checklist-head" });
      clHead.append(el("span", { class: "checklist-title", text: cl.title }));
      const delCl = el("button", { class: "btn-icon", type: "button", text: "\u2715", title: "\u5220\u9664\u6E05\u5355" });
      delCl.addEventListener("click", async () => {
        if (!await confirmDialog("\u5220\u9664\u8BE5\u6E05\u5355\uFF1F", { danger: true })) return;
        try {
          await api(`/checklists/${cl.id}`, { method: "DELETE" });
          notifyCardChanged();
          await refreshOpenCard();
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
      clHead.append(delCl);
      clEl.append(clHead);
      const items = el("div", { class: "checklist-items" });
      for (const item of cl.items) {
        const row = el("label", { class: "checklist-item" + (item.done ? " done" : "") });
        const cb = el("input", { type: "checkbox" });
        cb.checked = item.done;
        cb.addEventListener("change", async () => {
          row.classList.toggle("done", cb.checked);
          try {
            await api(`/checklist-items/${item.id}`, { method: "PATCH", body: { done: cb.checked } });
            notifyCardChanged();
            await refreshOpenCard();
          } catch (e) {
            cb.checked = !cb.checked;
            row.classList.toggle("done", cb.checked);
            toast(errMsg(e), "error");
          }
        });
        const label = el("span", { text: item.title });
        const del = el("button", { class: "btn-icon", type: "button", text: "\u2715", title: "\u5220\u9664\u6761\u76EE" });
        del.addEventListener("click", async () => {
          try {
            await api(`/checklist-items/${item.id}`, { method: "DELETE" });
            notifyCardChanged();
            await refreshOpenCard();
          } catch (e) {
            toast(errMsg(e), "error");
          }
        });
        row.append(cb, label, del);
        items.append(row);
      }
      clEl.append(items);
      clEl.append(buildAddChecklistItem(cl.id));
      sec.append(clEl);
    }
    const addBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ \u6DFB\u52A0\u6E05\u5355" });
    addBtn.addEventListener("click", async () => {
      const t = await promptDialog("\u65B0\u5EFA\u6E05\u5355", "\u6E05\u5355\u6807\u9898");
      if (!t) return;
      try {
        await api(`/cards/${currentCardId}/checklists`, { method: "POST", body: { title: t } });
        notifyCardChanged();
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    sec.append(addBtn);
    return sec;
  }
  function buildAddChecklistItem(clId) {
    const wrap = el("div", { class: "add-inline" });
    const input = el("input", { class: "input input-sm", type: "text", placeholder: "\u6DFB\u52A0\u6761\u76EE\uFF0C\u56DE\u8F66\u786E\u8BA4" });
    async function add() {
      const v = input.value.trim();
      if (!v) return;
      input.disabled = true;
      try {
        await api(`/checklists/${clId}/items`, { method: "POST", body: { title: v } });
        input.value = "";
        notifyCardChanged();
        await refreshOpenCard();
        input.disabled = false;
        input.focus();
      } catch (e) {
        toast(errMsg(e), "error");
        input.disabled = false;
      }
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void add();
    });
    wrap.append(input);
    return wrap;
  }
  function buildComments(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: `\u8BC4\u8BBA\uFF08${d.comments.length}\uFF09` }));
    const list = el("div", { class: "comment-list" });
    for (const c of d.comments) list.append(buildCommentRow(c));
    sec.append(list);
    const editor = el("div", { class: "comment-editor" });
    const ta = el("textarea", { class: "input", rows: "3", placeholder: "\u8F93\u5165\u8BC4\u8BBA\uFF0C\u652F\u6301 Markdown\uFF1B\u53EF\u76F4\u63A5\u7C98\u8D34\u56FE\u7247\u4E0A\u4F20" });
    ta.addEventListener("paste", async (e) => {
      const files = e.clipboardData?.files;
      if (!files || !files.length) return;
      if (!Array.from(files).some((f) => f.type.startsWith("image/"))) return;
      e.preventDefault();
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        try {
          const fd = new FormData();
          fd.append("file", f);
          const a = await api(`/cards/${currentCardId}/attachments`, { method: "POST", form: fd });
          ta.value += (ta.value ? "\n" : "") + `![${a.fileName}](/api/attachments/${a.id}/download)`;
          toast("\u56FE\u7247\u5DF2\u4E0A\u4F20\u5E76\u63D2\u5165\u8BC4\u8BBA", "success");
        } catch (err) {
          toast(errMsg(err), "error");
        }
      }
    });
    const hint = el("div", { class: "muted field-hint", text: "Ctrl+Enter \u63D0\u4EA4" });
    const submit = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "\u8BC4\u8BBA" });
    async function post() {
      const v = ta.value.trim();
      if (!v) return;
      submit.disabled = true;
      try {
        await api(`/cards/${currentCardId}/comments`, { method: "POST", body: { content: v } });
        ta.value = "";
        notifyCardChanged();
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), "error");
      }
      submit.disabled = false;
    }
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void post();
    });
    submit.addEventListener("click", () => void post());
    const actions = el("div", { class: "modal-actions" });
    actions.append(submit);
    editor.append(ta, hint, actions);
    sec.append(editor);
    return sec;
  }
  function buildCommentRow(c) {
    const row = el("div", { class: "comment" });
    row.append(avatar({ id: c.userId, avatarPath: c.avatarPath, displayName: c.displayName, username: c.username }, "sm"));
    const main = el("div", { class: "comment-main" });
    const head = el("div", { class: "comment-head" });
    head.append(el("span", { class: "comment-author", text: c.displayName || c.username }));
    head.append(el("span", { class: "muted", text: timeAgo(c.createdAt) }));
    main.append(head);
    const content = el("div", { class: "markdown-body" });
    content.innerHTML = c.contentHtml;
    main.append(content);
    row.append(main);
    return row;
  }
  function buildAttachments(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: `\u9644\u4EF6\uFF08${d.attachments.length}\uFF09` }));
    const list = el("div", { class: "attach-list" });
    for (const a of d.attachments) {
      const row = el("div", { class: "attach-row" });
      const link = el("a", { class: "attach-name", href: `/api/attachments/${a.id}/download`, text: a.fileName });
      const del = el("button", { class: "btn-icon", type: "button", text: "\u2715", title: "\u5220\u9664\u9644\u4EF6" });
      del.addEventListener("click", async () => {
        if (!await confirmDialog("\u5220\u9664\u8BE5\u9644\u4EF6\uFF1F", { danger: true })) return;
        try {
          await api(`/attachments/${a.id}`, { method: "DELETE" });
          notifyCardChanged();
          await refreshOpenCard();
        } catch (e) {
          toast(errMsg(e), "error");
        }
      });
      row.append(link, el("span", { class: "muted", text: fmtSize(a.fileSize) }), el("span", { class: "muted", text: a.uploaderName + " \xB7 " + timeAgo(a.createdAt) }), del);
      list.append(row);
    }
    sec.append(list);
    const up = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ \u4E0A\u4F20\u9644\u4EF6" });
    const fileInput = el("input", { type: "file", hidden: "true" });
    up.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const fd = new FormData();
        fd.append("file", f);
        await api(`/cards/${currentCardId}/attachments`, { method: "POST", form: fd });
        toast("\u4E0A\u4F20\u6210\u529F", "success");
        notifyCardChanged();
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), "error");
      }
      fileInput.value = "";
    });
    sec.append(up);
    return sec;
  }
  function buildGit(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: "Git \u5173\u8054" }));
    const list = el("div", { class: "git-list" });
    if (!d.gitCommits.length) {
      list.append(el("p", { class: "muted", text: "\u6682\u65E0\u5173\u8054\u63D0\u4EA4\uFF08\u53EF\u901A\u8FC7 GitLab \u540C\u6B65\u5173\u8054\uFF09" }));
    }
    for (const g of d.gitCommits) {
      const row = el("div", { class: "git-row" });
      const sha = el("a", { class: "git-sha", href: g.commitUrl || "#", target: "_blank", rel: "noopener", text: g.shortSha });
      row.append(sha, el("span", { class: "git-msg", text: g.message }));
      row.append(el("span", { class: "muted", text: g.authorName + " \xB7 " + (g.committedAt ? timeAgo(g.committedAt) : "") }));
      if (g.mrUrl) row.append(el("a", { class: "git-mr", href: g.mrUrl, target: "_blank", rel: "noopener", text: "MR" }));
      list.append(row);
    }
    sec.append(list);
    return sec;
  }
  var ACTION_LABELS = {
    created: "\u521B\u5EFA\u4E86",
    updated: "\u66F4\u65B0\u4E86",
    moved: "\u79FB\u52A8\u4E86",
    commented: "\u8BC4\u8BBA\u4E86",
    archived: "\u5F52\u6863\u4E86",
    restored: "\u6062\u590D\u4E86"
  };
  function buildActivity(d) {
    const sec = el("section", { class: "cd-section" });
    sec.append(el("h4", { class: "cd-section-title", text: "\u6D3B\u52A8" }));
    const list = el("div", { class: "activity-list" });
    if (!d.activities.length) list.append(el("p", { class: "muted", text: "\u6682\u65E0\u6D3B\u52A8\u8BB0\u5F55" }));
    for (const a of d.activities) {
      const row = el("div", { class: "activity-row" });
      row.append(avatar({ id: a.userId ?? void 0, avatarPath: null, displayName: a.displayName, username: a.username }, "xs"));
      const who = a.displayName || a.username || "\u7CFB\u7EDF";
      const verb = ACTION_LABELS[a.action] || a.action;
      row.append(el("span", { class: "activity-who", text: who }), el("span", { class: "activity-detail", text: `${verb} ${a.detail || ""}`.trim() }));
      row.append(el("span", { class: "muted", text: timeAgo(a.createdAt) }));
      list.append(row);
    }
    sec.append(list);
    return sec;
  }
  function priorityBadge(p, size = "sm") {
    return el("span", { class: `prio prio-${p} prio-${size}`, text: priorityText(p) });
  }

  // ts/home.ts
  var ICON_COLORS = ["#3B82F6", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4", "#8B5CF6", "#EC4899"];
  function initHome() {
    qs("#btn-new-project")?.addEventListener("click", openNewProjectModal);
    void loadMyTasks();
    window.addEventListener("dodogo:notify", (e) => {
      const d = e.detail;
      if (d?.type === "assigned" || d?.type === "moved") {
        if (taskRefreshTimer) clearTimeout(taskRefreshTimer);
        taskRefreshTimer = setTimeout(() => void loadMyTasks(), 800);
      }
    });
    window.addEventListener("dodogo:card-changed", () => {
      if (taskRefreshTimer) clearTimeout(taskRefreshTimer);
      taskRefreshTimer = setTimeout(() => void loadMyTasks(), 500);
    });
  }
  var taskRefreshTimer;
  function openNewProjectModal() {
    const body = el("div", { class: "form-stack" });
    const keyInput = el("input", { class: "input", type: "text", placeholder: "\u5982 DODG\uFF082-6 \u4F4D\u5927\u5199\u5B57\u6BCD/\u6570\u5B57\uFF09", maxlength: "6" });
    body.append(formField("\u9879\u76EE Key", keyInput));
    const nameInput = el("input", { class: "input", type: "text", placeholder: "\u5982 DoDoGo \u9879\u76EE\u7BA1\u7406", maxlength: "60" });
    body.append(formField("\u9879\u76EE\u540D\u79F0", nameInput));
    const descInput = el("textarea", { class: "input", rows: "3", placeholder: "\u4E00\u53E5\u8BDD\u63CF\u8FF0\u9879\u76EE\uFF08\u53EF\u9009\uFF09" });
    body.append(formField("\u9879\u76EE\u63CF\u8FF0", descInput));
    let selected = ICON_COLORS[0];
    let iconMode = "text";
    let iconFile = null;
    let previewUrl = "";
    let iconTextTouched = false;
    const iconTextInput = el("input", { class: "input", type: "text", placeholder: "\u7559\u7A7A\u9ED8\u8BA4\u53D6\u9879\u76EE\u540D\u524D\u4E24\u5B57", maxlength: "2" });
    const colorWrap = el("div", { class: "color-swatches" });
    for (const c of ICON_COLORS) {
      const sw = el("button", { class: "swatch" + (c === selected ? " active" : ""), type: "button", style: `background:${c}` });
      sw.addEventListener("click", () => {
        selected = c;
        qsa(".swatch", colorWrap).forEach((s) => s.classList.remove("active"));
        sw.classList.add("active");
        updatePreview();
      });
      colorWrap.append(sw);
    }
    const preview = el("div", { class: "icon-preview project-icon project-icon-lg", role: "button", "aria-label": "\u70B9\u51FB\u4E0A\u4F20\u56FE\u7247", title: "\u70B9\u51FB\u4E0A\u4F20\u56FE\u7247" });
    const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: "true" });
    const clearImg = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u79FB\u9664\u56FE\u7247\uFF0C\u5207\u56DE\u8272\u5757" });
    clearImg.hidden = true;
    function currentIconText() {
      const t = (iconTextInput.value.trim() || initialsOf(nameInput.value)).trim();
      return Array.from(t).slice(0, 2).join("") || "?";
    }
    function updatePreview() {
      preview.innerHTML = "";
      preview.style.background = selected;
      if (iconMode === "image" && previewUrl) {
        const img = el("img", { class: "project-icon-img", alt: "\u9879\u76EE\u56FE\u6807\u9884\u89C8" });
        img.src = previewUrl;
        preview.append(img);
        preview.title = "\u70B9\u51FB\u66F4\u6362\u56FE\u7247";
      } else {
        preview.append(el("span", { text: currentIconText() }));
        preview.title = "\u70B9\u51FB\u4E0A\u4F20\u56FE\u7247";
      }
    }
    nameInput.addEventListener("input", () => {
      if (!iconTextTouched) {
        const nm = nameInput.value.trim();
        iconTextInput.value = nm ? initialsOf(nm) : "";
      }
      updatePreview();
    });
    iconTextInput.addEventListener("input", () => {
      iconTextTouched = true;
      updatePreview();
    });
    preview.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      iconFile = f;
      iconMode = "image";
      previewUrl = URL.createObjectURL(f);
      clearImg.hidden = false;
      updatePreview();
      fileInput.value = "";
    });
    clearImg.addEventListener("click", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = "";
      iconFile = null;
      iconMode = "text";
      clearImg.hidden = true;
      updatePreview();
    });
    updatePreview();
    const iconControls = el("div", { class: "icon-controls" });
    iconControls.append(formField("\u56FE\u6807\u989C\u8272", colorWrap), formField("\u56FE\u6807\u6587\u5B57\uFF081-2 \u5B57\uFF09", iconTextInput), clearImg);
    const iconRow = el("div", { class: "icon-row" });
    iconRow.append(preview, iconControls);
    body.append(formField("\u56FE\u6807", iconRow, "\u70B9\u51FB\u9884\u89C8\u6846\u4E0A\u4F20\u56FE\u7247\uFF1B\u6587\u5B57\u7559\u7A7A\u9ED8\u8BA4\u53D6\u9879\u76EE\u540D\u524D\u4E24\u5B57"));
    const tplSelect = el("select", { class: "select" });
    const tpls = [
      ["", "\u6807\u51C6\uFF08\u5F85\u529E / \u5DF2\u5B8C\u6210\uFF09"],
      ["dev", "\u5F00\u53D1\u6D41\u7A0B\uFF08\u9700\u6C42 / \u5F00\u53D1 / \u6D4B\u8BD5 / \u53D1\u5E03\uFF09"],
      ["todo", "\u4EFB\u52A1\u6E05\u5355\uFF08\u5F85\u529E / \u8FDB\u884C\u4E2D / \u5DF2\u5B8C\u6210\uFF09"]
    ];
    for (const [v, t] of tpls) tplSelect.append(el("option", { value: v, text: t }));
    body.append(formField("\u770B\u677F\u6A21\u677F", tplSelect));
    const foot = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn btn-ghost", type: "button", text: "\u53D6\u6D88" });
    const ok = el("button", { class: "btn btn-primary", type: "button", text: "\u521B\u5EFA" });
    cancel.addEventListener("click", () => closeModal());
    ok.addEventListener("click", async () => {
      const k = keyInput.value.trim().toUpperCase();
      const n = nameInput.value.trim();
      if (!/^[A-Z0-9]{2,6}$/.test(k)) {
        toast("Key \u9700\u4E3A 2-6 \u4F4D\u5927\u5199\u5B57\u6BCD\u6216\u6570\u5B57", "error");
        return;
      }
      if (!n) {
        toast("\u8BF7\u8F93\u5165\u9879\u76EE\u540D\u79F0", "error");
        return;
      }
      ok.disabled = true;
      try {
        const proj = await api("/projects", {
          method: "POST",
          body: {
            key: k,
            name: n,
            description: descInput.value.trim(),
            icon_color: selected,
            icon_text: currentIconText(),
            template: tplSelect.value
          }
        });
        if (iconMode === "image" && iconFile) {
          const fd = new FormData();
          fd.append("file", iconFile);
          await api(`/projects/${proj.key}/icon`, { method: "POST", form: fd });
        }
        location.href = `/p/${proj.key}`;
      } catch (e) {
        toast(errMsg(e), "error");
        ok.disabled = false;
      }
    });
    foot.append(cancel, ok);
    openModal({ title: "\u65B0\u5EFA\u9879\u76EE", body, footer: foot, width: "480px" });
    keyInput.focus();
  }
  async function loadMyTasks() {
    const uid = Number(document.body.dataset.uid || 0);
    const box = qs("#my-tasks");
    const countEl = qs("#my-tasks-count");
    if (!box) return;
    box.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    try {
      const projects = await api("/projects");
      const tasks = [];
      for (const p of projects) {
        const boards = await api(`/projects/${p.key}/boards`);
        for (const b of boards) {
          const full = await api(`/boards/${b.id}`);
          for (const c of full.cards) {
            if (c.assignee && c.assignee.id === uid) {
              const col = full.columns.find((x) => x.id === c.columnId);
              tasks.push({ ...c, projectKey: p.key, projectName: p.name, columnName: col?.name });
            }
          }
        }
      }
      tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      renderMyTasks(box, tasks.slice(0, 20));
      if (countEl) countEl.textContent = tasks.length ? `\u5171 ${tasks.length} \u6761` : "";
    } catch {
      box.innerHTML = '<div class="empty">\u52A0\u8F7D\u5931\u8D25</div>';
    }
  }
  function renderMyTasks(box, tasks) {
    if (!tasks.length) {
      box.innerHTML = '<div class="empty">\u6682\u65E0\u6307\u6D3E\u7ED9\u4F60\u7684\u4EFB\u52A1</div>';
      return;
    }
    box.innerHTML = "";
    for (const t of tasks) {
      const row = el("div", { class: "task-row" });
      const icon = el("span", { class: "project-icon project-icon-sm", style: "background:#3B82F6", text: initialsOf(t.projectKey) });
      row.append(icon);
      const main = el("div", { class: "task-main" });
      main.append(el("span", { class: "task-title", text: t.title }));
      main.append(el("span", { class: "muted task-sub", text: `${t.number} \xB7 ${t.projectName}${t.columnName ? " \xB7 " + t.columnName : ""}` }));
      row.append(main);
      row.append(priorityBadge(t.priority));
      if (t.dueDate) row.append(el("span", { class: "card-due" + (t.dueDate < (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) ? " overdue" : ""), text: fmtDate(t.dueDate) }));
      row.append(el("span", { class: "muted", text: timeAgo(t.updatedAt) }));
      row.addEventListener("click", () => void openCardDetail(t.id));
      box.append(row);
    }
  }

  // ts/board.ts
  var boardEl = qs("#board");
  var boardId = Number(boardEl?.dataset.boardId || 0);
  var projectKey2 = boardEl?.dataset.projectKey || "";
  var COLUMN_COLORS = ["#3B82F6", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4", "#8B5CF6", "#EC4899"];
  var data = null;
  var filterQ = "";
  var filterAssignee = "";
  var filterLabel = "";
  var filterPriority = "";
  var dragCardId = null;
  var dragColId = null;
  var justDragged = false;
  var refreshTimer = null;
  function initBoard() {
    if (!boardEl || !boardId) return;
    qs("#board-select")?.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v) location.href = `/p/${projectKey2}/board/${v}`;
    });
    qs("#btn-new-board")?.addEventListener("click", async () => {
      const name = await promptDialog("\u65B0\u5EFA\u770B\u677F", "\u770B\u677F\u540D\u79F0");
      if (!name) return;
      try {
        const b = await api(`/projects/${projectKey2}/boards`, { method: "POST", body: { name } });
        location.href = `/p/${projectKey2}/board/${b.id}`;
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    const qInput = qs("#filter-q");
    qInput?.addEventListener("input", debounce(() => {
      filterQ = qInput.value.trim();
      rerender();
    }, 200));
    qs("#filter-assignee")?.addEventListener("change", (e) => {
      filterAssignee = e.target.value;
      rerender();
    });
    qs("#filter-label")?.addEventListener("change", (e) => {
      filterLabel = e.target.value;
      rerender();
    });
    qs("#filter-priority")?.addEventListener("change", (e) => {
      filterPriority = e.target.value;
      rerender();
    });
    qs("#btn-filter-reset")?.addEventListener("click", () => {
      filterQ = "";
      filterAssignee = "";
      filterLabel = "";
      filterPriority = "";
      if (qInput) qInput.value = "";
      qsa("#filter-assignee, #filter-label, #filter-priority").forEach((s) => s.value = "");
      rerender();
    });
    void load();
    initSse();
    document.addEventListener("pointerdown", (e) => {
      const t = e.target;
      qsa(".col-color-pop").forEach((p) => {
        if (p.hidden) return;
        if (p.contains(t)) return;
        if (t.closest(".col-color-btn")) return;
        p.hidden = true;
      });
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") qsa(".col-color-pop").forEach((p) => p.hidden = true);
    });
    window.addEventListener("dodogo:card-changed", () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void load(), 250);
    });
  }
  async function load() {
    try {
      data = await api(`/boards/${boardId}`);
      render();
      refreshFilterOptions();
    } catch (e) {
      boardEl.innerHTML = `<div class="empty">\u52A0\u8F7D\u770B\u677F\u5931\u8D25\uFF1A${esc(errMsg(e))}</div>`;
    }
  }
  function rerender() {
    if (!data) return;
    render();
  }
  function render() {
    if (!data) return;
    const columns = [...data.columns].sort((a, b) => a.position - b.position);
    boardEl.innerHTML = "";
    for (const col of columns) boardEl.append(buildColumn(col));
    boardEl.append(buildAddColumn());
  }
  function buildColumn(col) {
    const colEl = el("div", { class: "board-col", "data-col": String(col.id) });
    const cards = data.cards.filter((c) => c.columnId === col.id).sort((a, b) => a.position - b.position);
    const head = el("div", { class: "col-head" });
    head.draggable = true;
    const nameSpan = el("span", { class: "col-name", text: col.name });
    nameSpan.title = "\u70B9\u51FB\u6539\u540D\uFF0C\u53EF\u62D6\u62FD\u6392\u5E8F";
    head.append(nameSpan);
    const countEl = el("span", { class: "col-count", text: String(cards.length) });
    if (col.wipLimit > 0) {
      countEl.textContent = `${cards.length} / ${col.wipLimit}`;
      countEl.title = `WIP \u4E0A\u9650 ${col.wipLimit}`;
      if (cards.length > col.wipLimit) {
        countEl.classList.add("col-count-over");
        countEl.title = `\u5DF2\u8D85\u8FC7 WIP \u4E0A\u9650 ${col.wipLimit}`;
      }
    }
    head.append(countEl);
    const colActions = el("span", { class: "col-actions" });
    const colorBtn = el("button", { class: "btn-icon col-color-btn", type: "button", title: "\u5217\u989C\u8272" });
    colorBtn.textContent = "\u{1F3A8}";
    const colorPop = el("div", { class: "col-color-pop", hidden: "true" });
    for (const c of COLUMN_COLORS) {
      const sw = el("button", {
        class: "swatch" + (c === (col.color || COLUMN_COLORS[0]) ? " active" : ""),
        type: "button",
        style: `background:${c}`
      });
      sw.addEventListener("click", () => void applyColumnColor(col, c, colorPop));
      colorPop.append(sw);
    }
    const custom = el("input", { type: "color", title: "\u81EA\u5B9A\u4E49\u989C\u8272" });
    custom.value = /^#[0-9a-fA-F]{6}$/.test(col.color || "") ? col.color : COLUMN_COLORS[0];
    custom.addEventListener("input", () => {
      colEl.style.background = hexToRgba(custom.value, 0.06);
      head.style.background = hexToRgba(custom.value, 0.16);
    });
    custom.addEventListener("change", () => void applyColumnColor(col, custom.value, colorPop));
    colorPop.append(custom);
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willShow = colorPop.hidden;
      qsa(".col-color-pop").forEach((p) => p.hidden = true);
      colorPop.hidden = !willShow;
    });
    const delBtn = el("button", { class: "btn-icon", type: "button", text: "\u2715", title: "\u5220\u9664\u5217" });
    delBtn.addEventListener("click", async () => {
      if (!await confirmDialog(`\u5220\u9664\u5217\u300C${col.name}\u300D\uFF1F\uFF08\u5217\u5185\u4E0D\u80FD\u6709\u5361\u7247\uFF09`, { danger: true })) return;
      try {
        await api(`/columns/${col.id}`, { method: "DELETE" });
        await load();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    colActions.append(colorBtn, delBtn);
    head.append(colActions, colorPop);
    if (col.color) {
      colEl.style.background = hexToRgba(col.color, 0.06);
      head.style.background = hexToRgba(col.color, 0.16);
    }
    nameSpan.addEventListener("click", () => startColumnRename(head, nameSpan, col));
    setupColumnDrag(head, col);
    const body = el("div", { class: "col-cards", "data-col-body": String(col.id) });
    for (const card of cards) {
      const node = buildCard(card);
      if (!matchFilters(card)) node.classList.add("filtered-out");
      body.append(node);
    }
    setupDropZone(body, col.id);
    const foot = el("div", { class: "col-foot" });
    foot.append(buildAddCard(col.id));
    colEl.append(head, body, foot);
    return colEl;
  }
  function startColumnRename(head, nameSpan, col) {
    const input = el("input", { class: "input input-sm col-name-input", type: "text", maxlength: "30" });
    input.value = col.name;
    head.replaceChild(input, nameSpan);
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (!commit || !v || v === col.name) {
        if (!input.isConnected) return;
        head.replaceChild(nameSpan, input);
        return;
      }
      try {
        await patchColumn(col, { name: v });
        toast("\u5217\u540D\u5DF2\u66F4\u65B0", "success");
      } catch (e) {
        toast(errMsg(e), "error");
        if (input.isConnected) head.replaceChild(nameSpan, input);
      }
    };
    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void finish(true);
      } else if (e.key === "Escape") {
        void finish(false);
      }
    });
  }
  async function applyColumnColor(col, color, pop) {
    pop.hidden = true;
    try {
      await patchColumn(col, { color });
      toast("\u5217\u989C\u8272\u5DF2\u66F4\u65B0", "success");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  async function patchColumn(col, patch) {
    await api(`/columns/${col.id}`, {
      method: "PATCH",
      body: {
        name: patch.name ?? col.name,
        color: patch.color ?? col.color,
        wip_limit: patch.wipLimit ?? col.wipLimit,
        is_done: patch.isDone ?? col.isDone
      }
    });
    await load();
  }
  function setupColumnDrag(head, col) {
    head.addEventListener("dragstart", (e) => {
      const t = e.target;
      if (t.closest("button, input, .col-color-pop")) {
        e.preventDefault();
        return;
      }
      dragColId = col.id;
      head.classList.add("col-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(col.id));
      }
    });
    head.addEventListener("dragend", () => {
      dragColId = null;
      qsa(".col-head.col-dragging").forEach((h) => h.classList.remove("col-dragging"));
      clearColumnIndicators();
    });
    head.addEventListener("dragover", (e) => {
      if (dragColId == null || dragColId === col.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearColumnIndicators();
      const r = head.getBoundingClientRect();
      head.classList.add(e.clientX < r.left + r.width / 2 ? "col-drop-before" : "col-drop-after");
    });
    head.addEventListener("dragleave", () => {
      head.classList.remove("col-drop-before", "col-drop-after");
    });
    head.addEventListener("drop", (e) => {
      if (dragColId == null || dragColId === col.id) return;
      e.preventDefault();
      const before = head.classList.contains("col-drop-before");
      clearColumnIndicators();
      const cols = [...data.columns].sort((a, b) => a.position - b.position);
      const targetIdx = cols.findIndex((c) => c.id === col.id);
      const position = before ? targetIdx : targetIdx + 1;
      void moveColumn(dragColId, position);
    });
  }
  function clearColumnIndicators() {
    qsa(".col-head.col-drop-before, .col-head.col-drop-after").forEach((h) => h.classList.remove("col-drop-before", "col-drop-after"));
  }
  async function moveColumn(columnId, targetIndex) {
    if (!data) return;
    const cols = [...data.columns].sort((a, b) => a.position - b.position);
    const idx = cols.findIndex((c) => c.id === columnId);
    if (idx < 0) return;
    const [moved] = cols.splice(idx, 1);
    const insert = Math.max(0, Math.min(targetIndex, cols.length));
    cols.splice(insert, 0, moved);
    cols.forEach((c, i) => {
      c.position = i;
    });
    data.columns = cols;
    render();
    try {
      await api(`/columns/${columnId}/move`, { method: "POST", body: { position: insert } });
      await load();
    } catch (e) {
      await load();
      toast(errMsg(e), "error");
    }
  }
  function buildCard(card) {
    const node = el("div", { class: "card", draggable: "true", "data-card": String(card.id) });
    const cardLabels = data.labels.filter((l) => card.labelIds.includes(l.id));
    if (card.coverUrl) {
      const cover = el("div", { class: "card-cover" });
      const img = el("img", { class: "card-cover-img", alt: "", loading: "lazy" });
      img.src = card.coverUrl;
      cover.append(img);
      node.append(cover);
    }
    const top = el("div", { class: "card-top" });
    top.append(el("span", { class: "card-no muted", text: card.number }), priorityBadge(card.priority));
    const title = el("div", { class: "card-title", text: card.title });
    const chips = el("div", { class: "card-chips" });
    if (card.milestoneName) chips.append(el("span", { class: "chip chip-milestone", text: "\u25C6 " + card.milestoneName }));
    if (card.versionName) chips.append(el("span", { class: "chip chip-version", text: "\u{1F3F7} " + card.versionName }));
    const meta = el("div", { class: "card-meta" });
    const left = el("div", { class: "card-labels" });
    for (const l of cardLabels) {
      left.append(el("span", { class: "tag", style: `background:${hexToRgba(l.color, 0.16)};color:${l.color}`, text: l.name }));
    }
    const right = el("div", { class: "card-meta-right" });
    if (card.checklistTotal > 0) {
      right.append(el("span", { class: "muted card-checklist", text: `\u2611 ${card.checklistDone}/${card.checklistTotal}` }));
    }
    if (card.dueDate) {
      const overdue = card.dueDate < (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      right.append(el("span", { class: "card-due" + (overdue ? " overdue" : ""), text: fmtDate(card.dueDate) }));
    }
    if (card.assignee) {
      right.append(avatar(card.assignee, "sm"));
    }
    meta.append(left, right);
    if (chips.children.length) node.append(top, title, chips, meta);
    else node.append(top, title, meta);
    node.addEventListener("click", (e) => {
      if (justDragged) return;
      if (e.target.closest("button, a, select, input")) return;
      void openCardDetail(card.id);
    });
    node.addEventListener("dragstart", (e) => {
      dragCardId = card.id;
      justDragged = true;
      node.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", String(card.id));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    node.addEventListener("dragend", () => {
      dragCardId = null;
      setTimeout(() => {
        justDragged = false;
      }, 60);
      qsa(".card.dragging").forEach((c) => c.classList.remove("dragging"));
      qsa(".drop-before, .drop-after, .drop-empty").forEach((c) => c.classList.remove("drop-before", "drop-after", "drop-empty"));
    });
    return node;
  }
  function buildAddCard(colId) {
    const wrap = el("div", { class: "add-card" });
    const btn = el("button", { class: "add-card-btn", type: "button", text: "+ \u6DFB\u52A0\u5361\u7247" });
    const form = el("div", { class: "add-card-form", hidden: "true" });
    const input = el("input", { class: "input input-sm", type: "text", placeholder: "\u5361\u7247\u6807\u9898\uFF0C\u56DE\u8F66\u8FDE\u7EED\u521B\u5EFA" });
    const actions = el("div", { class: "add-card-actions" });
    const ok = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "\u6DFB\u52A0" });
    const cancel = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u53D6\u6D88" });
    function show() {
      btn.hidden = true;
      form.hidden = false;
      input.focus();
    }
    function hide() {
      btn.hidden = false;
      form.hidden = true;
      input.value = "";
    }
    async function create() {
      const title = input.value.trim();
      if (!title) {
        hide();
        return;
      }
      ok.disabled = true;
      try {
        await api(`/columns/${colId}/cards`, { method: "POST", body: { title } });
        input.value = "";
        ok.disabled = false;
        await load();
        input.focus();
      } catch (e) {
        toast(errMsg(e), "error");
        ok.disabled = false;
      }
    }
    btn.addEventListener("click", show);
    cancel.addEventListener("click", hide);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void create();
      else if (e.key === "Escape") hide();
    });
    ok.addEventListener("click", () => void create());
    actions.append(ok, cancel);
    form.append(input, actions);
    wrap.append(btn, form);
    return wrap;
  }
  function buildAddColumn() {
    const wrap = el("div", { class: "add-col-wrap" });
    const btn = el("button", { class: "add-col-btn", type: "button", text: "+ \u6DFB\u52A0\u5217" });
    btn.addEventListener("click", async () => {
      const name = await promptDialog("\u65B0\u5EFA\u5217", "\u5217\u540D");
      if (!name) return;
      try {
        await api(`/boards/${boardId}/columns`, { method: "POST", body: { name } });
        await load();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    wrap.append(btn);
    return wrap;
  }
  function setupDropZone(body, colId) {
    body.addEventListener("dragover", (e) => {
      if (dragCardId == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearIndicators(body);
      const cards = visibleCards(body);
      if (!cards.length) {
        body.classList.add("drop-empty");
        return;
      }
      let insertBefore = null;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          insertBefore = c;
          break;
        }
      }
      if (insertBefore) insertBefore.classList.add("drop-before");
      else cards[cards.length - 1].classList.add("drop-after");
    });
    body.addEventListener("drop", (e) => {
      if (dragCardId == null) return;
      e.preventDefault();
      const cards = visibleCards(body);
      let before = null;
      let after = null;
      const beforeEl = qs(".drop-before", body);
      if (beforeEl) before = Number(beforeEl.dataset.card);
      else {
        const afterEl = qs(".drop-after", body);
        if (afterEl) after = Number(afterEl.dataset.card);
      }
      clearIndicators(body);
      void moveCard(dragCardId, colId, before, after);
    });
    body.addEventListener("dragleave", () => {
      clearIndicators(body);
    });
  }
  function visibleCards(body) {
    return qsa(".card", body).filter((c) => !c.classList.contains("dragging") && !c.classList.contains("filtered-out"));
  }
  function clearIndicators(body) {
    const scope = body ?? document;
    qsa(".drop-before, .drop-after, .drop-empty", scope).forEach((c) => c.classList.remove("drop-before", "drop-after", "drop-empty"));
  }
  async function moveCard(cardId, colId, before, after) {
    if (!data) return;
    const card = data.cards.find((c) => c.id === cardId);
    if (!card) return;
    const prevColumn = card.columnId;
    card.columnId = colId;
    const rest = data.cards.filter((c) => c.id !== cardId);
    const colCards = rest.filter((c) => c.columnId === colId).sort((a, b) => a.position - b.position);
    const ids = colCards.map((c) => c.id);
    let idx;
    if (after != null) {
      const i = ids.indexOf(after);
      idx = i < 0 ? ids.length : i + 1;
    } else if (before != null) {
      const i = ids.indexOf(before);
      idx = i < 0 ? ids.length : i;
    } else {
      idx = ids.length;
    }
    colCards.splice(idx, 0, card);
    colCards.forEach((c, i) => {
      c.position = (i + 1) * 1024;
    });
    render();
    try {
      await api(`/cards/${cardId}/move`, {
        method: "POST",
        body: { column_id: colId, before_card_id: before, after_card_id: after }
      });
      await load();
    } catch (e) {
      card.columnId = prevColumn;
      await load();
      toast(errMsg(e), "error");
    }
  }
  function matchFilters(card) {
    if (filterAssignee && !(card.assignee && card.assignee.id === Number(filterAssignee))) return false;
    if (filterLabel && !card.labelIds.includes(Number(filterLabel))) return false;
    if (filterPriority && card.priority !== filterPriority) return false;
    if (filterQ) {
      const q = filterQ.toLowerCase();
      if (!card.title.toLowerCase().includes(q) && !card.number.toLowerCase().includes(q)) return false;
    }
    return true;
  }
  function refreshFilterOptions() {
    if (!data) return;
    const assigneeSel = qs("#filter-assignee");
    if (assigneeSel) {
      const cur = assigneeSel.value;
      assigneeSel.innerHTML = '<option value="">\u5168\u90E8\u6210\u5458</option>';
      for (const m of data.members) {
        const opt = el("option", { value: String(m.id), text: m.displayName || m.username });
        if (String(m.id) === cur) opt.selected = true;
        assigneeSel.append(opt);
      }
    }
    const labelSel = qs("#filter-label");
    if (labelSel) {
      const cur = labelSel.value;
      labelSel.innerHTML = '<option value="">\u5168\u90E8\u6807\u7B7E</option>';
      for (const l of data.labels) {
        const opt = el("option", { value: String(l.id), text: l.name });
        if (String(l.id) === cur) opt.selected = true;
        labelSel.append(opt);
      }
    }
    const prioSel = qs("#filter-priority");
    if (prioSel) {
      const cur = prioSel.value;
      prioSel.innerHTML = '<option value="">\u5168\u90E8\u4F18\u5148\u7EA7</option>';
      const prios = [
        ["p0", "\u7D27\u6025"],
        ["p1", "\u9AD8"],
        ["p2", "\u4E2D"],
        ["p3", "\u4F4E"]
      ];
      for (const [v, t] of prios) {
        const opt = el("option", { value: v, text: `${v.toUpperCase()} \xB7 ${t}` });
        if (v === cur) opt.selected = true;
        prioSel.append(opt);
      }
    }
  }
  function initSse() {
    const es = new EventSource(`/api/stream?channel=board:${boardId}`);
    const reload = debounce(() => {
      void load();
      if (getOpenCardId() != null) void refreshOpenCard();
    }, 400);
    ["card.created", "card.updated", "card.moved", "card.deleted", "comment.added"].forEach((ev) => {
      es.addEventListener(ev, reload);
    });
    es.onerror = () => {
    };
  }

  // ts/meta-list.ts
  var MILESTONE_STATUS = [
    ["open", "\u672A\u5F00\u59CB"],
    ["in_progress", "\u8FDB\u884C\u4E2D"],
    ["done", "\u5DF2\u5B8C\u6210"],
    ["overdue", "\u5DF2\u903E\u671F"]
  ];
  var RELEASE_STATUS = [
    ["planned", "\u89C4\u5212\u4E2D"],
    ["dev", "\u5F00\u53D1\u4E2D"],
    ["frozen", "\u51BB\u7ED3"],
    ["released", "\u5DF2\u53D1\u5E03"],
    ["archived", "\u5DF2\u5F52\u6863"]
  ];
  function initMetaList(kind) {
    const projectKey3 = document.body.dataset.projectKey || "";
    const listEl = qs(kind === "milestones" ? "#milestones-list" : "#releases-list");
    const addBtn = qs(kind === "milestones" ? "#btn-add-milestone" : "#btn-add-release");
    if (!listEl) return;
    const load2 = async () => {
      listEl.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
      try {
        const items = await api(`/projects/${projectKey3}/${kind === "milestones" ? "milestones" : "releases"}`);
        renderList(listEl, items, kind, load2);
      } catch (e) {
        listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    addBtn?.addEventListener("click", () => openEditModal(kind, null, load2));
    void load2();
  }
  function renderList(listEl, items, kind, reload) {
    if (!items.length) {
      listEl.innerHTML = `<div class="empty">\u6682\u65E0${kind === "milestones" ? "\u91CC\u7A0B\u7891" : "\u7248\u672C"}\uFF0C\u70B9\u51FB\u53F3\u4E0A\u89D2\u65B0\u5EFA\u3002</div>`;
      return;
    }
    listEl.innerHTML = "";
    const grid = el("div", { class: "meta-grid" });
    for (const m of items) {
      const card = el("div", { class: "card meta-card meta-card-clickable" });
      card.addEventListener("click", () => void openDetailModal(kind, m));
      const head = el("div", { class: "meta-card-head" });
      const color = m.color || "#3B82F6";
      head.append(el("span", { class: "col-dot", style: `background:${color}` }));
      head.append(el("span", { class: "meta-card-name", text: m.name }));
      const status = statusLabel(kind, m.status);
      head.append(el("span", { class: "tag", style: `background:${hexToRgba(statusColor(m.status), 0.15)};color:${statusColor(m.status)}`, text: status }));
      card.append(head);
      if (m.description) card.append(el("p", { class: "muted meta-card-desc", text: m.description }));
      const dates = [];
      if (kind === "milestones") {
        if (m.startDate) dates.push("\u5F00\u59CB " + fmtDate(m.startDate));
      } else {
        if (m.releaseDate) dates.push("\u53D1\u5E03\u65E5\u671F " + fmtDate(m.releaseDate));
      }
      if (m.dueDate) dates.push("\u622A\u6B62 " + fmtDate(m.dueDate));
      if (dates.length) card.append(el("p", { class: "muted meta-card-dates", text: dates.join(" \xB7 ") }));
      const pct = m.percent || 0;
      const bar = el("div", { class: "progress" });
      bar.append(el("div", { class: "progress-fill", style: `width:${pct}%` }));
      const prog = el("div", { class: "meta-card-progress" });
      prog.append(bar, el("span", { class: "muted", text: `${m.doneCards}/${m.totalCards} \u5361\u7247 \xB7 ${pct}%` }));
      card.append(prog);
      const ops = el("div", { class: "meta-card-ops" });
      const editBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u7F16\u8F91" });
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(kind, m, reload);
      });
      const delBtn = el("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", text: "\u5220\u9664" });
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!await confirmDialog(`\u5220\u9664${kind === "milestones" ? "\u91CC\u7A0B\u7891" : "\u7248\u672C"}\u300C${m.name}\u300D\uFF1F`, { danger: true, okText: "\u5220\u9664" })) return;
        try {
          await api(`/${kind === "milestones" ? "milestones" : "releases"}/${m.id}`, { method: "DELETE" });
          toast("\u5DF2\u5220\u9664", "success");
          await reload();
        } catch (e2) {
          toast(errMsg(e2), "error");
        }
      });
      ops.append(editBtn, delBtn);
      card.append(ops);
      grid.append(card);
    }
    listEl.append(grid);
  }
  function statusLabel(kind, status) {
    const map = kind === "milestones" ? MILESTONE_STATUS : RELEASE_STATUS;
    return map.find(([v]) => v === status)?.[1] || status;
  }
  function statusColor(status) {
    switch (status) {
      case "done":
      case "released":
        return "#10B981";
      case "overdue":
      case "frozen":
        return "#F59E0B";
      case "in_progress":
      case "dev":
        return "#3B82F6";
      default:
        return "#6B7280";
    }
  }
  function openEditModal(kind, item, reload) {
    const isMs = kind === "milestones";
    const body = el("div", { class: "form-stack" });
    const nameInput = el("input", { class: "input", type: "text", placeholder: "\u540D\u79F0", maxlength: "60" });
    nameInput.value = item?.name || "";
    body.append(formField("\u540D\u79F0", nameInput));
    const descInput = el("textarea", { class: "input", rows: "3", placeholder: "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09" });
    descInput.value = item?.description || "";
    body.append(formField("\u63CF\u8FF0", descInput));
    let startInput = null;
    if (isMs) {
      startInput = el("input", { class: "input", type: "date" });
      startInput.value = item?.startDate ? fmtDate(item.startDate) : "";
      body.append(formField("\u5F00\u59CB\u65E5\u671F", startInput));
    }
    const dueInput = el("input", { class: "input", type: "date" });
    dueInput.value = item?.dueDate ? fmtDate(item.dueDate) : "";
    body.append(formField(isMs ? "\u622A\u6B62\u65E5\u671F" : "\u53D1\u5E03\u65E5\u671F", dueInput));
    const statusOpts = isMs ? MILESTONE_STATUS : RELEASE_STATUS;
    const statusSel = el("select", { class: "select" });
    for (const [v, t] of statusOpts) {
      const opt = el("option", { value: v, text: t });
      if (v === (item?.status || (isMs ? "open" : "planned"))) opt.selected = true;
      statusSel.append(opt);
    }
    body.append(formField("\u72B6\u6001", statusSel));
    const foot = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn btn-ghost", type: "button", text: "\u53D6\u6D88" });
    const ok = el("button", { class: "btn btn-primary", type: "button", text: item ? "\u4FDD\u5B58" : "\u521B\u5EFA" });
    cancel.addEventListener("click", () => closeModal());
    ok.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast("\u8BF7\u8F93\u5165\u540D\u79F0", "error");
        return;
      }
      const payload = {
        name,
        description: descInput.value.trim(),
        status: statusSel.value
      };
      if (isMs) payload.start_date = startInput?.value || null;
      payload[isMs ? "due_date" : "release_date"] = dueInput.value || null;
      ok.disabled = true;
      try {
        if (item) {
          await api(`/${isMs ? "milestones" : "releases"}/${item.id}`, { method: "PATCH", body: payload });
        } else {
          await api(`/projects/${document.body.dataset.projectKey}/${isMs ? "milestones" : "releases"}`, { method: "POST", body: payload });
        }
        toast("\u5DF2\u4FDD\u5B58", "success");
        closeModal();
        await reload();
      } catch (e) {
        toast(errMsg(e), "error");
        ok.disabled = false;
      }
    });
    foot.append(cancel, ok);
    openModal({ title: item ? "\u7F16\u8F91" : `\u65B0\u5EFA${isMs ? "\u91CC\u7A0B\u7891" : "\u7248\u672C"}`, body, footer: foot, width: "480px" });
    nameInput.focus();
  }
  async function openDetailModal(kind, item) {
    const isMs = kind === "milestones";
    const body = el("div", { class: "meta-detail" });
    body.innerHTML = '<div class="loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    openModal({ title: item.name, body, width: "640px" });
    try {
      const d = await api(`/${isMs ? "milestones" : "releases"}/${item.id}`);
      renderDetail2(body, d, kind);
    } catch (e) {
      body.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  }
  function renderDetail2(body, d, kind) {
    const isMs = kind === "milestones";
    body.innerHTML = "";
    const ms = d;
    const ver = d;
    const color = (isMs ? ms.color : "#3B82F6") || "#3B82F6";
    const head = el("div", { class: "meta-detail-head" });
    const colorBar = el("span", { class: "meta-detail-color", style: `background:${color}` });
    const status = statusLabel(kind, d.status);
    head.append(
      colorBar,
      el("span", { class: "tag", style: `background:${hexToRgba(statusColor(d.status), 0.15)};color:${statusColor(d.status)}`, text: status })
    );
    body.append(head);
    if (d.description) body.append(el("p", { class: "meta-detail-desc", text: d.description }));
    const dates = [];
    if (isMs) {
      if (ms.startDate) dates.push("\u5F00\u59CB " + fmtDate(ms.startDate));
      if (ms.dueDate) dates.push("\u622A\u6B62 " + fmtDate(ms.dueDate));
    } else {
      if (ver.releaseDate) dates.push("\u53D1\u5E03\u65E5\u671F " + fmtDate(ver.releaseDate));
    }
    if (dates.length) body.append(el("p", { class: "muted meta-detail-dates", text: dates.join(" \xB7 ") }));
    const pct = d.percent || 0;
    const bar = el("div", { class: "progress" });
    bar.append(el("div", { class: "progress-fill", style: `width:${pct}%` }));
    const prog = el("div", { class: "meta-detail-progress" });
    prog.append(bar, el("span", { class: "muted", text: `${d.doneCards}/${d.totalCards} \u5361\u7247 \xB7 ${pct}%` }));
    body.append(prog);
    body.append(el("h4", { class: "meta-detail-cards-title", text: `\u5173\u8054\u5361\u7247\uFF08${d.cards.length}\uFF09` }));
    const list = el("div", { class: "meta-card-list" });
    if (!d.cards.length) list.append(el("p", { class: "muted", text: "\u6682\u65E0\u5173\u8054\u5361\u7247" }));
    for (const c of d.cards) list.append(buildDetailCardRow(c));
    body.append(list);
  }
  function buildDetailCardRow(c) {
    const row = el("div", { class: "meta-card-row" });
    row.append(el("span", { class: "muted meta-card-row-no", text: c.number }));
    row.append(el("span", { class: "meta-card-row-title", text: c.title }));
    row.append(el("span", { class: "muted meta-card-row-col", text: c.columnName || "" }));
    const done = el("span", { class: "meta-card-row-done" + (c.done ? " is-done" : ""), text: c.done ? "\u2713 \u5DF2\u5B8C\u6210" : "\u672A\u5B8C\u6210" });
    row.append(done);
    row.append(priorityBadge(c.priority));
    if (c.dueDate) row.append(el("span", { class: "muted meta-card-row-due", text: fmtDate(c.dueDate) }));
    row.addEventListener("click", () => void openCardDetail(c.id));
    return row;
  }

  // ts/members.ts
  var ROLE_OPTIONS = [
    ["owner", "\u6240\u6709\u8005"],
    ["admin", "\u7BA1\u7406\u5458"],
    ["member", "\u6210\u5458"],
    ["viewer", "\u89C2\u5BDF\u8005"]
  ];
  function initMembers() {
    const projectKey3 = document.body.dataset.projectKey || "";
    const listEl = qs("#members-list");
    if (!listEl) return;
    let existingIds = /* @__PURE__ */ new Set();
    const load2 = async () => {
      listEl.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
      try {
        const members2 = await api("/projects/" + projectKey3 + "/members");
        existingIds = new Set(members2.map((m) => m.userId));
        render2(listEl, members2, load2);
      } catch (e) {
        listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    qs("#btn-add-member")?.addEventListener("click", () => openAddModal(projectKey3, existingIds, load2));
    void load2();
  }
  function render2(listEl, members2, reload) {
    if (!members2.length) {
      listEl.innerHTML = '<div class="empty">\u6682\u65E0\u6210\u5458</div>';
      return;
    }
    listEl.innerHTML = "";
    const table = el("table", { class: "table" });
    const thead = el("thead");
    thead.append(el("tr"));
    const heads = ["\u6210\u5458", "\u89D2\u8272", "\u52A0\u5165\u65F6\u95F4", "\u64CD\u4F5C"];
    for (const h of heads) thead.querySelector("tr").append(el("th", { text: h }));
    table.append(thead);
    const tbody = el("tbody");
    for (const m of members2) {
      const tr = el("tr");
      const nameTd = el("td", { class: "cell-user" });
      nameTd.append(avatar({ id: m.userId, avatarPath: m.avatarPath, displayName: m.displayName, username: m.username }, "sm"));
      nameTd.append(el("span", { class: "cell-name", text: m.displayName || m.username }));
      if (m.username && m.displayName !== m.username) nameTd.append(el("span", { class: "muted", text: "@" + m.username }));
      tr.append(nameTd);
      const roleTd = el("td");
      if (m.role === "owner") {
        roleTd.append(el("span", { class: "tag", style: "background:rgba(139,92,246,.15);color:#8B5CF6", text: "\u6240\u6709\u8005" }));
      } else {
        const sel = el("select", { class: "select select-sm" });
        for (const [v, t] of ROLE_OPTIONS) {
          if (v === "owner") continue;
          const opt = el("option", { value: v, text: t });
          if (v === m.role) opt.selected = true;
          sel.append(opt);
        }
        sel.addEventListener("change", async () => {
          try {
            await api(`/projects/${document.body.dataset.projectKey}/members/${m.userId}`, { method: "PATCH", body: { role: sel.value } });
            toast("\u89D2\u8272\u5DF2\u66F4\u65B0", "success");
            await reload();
          } catch (e) {
            toast(errMsg(e), "error");
            await reload();
          }
        });
        roleTd.append(sel);
      }
      tr.append(roleTd);
      tr.append(el("td", { class: "muted", text: fmtDate(m.joinedAt) }));
      const opTd = el("td");
      if (m.role !== "owner") {
        const del = el("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", text: "\u79FB\u9664" });
        del.addEventListener("click", async () => {
          if (!await confirmDialog(`\u79FB\u9664\u6210\u5458 ${m.displayName || m.username}\uFF1F`, { danger: true, okText: "\u79FB\u9664" })) return;
          try {
            await api(`/projects/${document.body.dataset.projectKey}/members/${m.userId}`, { method: "DELETE" });
            toast("\u5DF2\u79FB\u9664", "success");
            await reload();
          } catch (e) {
            toast(errMsg(e), "error");
          }
        });
        opTd.append(del);
      }
      tr.append(opTd);
      tbody.append(tr);
    }
    table.append(tbody);
    listEl.append(table);
  }
  function openAddModal(projectKey3, existingIds, reload) {
    const body = el("div", { class: "form-stack" });
    let selectedUserId = null;
    let timer;
    const identityInput = el("input", { class: "input", type: "text", placeholder: "\u8F93\u5165\u7528\u6237\u540D / \u6635\u79F0 / \u90AE\u7BB1\u6A21\u7CCA\u641C\u7D22", autocomplete: "off" });
    const wrap = el("div", { class: "autocomplete" });
    const dropdown = el("div", { class: "autocomplete-list", hidden: "true" });
    wrap.append(identityInput, dropdown);
    body.append(formField("\u6210\u5458\uFF08\u6A21\u7CCA\u641C\u7D22\uFF09", wrap));
    async function search(q) {
      if (!q.trim()) {
        dropdown.hidden = true;
        dropdown.innerHTML = "";
        return;
      }
      try {
        const users = await api(
          "/users/search?q=" + encodeURIComponent(q.trim())
        );
        const filtered = users.filter((u) => !existingIds.has(u.id));
        dropdown.innerHTML = "";
        if (!filtered.length) {
          dropdown.hidden = true;
          return;
        }
        for (const u of filtered) {
          const item = el("div", { class: "autocomplete-item" });
          item.append(avatar({ id: u.id, avatarPath: u.avatarPath, displayName: u.displayName, username: u.username }, "xs"));
          item.append(el("span", { class: "cell-name", text: u.displayName || u.username }));
          if (u.username && u.displayName !== u.username) item.append(el("span", { class: "muted", text: "@" + u.username }));
          item.addEventListener("click", () => {
            selectedUserId = u.id;
            identityInput.value = u.displayName || u.username;
            dropdown.hidden = true;
          });
          dropdown.append(item);
        }
        dropdown.hidden = false;
      } catch {
        dropdown.hidden = true;
      }
    }
    identityInput.addEventListener("input", () => {
      selectedUserId = null;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void search(identityInput.value), 250);
    });
    document.addEventListener("pointerdown", (e) => {
      if (!wrap.contains(e.target)) dropdown.hidden = true;
    });
    const roleSel = el("select", { class: "select" });
    for (const [v, t] of ROLE_OPTIONS) {
      if (v === "owner") continue;
      roleSel.append(el("option", { value: v, text: t }));
    }
    body.append(formField("\u89D2\u8272", roleSel));
    const foot = el("div", { class: "modal-actions" });
    const cancel = el("button", { class: "btn btn-ghost", type: "button", text: "\u53D6\u6D88" });
    const ok = el("button", { class: "btn btn-primary", type: "button", text: "\u6DFB\u52A0" });
    cancel.addEventListener("click", () => closeModal());
    ok.addEventListener("click", async () => {
      const identity = identityInput.value.trim();
      if (!selectedUserId && !identity) {
        toast("\u8BF7\u8F93\u5165\u6216\u9009\u62E9\u6210\u5458", "error");
        return;
      }
      ok.disabled = true;
      try {
        await api(`/projects/${projectKey3}/members`, {
          method: "POST",
          body: { user_id: selectedUserId ?? void 0, identity: selectedUserId ? void 0 : identity, role: roleSel.value }
        });
        toast("\u5DF2\u6DFB\u52A0", "success");
        closeModal();
        await reload();
      } catch (e) {
        toast(errMsg(e), "error");
        ok.disabled = false;
      }
    });
    foot.append(cancel, ok);
    openModal({ title: "\u6DFB\u52A0\u6210\u5458", body, footer: foot, width: "440px" });
    identityInput.focus();
  }

  // ts/project-icon.ts
  function projectIcon(p, size = "md") {
    const cls = "project-icon" + (size === "sm" ? " project-icon-sm" : size === "lg" ? " project-icon-lg" : "");
    const text = p.iconText && p.iconText.trim() || initialsOf(p.name);
    const wrap = el("span", { class: cls, text });
    wrap.style.background = p.iconColor || "#3B82F6";
    if (p.iconPath) {
      const img = el("img", { class: "project-icon-img", alt: p.name });
      img.src = `/api/project-icons/${p.id}`;
      img.addEventListener("error", () => img.remove());
      wrap.append(img);
    }
    return wrap;
  }
  async function initProjectIcons() {
    const page = document.body.dataset.page || "";
    const projectKey3 = document.body.dataset.projectKey || "";
    if (projectKey3) {
      const headIcon = qs(".project-head .project-icon");
      if (headIcon) {
        try {
          const p = await api(`/projects/${projectKey3}`);
          headIcon.replaceWith(projectIcon(p, "lg"));
        } catch {
        }
      }
    }
    if (page === "home") {
      const cards = qsa(".project-card");
      if (!cards.length) return;
      try {
        const projects = await api("/projects");
        const byKey = new Map(projects.map((p) => [p.key, p]));
        for (const card of cards) {
          const key = card.dataset.projectKey;
          const p = key ? byKey.get(key) : void 0;
          if (!p) continue;
          const icon = qs(".project-icon", card);
          if (icon) icon.replaceWith(projectIcon(p, "md"));
        }
      } catch {
      }
    }
  }

  // ts/settings.ts
  var ICON_COLORS2 = ["#3B82F6", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4", "#8B5CF6", "#EC4899"];
  function initSettings() {
    const projectKey3 = document.body.dataset.projectKey || "";
    if (!projectKey3) return;
    qsa(".settings-tabs .tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        qsa(".settings-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        qs("#settings-basic").hidden = tab !== "basic";
        qs("#settings-gitlab").hidden = tab !== "gitlab";
      });
    });
    void loadBasic(projectKey3);
    void loadGitlab(projectKey3);
  }
  async function loadBasic(projectKey3) {
    const pane = qs("#settings-basic");
    if (!pane) return;
    pane.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    let p;
    try {
      p = await api(`/projects/${projectKey3}`);
    } catch (e) {
      pane.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      return;
    }
    const card = el("div", { class: "card settings-card" });
    const iconRow = el("div", { class: "settings-icon-row" });
    const iconPreview = el("div", { class: "settings-icon-preview" });
    iconPreview.append(projectIcon(p, "lg"));
    iconRow.append(iconPreview);
    const iconActions = el("div", { class: "settings-icon-actions" });
    const upBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u4E0A\u4F20\u56FE\u7247\u56FE\u6807" });
    const fileInput = el("input", { type: "file", accept: "image/*", hidden: "true" });
    upBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const fd = new FormData();
        fd.append("file", f);
        await api(`/projects/${projectKey3}/icon`, { method: "POST", form: fd });
        toast("\u56FE\u6807\u5DF2\u4E0A\u4F20", "success");
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(errMsg(e), "error");
      }
      fileInput.value = "";
    });
    iconActions.append(upBtn);
    if (p.iconPath) {
      const removeBtn = el("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", text: "\u79FB\u9664\u56FE\u7247\uFF0C\u5207\u56DE\u8272\u5757" });
      removeBtn.addEventListener("click", async () => {
        if (!await confirmDialog("\u79FB\u9664\u56FE\u7247\u56FE\u6807\uFF0C\u5207\u6362\u56DE\u8272\u5757 + \u6587\u5B57\u6A21\u5F0F\uFF1F")) return;
        try {
          await api(`/projects/${projectKey3}/icon`, { method: "DELETE" });
          toast("\u5DF2\u5207\u56DE\u8272\u5757\u6A21\u5F0F", "success");
          setTimeout(() => location.reload(), 500);
        } catch (e) {
          toast("\u79FB\u9664\u56FE\u6807\u5931\u8D25\uFF08\u540E\u7AEF\u6682\u672A\u63D0\u4F9B\u8BE5\u63A5\u53E3\uFF09\uFF1A" + errMsg(e), "error");
        }
      });
      iconActions.append(removeBtn);
    }
    iconRow.append(iconActions);
    card.append(formField("\u9879\u76EE\u56FE\u6807", iconRow));
    const nameInput = el("input", { class: "input", type: "text", maxlength: "60" });
    nameInput.value = p.name;
    card.append(formField("\u9879\u76EE\u540D\u79F0", nameInput));
    const descInput = el("textarea", { class: "input", rows: "3" });
    descInput.value = p.description || "";
    card.append(formField("\u9879\u76EE\u63CF\u8FF0", descInput));
    const iconTextInput = el("input", { class: "input", type: "text", maxlength: "2", placeholder: "1-2 \u5B57\uFF0C\u7559\u7A7A\u53D6\u9879\u76EE\u540D\u524D\u4E24\u5B57" });
    iconTextInput.value = p.iconText || initialsOf(p.name);
    card.append(formField("\u56FE\u6807\u6587\u5B57\uFF081-2 \u5B57\uFF09", iconTextInput));
    const colorWrap = el("div", { class: "color-swatches" });
    let selected = ICON_COLORS2.includes(p.iconColor) ? p.iconColor : ICON_COLORS2[0];
    for (const c of ICON_COLORS2) {
      const sw = el("button", { class: "swatch" + (c === selected ? " active" : ""), type: "button", style: `background:${c}` });
      sw.addEventListener("click", () => {
        selected = c;
        qsa(".swatch", colorWrap).forEach((s) => s.classList.remove("active"));
        sw.classList.add("active");
      });
      colorWrap.append(sw);
    }
    card.append(formField("\u56FE\u6807\u989C\u8272", colorWrap));
    const saveBtn = el("button", { class: "btn btn-primary", type: "button", text: "\u4FDD\u5B58\u57FA\u672C\u4FE1\u606F" });
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast("\u9879\u76EE\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A", "error");
        return;
      }
      saveBtn.disabled = true;
      try {
        await api(`/projects/${projectKey3}`, {
          method: "PATCH",
          body: {
            name,
            description: descInput.value.trim(),
            icon_color: selected,
            icon_text: iconTextInput.value.trim()
          }
        });
        toast("\u5DF2\u4FDD\u5B58", "success");
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(errMsg(e), "error");
        saveBtn.disabled = false;
      }
    });
    const actions = el("div", { class: "modal-actions" });
    actions.append(saveBtn);
    card.append(actions);
    pane.innerHTML = "";
    pane.append(card);
    const dangerCard = el("div", { class: "card settings-card danger-zone" });
    dangerCard.append(el("h4", { text: "\u5371\u9669\u64CD\u4F5C" }));
    const archiveBtn = el("button", { class: "btn btn-ghost", type: "button", text: p.status === "archived" ? "\u6062\u590D\u9879\u76EE" : "\u5F52\u6863\u9879\u76EE" });
    archiveBtn.addEventListener("click", async () => {
      if (p.status !== "archived" && !await confirmDialog("\u5F52\u6863\u8BE5\u9879\u76EE\uFF1F\u5F52\u6863\u540E\u6210\u5458\u5C06\u65E0\u6CD5\u8BBF\u95EE\u3002", { danger: true })) return;
      try {
        await api(`/projects/${projectKey3}/archive`, { method: "POST" });
        toast("\u5DF2\u5F52\u6863", "success");
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    const delBtn = el("button", { class: "btn btn-danger", type: "button", text: "\u5220\u9664\u9879\u76EE" });
    delBtn.addEventListener("click", async () => {
      const key = await promptDialog("\u8F93\u5165\u9879\u76EE Key \u4EE5\u786E\u8BA4\u5220\u9664\uFF08\u4E0D\u53EF\u6062\u590D\uFF09", "\u9879\u76EE Key");
      if (!key || key.toUpperCase() !== projectKey3.toUpperCase()) {
        if (key) toast("Key \u4E0D\u5339\u914D\uFF0C\u5DF2\u53D6\u6D88", "error");
        return;
      }
      try {
        await api(`/projects/${projectKey3}?confirm_key=${encodeURIComponent(projectKey3)}`, { method: "DELETE" });
        toast("\u9879\u76EE\u5DF2\u5220\u9664", "success");
        setTimeout(() => location.href = "/", 500);
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    const dangerActions = el("div", { class: "modal-actions" });
    dangerActions.append(archiveBtn, delBtn);
    dangerCard.append(dangerActions);
    pane.append(dangerCard);
  }
  async function loadGitlab(projectKey3) {
    const pane = qs("#settings-gitlab");
    if (!pane) return;
    pane.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    let cfg;
    try {
      cfg = await api(`/projects/${projectKey3}/gitlab`);
    } catch (e) {
      pane.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      return;
    }
    const card = el("div", { class: "card settings-card" });
    const baseUrl = el("input", { class: "input", type: "text", placeholder: "https://gitlab.example.com" });
    baseUrl.value = cfg.baseUrl || "";
    card.append(formField("GitLab \u5730\u5740", baseUrl));
    const token = el("input", { class: "input", type: "password", placeholder: cfg.hasToken ? "\u5DF2\u914D\u7F6E\uFF08\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\uFF09" : "Personal Access Token\uFF08\u9700 read_api \u6743\u9650\uFF09" });
    card.append(formField("\u8BBF\u95EE\u4EE4\u724C", token));
    const mainRepo = el("input", { class: "input", type: "text", placeholder: "\u5982 group/project \u6216 https://gitlab.example.com/group/project.git" });
    mainRepo.value = cfg.mainRepo || "";
    card.append(formField("\u4E3B\u4ED3\u5E93", mainRepo));
    const matchRegex = el("input", { class: "input", type: "text" });
    matchRegex.value = cfg.matchRegex || "";
    card.append(formField("\u5361\u7247\u5355\u53F7\u5339\u914D\u6B63\u5219", matchRegex, "\u63D0\u4EA4\u4FE1\u606F\u4E2D\u5339\u914D\u5355\u53F7\u7684\u6B63\u5219\uFF0C\u9ED8\u8BA4 ( #\u6216KEY- )(\\d+)"));
    const autoComplete = el("input", { type: "checkbox" });
    autoComplete.checked = !!cfg.autoComplete;
    const autoRow = el("label", { class: "check-row" });
    autoRow.append(autoComplete, el("span", { text: "\u63D0\u4EA4\u4FE1\u606F\u5305\u542B\u5355\u53F7\u65F6\u81EA\u52A8\u5B8C\u6210\uFF08\u79FB\u5230\u5DF2\u5B8C\u6210\u5217\uFF09" }));
    card.append(formField("\u81EA\u52A8\u5B8C\u6210", autoRow));
    const interval = el("input", { class: "input", type: "number", min: "1" });
    interval.value = String(cfg.syncIntervalMinutes || 5);
    card.append(formField("\u540C\u6B65\u95F4\u9694\uFF08\u5206\u949F\uFF09", interval));
    if (cfg.lastSyncAt || cfg.lastSyncStatus) {
      const statusTxt = cfg.lastSyncStatus || "";
      const ok = statusTxt === "ok" || statusTxt === "20001" || statusTxt === "";
      const statusLine = el("p", { class: "muted" });
      statusLine.textContent = `\u4E0A\u6B21\u540C\u6B65\uFF1A${cfg.lastSyncAt ? new Date(cfg.lastSyncAt).toLocaleString("zh-CN") : "\u4ECE\u672A"}${cfg.lastSyncError ? " \xB7 " + cfg.lastSyncError : ""}`;
      statusLine.style.color = ok ? "var(--text-2)" : "var(--danger)";
      card.append(statusLine);
    }
    const actions = el("div", { class: "modal-actions" });
    const testBtn = el("button", { class: "btn btn-ghost", type: "button", text: "\u6D4B\u8BD5\u8FDE\u63A5" });
    const syncBtn = el("button", { class: "btn btn-ghost", type: "button", text: "\u7ACB\u5373\u540C\u6B65" });
    const saveBtn = el("button", { class: "btn btn-primary", type: "button", text: "\u4FDD\u5B58\u914D\u7F6E" });
    function payload() {
      return {
        base_url: baseUrl.value.trim(),
        token: token.value || void 0,
        main_repo: mainRepo.value.trim(),
        match_regex: matchRegex.value.trim() || void 0,
        auto_complete: autoComplete.checked,
        sync_interval_minutes: Number(interval.value) || 5
      };
    }
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testBtn.textContent = "\u6D4B\u8BD5\u4E2D\u2026";
      try {
        await api(`/projects/${projectKey3}/gitlab/test`, { method: "POST", body: payload() });
        toast("\u8FDE\u63A5\u6210\u529F", "success");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      testBtn.disabled = false;
      testBtn.textContent = "\u6D4B\u8BD5\u8FDE\u63A5";
    });
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        await api(`/projects/${projectKey3}/gitlab`, { method: "PUT", body: payload() });
        toast("\u914D\u7F6E\u5DF2\u4FDD\u5B58", "success");
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(errMsg(e), "error");
        saveBtn.disabled = false;
      }
    });
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "\u540C\u6B65\u4E2D\u2026";
      try {
        const r = await api(`/projects/${projectKey3}/gitlab/sync`, { method: "POST" });
        toast("\u540C\u6B65\u5B8C\u6210\uFF1A" + JSON.stringify(r), "success");
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        toast(errMsg(e), "error");
      }
      syncBtn.disabled = false;
      syncBtn.textContent = "\u7ACB\u5373\u540C\u6B65";
    });
    actions.append(testBtn, syncBtn, saveBtn);
    card.append(actions);
    pane.innerHTML = "";
    pane.append(card);
  }

  // ts/search.ts
  function initSearch() {
    const input = qs("#search-input");
    const results = qs("#search-results");
    if (!input || !results) return;
    const run = debounce(async (q2) => {
      if (!q2) {
        results.innerHTML = '<div class="empty">\u8F93\u5165\u5173\u952E\u5B57\u5F00\u59CB\u641C\u7D22\uFF0C\u652F\u6301\u5355\u53F7\uFF08\u5982 DODG-12\u3001#12\uFF09</div>';
        return;
      }
      results.innerHTML = '<div class="muted loading">\u641C\u7D22\u4E2D\u2026</div>';
      try {
        const items = await api("/search?q=" + encodeURIComponent(q2));
        render3(results, items);
      } catch (e) {
        results.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    }, 300);
    input.addEventListener("input", () => run(input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run(input.value.trim());
    });
    const q = new URLSearchParams(location.search).get("q");
    if (q) {
      input.value = q;
      void run(q);
    }
  }
  function render3(box, items) {
    if (!items.length) {
      box.innerHTML = '<div class="empty">\u6CA1\u6709\u5339\u914D\u7684\u7ED3\u679C</div>';
      return;
    }
    box.innerHTML = "";
    const list = el("div", { class: "search-results-list" });
    for (const it of items) {
      const row = el("div", { class: "search-row" });
      const main = el("div", { class: "search-row-main" });
      main.append(el("span", { class: "search-row-no muted", text: it.number }));
      main.append(el("span", { class: "search-row-title", text: it.title }));
      const sub = [it.projectName];
      if (it.boardName) sub.push(it.boardName);
      if (it.columnName) sub.push(it.columnName);
      main.append(el("span", { class: "muted search-row-sub", text: sub.join(" \xB7 ") }));
      row.append(main);
      if (it.updatedAt) row.append(el("span", { class: "muted", text: timeAgo(it.updatedAt) }));
      row.addEventListener("click", () => void openCardDetail(it.id));
      list.append(row);
    }
    box.append(list);
  }

  // ts/notifications.ts
  var CARD_LINK_RE = /\/p\/([^/]+)\/card\/(\d+)/;
  function initNotifications() {
    const listEl = qs("#notifications-list");
    if (!listEl) return;
    const load2 = async () => {
      listEl.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
      try {
        const items = await api("/notifications?page=1&page_size=50");
        render4(listEl, items);
        void refreshUnread2();
      } catch (e) {
        listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    qs("#btn-read-all")?.addEventListener("click", async () => {
      try {
        await api("/notifications/read-all", { method: "POST" });
        toast("\u5DF2\u5168\u90E8\u6807\u8BB0\u4E3A\u5DF2\u8BFB", "success");
        await load2();
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    void load2();
  }
  async function refreshUnread2() {
    try {
      const d = await api("/notifications/unread-count");
      const badge = qs("#unread-badge");
      if (badge) {
        const n = d.count || 0;
        badge.hidden = n === 0;
        badge.textContent = n > 99 ? "99+" : String(n);
      }
    } catch {
    }
  }
  function render4(box, items) {
    if (!items.length) {
      box.innerHTML = '<div class="empty">\u6682\u65E0\u901A\u77E5</div>';
      return;
    }
    box.innerHTML = "";
    const list = el("div", { class: "notif-list-inner" });
    for (const n of items) {
      const row = el("div", { class: "notif-row" + (n.read ? "" : " unread") });
      const dot = el("span", { class: "notif-dot" });
      const main = el("div", { class: "notif-main" });
      main.append(el("div", { class: "notif-title", text: n.title }));
      if (n.body) main.append(el("div", { class: "muted notif-body", text: n.body }));
      main.append(el("div", { class: "muted", text: timeAgo(n.createdAt) }));
      row.append(dot, main);
      row.addEventListener("click", async () => {
        if (!n.read) {
          try {
            await api(`/notifications/${n.id}/read`, { method: "POST" });
            n.read = true;
            row.classList.remove("unread");
            void refreshUnread2();
          } catch {
          }
        }
        const m = CARD_LINK_RE.exec(n.link || "");
        if (m) {
          void openCardDetail(Number(m[2]));
        } else if (n.link) {
          location.href = n.link;
        }
      });
      list.append(row);
    }
    box.append(list);
  }

  // ts/admin.ts
  function initAdmin() {
    const content = qs("#admin-content");
    if (!content) return;
    const section = content.dataset.section || "overview";
    if (section === "users") void adminUsers(content);
    else if (section === "settings") void adminSettings(content);
    else if (section === "audit") void adminAudit(content);
    else void adminOverview(content);
  }
  async function adminOverview(content) {
    content.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    try {
      const info = await api("/admin/system-info");
      const cards = el("div", { class: "stat-grid" });
      const stats = [
        ["\u7248\u672C", info.version],
        ["\u6570\u636E\u5E93", info.dbKind],
        ["\u6570\u636E\u5E93\u5927\u5C0F", fmtSize(info.dbSize)],
        ["\u4E0A\u4F20\u76EE\u5F55", fmtSize(info.uploadsSize)],
        ["\u5728\u7EBF\u4F1A\u8BDD", String(info.onlineSessions)],
        ["\u542F\u52A8\u65F6\u95F4", info.startedAt ? fmtDateTime(info.startedAt) : ""]
      ];
      for (const [label, value] of stats) {
        const c = el("div", { class: "card stat-card" });
        c.append(el("div", { class: "muted", text: label }), el("div", { class: "stat-value", text: value }));
        cards.append(c);
      }
      content.innerHTML = "";
      content.append(el("h3", { text: "\u7CFB\u7EDF\u4FE1\u606F" }), cards);
    } catch (e) {
      content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      return;
    }
    content.append(el("h3", { text: "\u6570\u636E\u5E93\u5907\u4EFD" }));
    const backupBox = el("div", { class: "card" });
    const loadBackups = async () => {
      try {
        const list = await api("/admin/backups");
        backupBox.innerHTML = "";
        const table = el("table", { class: "table" });
        const thead = el("thead");
        thead.append(el("tr"));
        for (const h of ["\u6587\u4EF6\u540D", "\u5927\u5C0F", "\u521B\u5EFA\u65F6\u95F4", "\u64CD\u4F5C"]) thead.querySelector("tr").append(el("th", { text: h }));
        table.append(thead);
        const tbody = el("tbody");
        if (!list.length) {
          const tr = el("tr");
          tr.append(el("td", { colspan: "4", class: "muted", text: "\u6682\u65E0\u5907\u4EFD" }));
          tbody.append(tr);
        }
        for (const b of list) {
          const tr = el("tr");
          tr.append(el("td", { text: b.name }));
          tr.append(el("td", { class: "muted", text: fmtSize(b.size) }));
          tr.append(el("td", { class: "muted", text: b.modifiedAt ? fmtDateTime(b.modifiedAt) : "" }));
          const op = el("td");
          const del = el("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", text: "\u5220\u9664" });
          del.addEventListener("click", async () => {
            if (!await confirmDialog(`\u5220\u9664\u5907\u4EFD ${b.name}\uFF1F`, { danger: true, okText: "\u5220\u9664" })) return;
            try {
              await api(`/admin/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" });
              toast("\u5DF2\u5220\u9664", "success");
              await loadBackups();
            } catch (e) {
              toast(errMsg(e), "error");
            }
          });
          op.append(del);
          tr.append(op);
          tbody.append(tr);
        }
        table.append(tbody);
        backupBox.append(table);
      } catch (e) {
        backupBox.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    const createBtn = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "+ \u521B\u5EFA\u5907\u4EFD" });
    createBtn.addEventListener("click", async () => {
      createBtn.disabled = true;
      try {
        const r = await api("/admin/backups", { method: "POST" });
        toast("\u5907\u4EFD\u5DF2\u521B\u5EFA\uFF1A" + r.name, "success");
        await loadBackups();
      } catch (e) {
        toast(errMsg(e), "error");
      }
      createBtn.disabled = false;
    });
    const bar = el("div", { class: "section-bar" });
    bar.append(createBtn);
    content.append(bar, backupBox);
    void loadBackups();
  }
  async function adminUsers(content) {
    let page = 1;
    let q = "";
    const render5 = async () => {
      content.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
      try {
        const d = await api(`/admin/users?page=${page}&page_size=20&q=${encodeURIComponent(q)}`);
        content.innerHTML = "";
        const bar = el("div", { class: "section-bar" });
        const qInput = el("input", { class: "input input-sm", type: "text", placeholder: "\u641C\u7D22\u7528\u6237\u540D/\u6635\u79F0/\u90AE\u7BB1", value: q });
        qInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            q = qInput.value.trim();
            page = 1;
            void render5();
          }
        });
        bar.append(qInput, el("span", { class: "muted", text: `\u5171 ${d.total} \u4E2A\u7528\u6237` }));
        content.append(bar);
        const table = el("table", { class: "table" });
        const thead = el("thead");
        thead.append(el("tr"));
        for (const h of ["\u7528\u6237", "\u89D2\u8272", "\u72B6\u6001", "\u6CE8\u518C\u65F6\u95F4", "\u64CD\u4F5C"]) thead.querySelector("tr").append(el("th", { text: h }));
        table.append(thead);
        const tbody = el("tbody");
        for (const u of d.items) {
          const tr = el("tr");
          const nameTd = el("td", { class: "cell-user" });
          nameTd.append(el("span", { class: "cell-name", text: u.displayName || u.username }));
          nameTd.append(el("span", { class: "muted", text: `@${u.username}` + (u.email ? ` \xB7 ${u.email}` : "") }));
          tr.append(nameTd);
          const roleTd = el("td");
          if (u.role === "system_admin") {
            roleTd.append(el("span", { class: "tag", style: "background:rgba(139,92,246,.15);color:#8B5CF6", text: "\u7CFB\u7EDF\u7BA1\u7406\u5458" }));
          } else {
            const sel = el("select", { class: "select select-sm" });
            for (const [v, t] of [["user", "\u666E\u901A\u7528\u6237"], ["system_admin", "\u7CFB\u7EDF\u7BA1\u7406\u5458"]]) {
              const opt = el("option", { value: v, text: t });
              if (v === u.role) opt.selected = true;
              sel.append(opt);
            }
            sel.addEventListener("change", async () => {
              try {
                await api(`/admin/users/${u.id}`, { method: "PATCH", body: { role: sel.value } });
                toast("\u89D2\u8272\u5DF2\u66F4\u65B0", "success");
                await render5();
              } catch (e) {
                toast(errMsg(e), "error");
                await render5();
              }
            });
            roleTd.append(sel);
          }
          tr.append(roleTd);
          const statusTd = el("td");
          const statusTag = el("span", {
            class: "tag",
            style: u.status === "active" ? "background:rgba(16,185,129,.15);color:var(--success)" : "background:rgba(239,68,68,.15);color:var(--danger)",
            text: u.status === "active" ? "\u6B63\u5E38" : "\u5DF2\u7981\u7528"
          });
          statusTd.append(statusTag);
          tr.append(statusTd);
          tr.append(el("td", { class: "muted", text: u.createdAt ? fmtDateTime(u.createdAt) : "" }));
          const opTd = el("td", { class: "cell-ops" });
          const toggle = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: u.status === "active" ? "\u7981\u7528" : "\u542F\u7528" });
          toggle.addEventListener("click", async () => {
            try {
              await api(`/admin/users/${u.id}`, { method: "PATCH", body: { status: u.status === "active" ? "disabled" : "active" } });
              toast("\u5DF2\u66F4\u65B0", "success");
              await render5();
            } catch (e) {
              toast(errMsg(e), "error");
            }
          });
          const reset = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u91CD\u7F6E\u5BC6\u7801" });
          reset.addEventListener("click", async () => {
            const pwd = await promptDialog(`\u4E3A ${u.username} \u8BBE\u7F6E\u65B0\u5BC6\u7801`, "\u65B0\u5BC6\u7801\uFF088-64 \u4F4D\uFF0C\u542B\u5B57\u6BCD\u6570\u5B57\uFF09");
            if (!pwd) return;
            try {
              await api(`/admin/users/${u.id}/reset-password`, { method: "POST", body: { new_password: pwd } });
              toast("\u5BC6\u7801\u5DF2\u91CD\u7F6E", "success");
            } catch (e) {
              toast(errMsg(e), "error");
            }
          });
          const del = el("button", { class: "btn btn-ghost btn-sm btn-danger-text", type: "button", text: "\u5220\u9664" });
          del.addEventListener("click", async () => {
            if (!await confirmDialog(`\u5220\u9664\u7528\u6237 ${u.username}\uFF1F\u76F8\u5173\u6570\u636E\u5C06\u4E00\u5E76\u5220\u9664\u3002`, { danger: true, okText: "\u5220\u9664" })) return;
            try {
              await api(`/admin/users/${u.id}`, { method: "DELETE" });
              toast("\u5DF2\u5220\u9664", "success");
              await render5();
            } catch (e) {
              toast(errMsg(e), "error");
            }
          });
          opTd.append(toggle, reset, del);
          tr.append(opTd);
          tbody.append(tr);
        }
        table.append(tbody);
        content.append(table);
        const pager = el("div", { class: "pager" });
        const prev = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u4E0A\u4E00\u9875" });
        prev.disabled = page <= 1;
        prev.addEventListener("click", () => {
          page -= 1;
          void render5();
        });
        const next = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u4E0B\u4E00\u9875" });
        next.disabled = page * d.pageSize >= d.total;
        next.addEventListener("click", () => {
          page += 1;
          void render5();
        });
        pager.append(prev, el("span", { class: "muted", text: `\u7B2C ${d.page} \u9875` }), next);
        content.append(pager);
      } catch (e) {
        content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    await render5();
  }
  async function adminSettings(content) {
    content.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
    let map;
    try {
      map = await api("/admin/settings");
    } catch (e) {
      content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      return;
    }
    const defaults = { allow_registration: 1, wip_mode: "warn" };
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in map)) map[k] = v;
    }
    content.innerHTML = "";
    const card = el("div", { class: "card settings-card" });
    const regWrap = el("div", { class: "field" });
    const regCheck = el("input", { type: "checkbox" });
    regCheck.checked = String(map.allow_registration) === "1" || map.allow_registration === true;
    const regRow = el("label", { class: "check-row" });
    regRow.append(regCheck, el("span", { text: "\u5141\u8BB8\u516C\u5F00\u6CE8\u518C\uFF08\u5173\u95ED\u540E\u53EA\u80FD\u7531\u7BA1\u7406\u5458\u521B\u5EFA\u8D26\u53F7\uFF09" }));
    regWrap.append(el("label", { text: "\u6CE8\u518C" }), regRow);
    card.append(regWrap);
    const wipWrap = el("div", { class: "field" });
    const wipSel = el("select", { class: "select" });
    for (const [v, t] of [["warn", "\u4EC5\u63D0\u793A\uFF08\u5141\u8BB8\u8D85\u9650\uFF09"], ["block", "\u963B\u6B62\u8D85\u9650\u79FB\u52A8"]]) {
      const opt = el("option", { value: v, text: t });
      if (String(map.wip_mode) === v) opt.selected = true;
      wipSel.append(opt);
    }
    wipWrap.append(el("label", { text: "WIP \u8D85\u9650\u7B56\u7565" }), wipSel);
    card.append(wipWrap);
    const extra = el("div", { class: "field" });
    extra.append(el("label", { text: "\u5176\u4ED6\u8BBE\u7F6E\uFF08\u952E\u503C\u5BF9\uFF09" }));
    const kvRows = el("div", { class: "kv-rows" });
    const rows = [];
    const addRow = (k, v) => {
      if (k === "allow_registration" || k === "wip_mode") return;
      const kInput = el("input", { class: "input input-sm", type: "text", value: k, placeholder: "\u952E" });
      const vInput = el("input", { class: "input input-sm", type: "text", value: String(v ?? ""), placeholder: "\u503C" });
      const row = el("div", { class: "kv-row" });
      row.append(kInput, vInput);
      rows.push([kInput, vInput]);
      kvRows.append(row);
    };
    for (const [k, v] of Object.entries(map)) addRow(k, v);
    const addBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ \u6DFB\u52A0\u952E" });
    addBtn.addEventListener("click", () => {
      const k = el("input", { class: "input input-sm", type: "text", placeholder: "\u952E" });
      const v = el("input", { class: "input input-sm", type: "text", placeholder: "\u503C" });
      const row = el("div", { class: "kv-row" });
      row.append(k, v);
      rows.push([k, v]);
      kvRows.append(row);
    });
    extra.append(kvRows, addBtn);
    card.append(extra);
    const actions = el("div", { class: "modal-actions" });
    const save = el("button", { class: "btn btn-primary", type: "button", text: "\u4FDD\u5B58\u8BBE\u7F6E" });
    save.addEventListener("click", async () => {
      const body = {
        allow_registration: regCheck.checked ? 1 : 0,
        wip_mode: wipSel.value
      };
      for (const [kInput, vInput] of rows) {
        const k = kInput.value.trim();
        if (!k) continue;
        body[k] = vInput.value;
      }
      save.disabled = true;
      try {
        await api("/admin/settings", { method: "PUT", body });
        toast("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58", "success");
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        toast(errMsg(e), "error");
        save.disabled = false;
      }
    });
    actions.append(save);
    card.append(actions);
    content.append(card);
  }
  async function adminAudit(content) {
    let page = 1;
    const render5 = async () => {
      content.innerHTML = '<div class="muted loading">\u52A0\u8F7D\u4E2D\u2026</div>';
      try {
        const items = await api(`/admin/audit-logs?page=${page}&page_size=30`);
        content.innerHTML = "";
        const table = el("table", { class: "table" });
        const thead = el("thead");
        thead.append(el("tr"));
        for (const h of ["\u65F6\u95F4", "\u7528\u6237", "\u64CD\u4F5C", "\u5BF9\u8C61", "IP"]) thead.querySelector("tr").append(el("th", { text: h }));
        table.append(thead);
        const tbody = el("tbody");
        if (!items.length) {
          const tr = el("tr");
          tr.append(el("td", { colspan: "5", class: "muted", text: "\u6682\u65E0\u65E5\u5FD7" }));
          tbody.append(tr);
        }
        for (const it of items) {
          const tr = el("tr");
          tr.append(el("td", { class: "muted", text: fmtDateTime(it.createdAt) }));
          tr.append(el("td", { text: it.username || "\u7CFB\u7EDF" }));
          tr.append(el("td", { text: it.action }));
          tr.append(el("td", { class: "muted", text: `${it.targetType || "-"}${it.targetId ? " #" + it.targetId : ""}` }));
          tr.append(el("td", { class: "muted", text: it.ip || "-" }));
          tbody.append(tr);
        }
        table.append(tbody);
        content.append(table);
        const pager = el("div", { class: "pager" });
        const prev = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u4E0A\u4E00\u9875" });
        prev.disabled = page <= 1;
        prev.addEventListener("click", () => {
          page -= 1;
          void render5();
        });
        const next = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "\u4E0B\u4E00\u9875" });
        next.addEventListener("click", () => {
          page += 1;
          void render5();
        });
        pager.append(prev, el("span", { class: "muted", text: `\u7B2C ${page} \u9875` }), next);
        content.append(pager);
      } catch (e) {
        content.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
      }
    };
    await render5();
  }

  // ts/index.ts
  function init() {
    initTheme();
    const page = document.body.dataset.page;
    if (page === "login" || page === "register" || page === "setup") {
      initAuth();
      return;
    }
    if (page === "error") return;
    initTopbar();
    void initProjectIcons();
    switch (page) {
      case "home":
        initHome();
        break;
      case "board":
        initBoard();
        break;
      case "milestones":
        initMetaList("milestones");
        break;
      case "releases":
        initMetaList("releases");
        break;
      case "members":
        initMembers();
        break;
      case "settings":
        initSettings();
        break;
      case "search":
        initSearch();
        break;
      case "notifications":
        initNotifications();
        break;
      case "admin":
        initAdmin();
        break;
      default:
        break;
    }
  }
  init();
})();
