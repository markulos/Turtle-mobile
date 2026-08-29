/**
 * Formatting for the server stats and performance panels.
 *
 * Kept free of react-native imports (same rule as `zoomMath` and
 * `boardCanvasLayout`): plain, side-effect-free string building, unit-testable
 * without rendering anything.
 *
 * One house rule runs through all of it: NEVER lean on Intl. Hermes ships a
 * trimmed Intl that does not reliably group digits in `Number.toLocaleString`,
 * which is why the digit grouping below is a regex — the same workaround
 * SidecarStatusCard already carries.
 */

const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Three significant digits, which is how every disk tool renders a size:
 * 2.64 TB, 11.1 MB, 145 MB. More precision than that is noise at a glance, and
 * less ("3 MB") throws away the difference between 2.5 and 3.4.
 *
 * Binary units (1024), because that is what the operating system reports — a
 * panel that disagreed with Explorer/Finder about the size of the same file
 * would just look wrong.
 */
export function formatBytes(bytes) {
  const n = finite(bytes);
  const sign = n < 0 ? '-' : '';
  let value = Math.abs(n);
  if (value < KIB) return `${sign}${Math.round(value)} B`;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  // Drop a trailing zero so it reads "2.6 TB", never "2.60 TB".
  const text = value.toFixed(decimals).replace(/\.?0+$/, '');
  return `${sign}${text} ${UNITS[unit]}`;
}

/** Thousands separators, without Intl. */
export function formatCount(value) {
  return String(Math.round(finite(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A share of a whole, as a rounded percentage. Returns null when there is no
 *  whole to be a share OF — callers hide the figure rather than print "NaN%". */
export function percentOf(part, whole) {
  const total = finite(whole);
  if (!(total > 0)) return null;
  return Math.round((finite(part) / total) * 100);
}

/** Same, but keeping a decimal where the last percent matters (97.6% understood
 *  says something "98%" doesn't — it says some are still missing). */
export function precisePercentOf(part, whole) {
  const total = finite(whole);
  if (!(total > 0)) return null;
  const pct = (finite(part) / total) * 100;
  // Never round a partial job up to a flat 100 — "100%" must mean finished.
  if (pct >= 99.95 && finite(part) < total) return 99.9;
  return Math.round(pct * 10) / 10;
}

/** Elapsed seconds as a coarse duration: "3d 4h", "6h 12m", "45s". */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(finite(seconds)));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return h && m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/**
 * A measured duration in MILLISECONDS — the unit performance telemetry arrives
 * in, where `formatDuration`'s seconds would round every interesting number to
 * "0s".
 *
 * The scale changes what precision is worth reading. Under a second, whole
 * milliseconds: 412 ms is a latency, "0.4 s" is a shrug. Past a second the
 * millisecond is noise and seconds carry it. Past a minute — which only the
 * cumulative totals reach — it hands off to `formatDuration`, so "8m 20s"
 * reads the same here as it does for an uptime.
 */
export function formatMs(ms) {
  const n = Math.max(0, finite(ms));
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) {
    const seconds = n / 1000;
    return `${(seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))).replace(/\.0$/, '')} s`;
  }
  return formatDuration(Math.round(n / 1000));
}

/** "4h ago" / "just now" for a timestamp in ms. Empty string for no timestamp,
 *  so a missing value renders as nothing rather than as 1970. */
export function formatAgo(ms, now = Date.now()) {
  const t = finite(ms);
  if (t <= 0) return '';
  const diff = now - t;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return 'just now';
  return `${formatDuration(Math.floor(diff / 1000))} ago`;
}

/** "Mar 2026". Used for the span of the library, where a day is noise. */
export function formatMonthYear(ms) {
  const t = finite(ms);
  if (t <= 0) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * What KIND of thing a B-tree is, in words.
 *
 * The row keeps SQLite's own name — "media_fts_content" is opaque but it is
 * the truth, and a panel that renames the schema is a panel you can't act on.
 * This supplies the missing half: whether that opaque name is your data, an
 * index over it, or full-text search machinery. Text, not a colour, because
 * hue is already spoken for by the magnitude bar and this is identity.
 */
export function btreeKindLabel(name, kind) {
  const raw = String(name || '');
  if (/_fts(_\w+)?$/.test(raw)) return 'search';
  if (kind === 'index' || /^idx_/.test(raw) || /^sqlite_autoindex/.test(raw)) return 'index';
  return 'table';
}

/**
 * The name a person uses for a file extension.
 *
 * Deliberately almost empty: for nearly every extension the answer is the
 * extension in capitals — MP4, PNG, HEIC — and a big table of aliases would be
 * a list to maintain that says nothing the uppercase doesn't. Only the handful
 * where capitalising is actually WRONG is written down.
 *
 * The one entry that isn't cosmetic is the empty string. The server groups
 * every dotless filename under '', and rendering that as a blank row would
 * read as a bug; "No extension" is a real category, and on this pond it is
 * usually imports that arrived without one.
 */
const FILE_TYPE_NAMES = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  tif: 'TIFF',
  htm: 'HTML',
};

export function fileTypeLabel(ext) {
  const raw = String(ext || '').trim().toLowerCase();
  if (!raw) return 'No extension';
  return FILE_TYPE_NAMES[raw] || raw.toUpperCase();
}
