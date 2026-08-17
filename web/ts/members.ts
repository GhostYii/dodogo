// 项目成员页：列表、添加成员、改角色、移除

import { api, errMsg } from './api';
import { el, qs, esc, avatar, fmtDate, formField } from './util';
import { toast } from './toast';
import { openModal, closeModal, confirmDialog } from './modal';
import type { MemberDto } from './types';

const ROLE_OPTIONS: [string, string][] = [
  ['owner', '所有者'],
  ['admin', '管理员'],
  ['member', '成员'],
  ['viewer', '观察者'],
];

export function initMembers(): void {
  const projectKey = document.body.dataset.projectKey || '';
  const listEl = qs<HTMLElement>('#members-list');
  if (!listEl) return;

  const load = async (): Promise<void> => {
    listEl.innerHTML = '<div class="muted loading">加载中…</div>';
    try {
      const members = await api<MemberDto[]>('/projects/' + projectKey + '/members');
      render(listEl, members, load);
    } catch (e) {
      listEl.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
    }
  };

  qs('#btn-add-member')?.addEventListener('click', () => openAddModal(projectKey, load));
  void load();
}

function render(listEl: HTMLElement, members: MemberDto[], reload: () => Promise<void>): void {
  if (!members.length) {
    listEl.innerHTML = '<div class="empty">暂无成员</div>';
    return;
  }
  listEl.innerHTML = '';
  const table = el('table', { class: 'table' });
  const thead = el('thead');
  thead.append(el('tr'));
  const heads = ['成员', '角色', '加入时间', '操作'];
  for (const h of heads) thead.querySelector('tr')!.append(el('th', { text: h }));
  table.append(thead);

  const tbody = el('tbody');
  for (const m of members) {
    const tr = el('tr');
    const nameTd = el('td', { class: 'cell-user' });
    nameTd.append(avatar({ id: m.userId, avatarPath: m.avatarPath, displayName: m.displayName, username: m.username }, 'sm'));
    nameTd.append(el('span', { class: 'cell-name', text: m.displayName || m.username }));
    if (m.username && m.displayName !== m.username) nameTd.append(el('span', { class: 'muted', text: '@' + m.username }));
    tr.append(nameTd);

    const roleTd = el('td');
    if (m.role === 'owner') {
      roleTd.append(el('span', { class: 'tag', style: 'background:rgba(139,92,246,.15);color:#8B5CF6', text: '所有者' }));
    } else {
      const sel = el('select', { class: 'select select-sm' });
      for (const [v, t] of ROLE_OPTIONS) {
        if (v === 'owner') continue;
        const opt = el('option', { value: v, text: t });
        if (v === m.role) opt.selected = true;
        sel.append(opt);
      }
      sel.addEventListener('change', async () => {
        try {
          await api(`/projects/${document.body.dataset.projectKey}/members/${m.userId}`, { method: 'PATCH', body: { role: sel.value } });
          toast('角色已更新', 'success');
          await reload();
        } catch (e) {
          toast(errMsg(e), 'error');
          await reload();
        }
      });
      roleTd.append(sel);
    }
    tr.append(roleTd);

    tr.append(el('td', { class: 'muted', text: fmtDate(m.joinedAt) }));

    const opTd = el('td');
    if (m.role !== 'owner') {
      const del = el('button', { class: 'btn btn-ghost btn-sm btn-danger-text', type: 'button', text: '移除' });
      del.addEventListener('click', async () => {
        if (!(await confirmDialog(`移除成员 ${m.displayName || m.username}？`, { danger: true, okText: '移除' }))) return;
        try {
          await api(`/projects/${document.body.dataset.projectKey}/members/${m.userId}`, { method: 'DELETE' });
          toast('已移除', 'success');
          await reload();
        } catch (e) {
          toast(errMsg(e), 'error');
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

function openAddModal(projectKey: string, reload: () => Promise<void>): void {
  const body = el('div', { class: 'form-stack' });
  const identityInput = el('input', { class: 'input', type: 'text', placeholder: '用户名或邮箱' });
  body.append(formField('成员（用户名或邮箱）', identityInput));

  const roleSel = el('select', { class: 'select' });
  for (const [v, t] of ROLE_OPTIONS) {
    if (v === 'owner') continue;
    roleSel.append(el('option', { value: v, text: t }));
  }
  body.append(formField('角色', roleSel));

  const foot = el('div', { class: 'modal-actions' });
  const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
  const ok = el('button', { class: 'btn btn-primary', type: 'button', text: '添加' });
  cancel.addEventListener('click', () => closeModal());
  ok.addEventListener('click', async () => {
    const identity = identityInput.value.trim();
    if (!identity) {
      toast('请输入用户名或邮箱', 'error');
      return;
    }
    ok.disabled = true;
    try {
      await api(`/projects/${projectKey}/members`, { method: 'POST', body: { identity, role: roleSel.value } });
      toast('已添加', 'success');
      closeModal();
      await reload();
    } catch (e) {
      toast(errMsg(e), 'error');
      ok.disabled = false;
    }
  });
  foot.append(cancel, ok);
  openModal({ title: '添加成员', body, footer: foot, width: '440px' });
  identityInput.focus();
}
