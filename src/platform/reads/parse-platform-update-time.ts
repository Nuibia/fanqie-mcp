export interface LongMetric extends Record<string, unknown> {
  statisticsBookId: string;
  title: string;
  wordCount: number | null;
  creationStatusCode: number | null;
  reportedListReadCount: string | null;
  reportedReaderUvDaily: string | null;
  reportedPursueReadRate: string | null;
  updateTimeRaw: string | null;
  platformUpdatedAt: string | null;
  platformUpdatedDate: string | null;
  platformUpdateTimeBasis: string | null;
}

/** update_time establishes platform update time only; it never establishes the statistics window/cutoff. */
export function parsePlatformUpdateTime(
  raw: string | null,
  capturedAt = new Date().toISOString(),
): Pick<LongMetric, 'platformUpdatedAt' | 'platformUpdatedDate' | 'platformUpdateTimeBasis'> {
  const unknown = {
    platformUpdatedAt: null,
    platformUpdatedDate: null,
    platformUpdateTimeBasis: null,
  };
  if (raw === null || !Number.isFinite(Date.parse(capturedAt))) return unknown;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      raw,
    );
  if (!match) return unknown;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${day}T00:00:00Z`);
  if (
    Number(match[1]) < 2000 ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return unknown;
  const chinaDay = (value: Date): string =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  if (match[4] === undefined)
    return day <= chinaDay(new Date(capturedAt))
      ? {
          platformUpdatedAt: null,
          platformUpdatedDate: day,
          platformUpdateTimeBasis: 'platform-api-update_time;explicit-date;not-statistics-cutoff',
        }
      : unknown;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? '0') > 59)
    return unknown;
  if (match[8] === undefined)
    return day <= chinaDay(new Date(capturedAt))
      ? {
          platformUpdatedAt: null,
          platformUpdatedDate: day,
          platformUpdateTimeBasis:
            'platform-api-update_time;explicit-local-date-time;timezone-unknown;not-statistics-cutoff',
        }
      : unknown;
  const zone = match[8];
  if (zone !== 'Z' && (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(zone) || /^[-+]14:(?!00)/.test(zone)))
    return unknown;
  const timestamp = new Date(
    `${day}T${match[4]}:${match[5]}:${match[6] ?? '00'}${match[7] ? `.${match[7]}` : ''}${zone}`,
  );
  if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.parse(capturedAt))
    return unknown;
  return {
    platformUpdatedAt: timestamp.toISOString(),
    platformUpdatedDate: day,
    platformUpdateTimeBasis:
      'platform-api-update_time;explicit-timezone;date-as-reported;not-statistics-cutoff',
  };
}
