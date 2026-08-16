import { readLiliumOSStorage, removeLiliumOSStorage, writeLiliumOSStorage } from './liliumosStorage';

export interface SimpleFinError {
  code: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

export interface SimpleFinConnection {
  conn_id: string;
  name: string;
  org_id?: string;
  org_name?: string;
  org_url?: string;
  sfin_url?: string;
}

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  conn_id: string;
  conn_name?: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SimpleFinTransaction[];
  extra?: Record<string, unknown>;
}

export interface SimpleFinAccountSet {
  errlist: SimpleFinError[];
  connections: SimpleFinConnection[];
  accounts: SimpleFinAccount[];
}

const ACCESS_URL_KEY = 'liliumos.simplefin.accessUrl.v1';
const LEGACY_ACCESS_URL_KEYS = ['sullyem.simplefin.accessUrl.v1'];

function requireHttpsUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${label}格式不正确`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label}必须使用 HTTPS`);
  return url;
}

function decodeSetupToken(token: string): URL {
  const compact = token.trim().replace(/\s+/g, '');
  if (!compact) throw new Error('请先粘贴 SimpleFIN Setup Token');
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return requireHttpsUrl(atob(padded), 'Setup Token');
  } catch {
    throw new Error('这不是 SimpleFIN Setup Token，可能是邮件里的登录验证码。请先用邮件链接完成登录，再从 SimpleFIN Bridge 生成 Setup Token（通常以 aHR0cHM6 开头）');
  }
}

export function getSimpleFinAccessUrl(): string | null {
  try {
    const value = readLiliumOSStorage(ACCESS_URL_KEY, LEGACY_ACCESS_URL_KEYS)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function hasSimpleFinConnection(): boolean {
  return Boolean(getSimpleFinAccessUrl());
}

export function forgetSimpleFinConnection(): void {
  removeLiliumOSStorage(ACCESS_URL_KEY, LEGACY_ACCESS_URL_KEYS);
}

export async function claimSimpleFinSetupToken(
  setupToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const claimUrl = decodeSetupToken(setupToken);
  const response = await fetchImpl(claimUrl.toString(), { method: 'POST' });
  if (response.status === 403) {
    throw new Error('这个 Setup Token 已失效或已被使用。若不是你使用的，请在 SimpleFIN 停用它并重新生成');
  }
  if (!response.ok) throw new Error(`SimpleFIN 连接失败（HTTP ${response.status}）`);

  const accessUrl = requireHttpsUrl(await response.text(), 'SimpleFIN Access URL');
  if (!accessUrl.username || !accessUrl.password) {
    throw new Error('SimpleFIN 返回的 Access URL 缺少认证信息');
  }
  // Setup Token is one-time. Persist immediately so a later sync failure does not lose it.
  writeLiliumOSStorage(ACCESS_URL_KEY, accessUrl.toString(), LEGACY_ACCESS_URL_KEYS);
}

function buildAuthorizedRequest(accessUrlRaw: string, params: URLSearchParams): { url: string; headers: HeadersInit } {
  const accessUrl = requireHttpsUrl(accessUrlRaw, 'SimpleFIN Access URL');
  const username = decodeURIComponent(accessUrl.username);
  const password = decodeURIComponent(accessUrl.password);
  accessUrl.username = '';
  accessUrl.password = '';
  accessUrl.pathname = `${accessUrl.pathname.replace(/\/+$/, '')}/accounts`;
  accessUrl.search = params.toString();
  return {
    url: accessUrl.toString(),
    headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
  };
}

export async function fetchSimpleFinAccounts(options: {
  startDate?: number;
  endDate?: number;
  pending?: boolean;
  balancesOnly?: boolean;
  accountIds?: string[];
  fetchImpl?: typeof fetch;
} = {}): Promise<SimpleFinAccountSet> {
  const accessUrl = getSimpleFinAccessUrl();
  if (!accessUrl) throw new Error('尚未连接 SimpleFIN');

  const params = new URLSearchParams({ version: '2' });
  if (options.startDate != null) params.set('start-date', String(Math.floor(options.startDate)));
  if (options.endDate != null) params.set('end-date', String(Math.floor(options.endDate)));
  if (options.pending !== false) params.set('pending', '1');
  if (options.balancesOnly) params.set('balances-only', '1');
  for (const accountId of options.accountIds || []) params.append('account', accountId);

  const request = buildAuthorizedRequest(accessUrl, params);
  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(request.url, { headers: request.headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 SimpleFIN。若浏览器提示跨域限制，需要改走专用代理。（${detail}）`);
  }
  if (response.status === 402) throw new Error('SimpleFIN Bridge 订阅未生效或已到期');
  if (response.status === 403) throw new Error('SimpleFIN 访问已失效，请断开后重新连接');
  if (!response.ok) throw new Error(`SimpleFIN 同步失败（HTTP ${response.status}）`);

  const data = await response.json() as Partial<SimpleFinAccountSet>;
  return {
    errlist: Array.isArray(data.errlist) ? data.errlist : [],
    connections: Array.isArray(data.connections) ? data.connections : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
  };
}
