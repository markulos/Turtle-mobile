import * as FileSystem from 'expo-file-system/legacy';

export const SHARE_UPLOAD_ROOT = `${FileSystem.cacheDirectory || ''}TurtleShareUploads/`;
export const SHARE_STAGING_MAX_BYTES = 1024 * 1024 * 1024;
export const SHARE_STAGING_FREE_RESERVE_BYTES = 64 * 1024 * 1024;
export const SHARE_STAGING_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const manifestPath = (directory) =>
  `${String(directory).endsWith('/') ? directory : `${directory}/`}manifest.json`;

const remove = async (uri) => {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort: cache cleanup must not block app startup.
  }
};

const sizeOf = async (uri) => {
  let info;
  try {
    info = await FileSystem.getInfoAsync(uri, { size: true });
  } catch {
    return 0;
  }
  if (!info?.exists) return 0;
  if (!info.isDirectory) return Number(info.size) || 0;
  let names;
  try {
    names = await FileSystem.readDirectoryAsync(uri);
  } catch {
    return Number(info.size) || 0;
  }
  const prefix = uri.endsWith('/') ? uri : `${uri}/`;
  const sizes = await Promise.all(names.map((name) => sizeOf(`${prefix}${name}`)));
  return sizes.reduce((total, size) => total + size, 0);
};

const scrubSecrets = (value) => {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['token', 'apiClient', 'abortController'].includes(key))
      .map(([key, nested]) => [key, scrubSecrets(nested)])
  );
};

export async function writeShareUploadManifest(directory, manifest) {
  const serialized = JSON.stringify({
    version: 1,
    ...scrubSecrets(manifest),
    updatedAt: Date.now(),
  });
  await FileSystem.writeAsStringAsync(manifestPath(directory), serialized);
}

export async function readShareUploadManifest(directory) {
  try {
    const raw = await FileSystem.readAsStringAsync(manifestPath(directory));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function sweepShareUploadStaging({
  ownerIdentity = null,
  activeDirectories = [],
  forceOwnerCleanup = false,
  now = Date.now(),
  orphanMaxAgeMs = SHARE_STAGING_ORPHAN_MAX_AGE_MS,
} = {}) {
  let names;
  try {
    names = await FileSystem.readDirectoryAsync(SHARE_UPLOAD_ROOT);
  } catch {
    return;
  }
  const active = new Set(activeDirectories.map((uri) => (
    String(uri).endsWith('/') ? String(uri) : `${uri}/`
  )));
  const retained = await Promise.all(names.map(async (name) => {
    const uri = `${SHARE_UPLOAD_ROOT}${name}${name.includes('.') ? '' : '/'}`;
    if (active.has(uri)) return null;
    let info;
    try {
      info = await FileSystem.getInfoAsync(uri, { size: true });
    } catch {
      return null;
    }
    const directory = info?.isDirectory ? uri : null;
    const manifest = directory ? await readShareUploadManifest(directory) : null;
    if (manifest) {
      if (forceOwnerCleanup && manifest.ownerIdentity === ownerIdentity) {
        await remove(uri);
        return null;
      }
      if (ownerIdentity && manifest.ownerIdentity && manifest.ownerIdentity !== ownerIdentity) {
        await remove(uri);
        return null;
      }
      if (['uploading', 'error', 'retry', 'paused'].includes(manifest.status)) {
        return { directory: uri, manifest };
      }
      await remove(uri);
      return null;
    }
    const rawModified = Number(info?.modificationTime) || 0;
    const modifiedAt = rawModified > 0 && rawModified < 1e12 ? rawModified * 1000 : rawModified;
    if (!modifiedAt || now - modifiedAt >= orphanMaxAgeMs) await remove(uri);
    return null;
  }));
  return retained.filter(Boolean);
}

export async function assertShareStagingCapacity(
  sourceUris,
  {
    maxStagingBytes = SHARE_STAGING_MAX_BYTES,
    freeSpaceReserveBytes = SHARE_STAGING_FREE_RESERVE_BYTES,
  } = {}
) {
  const incomingSizes = await Promise.all(
    (sourceUris || []).map(async (uri) => {
      try {
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        return Number(info?.size) || 0;
      } catch {
        return 0;
      }
    })
  );
  const incomingBytes = incomingSizes.reduce((total, size) => total + size, 0);
  const stagedBytes = await sizeOf(SHARE_UPLOAD_ROOT);
  if (stagedBytes + incomingBytes > maxStagingBytes) {
    throw new Error('Share staging quota exceeded. Clear completed uploads and try again.');
  }
  if (typeof FileSystem.getFreeDiskStorageAsync === 'function') {
    try {
      const freeBytes = await FileSystem.getFreeDiskStorageAsync();
      if (Number.isFinite(freeBytes) && freeBytes < incomingBytes + freeSpaceReserveBytes) {
        throw new Error('Not enough free space to preserve the shared files safely.');
      }
    } catch (error) {
      if (/free space/i.test(error?.message || '')) throw error;
    }
  }
  return { incomingBytes, stagedBytes };
}
