/**
 * statsFormat — the strings the server-stats panel is made of.
 *
 * Two things here are easy to get wrong and invisible when you do: rounding a
 * partially-finished job up to a flat "100%", and dividing by a zero total on a
 * brand-new pond. Both are covered below.
 */
const {
  formatBytes,
  formatCount,
  percentOf,
  precisePercentOf,
  formatDuration,
  formatMs,
  formatAgo,
  formatMonthYear,
  btreeKindLabel,
  fileTypeLabel,
} = require('../statsFormat');

describe('formatBytes', () => {
  it('keeps three significant digits, the way a disk tool does', () => {
    expect(formatBytes(151621632)).toBe('145 MB');
    expect(formatBytes(11685888)).toBe('11.1 MB');
    expect(formatBytes(2900125577216)).toBe('2.64 TB');
    expect(formatBytes(237015712150)).toBe('221 GB');
  });

  it('leaves bytes alone below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('never prints a trailing zero', () => {
    expect(formatBytes(1024 * 1024 * 2)).toBe('2 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('treats junk as nothing rather than printing NaN', () => {
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes('nonsense')).toBe('0 B');
  });

  it('handles a negative delta without mangling the unit', () => {
    expect(formatBytes(-1048576)).toBe('-1 MB');
  });

  it('tops out at a real unit instead of running off the end of the list', () => {
    expect(formatBytes(1024 ** 6)).toBe('1024 PB');
  });
});

describe('formatCount', () => {
  it('groups digits without Intl (Hermes cannot be trusted to)', () => {
    expect(formatCount(26288)).toBe('26,288');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000000)).toBe('1,000,000');
    expect(formatCount(0)).toBe('0');
  });

  it('falls back to zero for junk', () => {
    expect(formatCount(undefined)).toBe('0');
  });
});

describe('percentOf', () => {
  it('rounds to whole percent', () => {
    expect(percentOf(5101420511232, 8001546088448)).toBe(64);
  });

  it('returns null when there is no whole to be a share of', () => {
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(5, null)).toBeNull();
  });
});

describe('precisePercentOf', () => {
  it('keeps the decimal that says the job is not finished', () => {
    expect(precisePercentOf(25665, 26288)).toBe(97.6);
  });

  it('reports a genuinely complete job as 100', () => {
    expect(precisePercentOf(26288, 26288)).toBe(100);
  });

  it('refuses to round an INCOMPLETE job up to 100', () => {
    // 9999/10000 is 99.99%, which would round to 100 and read as "done".
    expect(precisePercentOf(9999, 10000)).toBe(99.9);
  });

  it('returns null with no total', () => {
    expect(precisePercentOf(1, 0)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('steps through seconds, minutes, hours and days', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3600 + 720)).toBe('1h 12m');
    expect(formatDuration(86400 * 3)).toBe('3d');
    expect(formatDuration(86400 * 3 + 3600 * 4)).toBe('3d 4h');
  });

  it('clamps a negative or absent duration to zero', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(null)).toBe('0s');
  });
});

describe('formatMs', () => {
  it('keeps whole milliseconds where a latency lives', () => {
    // The unit telemetry arrives in. "0.4 s" throws away the difference
    // between a fast endpoint and a slow one.
    expect(formatMs(412)).toBe('412 ms');
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(999)).toBe('999 ms');
  });

  it('switches to seconds once the millisecond stops mattering', () => {
    expect(formatMs(1000)).toBe('1 s');
    expect(formatMs(3240)).toBe('3.2 s');
    expect(formatMs(12_400)).toBe('12 s');
  });

  it('hands the cumulative totals over to formatDuration', () => {
    expect(formatMs(500_000)).toBe('8m');
    expect(formatMs(3_600_000)).toBe('1h');
  });

  it('treats junk and negatives as nothing', () => {
    expect(formatMs(null)).toBe('0 ms');
    expect(formatMs(-50)).toBe('0 ms');
    expect(formatMs('nonsense')).toBe('0 ms');
  });
});

describe('fileTypeLabel', () => {
  it('capitalises the extension, which is right nearly every time', () => {
    expect(fileTypeLabel('mp4')).toBe('MP4');
    expect(fileTypeLabel('HEIC')).toBe('HEIC');
    expect(fileTypeLabel('png')).toBe('PNG');
  });

  it('spells out the few where capitalising is wrong', () => {
    expect(fileTypeLabel('jpg')).toBe('JPEG');
    expect(fileTypeLabel('jpeg')).toBe('JPEG');
    expect(fileTypeLabel('tif')).toBe('TIFF');
  });

  it('names the no-extension bucket instead of rendering a blank row', () => {
    // The server groups every dotless filename under ''; an empty label there
    // would read as a rendering bug rather than as a real category.
    expect(fileTypeLabel('')).toBe('No extension');
    expect(fileTypeLabel(null)).toBe('No extension');
    expect(fileTypeLabel('   ')).toBe('No extension');
  });
});

describe('formatAgo', () => {
  const NOW = 1_787_688_000_000;

  it('describes how long ago something happened', () => {
    expect(formatAgo(NOW - 4 * 3600 * 1000, NOW)).toBe('4h ago');
    expect(formatAgo(NOW - 30_000, NOW)).toBe('just now');
  });

  it('renders nothing at all for a missing timestamp', () => {
    // Empty, not "56 years ago" — a backup that has never run has no date.
    expect(formatAgo(0, NOW)).toBe('');
    expect(formatAgo(null, NOW)).toBe('');
  });

  it('does not go negative on a clock skewed into the future', () => {
    expect(formatAgo(NOW + 60_000, NOW)).toBe('just now');
  });
});

describe('formatMonthYear', () => {
  it('drops the day, which is noise across a library span', () => {
    expect(formatMonthYear(new Date(2026, 2, 15).getTime())).toBe('Mar 2026');
  });

  it('is empty for no date', () => {
    expect(formatMonthYear(0)).toBe('');
  });
});

describe('btreeKindLabel', () => {
  it('names full-text machinery as search, whatever SQLite calls the shadow', () => {
    expect(btreeKindLabel('media_fts_content', 'table')).toBe('search');
    expect(btreeKindLabel('notes_fts', 'table')).toBe('search');
  });

  it('recognises indexes both by declared kind and by name', () => {
    expect(btreeKindLabel('idx_media_tags_tag', 'index')).toBe('index');
    // Internal auto-indexes have no sqlite_master row to declare a kind.
    expect(btreeKindLabel('sqlite_autoindex_media_1', undefined)).toBe('index');
  });

  it('leaves a plain table as a table', () => {
    expect(btreeKindLabel('media', 'table')).toBe('table');
  });
});
