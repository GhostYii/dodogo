// DOM 与格式化辅助

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c as Node);
  return node;
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** 为密码输入框追加「显示/隐藏密码」切换按钮（包装成 .pwd-wrap）。 */
export function addPasswordToggles(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    if (input.closest('.pwd-wrap')) return; // 已处理过
    const wrap = el('div', { class: 'pwd-wrap' });
    input.parentNode?.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = el('button', { class: 'pwd-toggle', type: 'button', title: '显示密码', 'aria-label': '显示密码' });
    btn.textContent = '👁';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.title = show ? '隐藏密码' : '显示密码';
    });
    wrap.appendChild(btn);
  });
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** "2025-01-31" 或 ISO 时间 → 显示日期 */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  return fmtDate(iso);
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initialsOf(name: string): string {
  const t = (name || '?').trim();
  const chars = Array.from(t);
  return (chars[0] || '?') + (chars[1] || '');
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(59,130,246,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface AvatarLike {
  id?: number;
  userId?: number;
  avatarPath?: string | null;
  displayName?: string | null;
  username?: string | null;
}

/** 头像元素：有头像则用 /api/avatars/{id}，否则显示首字 */
export function avatar(user: AvatarLike | null | undefined, size: 'xs' | 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const name = (user?.displayName || user?.username || '?').trim();
  const id = user?.id ?? user?.userId;
  if (user?.avatarPath && id != null) {
    const img = el('img', { class: `avatar avatar-${size}`, alt: name });
    img.src = `/api/avatars/${id}`;
    return img;
  }
  return el('span', { class: `avatar avatar-${size} avatar-initial`, text: initialsOf(name) });
}

/** 成员名称 + 头像的超链接（跳转到个人主页 /users/{id}）。 */
export function userLink(user: AvatarLike | null | undefined, size: 'xs' | 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const id = user?.id ?? user?.userId;
  const display = (user?.displayName || user?.username || '?').trim();
  const username = (user?.username || '').trim();
  const a = el('a', { class: 'user-link', href: id != null ? `/users/${id}` : '#' });
  a.append(avatar(user, size));
  a.append(el('span', { text: display }));
  if (username && username !== display) {
    a.append(el('span', { class: 'muted', text: '@' + username }));
  }
  return a;
}

export function priorityText(p: string): string {
  switch (p) {
    case 'p0': return '紧急';
    case 'p1': return '高';
    case 'p2': return '中';
    case 'p3': return '低';
    default: return '中';
  }
}

/** 表单字段包装：label + control */
export function formField(label: string, control: HTMLElement, hint = ''): HTMLElement {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { text: label }));
  wrap.append(control);
  if (hint) wrap.append(el('div', { class: 'field-hint muted', text: hint }));
  return wrap;
}

export function selectBox(options: { value: string; text: string }[], current: string, attrs: Record<string, string> = {}): HTMLSelectElement {
  const sel = el('select', { class: 'select', ...attrs }) as HTMLSelectElement;
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.text });
    if (o.value === current) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}
