// 卡片详情弹窗：标题/描述/侧栏字段/清单/评论/附件/活动/Git 关联

import { api, errMsg } from './api';
import { el, qs, qsa, esc, avatar, formField, selectBox, fmtDate, fmtDateTime, timeAgo, fmtSize, priorityText } from './util';
import { toast } from './toast';
import { openModal, closeModal, confirmDialog, promptDialog } from './modal';
import { mdToHtml } from './markdown';
import type { CardDetail, LabelDto, AssigneeDto, MemberDto, MilestoneDto, VersionDto, CommentDto, AttachmentDto, ActivityDto, GitCommitDto } from './types';

let currentCardId: number | null = null;
let detail: CardDetail | null = null;
let projectKey = '';
let labels: LabelDto[] = [];
let members: AssigneeDto[] = [];
let milestones: MilestoneDto[] = [];
let versions: VersionDto[] = [];
let currentUserId = 0;

export function getOpenCardId(): number | null {
  return currentCardId;
}

/** 卡片数据变更通知（看板页据此刷新） */
export function notifyCardChanged(): void {
  window.dispatchEvent(new CustomEvent('dodogo:card-changed', { detail: { cardId: currentCardId } }));
}

export async function openCardDetail(cardId: number): Promise<void> {
  closeModal(false);
  currentCardId = cardId;
  const body = el('div', { class: 'card-detail' });
  body.innerHTML = '<div class="loading">加载中…</div>';
  openModal({
    title: '卡片详情',
    body,
    width: '880px',
    onClose: () => {
      currentCardId = null;
      detail = null;
    },
  });
  try {
    const d = await api<CardDetail>('/cards/' + cardId);
    detail = d;
    await loadMeta(d);
    renderDetail(body, d);
  } catch (e) {
    body.innerHTML = `<div class="empty">${esc(errMsg(e))}</div>`;
  }
}

export async function refreshOpenCard(): Promise<void> {
  if (currentCardId == null) return;
  const body = qs<HTMLElement>('.card-detail');
  if (!body) return;
  try {
    const d = await api<CardDetail>('/cards/' + currentCardId);
    detail = d;
    await loadMeta(d);
    renderDetail(body, d);
  } catch {
    /* 保留旧内容 */
  }
}

async function loadMeta(d: CardDetail): Promise<void> {
  try {
    const me = await api<{ id: number }>('/auth/me');
    currentUserId = me.id;
  } catch {
    currentUserId = 0;
  }
  const idx = (d.number || '').lastIndexOf('-');
  projectKey = idx > 0 ? d.number.slice(0, idx) : '';
  if (!projectKey) return;
  const [ls, ms, vs, mb] = await Promise.all([
    api<LabelDto[]>(`/projects/${projectKey}/labels`).catch(() => [] as LabelDto[]),
    api<MilestoneDto[]>(`/projects/${projectKey}/milestones`).catch(() => [] as MilestoneDto[]),
    api<VersionDto[]>(`/projects/${projectKey}/releases`).catch(() => [] as VersionDto[]),
    api<MemberDto[]>(`/projects/${projectKey}/members`).catch(() => [] as MemberDto[]),
  ]);
  labels = ls;
  milestones = ms;
  versions = vs;
  members = mb.map((m) => ({ id: m.userId, username: m.username, displayName: m.displayName, avatarPath: m.avatarPath }));
}

function renderDetail(body: HTMLElement, d: CardDetail): void {
  body.innerHTML = '';

  const header = el('div', { class: 'cd-header' });
  header.append(el('span', { class: 'cd-number muted', text: d.number }));
  header.append(priorityBadge(d.priority, 'md'));
  const statusTxt = d.status === 'archived' ? '（已归档）' : '';
  if (statusTxt) header.append(el('span', { class: 'tag', style: 'background:rgba(245,158,11,.15);color:var(--warning)', text: statusTxt }));
  header.append(el('span', { class: 'muted cd-updated', text: '更新于 ' + fmtDateTime(d.updatedAt) }));

  const titleInput = el('input', { class: 'cd-title-input', type: 'text', placeholder: '卡片标题' });
  titleInput.value = d.title;
  titleInput.addEventListener('change', () => {
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
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur();
  });

  const main = el('div', { class: 'cd-main' });
  main.append(titleInput, buildDescription(d), buildChecklists(d), buildComments(d), buildAttachments(d), buildGit(d), buildActivity(d));
  const grid = el('div', { class: 'cd-grid' });
  grid.append(main, buildSidebar(d));
  body.append(header, grid);
}

// ============ 写操作 ============

async function patchCard(p: Record<string, unknown>): Promise<void> {
  await api(`/cards/${currentCardId}`, { method: 'PATCH', body: p });
  notifyCardChanged();
  await refreshOpenCard();
}

async function setLabels(labelIds: number[]): Promise<void> {
  await api(`/cards/${currentCardId}/labels`, { method: 'PUT', body: { label_ids: labelIds } });
  notifyCardChanged();
  await refreshOpenCard();
}

// ============ 描述 ============

function buildDescription(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: '描述' }));

  const view = el('div', { class: 'cd-desc-view markdown-body' });
  view.innerHTML = d.descriptionHtml || '<p class="muted">暂无描述，点击编辑添加。</p>';
  view.addEventListener('click', () => showEditor());

  const editor = el('div', { class: 'cd-desc-editor', hidden: 'true' });
  const ta = el('textarea', { class: 'input', rows: '6', placeholder: '支持 Markdown…' });
  ta.value = d.description || '';

  const tabs = el('div', { class: 'editor-tabs' });
  const editTab = el('button', { class: 'tab-btn active', type: 'button', text: '编辑' });
  const prevTab = el('button', { class: 'tab-btn', type: 'button', text: '预览' });
  const preview = el('div', { class: 'markdown-body cd-desc-preview', hidden: 'true' });

  const actions = el('div', { class: 'modal-actions' });
  const save = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '保存' });
  const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '取消' });

  function showEditor(): void {
    view.hidden = true;
    editor.hidden = false;
    ta.focus();
  }
  function hideEditor(): void {
    view.hidden = false;
    editor.hidden = true;
  }

  editTab.addEventListener('click', () => {
    editTab.classList.add('active');
    prevTab.classList.remove('active');
    ta.hidden = false;
    preview.hidden = true;
  });
  prevTab.addEventListener('click', async () => {
    prevTab.classList.add('active');
    editTab.classList.remove('active');
    preview.hidden = false;
    ta.hidden = true;
    preview.innerHTML = '<div class="loading">预览中…</div>';
    preview.innerHTML = await mdToHtml(ta.value);
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const v = ta.value;
      await patchCard({ description: v });
      d.description = v;
      view.innerHTML = await mdToHtml(v);
      hideEditor();
      toast('描述已保存', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    save.disabled = false;
  });
  cancel.addEventListener('click', hideEditor);

  actions.append(save, cancel);
  tabs.append(editTab, prevTab);
  editor.append(tabs, ta, preview, actions);
  sec.append(view, editor);
  return sec;
}

// ============ 侧栏 ============

function buildSidebar(d: CardDetail): HTMLElement {
  const aside = el('aside', { class: 'cd-sidebar' });

  // 指派人
  const assigneeOpts = members.map((m) => ({ value: String(m.id), text: m.displayName || m.username }));
  const assigneeSel = selectBox(assigneeOpts, d.assignee ? String(d.assignee.id) : '');
  if (!d.assignee) {
    assigneeSel.prepend(el('option', { value: '', text: '未指派（暂不可清除）', disabled: 'true', selected: 'true' }));
  }
  assigneeSel.addEventListener('change', () => {
    if (!assigneeSel.value) return;
    void patchCard({ assignee_id: Number(assigneeSel.value) });
  });
  aside.append(formField('指派人', assigneeSel));

  // 优先级
  const prioSel = selectBox(
    ['p0', 'p1', 'p2', 'p3'].map((p) => ({ value: p, text: `${p.toUpperCase()} · ${priorityText(p)}` })),
    d.priority,
  );
  prioSel.addEventListener('change', () => void patchCard({ priority: prioSel.value }));
  aside.append(formField('优先级', prioSel));

  // 标签（多选）
  const labelWrap = el('div', { class: 'label-picker' });
  const picked = new Set<number>(d.labels.map((l) => l.id));
  for (const l of labels) {
    const row = el('label', { class: 'check-row check-row-sm' });
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = picked.has(l.id);
    const dot = el('span', { class: 'label-dot', style: `background:${l.color}` });
    cb.addEventListener('change', () => {
      if (cb.checked) picked.add(l.id);
      else picked.delete(l.id);
      void setLabels(Array.from(picked));
    });
    row.append(cb, dot, el('span', { text: l.name }));
    labelWrap.append(row);
  }
  const newLabelBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '+ 新建标签' });
  newLabelBtn.addEventListener('click', async () => {
    const name = await promptDialog('新建标签', '标签名称');
    if (!name) return;
    const colors = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    try {
      const r = await api<{ id: number }>(`/projects/${projectKey}/labels`, { method: 'POST', body: { name, color } });
      labels.push({ id: r.id, name, color });
      picked.add(r.id);
      await setLabels(Array.from(picked));
      await refreshOpenCard();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  labelWrap.append(newLabelBtn);
  aside.append(formField('标签', labelWrap));

  // 日期与估算
  const startInput = el('input', { class: 'input', type: 'date' });
  startInput.value = d.startDate ? fmtDate(d.startDate) : '';
  startInput.addEventListener('change', () => void patchCard({ start_date: startInput.value || null }));
  aside.append(formField('开始日期', startInput));

  const dueInput = el('input', { class: 'input', type: 'date' });
  dueInput.value = d.dueDate ? fmtDate(d.dueDate) : '';
  dueInput.addEventListener('change', () => void patchCard({ due_date: dueInput.value || null }));
  aside.append(formField('截止日期', dueInput));

  const estInput = el('input', { class: 'input', type: 'number', min: '0', step: '0.5' });
  estInput.value = d.estimateHours != null ? String(d.estimateHours) : '';
  estInput.addEventListener('change', () => {
    const v = estInput.value;
    void patchCard({ estimate_hours: v === '' ? null : Number(v) });
  });
  aside.append(formField('估算工时（小时）', estInput));

  // 里程碑 / 版本
  const msOpts = [{ value: '', text: '不关联' }, ...milestones.map((m) => ({ value: String(m.id), text: m.name }))];
  const msSel = selectBox(msOpts, d.milestone ? String(d.milestone.id) : '');
  msSel.addEventListener('change', () => void patchCard({ milestone_id: msSel.value ? Number(msSel.value) : null }));
  aside.append(formField('里程碑', msSel));

  const vOpts = [{ value: '', text: '不关联' }, ...versions.map((v) => ({ value: String(v.id), text: v.name }))];
  const vSel = selectBox(vOpts, d.version ? String(d.version.id) : '');
  vSel.addEventListener('change', () => void patchCard({ version_id: vSel.value ? Number(vSel.value) : null }));
  aside.append(formField('版本', vSel));

  // 操作
  const ops = el('div', { class: 'cd-ops' });
  const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '复制卡片' });
  copyBtn.addEventListener('click', async () => {
    try {
      await api(`/cards/${d.id}/copy`, { method: 'POST' });
      toast('已复制', 'success');
      notifyCardChanged();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  const archiveBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: d.status === 'archived' ? '恢复卡片' : '归档卡片' });
  archiveBtn.addEventListener('click', async () => {
    if (d.status !== 'archived' && !(await confirmDialog('归档该卡片？归档后看板中不再显示。', { danger: true }))) return;
    try {
      await api(`/cards/${d.id}/archive`, { method: 'POST' });
      toast('已归档', 'success');
      closeModal();
      notifyCardChanged();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  const delBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: '删除卡片' });
  delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('删除后不可恢复，确定删除该卡片？', { danger: true, okText: '删除' }))) return;
    try {
      await api(`/cards/${d.id}`, { method: 'DELETE' });
      toast('已删除', 'success');
      closeModal();
      notifyCardChanged();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  ops.append(copyBtn, archiveBtn, delBtn);
  aside.append(formField('操作', ops));

  return aside;
}

// ============ 清单 ============

function buildChecklists(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: '清单' }));

  const total = d.checklists.reduce((s, cl) => s + cl.items.length, 0);
  const done = d.checklists.reduce((s, cl) => s + cl.items.filter((i) => i.done).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = el('div', { class: 'progress' });
  bar.append(el('div', { class: 'progress-fill', style: `width:${pct}%` }));
  const barRow = el('div', { class: 'checklist-progress' });
  barRow.append(bar, el('span', { class: 'muted', text: `${done}/${total}` }));
  sec.append(barRow);

  for (const cl of d.checklists) {
    const clEl = el('div', { class: 'checklist' });
    const clHead = el('div', { class: 'checklist-head' });
    clHead.append(el('span', { class: 'checklist-title', text: cl.title }));
    const delCl = el('button', { class: 'btn-icon', type: 'button', text: '✕', title: '删除清单' });
    delCl.addEventListener('click', async () => {
      if (!(await confirmDialog('删除该清单？', { danger: true }))) return;
      try {
        await api(`/checklists/${cl.id}`, { method: 'DELETE' });
        notifyCardChanged();
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    });
    clHead.append(delCl);
    clEl.append(clHead);

    const items = el('div', { class: 'checklist-items' });
    for (const item of cl.items) {
      const row = el('label', { class: 'checklist-item' + (item.done ? ' done' : '') });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = item.done;
      cb.addEventListener('change', async () => {
        row.classList.toggle('done', cb.checked);
        try {
          await api(`/checklist-items/${item.id}`, { method: 'PATCH', body: { done: cb.checked } });
          notifyCardChanged();
          await refreshOpenCard();
        } catch (e) {
          cb.checked = !cb.checked;
          row.classList.toggle('done', cb.checked);
          toast(errMsg(e), 'error');
        }
      });
      const label = el('span', { text: item.title });
      const del = el('button', { class: 'btn-icon', type: 'button', text: '✕', title: '删除条目' });
      del.addEventListener('click', async () => {
        try {
          await api(`/checklist-items/${item.id}`, { method: 'DELETE' });
          notifyCardChanged();
          await refreshOpenCard();
        } catch (e) {
          toast(errMsg(e), 'error');
        }
      });
      row.append(cb, label, del);
      items.append(row);
    }
    clEl.append(items);
    clEl.append(buildAddChecklistItem(cl.id));
    sec.append(clEl);
  }

  const addBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '+ 添加清单' });
  addBtn.addEventListener('click', async () => {
    const t = await promptDialog('新建清单', '清单标题');
    if (!t) return;
    try {
      await api(`/cards/${currentCardId}/checklists`, { method: 'POST', body: { title: t } });
      notifyCardChanged();
      await refreshOpenCard();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  sec.append(addBtn);
  return sec;
}

function buildAddChecklistItem(clId: number): HTMLElement {
  const wrap = el('div', { class: 'add-inline' });
  const input = el('input', { class: 'input input-sm', type: 'text', placeholder: '添加条目，回车确认' });
  async function add(): Promise<void> {
    const v = input.value.trim();
    if (!v) return;
    input.disabled = true;
    try {
      await api(`/checklists/${clId}/items`, { method: 'POST', body: { title: v } });
      input.value = '';
      notifyCardChanged();
      await refreshOpenCard();
      input.disabled = false;
      input.focus();
    } catch (e) {
      toast(errMsg(e), 'error');
      input.disabled = false;
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  wrap.append(input);
  return wrap;
}

// ============ 评论 ============

function buildComments(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: `评论（${d.comments.length}）` }));

  const list = el('div', { class: 'comment-list' });
  for (const c of d.comments) list.append(buildCommentRow(c));
  sec.append(list);

  const editor = el('div', { class: 'comment-editor' });
  const ta = el('textarea', { class: 'input', rows: '3', placeholder: '输入评论，支持 Markdown；可直接粘贴图片上传' });
  ta.addEventListener('paste', async (e: ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (!files || !files.length) return;
    if (!Array.from(files).some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const fd = new FormData();
        fd.append('file', f);
        const a = await api<{ id: number; fileName: string }>(`/cards/${currentCardId}/attachments`, { method: 'POST', form: fd });
        ta.value += (ta.value ? '\n' : '') + `![${a.fileName}](/api/attachments/${a.id}/download)`;
        toast('图片已上传并插入评论', 'success');
      } catch (err) {
        toast(errMsg(err), 'error');
      }
    }
  });
  const hint = el('div', { class: 'muted field-hint', text: 'Ctrl+Enter 提交' });
  const submit = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '评论' });
  async function post(): Promise<void> {
    const v = ta.value.trim();
    if (!v) return;
    submit.disabled = true;
    try {
      await api(`/cards/${currentCardId}/comments`, { method: 'POST', body: { content: v } });
      ta.value = '';
      notifyCardChanged();
      await refreshOpenCard();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    submit.disabled = false;
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post();
  });
  submit.addEventListener('click', () => void post());
  const actions = el('div', { class: 'modal-actions' });
  actions.append(submit);
  editor.append(ta, hint, actions);
  sec.append(editor);
  return sec;
}

function buildCommentRow(c: CommentDto): HTMLElement {
  const row = el('div', { class: 'comment' });
  row.append(avatar({ id: c.userId, avatarPath: c.avatarPath, displayName: c.displayName, username: c.username }, 'sm'));
  const main = el('div', { class: 'comment-main' });
  const head = el('div', { class: 'comment-head' });
  head.append(el('span', { class: 'comment-author', text: c.displayName || c.username }));
  head.append(el('span', { class: 'muted', text: timeAgo(c.createdAt) }));
  main.append(head);
  const content = el('div', { class: 'markdown-body' });
  content.innerHTML = c.contentHtml;
  main.append(content);
  row.append(main);
  return row;
}

// ============ 附件 ============

function buildAttachments(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: `附件（${d.attachments.length}）` }));

  const list = el('div', { class: 'attach-list' });
  for (const a of d.attachments) {
    const row = el('div', { class: 'attach-row' });
    const link = el('a', { class: 'attach-name', href: `/api/attachments/${a.id}/download`, text: a.fileName });
    const del = el('button', { class: 'btn-icon', type: 'button', text: '✕', title: '删除附件' });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('删除该附件？', { danger: true }))) return;
      try {
        await api(`/attachments/${a.id}`, { method: 'DELETE' });
        notifyCardChanged();
        await refreshOpenCard();
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    });
    row.append(link, el('span', { class: 'muted', text: fmtSize(a.fileSize) }), el('span', { class: 'muted', text: a.uploaderName + ' · ' + timeAgo(a.createdAt) }), del);
    list.append(row);
  }
  sec.append(list);

  const up = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '+ 上传附件' });
  const fileInput = el('input', { type: 'file', hidden: 'true' });
  up.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api(`/cards/${currentCardId}/attachments`, { method: 'POST', form: fd });
      toast('上传成功', 'success');
      notifyCardChanged();
      await refreshOpenCard();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    fileInput.value = '';
  });
  sec.append(up);
  return sec;
}

// ============ Git 关联 ============

function buildGit(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: 'Git 关联' }));
  const list = el('div', { class: 'git-list' });
  if (!d.gitCommits.length) {
    list.append(el('p', { class: 'muted', text: '暂无关联提交（可通过 GitLab 同步关联）' }));
  }
  for (const g of d.gitCommits) {
    const row = el('div', { class: 'git-row' });
    const sha = el('a', { class: 'git-sha', href: g.commitUrl || '#', target: '_blank', rel: 'noopener', text: g.shortSha });
    row.append(sha, el('span', { class: 'git-msg', text: g.message }));
    row.append(el('span', { class: 'muted', text: g.authorName + ' · ' + (g.committedAt ? timeAgo(g.committedAt) : '') }));
    if (g.mrUrl) row.append(el('a', { class: 'git-mr', href: g.mrUrl, target: '_blank', rel: 'noopener', text: 'MR' }));
    list.append(row);
  }
  sec.append(list);
  return sec;
}

// ============ 活动 ============

const ACTION_LABELS: Record<string, string> = {
  created: '创建了',
  updated: '更新了',
  moved: '移动了',
  commented: '评论了',
  archived: '归档了',
  restored: '恢复了',
};

function buildActivity(d: CardDetail): HTMLElement {
  const sec = el('section', { class: 'cd-section' });
  sec.append(el('h4', { class: 'cd-section-title', text: '活动' }));
  const list = el('div', { class: 'activity-list' });
  if (!d.activities.length) list.append(el('p', { class: 'muted', text: '暂无活动记录' }));
  for (const a of d.activities) {
    const row = el('div', { class: 'activity-row' });
    row.append(avatar({ id: a.userId ?? undefined, avatarPath: null, displayName: a.displayName, username: a.username }, 'xs'));
    const who = a.displayName || a.username || '系统';
    const verb = ACTION_LABELS[a.action] || a.action;
    row.append(el('span', { class: 'activity-who', text: who }), el('span', { class: 'activity-detail', text: `${verb} ${a.detail || ''}`.trim() }));
    row.append(el('span', { class: 'muted', text: timeAgo(a.createdAt) }));
    list.append(row);
  }
  sec.append(list);
  return sec;
}

// ============ 公共小部件 ============

export function priorityBadge(p: string, size: 'sm' | 'md' = 'sm'): HTMLElement {
  return el('span', { class: `prio prio-${p} prio-${size}`, text: priorityText(p) });
}
