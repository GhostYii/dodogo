// 成员个人主页弹窗：点击成员名称/头像打开（非独立页面）

import { api, errMsg } from './api';
import { el, avatar } from './util';
import { openModal } from './modal';
import { toast } from './toast';

interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  system_admin: '系统管理员',
  user: '普通用户',
};

/** 全局拦截 .user-link 点击，以弹窗打开成员信息。 */
export function initUserProfileLinks(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const link = t.closest<HTMLAnchorElement>('a.user-link');
    if (!link) return;
    const m = /\/users\/(\d+)/.exec(link.getAttribute('href') || '');
    if (!m) return;
    e.preventDefault();
    void openUserProfile(Number(m[1]));
  });
}

export async function openUserProfile(userId: number): Promise<void> {
  let p: UserProfile;
  try {
    p = await api<UserProfile>('/users/' + userId);
  } catch (e) {
    toast(errMsg(e), 'error');
    return;
  }
  const body = el('div', { class: 'user-profile' });
  const card = el('div', { class: 'user-profile-card' });
  card.append(avatar({ id: p.id, avatarPath: p.avatarPath, displayName: p.displayName, username: p.username }, 'xl'));
  card.append(el('h2', { class: 'user-profile-name', text: p.displayName || p.username }));
  card.append(el('p', { class: 'user-profile-username', text: '@' + p.username }));
  const meta = el('div', { class: 'user-profile-meta' });
  meta.append(el('span', { class: 'tag', text: ROLE_LABELS[p.role] || p.role }));
  const created = p.createdAt ? String(p.createdAt).slice(0, 10) : '';
  if (created) meta.append(el('span', { class: 'muted', text: '加入于 ' + created }));
  card.append(meta);
  body.append(card);
  openModal({ title: '成员信息', body, width: '440px' });
}
