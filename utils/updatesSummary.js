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

/** The first eight characters of an update id are plenty to tell two apart. */
export function shortId(id) {
  if (!id) return '';
  return String(id).replace(/-/g, '').slice(0, 8);
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
