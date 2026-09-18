/**
 * filesUtils — the pure half of the Files tab: colours, labels, sorting and
 * breadcrumb collapsing. No React, no network; everything here is unit-tested.
 */

/** The boards' hue formula, so a folder wears the same colour a board of that name would. */
export function folderHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
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
