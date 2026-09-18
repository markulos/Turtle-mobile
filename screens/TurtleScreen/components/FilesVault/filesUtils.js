/**
 * filesUtils — the pure half of the Files tab: colours, labels, sorting and
 * breadcrumb collapsing. No React, no network; everything here is unit-tested.
 */

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

const EXT_ICON = {
  pdf: 'file-pdf-box',
  doc: 'file-word-box', docx: 'file-word-box', odt: 'file-word-box', rtf: 'file-word-box',
  xls: 'file-excel-box', xlsx: 'file-excel-box', ods: 'file-excel-box', csv: 'file-delimited-outline',
  ppt: 'file-powerpoint-box', pptx: 'file-powerpoint-box', odp: 'file-powerpoint-box',
  zip: 'folder-zip-outline',
  json: 'code-json',
  md: 'language-markdown',
  txt: 'file-document-outline',
};
export function documentIcon(item) {
  const name = String(item?.originalName || item?.filename || '');
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_ICON[ext] || 'file-outline';
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
