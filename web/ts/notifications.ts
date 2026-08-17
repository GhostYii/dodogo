// 通知中心：列表、单条已读、全部已读

import { api, errMsg } from './api';
import { el, qs, esc, timeAgo } from './util';
import { toast } from './toast';
import { openCardDetail } from './card-modal';
import type { NotificationDto } from './types';

const CARD_LINK_RE = /\/p\/([^/]+)\/card\/(\d+)/;

export function initNotifications(): void {
  const listEl = qs<HTMLElement>('#notifications-list');
  if (!listEl) return;

  const load = async (): Promise<void> => {
    listEl.innerHTML = '<div class="muted loading">加载中…</div>';
    try {
      const items = await api<NotificationDto[]>('/notifications?page=1&page_size=50');
      render(listEl, items);
      void refreshUnread();
    } catch (e) {
      listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };

  qs('#btn-read-all')?.addEventListener('click', async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      toast('已全部标记为已读', 'success');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });

  void load();
}

async function refreshUnread(): Promise<void> {
  try {
    const d = await api<{ count: number }>('/notifications/unread-count');
    const badge = qs('#unread-badge');
    if (badge) {
      const n = d.count || 0;
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);
    }
  } catch {
    /* ignore */
  }
}

function render(box: HTMLElement, items: NotificationDto[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">暂无通知</div>';
    return;
  }
  box.innerHTML = '';
  const list = el('div', { class: 'notif-list-inner' });
  for (const n of items) {
    const row = el('div', { class: 'notif-row' + (n.read ? '' : ' unread') });
    const dot = el('span', { class: 'notif-dot' });
    const main = el('div', { class: 'notif-main' });
    main.append(el('div', { class: 'notif-title', text: n.title }));
    if (n.body) main.append(el('div', { class: 'muted notif-body', text: n.body }));
    main.append(el('div', { class: 'muted', text: timeAgo(n.createdAt) }));
    row.append(dot, main);

    row.addEventListener('click', async () => {
      if (!n.read) {
        try {
          await api(`/notifications/${n.id}/read`, { method: 'POST' });
          n.read = true;
          row.classList.remove('unread');
          void refreshUnread();
        } catch {
          /* ignore */
        }
      }
      const m = CARD_LINK_RE.exec(n.link || '');
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
