// 原生弹窗系统：openModal / closeModal / confirmDialog / promptDialog

import { el } from './util';

export interface ModalOptions {
  title?: string;
  body: HTMLElement | string;
  footer?: HTMLElement | string;
  width?: string;
  onClose?: () => void;
}

let modalStack: HTMLElement[] = [];

export function openModal(opts: ModalOptions): HTMLElement {
  // 弹窗支持堆叠：不关闭下层弹窗（例如卡片详情之上的新建标签/确认对话框）
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' });
  if (opts.width) modal.style.maxWidth = opts.width;

  const head = el('div', { class: 'modal-head' });
  head.append(el('h3', { class: 'modal-title', text: opts.title || '' }));
  const closeBtn = el('button', { class: 'modal-close', type: 'button', 'aria-label': '关闭' });
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => closeModal());
  head.append(closeBtn);
  modal.append(head);

  const body = el('div', { class: 'modal-body' });
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else body.append(opts.body);
  modal.append(body);

  if (opts.footer) {
    const foot = el('div', { class: 'modal-foot' });
    foot.append(typeof opts.footer === 'string' ? opts.footer : opts.footer);
    modal.append(foot);
  }

  backdrop.append(modal);
  document.body.append(backdrop);
  modalStack.push(backdrop);

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
    }
  };
  document.addEventListener('keydown', onKey, true);
  (modal as unknown as { __onClose?: () => void }).__onClose = opts.onClose;
  (modal as unknown as { __removeKey?: () => void }).__removeKey = () => document.removeEventListener('keydown', onKey, true);

  return modal;
}

export function closeModal(runCallback = true): void {
  const backdrop = modalStack.pop();
  if (!backdrop) return;
  const modal = backdrop.querySelector<HTMLElement>('.modal');
  if (modal) {
    const m = modal as unknown as { __removeKey?: () => void; __onClose?: () => void };
    m.__removeKey?.();
    if (runCallback) m.__onClose?.();
  }
  backdrop.remove();
}

export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

export function confirmDialog(message: string, opts: { title?: string; danger?: boolean; okText?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const body = el('p', { class: 'confirm-text', text: message });
    const foot = el('div', { class: 'modal-actions' });
    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
    const ok = el('button', { class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: opts.okText || '确定' });
    cancel.addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    ok.addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    foot.append(cancel, ok);
    openModal({ title: opts.title || '确认操作', body, footer: foot, width: '420px' });
    ok.focus();
  });
}

export function promptDialog(title: string, placeholder = '', value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', type: 'text', placeholder });
    input.value = value;
    const body = el('div');
    body.append(input);
    const foot = el('div', { class: 'modal-actions' });
    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: '取消' });
    const ok = el('button', { class: 'btn btn-primary', type: 'button', text: '确定' });
    cancel.addEventListener('click', () => {
      closeModal();
      resolve(null);
    });
    ok.addEventListener('click', () => {
      closeModal();
      resolve(input.value.trim() || null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok.click();
    });
    foot.append(cancel, ok);
    openModal({ title, body, footer: foot, width: '420px' });
    input.focus();
  });
}
