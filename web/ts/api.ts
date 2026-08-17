// 统一 API 封装：JSON 信封 {code,message,data} + CSRF 头 + 401 跳转

export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

export function csrfToken(): string {
  const m = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return m ? m.content : '';
}

export class ApiError extends Error {
  code: number;
  status: number;
  constructor(code: number, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ApiOptions {
  method?: string;
  /** JSON body */
  body?: unknown;
  /** multipart body（优先于 body） */
  form?: FormData;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = (opts.method ?? (opts.form || opts.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const t = csrfToken();
    if (t) headers['X-CSRF-Token'] = t;
  }

  const res = await fetch('/api' + path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (res.status === 401) {
    const page = document.body.dataset.page;
    if (page !== 'login' && page !== 'register' && page !== 'setup') {
      location.href = '/login';
    }
    throw new ApiError(10002, '未登录或会话已失效', 401);
  }

  let payload: ApiEnvelope | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope;
  } catch {
    // 非 JSON 响应
  }

  if (!res.ok || !payload || payload.code !== 0) {
    throw new ApiError(payload?.code ?? -1, payload?.message || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return payload.data as T;
}
