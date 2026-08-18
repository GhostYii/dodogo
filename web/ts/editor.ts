// TipTap 所见即所得（WYSIWYG）编辑器封装：创建 / 设值 / 取值 / 销毁 + 工具栏
// 进入编辑：mdToHtml(markdown) → prepareHtml → setContent(html)
// 保存：getHTML() → htmlToMarkdown(html) → PATCH description（存 Markdown 原文）

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { el } from './util';
import { mdToHtml } from './markdown';
import { htmlToMarkdown } from './html2md';

export interface WysiwygEditor {
  /** 编辑器根容器（工具栏 + 编辑区） */
  root: HTMLElement;
  /** TipTap 编辑器实例 */
  editor: Editor;
  /** 用 Markdown 原文填充编辑器（内部走 mdToHtml 转 HTML） */
  setMarkdown(md: string): Promise<void>;
  /** 取回 Markdown（内部走 getHTML → htmlToMarkdown） */
  getMarkdown(): string;
  /** 聚焦编辑区 */
  focus(): void;
  /** 销毁编辑器实例，释放监听 */
  destroy(): void;
}

// ---------- 服务端 HTML → TipTap HTML 的兼容性预处理 ----------
// 服务端 pulldown-cmark 的任务列表输出为 <ul><li><input type="checkbox"> text</li></ul>，
// TipTap 的 taskList/taskItem 需要 <ul data-type="taskList"><li data-type="taskItem"
// data-checked="…"><label><input type="checkbox"><span></span></label><div><p>…</p></div></li></ul>。
// 这里做 DOM 级转换，保证既有 Markdown 任务清单在编辑后不丢状态。

function liHasCheckbox(li: HTMLElement): boolean {
  return Array.from(li.childNodes).some(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).tagName === 'INPUT' &&
      ((n as HTMLElement).getAttribute('type') || '').toLowerCase() === 'checkbox',
  );
}

function convertTaskItem(li: HTMLElement): void {
  const input = Array.from(li.childNodes).find(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).tagName === 'INPUT' &&
      ((n as HTMLElement).getAttribute('type') || '').toLowerCase() === 'checkbox',
  ) as HTMLElement | undefined;
  const checked = input ? input.hasAttribute('checked') : false;
  if (input) input.remove();

  const doc = li.ownerDocument;
  li.setAttribute('data-type', 'taskItem');
  li.setAttribute('data-checked', checked ? 'true' : 'false');

  const label = doc.createElement('label');
  const cb = doc.createElement('input');
  cb.setAttribute('type', 'checkbox');
  if (checked) cb.setAttribute('checked', 'checked');
  label.append(cb, doc.createElement('span'));

  // 内容移入 <div><p>…</p></div>；嵌套列表/引用等块级元素保留在段落之后。
  const div = doc.createElement('div');
  const p = doc.createElement('p');
  const blockChildren: Node[] = [];
  for (const n of Array.from(li.childNodes)) {
    if (
      n.nodeType === Node.ELEMENT_NODE &&
      ['UL', 'OL', 'BLOCKQUOTE', 'PRE'].includes((n as HTMLElement).tagName)
    ) {
      blockChildren.push(n);
    } else {
      p.append(n);
    }
  }
  div.append(p);
  for (const n of blockChildren) div.append(n);
  li.append(label, div);
}

function convertTaskLists(doc: Document): void {
  const uls = Array.from(doc.querySelectorAll('ul')).filter((ul) =>
    Array.from(ul.children).some(
      (c) => c.tagName === 'LI' && liHasCheckbox(c as HTMLElement),
    ),
  );
  for (const ul of uls) {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI') as HTMLElement[];
    if (!items.length) continue;

    // 按是否含复选框对直接 li 做连续分组；混合列表拆分为多个兄弟 <ul>（taskList 与普通列表各归其位）。
    const groups: { task: boolean; lis: HTMLElement[] }[] = [];
    for (const li of items) {
      const task = liHasCheckbox(li);
      const last = groups[groups.length - 1];
      if (last && last.task === task) last.lis.push(li);
      else groups.push({ task, lis: [li] });
    }

    const newUls: HTMLElement[] = [];
    for (const g of groups) {
      const newUl = doc.createElement('ul');
      if (g.task) newUl.setAttribute('data-type', 'taskList');
      for (const li of g.lis) {
        if (g.task) convertTaskItem(li);
        newUl.append(li);
      }
      newUls.push(newUl);
    }
    ul.replaceWith(...newUls);
  }
}

function prepareHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  convertTaskLists(doc);
  return doc.body.innerHTML;
}

// ---------- 编辑器工厂 ----------

export function createWysiwygEditor(opts: { placeholder?: string } = {}): WysiwygEditor {
  const content = el('div', { class: 'wys-editor' });

  const editor = new Editor({
    element: content,
    extensions: [
      StarterKit.configure({
        // 全量标题级别，保证 h4–h6 编辑往返不降级（格式化通过快捷键）。
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TaskList,
      TaskItem,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Placeholder.configure({ placeholder: opts.placeholder ?? '支持 Markdown…' }),
    ],
    content: '',
  });

  return {
    root: content,
    editor,
    async setMarkdown(md: string): Promise<void> {
      if (!md || !md.trim()) {
        editor.commands.setContent('');
        return;
      }
      const html = prepareHtml(await mdToHtml(md));
      editor.commands.setContent(html);
    },
    getMarkdown(): string {
      return htmlToMarkdown(editor.getHTML());
    },
    focus(): void {
      editor.commands.focus('start');
    },
    destroy(): void {
      editor.destroy();
    },
  };
}
