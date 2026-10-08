import { OWN_INFO_PATH, type OwnResponseStructure } from './read-diagnostics.js';

export function ownInfoSource(url: URL): boolean {
  return (
    url.origin === 'https://fanqienovel.com' &&
    OWN_INFO_PATH.test(url.pathname) &&
    ![...url.searchParams.keys()].some((key) =>
      /^(?:book|work|chapter|author|writer|user|target|account|owner)_?id$|^(?:uid|id)$/i.test(key),
    )
  );
}

/** Fixed schema names only; dynamic map keys and prose/content containers are never traversed. */
export function projectOwnResponseFields(
  value: unknown,
): Pick<OwnResponseStructure, 'fields' | 'truncated'> {
  const allowed = new Set([
    'code',
    'message',
    'msg',
    'data',
    'result',
    'status',
    'statuscode',
    'success',
    'ret',
    'retcode',
    'retmsg',
    'error',
    'errorcode',
    'errormsg',
    'errno',
    'info',
    'profile',
    'basicinfo',
    'userinfo',
    'userdata',
    'userprofile',
    'authorinfo',
    'authordata',
    'authorprofile',
    'authoraccountinfo',
    'authorbasicinfo',
    'accountinfo',
    'account',
    'writerinfo',
    'personalinfo',
    'ownaccount',
    'id',
    'uid',
    'aid',
    'userid',
    'useruid',
    'useridstr',
    'uidstr',
    'accountid',
    'authorid',
    'authoruid',
    'writerid',
    'username',
    'nickname',
    'nick',
    'nickname',
    'authorname',
    'writername',
    'penname',
    'displayname',
    'name',
    'avatar',
    'avatarurl',
    'avatarlist',
    'phone',
    'mobile',
    'email',
    'realname',
    'sex',
    'gender',
    'level',
    'role',
    'roles',
    'permission',
    'permissions',
    'qualification',
    'qualifications',
    'qualificationinfo',
    'islogin',
    'isloggedin',
    'isauthor',
    'iswriter',
    'isverified',
    'verification',
    'verifyinfo',
    'userstatus',
    'authorstatus',
    'accountstatus',
    'loginstatus',
    'createat',
    'createdat',
    'createtime',
    'updateat',
    'updatedat',
    'updatetime',
    'token',
    'accesstoken',
    'refreshtoken',
    'session',
    'sessionid',
    'cookie',
    'cookies',
    'csrf',
    'csrftoken',
    'encryptuid',
    'encrypteduid',
    'encryptuserid',
    'encrypteduserid',
    'encryptauthorid',
    'encryptedauthorid',
    'secuid',
    'openid',
    'unionid',
    'appid',
    'appname',
    'bindinfo',
    'boundinfo',
  ]);
  const fields: OwnResponseStructure['fields'] = [];
  let truncated = false;
  const walk = (object: unknown, prefix: string, depth: number): void => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    if (depth > 5) {
      truncated = true;
      return;
    }
    for (const key of Object.keys(object)) {
      if (
        !/^[A-Za-z_][A-Za-z_]{0,63}$/.test(key) ||
        !allowed.has(key.replace(/_/g, '').toLowerCase())
      )
        continue;
      if (fields.length >= 160) {
        truncated = true;
        return;
      }
      const nested = (object as Record<string, unknown>)[key];
      const type = nested === null ? 'null' : Array.isArray(nested) ? 'array' : typeof nested;
      if (!['object', 'array', 'string', 'number', 'boolean', 'null'].includes(type)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      fields.push({ path, type: type as OwnResponseStructure['fields'][number]['type'] });
      if (type === 'object') walk(nested, path, depth + 1);
      // No array item is inspected: items may represent other people or works.
    }
  };
  walk(value, '', 0);
  return { fields, truncated };
}

export interface PlatformIdentity {
  accountId: string | null;
  authorId: string | null;
  displayName: string | null;
  evidenceSource: string;
}

export interface LoginState {
  status: 'authenticated' | 'login_required' | 'unknown';
  identity: PlatformIdentity | null;
  sourceUrl: string;
  checkedAt: string;
  reason?: string;
}

/** IDs never pass through Number: platform identifiers exceed JS's safe integer range. */
export function parseOwnIdentity(value: unknown, evidenceSource: string): PlatformIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const id = (raw: unknown): string | null => {
    if (typeof raw === 'string' && /^\d{1,30}$/.test(raw)) return raw;
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return String(raw);
    return null;
  };
  const text = (raw: unknown): string | null =>
    typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 200) : null;
  const accountId = id(object.user_id ?? object.userId ?? object.account_id ?? object.accountId);
  const authorId = id(object.author_id ?? object.authorId ?? object.writer_id ?? object.writerId);
  const displayName = text(
    object.author_name ?? object.authorName ?? object.pen_name ?? object.penName ?? object.nickname,
  );
  if (!accountId && !authorId && !displayName) return null;
  return { accountId, authorId, displayName, evidenceSource };
}

/** Only accepts explicitly named *own account* objects, never a book's author object. */
export function findOwnIdentity(value: unknown, evidenceSource: string): PlatformIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  for (const key of [
    'userInfo',
    'user_info',
    'authorInfo',
    'author_info',
    'accountInfo',
    'account_info',
    'writerInfo',
    'writer_info',
  ]) {
    const identity = parseOwnIdentity(object[key], evidenceSource);
    if (identity) return identity;
  }
  // These are routing/data envelopes, not arbitrary recursively searched entities.
  for (const key of ['data', 'loaderData']) {
    const envelope = object[key];
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) continue;
    const direct = findOwnIdentity(envelope, evidenceSource);
    if (direct) return direct;
    if (key === 'loaderData')
      for (const route of Object.values(envelope)) {
        const identity = findOwnIdentity(route, evidenceSource);
        if (identity) return identity;
      }
  }
  return null;
}

/** Uses the confirmed data.id schema only for the current-user endpoint that actually owns it. */
export function parseOwnResponseIdentity(
  value: unknown,
  rawSource: string,
): PlatformIdentity | null {
  let source: URL;
  try {
    source = new URL(rawSource);
  } catch {
    return null;
  }
  if (!ownInfoSource(source) || source.username || source.password) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.code !== undefined && envelope.code !== 0) return null;
  const evidenceSource = `${source.origin}${source.pathname}`;
  if (source.pathname === '/api/user/info/v2') {
    // Confirmed on 2026-10-03: successful code=0, data.id is a string, data.name is the display name.
    if (
      envelope.code !== 0 ||
      !envelope.data ||
      typeof envelope.data !== 'object' ||
      Array.isArray(envelope.data)
    )
      return null;
    const data = envelope.data as Record<string, unknown>;
    return parseOwnIdentity(
      { account_id: typeof data.id === 'string' ? data.id : undefined, nickname: data.name },
      evidenceSource,
    );
  }
  // Other observed own routes keep their explicit user_id/author_id rules. Never reinterpret generic id/uid.
  return findOwnIdentity(value, evidenceSource) ?? parseOwnIdentity(envelope.data, evidenceSource);
}
