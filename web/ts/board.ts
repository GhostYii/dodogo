// 看板页：列渲染、卡片拖拽（原生 HTML5 DnD + 乐观更新）、快速建卡、筛选、SSE

import { api, errMsg } from './api';
import { el, qs, qsa, esc, avatar, debounce, fmtDate, hexToRgba } from './util';
import { toast } from './toast';
import { promptDialog, confirmDialog } from './modal';
import { openCardDetail, getOpenCardId, refreshOpenCard, priorityBadge } from './card-modal';
import type { BoardFull, CardSummary, ColumnDto } from './types';

const boardEl = qs<HTMLElement>('#board');
const boardId = Number(boardEl?.dataset.boardId || 0);
const projectKey = boardEl?.dataset.projectKey || '';

const COLUMN_COLORS = ['#3B82F6', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#8B5CF6', '#EC4899'];

let data: BoardFull | null = null;
let filterQ = '';
let filterAssignee = '';
let filterLabel = '';
let filterPriority = '';
let dragCardId: number | null = null;
let dragColId: number | null = null;
let justDragged = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function initBoard(): void {
  if (!boardEl || !boardId) return;

  qs('#board-select')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v) location.href = `/p/${projectKey}/board/${v}`;
  });
  qs('#btn-new-board')?.addEventListener('click', async () => {
    const name = await promptDialog('新建看板', '看板名称');
    if (!name) return;
    try {
      const b = await api<{ id: number }>(`/projects/${projectKey}/boards`, { method: 'POST', body: { name } });
      location.href = `/p/${projectKey}/board/${b.id}`;
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });

  const qInput = qs<HTMLInputElement>('#filter-q');
  qInput?.addEventListener('input', debounce(() => {
    filterQ = qInput.value.trim();
    rerender();
  }, 200));
  qs('#filter-assignee')?.addEventListener('change', (e) => {
    filterAssignee = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#filter-label')?.addEventListener('change', (e) => {
    filterLabel = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#filter-priority')?.addEventListener('change', (e) => {
    filterPriority = (e.target as HTMLSelectElement).value;
    rerender();
  });
  qs('#btn-filter-reset')?.addEventListener('click', () => {
    filterQ = '';
    filterAssignee = '';
    filterLabel = '';
    filterPriority = '';
    if (qInput) qInput.value = '';
    qsa<HTMLSelectElement>('#filter-assignee, #filter-label, #filter-priority').forEach((s) => (s.value = ''));
    rerender();
  });

  void load();
  initSse();
  // 点击其它区域时收起列颜色选择面板（颜色按钮自身由 click 处理开关）
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    qsa<HTMLElement>('.col-color-pop').forEach((p) => {
      if (p.hidden) return;
      if (p.contains(t)) return; // 面板内部交互（含自定义取色 input）不关闭
      if (t.closest('.col-color-btn')) return;
      p.hidden = true;
    });
  }, true);
  // Escape 收起列颜色选择面板
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') qsa<HTMLElement>('.col-color-pop').forEach((p) => (p.hidden = true));
  });
  window.addEventListener('dodogo:card-changed', () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void load(), 250);
  });
}

// ============ 数据 ============

async function load(): Promise<void> {
  try {
    data = await api<BoardFull>(`/boards/${boardId}`);
    render();
    refreshFilterOptions();
  } catch (e) {
    boardEl!.innerHTML = `<div class="empty">加载看板失败：${esc(errMsg(e))}</div>`;
  }
}

// ============ 渲染 ============

function rerender(): void {
  if (!data) return;
  render();
}

function render(): void {
  if (!data) return;
  const columns = [...data.columns].sort((a, b) => a.position - b.position);
  boardEl!.innerHTML = '';
  for (const col of columns) boardEl!.append(buildColumn(col));
  boardEl!.append(buildAddColumn());
}

function buildColumn(col: ColumnDto): HTMLElement {
  const colEl = el('div', { class: 'board-col', 'data-col': String(col.id) });
  const cards = data!.cards.filter((c) => c.columnId === col.id).sort((a, b) => a.position - b.position);

  const head = el('div', { class: 'col-head' });
  head.draggable = true;

  const nameSpan = el('span', { class: 'col-name', text: col.name });
  nameSpan.title = '点击改名，可拖拽排序';
  head.append(nameSpan);

  // 列头计数：默认只显示卡片总数；有 WIP 上限时显示「总数 / 上限」，超限高亮
  const countEl = el('span', { class: 'col-count', text: String(cards.length) });
  if (col.wipLimit > 0) {
    countEl.textContent = `${cards.length} / ${col.wipLimit}`;
    countEl.title = `WIP 上限 ${col.wipLimit}`;
    if (cards.length > col.wipLimit) {
      countEl.classList.add('col-count-over');
      countEl.title = `已超过 WIP 上限 ${col.wipLimit}`;
    }
  }
  head.append(countEl);

  const colActions = el('span', { class: 'col-actions' });

  // 颜色选择（复用 8 色板 + 自定义），选中后作为列头/列区域背景色
  const colorBtn = el('button', { class: 'btn-icon col-color-btn', type: 'button', title: '列颜色' });
  colorBtn.textContent = '🎨';
  const colorPop = el('div', { class: 'col-color-pop', hidden: 'true' });
  for (const c of COLUMN_COLORS) {
    const sw = el('button', {
      class: 'swatch' + (c === (col.color || COLUMN_COLORS[0]) ? ' active' : ''),
      type: 'button',
      style: `background:${c}`,
    });
    sw.addEventListener('click', () => void applyColumnColor(col, c, colorPop));
    colorPop.append(sw);
  }
  const custom = el('input', { type: 'color', title: '自定义颜色' }) as HTMLInputElement;
  custom.value = /^#[0-9a-fA-F]{6}$/.test(col.color || '') ? col.color : COLUMN_COLORS[0];
  // 拖动取色：input 事件实时更新列背景预览（不提交、不关闭面板）
  custom.addEventListener('input', () => {
    colEl.style.background = hexToRgba(custom.value, 0.06);
    head.style.background = hexToRgba(custom.value, 0.16);
  });
  // 松手 / 确认：change 事件才最终提交并关闭面板
  custom.addEventListener('change', () => void applyColumnColor(col, custom.value, colorPop));
  colorPop.append(custom);
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = colorPop.hidden;
    qsa<HTMLElement>('.col-color-pop').forEach((p) => (p.hidden = true));
    colorPop.hidden = !willShow;
  });

  const delBtn = el('button', { class: 'btn-icon', type: 'button', text: '✕', title: '删除列' });
  delBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(`删除列「${col.name}」？（列内不能有卡片）`, { danger: true }))) return;
    try {
      await api(`/columns/${col.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  colActions.append(colorBtn, delBtn);
  head.append(colActions, colorPop);

  // 列颜色 → 浅色背景（列头稍深，列区域更浅）
  if (col.color) {
    colEl.style.background = hexToRgba(col.color, 0.06);
    head.style.background = hexToRgba(col.color, 0.16);
  }

  // 列名内联改名
  nameSpan.addEventListener('click', () => startColumnRename(head, nameSpan, col));

  setupColumnDrag(head, col);

  const body = el('div', { class: 'col-cards', 'data-col-body': String(col.id) });
  for (const card of cards) {
    const node = buildCard(card);
    if (!matchFilters(card)) node.classList.add('filtered-out');
    body.append(node);
  }
  setupDropZone(body, col.id);

  const foot = el('div', { class: 'col-foot' });
  foot.append(buildAddCard(col.id));

  colEl.append(head, body, foot);
  return colEl;
}

/** 列内联改名。 */
function startColumnRename(head: HTMLElement, nameSpan: HTMLElement, col: ColumnDto): void {
  const input = el('input', { class: 'input input-sm col-name-input', type: 'text', maxlength: '30' });
  input.value = col.name;
  head.replaceChild(input, nameSpan);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit: boolean): Promise<void> => {
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
      toast('列名已更新', 'success');
    } catch (e) {
      toast(errMsg(e), 'error');
      if (input.isConnected) head.replaceChild(nameSpan, input);
    }
  };
  input.addEventListener('blur', () => void finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      void finish(false);
    }
  });
}

/** 列颜色变更（PATCH /columns/{id}）。 */
async function applyColumnColor(col: ColumnDto, color: string, pop: HTMLElement): Promise<void> {
  pop.hidden = true;
  try {
    await patchColumn(col, { color });
    toast('列颜色已更新', 'success');
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

/** 更新列：始终携带全部字段，避免后端把未传字段重置为默认值。 */
async function patchColumn(col: ColumnDto, patch: Partial<Pick<ColumnDto, 'name' | 'color' | 'wipLimit' | 'isDone'>>): Promise<void> {
  await api(`/columns/${col.id}`, {
    method: 'PATCH',
    body: {
      name: patch.name ?? col.name,
      color: patch.color ?? col.color,
      wip_limit: patch.wipLimit ?? col.wipLimit,
      is_done: patch.isDone ?? col.isDone,
    },
  });
  await load();
}

// ============ 列拖拽排序 ============

function setupColumnDrag(head: HTMLElement, col: ColumnDto): void {
  head.addEventListener('dragstart', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, .col-color-pop')) {
      e.preventDefault();
      return;
    }
    dragColId = col.id;
    head.classList.add('col-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(col.id));
    }
  });
  head.addEventListener('dragend', () => {
    dragColId = null;
    qsa('.col-head.col-dragging').forEach((h) => h.classList.remove('col-dragging'));
    clearColumnIndicators();
  });
  head.addEventListener('dragover', (e) => {
    if (dragColId == null || dragColId === col.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearColumnIndicators();
    const r = head.getBoundingClientRect();
    head.classList.add(e.clientX < r.left + r.width / 2 ? 'col-drop-before' : 'col-drop-after');
  });
  head.addEventListener('dragleave', () => {
    head.classList.remove('col-drop-before', 'col-drop-after');
  });
  head.addEventListener('drop', (e) => {
    if (dragColId == null || dragColId === col.id) return;
    e.preventDefault();
    const before = head.classList.contains('col-drop-before');
    clearColumnIndicators();
    const cols = [...data!.columns].sort((a, b) => a.position - b.position);
    const targetIdx = cols.findIndex((c) => c.id === col.id);
    const position = before ? targetIdx : targetIdx + 1;
    void moveColumn(dragColId, position);
  });
}

function clearColumnIndicators(): void {
  qsa('.col-head.col-drop-before, .col-head.col-drop-after').forEach((h) => h.classList.remove('col-drop-before', 'col-drop-after'));
}

async function moveColumn(columnId: number, targetIndex: number): Promise<void> {
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
    await api(`/columns/${columnId}/move`, { method: 'POST', body: { position: insert } });
    await load();
  } catch (e) {
    await load();
    toast(errMsg(e), 'error');
  }
}

function buildCard(card: CardSummary): HTMLElement {
  const node = el('div', { class: 'card', draggable: 'true', 'data-card': String(card.id) });
  const cardLabels = data!.labels.filter((l) => card.labelIds.includes(l.id));

  // 封面图（有 coverUrl 才显示）
  if (card.coverUrl) {
    const cover = el('div', { class: 'card-cover' });
    const img = el('img', { class: 'card-cover-img', alt: '', loading: 'lazy' });
    img.src = card.coverUrl;
    cover.append(img);
    node.append(cover);
  }

  const top = el('div', { class: 'card-top' });
  top.append(el('span', { class: 'card-no muted', text: card.number }), priorityBadge(card.priority));

  const title = el('div', { class: 'card-title', text: card.title });

  // 里程碑 / 版本徽标（有值才显示）
  const chips = el('div', { class: 'card-chips' });
  if (card.milestoneName) chips.append(el('span', { class: 'chip chip-milestone', text: '◆ ' + card.milestoneName }));
  if (card.versionName) chips.append(el('span', { class: 'chip chip-version', text: '🏷 ' + card.versionName }));

  const meta = el('div', { class: 'card-meta' });
  const left = el('div', { class: 'card-labels' });
  for (const l of cardLabels) {
    left.append(el('span', { class: 'tag', style: `background:${hexToRgba(l.color, 0.16)};color:${l.color}`, text: l.name }));
  }
  const right = el('div', { class: 'card-meta-right' });
  if (card.checklistTotal > 0) {
    right.append(el('span', { class: 'muted card-checklist', text: `☑ ${card.checklistDone}/${card.checklistTotal}` }));
  }
  if (card.dueDate) {
    const overdue = card.dueDate < new Date().toISOString().slice(0, 10);
    right.append(el('span', { class: 'card-due' + (overdue ? ' overdue' : ''), text: fmtDate(card.dueDate) }));
  }
  if (card.assignee) {
    const assigneeLink = el('a', { class: 'card-assignee', href: `/users/${card.assignee.id}`, title: card.assignee.displayName || card.assignee.username });
    assigneeLink.append(avatar(card.assignee, 'sm'));
    right.append(assigneeLink);
  }
  meta.append(left, right);

  if (chips.children.length) node.append(top, title, chips, meta);
  else node.append(top, title, meta);

  node.addEventListener('click', (e) => {
    if (justDragged) return;
    if ((e.target as HTMLElement).closest('button, a, select, input')) return;
    void openCardDetail(card.id);
  });
  node.addEventListener('dragstart', (e) => {
    dragCardId = card.id;
    justDragged = true;
    node.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', String(card.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragend', () => {
    dragCardId = null;
    setTimeout(() => {
      justDragged = false;
    }, 60);
    qsa('.card.dragging').forEach((c) => c.classList.remove('dragging'));
    qsa('.drop-before, .drop-after, .drop-empty').forEach((c) => c.classList.remove('drop-before', 'drop-after', 'drop-empty'));
  });
  return node;
}

function buildAddCard(colId: number): HTMLElement {
  const wrap = el('div', { class: 'add-card' });
  const btn = el('button', { class: 'add-card-btn', type: 'button', text: '+ 添加卡片' });
  const form = el('div', { class: 'add-card-form', hidden: 'true' });
  const input = el('input', { class: 'input input-sm', type: 'text', placeholder: '卡片标题，回车连续创建' });
  const actions = el('div', { class: 'add-card-actions' });
  const ok = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '添加' });
  const cancel = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '取消' });

  function show(): void {
    btn.hidden = true;
    form.hidden = false;
    input.focus();
  }
  function hide(): void {
    btn.hidden = false;
    form.hidden = true;
    input.value = '';
  }
  async function create(): Promise<void> {
    const title = input.value.trim();
    if (!title) {
      hide();
      return;
    }
    ok.disabled = true;
    try {
      await api(`/columns/${colId}/cards`, { method: 'POST', body: { title } });
      input.value = '';
      ok.disabled = false;
      await load();
      input.focus(); // 回车快速连续创建
    } catch (e) {
      toast(errMsg(e), 'error');
      ok.disabled = false;
    }
  }
  btn.addEventListener('click', show);
  cancel.addEventListener('click', hide);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void create();
    else if (e.key === 'Escape') hide();
  });
  ok.addEventListener('click', () => void create());
  actions.append(ok, cancel);
  form.append(input, actions);
  wrap.append(btn, form);
  return wrap;
}

function buildAddColumn(): HTMLElement {
  const wrap = el('div', { class: 'add-col-wrap' });
  const btn = el('button', { class: 'add-col-btn', type: 'button', text: '+ 添加列' });
  btn.addEventListener('click', async () => {
    const name = await promptDialog('新建列', '列名');
    if (!name) return;
    try {
      await api(`/boards/${boardId}/columns`, { method: 'POST', body: { name } });
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });
  wrap.append(btn);
  return wrap;
}

// ============ 拖拽 ============

function setupDropZone(body: HTMLElement, colId: number): void {
  body.addEventListener('dragover', (e) => {
    if (dragCardId == null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearIndicators(body);
    const cards = visibleCards(body);
    if (!cards.length) {
      body.classList.add('drop-empty');
      return;
    }
    let insertBefore: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        insertBefore = c;
        break;
      }
    }
    if (insertBefore) insertBefore.classList.add('drop-before');
    else cards[cards.length - 1].classList.add('drop-after');
  });
  body.addEventListener('drop', (e) => {
    if (dragCardId == null) return;
    e.preventDefault();
    const cards = visibleCards(body);
    let before: number | null = null;
    let after: number | null = null;
    const beforeEl = qs<HTMLElement>('.drop-before', body);
    if (beforeEl) before = Number(beforeEl.dataset.card);
    else {
      const afterEl = qs<HTMLElement>('.drop-after', body);
      if (afterEl) after = Number(afterEl.dataset.card);
    }
    clearIndicators(body);
    void moveCard(dragCardId, colId, before, after);
  });
  body.addEventListener('dragleave', () => {
    clearIndicators(body);
  });
}

function visibleCards(body: HTMLElement): HTMLElement[] {
  return qsa<HTMLElement>('.card', body).filter((c) => !c.classList.contains('dragging') && !c.classList.contains('filtered-out'));
}

function clearIndicators(body?: HTMLElement): void {
  const scope = body ?? document;
  qsa<HTMLElement>('.drop-before, .drop-after, .drop-empty', scope).forEach((c) => c.classList.remove('drop-before', 'drop-after', 'drop-empty'));
}

async function moveCard(cardId: number, colId: number, before: number | null, after: number | null): Promise<void> {
  if (!data) return;
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) return;
  const prevColumn = card.columnId;

  // 乐观更新本地数据
  card.columnId = colId;
  const rest = data.cards.filter((c) => c.id !== cardId);
  const colCards = rest.filter((c) => c.columnId === colId).sort((a, b) => a.position - b.position);
  const ids = colCards.map((c) => c.id);
  let idx: number;
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
      method: 'POST',
      body: { column_id: colId, before_card_id: before, after_card_id: after },
    });
    await load(); // 与服务器对齐
  } catch (e) {
    card.columnId = prevColumn;
    await load();
    toast(errMsg(e), 'error');
  }
}

// ============ 筛选 ============

function matchFilters(card: CardSummary): boolean {
  if (filterAssignee && !(card.assignee && card.assignee.id === Number(filterAssignee))) return false;
  if (filterLabel && !card.labelIds.includes(Number(filterLabel))) return false;
  if (filterPriority && card.priority !== filterPriority) return false;
  if (filterQ) {
    const q = filterQ.toLowerCase();
    if (!card.title.toLowerCase().includes(q) && !card.number.toLowerCase().includes(q)) return false;
  }
  return true;
}

function refreshFilterOptions(): void {
  if (!data) return;
  const assigneeSel = qs<HTMLSelectElement>('#filter-assignee');
  if (assigneeSel) {
    const cur = assigneeSel.value;
    assigneeSel.innerHTML = '<option value="">全部成员</option>';
    for (const m of data.members) {
      const opt = el('option', { value: String(m.id), text: m.displayName || m.username });
      if (String(m.id) === cur) opt.selected = true;
      assigneeSel.append(opt);
    }
  }
  const labelSel = qs<HTMLSelectElement>('#filter-label');
  if (labelSel) {
    const cur = labelSel.value;
    labelSel.innerHTML = '<option value="">全部标签</option>';
    for (const l of data.labels) {
      const opt = el('option', { value: String(l.id), text: l.name });
      if (String(l.id) === cur) opt.selected = true;
      labelSel.append(opt);
    }
  }
  const prioSel = qs<HTMLSelectElement>('#filter-priority');
  if (prioSel) {
    const cur = prioSel.value;
    prioSel.innerHTML = '<option value="">全部优先级</option>';
    const prios: [string, string][] = [
      ['p0', '紧急'],
      ['p1', '高'],
      ['p2', '中'],
      ['p3', '低'],
    ];
    for (const [v, t] of prios) {
      const opt = el('option', { value: v, text: `${v.toUpperCase()} · ${t}` });
      if (v === cur) opt.selected = true;
      prioSel.append(opt);
    }
  }
}

// ============ SSE ============

function initSse(): void {
  const es = new EventSource(`/api/stream?channel=board:${boardId}`);
  const reload = debounce(() => {
    void load();
    if (getOpenCardId() != null) void refreshOpenCard();
  }, 400);
  ['card.created', 'card.updated', 'card.moved', 'card.deleted', 'comment.added'].forEach((ev) => {
    es.addEventListener(ev, reload);
  });
  es.onerror = () => {
    /* 自动重连 */
  };
}
