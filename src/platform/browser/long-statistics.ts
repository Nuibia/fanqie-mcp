import { type ReadResponseStructure, projectReadResponseFields } from '../reads.js';

/** These three diagnostic-only GET sources were observed on the authenticated /main/writer/data page on 2026-10-03. */
export function isLongStatsSchemaSource(raw: string): boolean {
  try {
    const source = new URL(raw);
    return (
      source.origin === 'https://fanqienovel.com' &&
      !source.username &&
      !source.password &&
      /^\/api\/author\/stats\/(?:book_list|book_common_v1|book_increase_v2)\/v0\/$/.test(
        source.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** Diagnostic field names/types are candidates only; they do not establish metric semantics or a collector mapping. */
export function projectLongStatsResponseFields(
  value: unknown,
  redactions: readonly string[] = [],
): Pick<ReadResponseStructure, 'fields' | 'truncated'> {
  const base = projectReadResponseFields(value);
  const hidden = new Set(
    redactions.filter((item) => item.length >= 3).map((item) => item.toLowerCase()),
  );
  // Names/titles are used only as an internal deny list, never serialized or used to discover routes.
  const gatherNames = (object: unknown, depth: number): void => {
    if (!object || typeof object !== 'object' || depth > 4) return;
    if (Array.isArray(object)) {
      for (const item of object.slice(0, 10)) gatherNames(item, depth + 1);
      return;
    }
    for (const key of Object.keys(object)) {
      if (
        [
          'book_name',
          'bookName',
          'work_name',
          'workName',
          'author_name',
          'authorName',
          'nickname',
        ].includes(key)
      ) {
        const name = (object as Record<string, unknown>)[key];
        if (typeof name === 'string' && name.length >= 3 && name.length <= 200)
          hidden.add(name.toLowerCase());
      } else if (
        [
          'data',
          'result',
          'list',
          'items',
          'books',
          'book_list',
          'bookList',
          'stats_book_list',
        ].includes(key)
      )
        gatherNames((object as Record<string, unknown>)[key], depth + 1);
    }
  };
  gatherNames(value, 0);
  const secretKey = (key: string): boolean =>
    [...hidden].some((secret) => key.toLowerCase().includes(secret));
  const fields = base.fields.filter((field) => !field.path.split(/[.\[\]]/).some(secretKey));
  const seen = new Set(fields.map((field) => `${field.path}:${field.type}`));
  let truncated = base.truncated;
  const allowed = new Set([
    'code',
    'data',
    'result',
    'status',
    'success',
    'list',
    'items',
    'books',
    'booklist',
    'statsbooklist',
    'total',
    'totalcount',
    'count',
    'hasmore',
    'more',
    'nextcursor',
    'cursor',
    'pageindex',
    'pagecount',
    'pagesize',
    'bookid',
    'bookname',
    'signstatus',
    'common',
    'commondata',
    'commonstats',
    'bookcommon',
    'stats',
    'statistics',
    'metrics',
    'overview',
    'summary',
    'increase',
    'increasedata',
    'increasestats',
    'bookincrease',
    'daily',
    'dailydata',
    'date',
    'time',
    'statdate',
    'startdate',
    'enddate',
    'statisticsthrough',
    'updatetime',
    'read',
    'reader',
    'readers',
    'readcount',
    'readercount',
    'readeruv',
    'readuv',
    'readpv',
    'readnum',
    'readernum',
    'readusercount',
    'readusernum',
    'readuseruv',
    'readuser',
    'readusers',
    'reading',
    'readingcount',
    'readingnum',
    'readinguv',
    'inread',
    'inreading',
    'inreadcount',
    'inreadingcount',
    'inreadnum',
    'inreadingnum',
    'inreaduv',
    'inreadinguv',
    'newreadcount',
    'newreadercount',
    'newreaderuv',
    'newreaduv',
    'newreadingcount',
    'newinreadcount',
    'newinreadingcount',
    'chase',
    'chasecount',
    'chasenum',
    'chaseuv',
    'follow',
    'followcount',
    'follownum',
    'followuv',
    'followread',
    'followreadcount',
    'followreadingcount',
    'pursuereadcount',
    'urge',
    'urgecount',
    'urgenum',
    'urging',
    'urgingcount',
    'remind',
    'remindcount',
    'remindnum',
    'updateremindcount',
    'updateremindnum',
    'score',
    'rating',
    'ratings',
    'scorecount',
    'scorenum',
    'ratingcount',
    'ratingnum',
    'averagescore',
    'averagerating',
    'shelf',
    'shelfcount',
    'shelfnum',
    'bookshelf',
    'bookshelfcount',
    'bookshelfnum',
    'addshelfcount',
    'collect',
    'collectcount',
    'collectnum',
    'collectioncount',
    'collectionnum',
    'favoritecount',
    'comment',
    'comments',
    'commentcount',
    'commentnum',
    'reviewcount',
    'reviewnum',
    'showcount',
    'clickrate',
    'diggcount',
  ]);
  const statisticWords = new Set([
    'read',
    'reads',
    'reader',
    'readers',
    'reading',
    'listen',
    'listener',
    'listening',
    'chase',
    'chasing',
    'follow',
    'following',
    'pursue',
    'urge',
    'urging',
    'remind',
    'reminder',
    'score',
    'rating',
    'ratings',
    'shelf',
    'bookshelf',
    'collect',
    'collection',
    'favorite',
    'favourite',
    'comment',
    'comments',
    'review',
    'reviews',
    'show',
    'exposure',
    'click',
    'digg',
    'uv',
    'pv',
    'count',
    'counts',
    'num',
    'number',
    'total',
    'statistics',
    'stat',
    'stats',
    'metric',
    'metrics',
    'overview',
    'summary',
  ]);
  const envelopeWords = new Set([
    'book',
    'books',
    'common',
    'increase',
    'increases',
    'increased',
    'incr',
    'increment',
    'data',
    'info',
    'detail',
    'details',
    'value',
    'values',
    'item',
    'items',
    'list',
    'lists',
    'result',
    'results',
  ]);
  const qualifierWords = new Set([
    'user',
    'users',
    'person',
    'people',
    'active',
    'actived',
    'current',
    'cur',
    'new',
    'old',
    'add',
    'added',
    'in',
    'is',
    'has',
    'keep',
    'kept',
    'up',
    'update',
    'last',
    'first',
    'today',
    'yesterday',
    'daily',
    'day',
    'days',
    'week',
    'weekly',
    'month',
    'monthly',
    'year',
    'start',
    'end',
    'max',
    'maximum',
    'min',
    'minimum',
    'avg',
    'average',
    'mean',
    'rate',
    'ratio',
    'percent',
    'percentage',
    'growth',
    'change',
    'changes',
    'changed',
    'duration',
    'time',
    'times',
    'amount',
    'period',
    'date',
    'dates',
  ]);
  const safeKey = (key: string): boolean => {
    if (!/^[A-Za-z_][A-Za-z_]{0,63}$/.test(key) || /^[a-fA-F]{16,}$/.test(key) || secretKey(key))
      return false;
    const normalized = key.replace(/_/g, '').toLowerCase();
    if (
      /(?:token|csrf|cookie|credential|secret|password|session|header|auth|nickname|avatar|email|phone|mobile|content|body|text|intro|description|synopsis|map|dict|byid|bybook|byname)/.test(
        normalized,
      )
    )
      return false;
    if (allowed.has(normalized)) return true;
    const words = key
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .split('_')
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    return (
      words.length > 0 &&
      words.every(
        (word) => statisticWords.has(word) || envelopeWords.has(word) || qualifierWords.has(word),
      ) &&
      (words.some((word) => statisticWords.has(word)) ||
        words.every((word) => envelopeWords.has(word)))
    );
  };
  const walk = (object: unknown, prefix: string, depth: number): void => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    if (depth > 5) {
      truncated = true;
      return;
    }
    for (const key of Object.keys(object)) {
      if (!safeKey(key)) continue;
      const nested = (object as Record<string, unknown>)[key];
      const type = nested === null ? 'null' : Array.isArray(nested) ? 'array' : typeof nested;
      if (!['object', 'array', 'string', 'number', 'boolean', 'null'].includes(type)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const signature = `${path}:${type}`;
      if (!seen.has(signature)) {
        if (fields.length >= 160) {
          truncated = true;
          return;
        }
        seen.add(signature);
        fields.push({ path, type: type as ReadResponseStructure['fields'][number]['type'] });
      }
      if (type === 'object') walk(nested, path, depth + 1);
      if (type === 'array') {
        const items = nested as unknown[];
        if (items.length > 10) truncated = true;
        for (const item of items.slice(0, 10)) walk(item, `${path}[]`, depth + 1);
      }
    }
  };
  walk(value, '', 0);
  return { fields, truncated };
}
