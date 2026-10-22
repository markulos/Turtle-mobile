/**
 * filesUtils — the pure half of the Files tab: colours, labels, sorting and
 * breadcrumb collapsing. No React, no network; everything here is unit-tested.
 */
import { fileIconForName } from '../../../../utils/fileBadge';

/**
 * Mirrors boardColor (ConversationsOverlay.jsx) code-unit for code-unit, so a folder
 * and a board of the same name share a hue — including emoji names. Do not switch
 * this to iterating Unicode code points: that diverges from boardColor on any name
 * outside the BMP.
 */
export function folderHue(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
export const folderColor = (name) => `hsl(${folderHue(name)}, 55%, 55%)`;
// hsla, never an 8-digit hex: RN's hsl matcher is unanchored and silently
// drops a hex alpha suffix.
export const folderTint = (name, alpha = 0.18) => `hsla(${folderHue(name)}, 55%, 55%, ${alpha})`;

export function formatSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return '';
  const n = Number(bytes);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const isDocument = (item) => !!item && item.type === 'document';

/**
 * Can the in-app viewer render this? PDF only — the one document type with a
 * real renderer behind it (PDFKit on iOS). Everything else still goes out to
 * the system share sheet, which knows how to preview a .docx and we do not.
 *
 * MIME first, extension as the fallback: a row uploaded before the server
 * stored mimeType has none, and a tunnelled row can arrive as
 * application/octet-stream — both are still PDFs, and both used to be right
 * there in the name.
 */
export function isPdf(item) {
  if (!item) return false;
  const mime = String(item.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/pdf') return true;
  if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return false;
  const name = String(item.originalName || item.filename || '').split(/[?#]/, 1)[0];
  return /\.pdf$/i.test(name);
}

/** The icon for a vault row. The map itself lives in utils/fileBadge beside
 *  the badge words, because the canvas needs the same answer from a bare
 *  filename and two copies of it is how a .csv ends up with two faces. */
export function documentIcon(item) {
  return fileIconForName(item?.originalName || item?.filename || '');
}

/** Files › … › Parent › Name: keep the first, the last two, and an ellipsis between. */
export function collapseCrumbs(path, max = 3) {
  const list = Array.isArray(path) ? path : [];
  if (list.length <= max) return list.map((c) => ({ ...c }));
  return [
    { ...list[0] },
    { id: '…', name: '…', ellipsis: true },
    ...list.slice(-2).map((c) => ({ ...c })),
  ];
}

const nameOf = (i) => String(i.originalName || i.filename || '').toLowerCase();
const dateOf = (i) => Number(i.originalDate ?? i.uploadDate ?? 0);
const KEYS = {
  name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
  date: (a, b) => dateOf(a) - dateOf(b),
  size: (a, b) => Number(a.size || 0) - Number(b.size || 0),
  type: (a, b) => String(a.type || 'image').localeCompare(String(b.type || 'image')) || nameOf(a).localeCompare(nameOf(b)),
};
/** A new array, never the input. Unknown sort → date. */
export function sortFolderItems(items, sort = 'date', order = 'desc') {
  const cmp = KEYS[sort] || KEYS.date;
  const sign = order === 'asc' ? 1 : -1;
  return [...(items || [])].sort((a, b) => sign * cmp(a, b) || String(a.id).localeCompare(String(b.id)) * sign);
}

/**
 * messageOf — turn a thrown Error (or a bare string) into words a person can
 * read. ServerContext's apiPost/apiPatch/apiPut/apiDelete throw
 * `API Error <status>: <body>`, and for the folders routes `<body>` is the
 * server's raw JSON, e.g. `{"success":false,"error":"FOLDER_EXISTS",
 * "message":"A folder named Taxes already exists here."}` — the human
 * wording `services/folders.js` already sends lives in that `.message`.
 * Without this, the sheets rendered the whole blob verbatim.
 *
 * Order: an embedded JSON object's `.message` (or `.error`) wins first;
 * else an `API Error <status>: ` prefix is stripped so the server's own text
 * survives; else the message is used as-is; empty/missing → a generic line.
 */
export function messageOf(e) {
  const raw = typeof e === 'string' ? e : String(e?.message || '');
  if (!raw) return 'Something went wrong.';
  const jsonMatch = /\{[\s\S]*\}/.exec(raw);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const msg = parsed && (parsed.message || parsed.error);
      if (msg) return String(msg);
    } catch { /* not valid JSON — fall through */ }
  }
  const apiMatch = /^API Error \d+: ([\s\S]*)$/.exec(raw);
  if (apiMatch) return apiMatch[1] || raw;
  return raw;
}

/**
 * One cell of the photos-and-videos grid in a folder.
 *
 * ─── Why this is a function and not one line at the call site ───────────────
 *
 * It was one line at the call site, and it quietly rendered TWO columns
 * instead of three for as long as it existed. The width budgeted for the gaps
 * BETWEEN tiles — `cols - 1` of them — while every tile also carried a
 * `marginRight`, including the last in each row. So a row wanted
 * `cols × cell + cols × gap` from a container holding
 * `cols × cell + (cols-1) × gap`: two points short on a 393 pt screen, which
 * is all `flexWrap` needs to push the third tile down and leave a tile-sized
 * hole on the right.
 *
 * This arithmetic is only right when the gaps really are between tiles, so
 * the grid spaces its children with the container's `gap` (as the vault
 * picker and the shared-board grid already do) and no tile carries a margin
 * of its own. Keeping the two halves apart is what let them disagree.
 *
 * The floor is belt and braces: three fractional widths that fit exactly in
 * theory can sum a hair over the container and wrap for a reason no one
 * looking at the screen could ever guess.
 */
export function gridCellSize(windowWidth, { cols = 3, gap = 2, padding = 16 } = {}) {
  const inner = Math.max(0, Number(windowWidth) || 0) - padding * 2;
  const columns = Math.max(1, Math.floor(cols));
  return Math.max(0, Math.floor((inner - gap * (columns - 1)) / columns));
}
