// 顶栏：主题切换、用户菜单、全局搜索、未读通知（SSE + 轮询）、快捷键

import { api, errMsg } from './api';
import { el, qs, qsa, avatar, formField, isTyping } from './util';
import { toggleTheme } from './theme';
import { toast } from './toast';
import { openModal } from './modal';

export function initTopbar(): void {
  qs('#theme-toggle')?.addEventListener('click', toggleTheme);

  const chip = qs('#user-chip');
  const menu = qs<HTMLElement>('#user-menu');
  if (chip && menu) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => {
      menu.hidden = true;
    });
    qsa<HTMLButtonElement>('[data-action]', menu).forEach((btn) => {
      btn.addEventListener('click', () => {
        menu.hidden = true;
        void handleUserAction(btn.dataset.action || '');
      });
    });
  }

  const gs = qs<HTMLInputElement>('#global-search');
  gs?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = gs.value.trim();
      if (v) location.href = '/search?q=' + encodeURIComponent(v);
    }
  });

  void refreshUnread();
  initUnreadSse();
  initShortcuts();
}

// ============ 用户菜单 ============

async function handleUserAction(action: string): Promise<void> {
  if (action === 'logout') {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    location.href = '/login';
  } else if (action === 'profile') {
    await openProfileModal();
  }
}

interface Me {
  id: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  email?: string;
}

async function openProfileModal(): Promise<void> {
  let me: Me;
  try {
    me = await api<Me>('/auth/me');
  } catch {
    return;
  }
  const body = el('div', { class: 'profile-form' });

  const avatarRow = el('div', { class: 'profile-avatar-row' });
  avatarRow.append(avatar(me, 'lg'));
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: 'true' });
  const avatarBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '更换头像' });
  avatarBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      await api('/auth/avatar', { method: 'POST', form: fd });
      toast('头像已更新', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  avatarRow.append(avatarBtn, fileInput);
  body.append(avatarRow);

  const nameInput = el('input', { class: 'input', type: 'text', maxlength: '60' });
  nameInput.value = me.displayName || '';
  body.append(formField('昵称', nameInput));

  const emailInput = el('input', { class: 'input', type: 'email' });
  emailInput.value = me.email || '';
  body.append(formField('邮箱', emailInput));

  body.append(el('div', { class: 'section-divider' }));

  const oldPwd = el('input', { class: 'input', type: 'password', placeholder: '旧密码' });
  const newPwd = el('input', { class: 'input', type: 'password', placeholder: '新密码（8-64 位，含字母数字）' });
  const newPwd2 = el('input', { class: 'input', type: 'password', placeholder: '确认新密码' });
  body.append(formField('旧密码', oldPwd));
  body.append(formField('新密码', newPwd));
  body.append(formField('确认新密码', newPwd2));

  const foot = el('div', { class: 'modal-actions' });
  const save = el('button', { class: 'btn btn-primary', type: 'button', text: '保存' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api('/auth/me', {
        method: 'PATCH',
        body: { display_name: nameInput.value.trim() || me.username, email: emailInput.value.trim() || null },
      });
      const oldP = oldPwd.value;
      const newP = newPwd.value;
      if (oldP || newP) {
        if (newP !== newPwd2.value) {
          toast('两次输入的新密码不一致', 'error');
          save.disabled = false;
          return;
        }
        await api('/auth/password', { method: 'PUT', body: { old_password: oldP, new_password: newP } });
      }
      toast('已保存', 'success');
      location.reload();
    } catch (e) {
      toast(errMsg(e), 'error');
      save.disabled = false;
    }
  });
  foot.append(save);
  openModal({ title: '个人设置', body, footer: foot, width: '480px' });
}

// ============ 未读通知 ============

async function refreshUnread(): Promise<void> {
  try {
    const d = await api<{ count: number }>('/notifications/unread-count');
    const badge = qs('#unread-badge');
    if (!badge) return;
    const n = d.count || 0;
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
  } catch {
    /* ignore */
  }
}

function initUnreadSse(): void {
  const es = new EventSource('/api/stream');
  es.addEventListener('notification.new', () => void refreshUnread());
  es.onerror = () => {
    /* EventSource 自动重连 */
  };
  // 兜底轮询，防止 SSE 偶发断开
  setInterval(() => void refreshUnread(), 120000);
}

// ============ 快捷键 ============

function showHelp(): void {
  const rows: [string, string][] = [
    ['/', '聚焦全局搜索'],
    ['Esc', '关闭弹窗 / 菜单'],
    ['Shift + ?', '显示本帮助'],
    ['Ctrl + Enter', '评论框中提交评论'],
  ];
  const body = el('div', { class: 'help-list' });
  for (const [k, d] of rows) {
    const row = el('div', { class: 'help-row' });
    row.append(el('code', { class: 'kbd', text: k }), el('span', { text: d }));
    body.append(row);
  }
  openModal({ title: '键盘快捷键', body });
}

function initShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (e.key === '/') {
      e.preventDefault();
      const s = qs<HTMLInputElement>('#global-search');
      if (s) {
        s.focus();
        s.select();
      }
    } else if (e.key === '?' && e.shiftKey) {
      e.preventDefault();
      showHelp();
    }
  });
}
