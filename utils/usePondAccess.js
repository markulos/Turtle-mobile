/**
 * usePondAccess — "who in the pond has this thing, and change that."
 *
 * ONE implementation of a conversation the app now has in two places: a photo
 * board's sharing card, and a music track's ⋯ sheet. The two render nothing
 * alike — one is a section in a scrolling card, the other a page inside a
 * bottom sheet — but the exchange with the server is identical, and the rules
 * that are easy to get subtly wrong live here rather than in each caller:
 *
 *   · The roster and the pond directory are read INDEPENDENTLY. Losing the
 *     directory must not empty the roster: "shared with nobody" and "could not
 *     list your pond" are different claims and the UI would otherwise tell the
 *     first lie whenever the second thing happened.
 *   · A grant redraws from the SERVER'S roster, never from a locally appended
 *     person — the server folds a second grant to the same person into the
 *     existing row, so the id it returns is the one that actually revokes.
 *   · A revoke is optimistic WITH revert, because the confirm has already been
 *     paid for and the row should go the instant you say so.
 *   · `addable` excludes whoever already has it. /friends already excludes me,
 *     so there is no self to filter.
 *   · A FOLDER's grant can carry 'edit'; a board's and a track's cannot. That
 *     is a server fact (PERMISSIONS in routes/folderAccess.js vs
 *     routes/albumAccess.js), so `canSetPermission` is reported from here
 *     rather than each caller guessing — a toggle on a board would be a
 *     control for a request the pond has no route for.
 *
 * The two endpoint families are the same shape by design (see
 * server/routes/albumAccess.js), so the only thing a caller varies is the noun.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * @param api           the pond client
 * @param opts.kind     'album' | 'track' | 'folder' — which endpoint family
 * @param opts.id       the board name, the media id, or the folder id
 * @param opts.enabled  false while the surface is closed, so a shut sheet is
 *                      not holding a subscription to the pond directory
 * @param opts.onChanged called after any successful write, so the surface
 *                      behind can re-read its own summary
 */
export function usePondAccess(api, { kind = 'album', id, enabled = true, onChanged } = {}) {
  const [people, setPeople] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  // One place that knows the endpoint families differ only by noun.
  //
  // A FOLDER's id is a row id rather than a name, which changes nothing here
  // but changes one thing on the server: a folder id is global, so the grant
  // path there proves the folder is the sharer's before writing anything (an
  // album name is only ever interpreted against an owner). See
  // server/routes/folderAccess.js — the shape of the exchange is identical,
  // which is why this stays one hook.
  const paths = useMemo(() => {
    if (kind === 'track') {
      return { roster: `/track-access?trackId=${encodeURIComponent(id ?? '')}`, grant: '/track-access', revoke: '/track-access', key: 'trackId' };
    }
    if (kind === 'folder') {
      return { roster: `/folder-access?folderId=${encodeURIComponent(id ?? '')}`, grant: '/folder-access', revoke: '/folder-access', key: 'folderId' };
    }
    return { roster: `/album-access?album=${encodeURIComponent(id ?? '')}`, grant: '/album-access', revoke: '/album-access', key: 'album' };
  }, [kind, id]);

  useEffect(() => {
    if (!enabled || id == null || id === '') return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [roster, directory] = await Promise.allSettled([
        api.get(paths.roster),
        api.get('/friends'),
      ]);
      if (cancelled) return;
      if (roster.status === 'fulfilled') setPeople(roster.value?.people || []);
      else setError('Could not load who has this');
      if (directory.status === 'fulfilled') setMembers(directory.value?.friends || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [api, enabled, id, paths.roster]);

  const held = useMemo(() => new Set(people.map((p) => p.userId)), [people]);
  const addable = useMemo(() => members.filter((m) => !held.has(m.id)), [members, held]);

  const grant = useCallback(async (member) => {
    setBusyId(member.id);
    setError(null);
    try {
      const res = await api.post(paths.grant, { [paths.key]: id, withUserId: member.id });
      if (!res?.success) throw new Error(res?.error || 'Could not share that');
      setPeople(res.people || []);
      onChanged?.();
      return true;
    } catch (e) {
      setError(e?.message || 'Could not share that');
      return false;
    } finally {
      setBusyId(null);
    }
  }, [api, id, onChanged, paths.grant, paths.key]);

  const revoke = useCallback(async (person) => {
    setBusyId(person.userId);
    const before = people;
    setPeople((prev) => prev.filter((p) => p.shareId !== person.shareId));
    try {
      const res = await api.delete(`${paths.revoke}/${person.shareId}`);
      if (!res?.success) throw new Error(res?.error || 'Could not stop sharing');
      onChanged?.();
      return true;
    } catch (e) {
      setPeople(before);
      setError(e?.message || 'Could not stop sharing');
      return false;
    } finally {
      setBusyId(null);
    }
  }, [api, onChanged, paths.revoke, people]);

  /**
   * Move somebody between 'view' and 'edit' on a folder.
   *
   * Not optimistic: unlike a revoke, nothing has been confirmed and the only
   * honest thing to show is what the server says the roster now is. A pond
   * whose server predates the route answers 404 with no `error` of its own,
   * which is the one case worth its own sentence — a toggle that silently does
   * nothing is worse than one that says why.
   */
  const setPermission = useCallback(async (person, permission) => {
    setBusyId(person.userId);
    setError(null);
    try {
      const res = await api.patch(`${paths.revoke}/${person.shareId}`, { permission });
      if (!res?.success) {
        throw new Error(res?.error || res?.message || 'Could not change that');
      }
      setPeople(res.people || []);
      onChanged?.();
      return true;
    } catch (e) {
      const msg = e?.message || '';
      setError(/\b404\b/.test(msg) || /Cannot PATCH/i.test(msg)
        ? 'This pond’s server cannot change a folder’s permission yet.'
        : (msg || 'Could not change that'));
      return false;
    } finally {
      setBusyId(null);
    }
  }, [api, onChanged, paths.revoke]);

  return {
    people,
    members,
    addable,
    loading,
    busyId,
    error,
    setError,
    grant,
    revoke,
    setPermission,
    // Only a folder share carries a permission the pond will honour.
    canSetPermission: kind === 'folder',
  };
}

export default usePondAccess;
