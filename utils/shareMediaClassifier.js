const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'avi',
  'mkv',
  'wmv',
  'flv',
  'webm',
  'm4v',
  '3gp',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'svg',
  'heic',
  'heif',
]);

const GENERIC_MIME_TYPES = new Set([
  '*/*',
  'application/octet-stream',
  'application/unknown',
  'binary/octet-stream',
]);

const MIME_TYPE_PATTERN = /^[!#$%&'*+\-.^_`|~0-9a-z]+\/[!#$%&'*+\-.^_`|~0-9a-z]+$/i;

const parseMime = (entry) => {
  if (!Object.prototype.hasOwnProperty.call(entry, 'mimeType')) {
    return { state: 'missing', value: '' };
  }

  if (typeof entry.mimeType !== 'string') {
    return { state: 'invalid', value: '' };
  }

  const raw = entry.mimeType.trim();
  if (!raw) return { state: 'missing', value: '' };

  const value = raw.split(';', 1)[0].trim().toLowerCase();
  if (!MIME_TYPE_PATTERN.test(value)) {
    return { state: 'invalid', value };
  }

  return {
    state: GENERIC_MIME_TYPES.has(value) ? 'generic' : 'specific',
    value,
  };
};

const extensionOf = (entry) => {
  const value = typeof entry?.fileName === 'string' && entry.fileName.trim()
    ? entry.fileName
    : entry?.path;
  if (typeof value !== 'string') return '';
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const match = /\.([a-z0-9]+)$/i.exec(withoutQuery);
  return match ? match[1].toLowerCase() : '';
};

export function classifySharedFile(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'unsupported';
  if (typeof entry.path !== 'string' || !entry.path.trim()) return 'unsupported';

  const mimeResult = parseMime(entry);
  if (mimeResult.state === 'invalid') return 'unsupported';

  const mime = mimeResult.value;
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mimeResult.state === 'specific') return 'unsupported';

  const extension = extensionOf(entry);
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return 'unsupported';
}

export function supportedAudioVideoFiles(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => {
    const kind = classifySharedFile(entry);
    return kind === 'audio' || kind === 'video';
  });
}

export function isHttpImportUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}
