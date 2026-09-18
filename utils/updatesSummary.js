/**
 * updatesSummary — the pure half of the Updates panel.
 *
 * Everything here is a function of plain values, so the sentences the panel
 * shows can be tested without a native module: which KIND of build is running
 * (a development client that loads code from Metro, a factory build running the
 * JavaScript it shipped with, or a build that has since applied an over-the-air
 * update), how to name an update, and how to word a failure without hiding it.
 *
 * Why the wording is careful: this panel exists because "the app always
 * downloads the latest" was the daily experience, and the fix — a build that
 * runs the code it has and updates only when asked — is invisible unless the
 * screen says plainly which of those two worlds the phone is in.
 */

/**
 * The first eight characters of an update id are plenty to tell two apart.
 *
 * Lower-cased: iOS reports `Updates.updateId` upper-cased while the pond
 * writes and serves it lower, and the same update showing as 7D0EF475 in one
 * line and 7d0ef475 in the next reads as two different updates.
 */
export function shortId(id) {
  if (!id) return '';
  return String(id).replace(/-/g, '').slice(0, 8).toLowerCase();
}

/** "5 Sep, 14:02" — a human date, in the device's locale, without seconds. */
export function formatWhen(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(undefined, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Which world is this phone in?
 *
 *   dev-client  — expo-dev-client; JavaScript comes from Metro every launch.
 *                 Over-the-air updates do not apply and the panel must say so,
 *                 or a developer will tap "check" forever.
 *   embedded    — a real build running the JS it shipped with ("factory").
 *   ota         — a real build that has applied at least one update.
 */
export function describeBuild({ isEnabled, isEmbeddedLaunch, updateId, createdAt, isDev } = {}) {
  if (isDev || isEnabled === false) {
    return {
      mode: 'dev-client',
      title: 'Development build',
      detail: 'JavaScript comes from Metro on every launch. Over-the-air updates do not apply to this build.',
    };
  }
  if (isEmbeddedLaunch || !updateId) {
    return {
      mode: 'embedded',
      title: 'Running the build as installed',
      detail: createdAt ? `Factory JavaScript from ${formatWhen(createdAt)}.` : 'Factory JavaScript, no update applied yet.',
    };
  }
  return {
    mode: 'ota',
    title: `Running update ${shortId(updateId)}`,
    detail: createdAt ? `Applied over the air, published ${formatWhen(createdAt)}.` : 'Applied over the air.',
  };
}

/**
 * The publish MESSAGE of a stored update — "what this one entails", written by
 * whoever ran the publish script (`--message`). The pond keeps it as
 * provenance and hands it back from GET /mobile-updates/status, which is the
 * only place the phone can learn it: the Expo manifest carries the protocol
 * fields and the app config, never the note.
 *
 * Ids are compared case-insensitively — expo-updates reports `updateId`
 * upper-cased on iOS and the store writes it lower-cased.
 */
export function messageFor(updates, id) {
  if (!id || !Array.isArray(updates)) return '';
  const want = String(id).toLowerCase();
  const hit = updates.find((u) => String(u?.id || '').toLowerCase() === want);
  return String(hit?.provenance?.message || '').trim();
}

/** One line, so it reads as a sentence in a launcher card rather than a log. */
const firstLine = (s) => String(s || '').split(/\r?\n/)[0].trim();

const sameId = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * What an update IS, for the log: the one this phone is running, and/or the
 * head of a channel. An update can be several at once (you are usually running
 * the preview head), so this returns every label that applies, in the order
 * they matter to the reader.
 */
export function updateTags(id, { runningId, previewId, productionId } = {}) {
  const tags = [];
  if (sameId(id, runningId)) tags.push('running');
  if (sameId(id, previewId)) tags.push('preview');
  if (sameId(id, productionId)) tags.push('production');
  return tags;
}

/**
 * The update log: newest first, each with the publish message as its
 * description, and the labels that say where it sits. `updates` is what
 * GET /mobile-updates/status hands back.
 */
export function updateLog(updates, heads = {}) {
  if (!Array.isArray(updates)) return [];
  return updates.map((u) => ({
    id: u?.id || '',
    short: shortId(u?.id),
    when: formatWhen(u?.createdAt),
    // The publish message IS the description of what was updated. Without one
    // the row still says something rather than showing a blank line.
    note: String(u?.provenance?.message || '').trim() || 'No description given.',
    commit: u?.provenance?.gitCommit || null,
    tags: updateTags(u?.id, heads),
  }));
}

/**
 * The line under "Check for updates" on the profile: what the update you would
 * install — or failing that, the one you are already running — actually
 * changed. Pure, so the wording is tested without a native module.
 *
 * Precedence is "what can I act on?": an available update's note beats the
 * running one's, because that is the reason to tap. With no note to show it
 * still says something true (the id and when it was published) rather than
 * going blank, and on a dev client it says why there is nothing to check.
 */
export function summarizeLatest({
  mode, phase, availableId, availableCreatedAt, runningId, runningCreatedAt, updates,
} = {}) {
  if (mode === 'dev-client') {
    return { state: 'dev', line: "Development build — over-the-air updates don't apply" };
  }
  if (phase === 'checking') return { state: 'checking', line: 'Checking for a new version…' };
  if (phase === 'error') return { state: 'error', line: "Couldn't reach the update server — tap to retry" };

  if (phase === 'available') {
    const note = firstLine(messageFor(updates, availableId));
    if (note) return { state: 'available', line: `Update ready · ${note}` };
    const when = formatWhen(availableCreatedAt);
    return {
      state: 'available',
      line: `Update ready${availableId ? ` · ${shortId(availableId)}` : ''}${when ? ` · published ${when}` : ''}`,
    };
  }

  const note = firstLine(messageFor(updates, runningId));
  if (note) return { state: 'current', line: `Up to date · ${note}` };
  if (mode === 'embedded' || !runningId) {
    return { state: 'current', line: 'Up to date · running the build as installed' };
  }
  const when = formatWhen(runningCreatedAt);
  return { state: 'current', line: `Up to date · update ${shortId(runningId)}${when ? `, ${when}` : ''}` };
}

/**
 * Word a check/fetch failure. Keeps the real message — a sanitized failure is
 * how the SMS outage stayed invisible for five days — but leads with the one
 * cause the user can act on (no network) when that is what it is.
 */
export function describeUpdateError(err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  if (/network|offline|ENOTFOUND|Failed to fetch|timed? ?out/i.test(msg)) {
    return `Couldn't reach the update server — check the connection. (${msg})`;
  }
  if (/not enabled|disabled in development|isEnabled/i.test(msg)) {
    return 'Updates are disabled in this build.';
  }
  return msg;
}
