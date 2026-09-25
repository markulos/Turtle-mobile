/**
 * guestReminderConfig — what a task's reminder settings have to become once
 * there is a GUEST on it.
 *
 * A guest is a phone number and nothing else. No app, no push, no notification
 * tray — the only way they find out about the appointment is a text. So the
 * moment one is added, two things follow, and neither is worth making the user
 * go and set:
 *
 *   • SMS goes on. It is not an option any more; it is the only channel.
 *   • If no lead times were chosen, they get DEFAULT_LEADS — one the day
 *     before and one at the time. That is what a reminder for someone else's
 *     diary has to be: the day-before is what lets them move something, and
 *     the at-time is what actually gets them there.
 *
 * Everything else is left exactly as the user set it. Leads they chose are
 * theirs; this only fills an empty list, and it never turns SMS back OFF —
 * removing the last guest leaves the settings alone rather than silently
 * cancelling texts the owner may have wanted for themselves.
 *
 * Pure, and separate from the form, because the interesting part is the policy
 * and the policy is the thing worth being able to read in one place.
 */

/** The day before, and at the time. Minutes before due, as the server reads them. */
export const DEFAULT_LEADS = [1440, 0];

export function guestReminderConfig(reminders, guests) {
  const cfg = (reminders && typeof reminders === 'object') ? reminders : {};
  const leads = Array.isArray(cfg.leads) ? cfg.leads : [];
  const hasGuest = (guests || []).some((g) => g && g.phone);
  if (!hasGuest) return { ...cfg, leads };
  return {
    ...cfg,
    leads: leads.length ? leads : [...DEFAULT_LEADS],
    sms: true,
  };
}
