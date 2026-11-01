/**
 * useFolderShares — which of MY folders I have given someone access to.
 *
 * One call, one map: `GET /api/folder-access/mine` answers
 * `{ folders: { [folderId]: Person[] } }` for every share I have granted, so a
 * whole grid can be marked from a single request rather than asking per tile.
 * That shape is why the badge states a COUNT — the people are already here.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 * It is the OUT direction only: folders of mine that others can see. Folders
 * other people have shared WITH me are `GET /api/shared-folders`, a different
 * list that the Files tab does not yet draw at all. Keep the two apart — a
 * folder you were given is not a folder you shared, and a badge that conflated
 * them would say "shared" on someone else's folder sitting in your grid.
 *
 * ── Failing quietly is the right failure ──────────────────────────────────
 * A share map that will not load must not take the folder grid down with it:
 * the grid's job is to show your folders, and this only adds a mark to them.
 * On an error it settles to an empty map, so every folder simply reads as
 * unshared — the same thing it read as before this existed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useServer } from '../../../../context/ServerContext';

export default function useFolderShares() {
  const { api } = useServer();
  const [shares, setShares] = useState(null);

  const refreshShares = useCallback(async () => {
    try {
      const r = await api.get('/folder-access/mine');
      const folders = r && r.folders;
      setShares(folders && typeof folders === 'object' ? folders : {});
    } catch {
      setShares({});
    }
  }, [api]);

  useEffect(() => { refreshShares(); }, [refreshShares]);

  /**
   * How many people can see this folder. 0 both for "shared with nobody" and
   * for "not loaded yet", deliberately: the tile draws no badge either way, and
   * a badge that appeared a beat after the grid would be a flicker on every
   * single folder.
   */
  const sharedCount = useCallback(
    (folderId) => {
      const people = shares && shares[folderId];
      return Array.isArray(people) ? people.length : 0;
    },
    [shares],
  );

  return { sharedCount, refreshShares };
}
