/**
 * The interactive board an assistant reply can carry, as the chat reads it.
 *
 * A reply is no longer only text. The server can attach a small stack of cards
 * — buttons, a checklist, a row of figures, a short form — built and validated
 * against the live router (server: `services/aiBlocks.js`). This module is the
 * pure half: what a form sends, whether it may send it, and where an "open"
 * button goes on THIS app.
 *
 * Free of react-native imports so the decisions can be tested without a
 * renderer, the same rule `apiProposal` and `statsFormat` follow.
 *
 * ─── What is NOT decided here ───────────────────────────────────────────────
 *
 * Nothing about safety. Whether an action is allowed, what it really does, and
 * whether it needs confirming are all settled server-side and re-checked when
 * the button is tapped (`POST /api/turtle/chat/action`). A block that arrives
 * with `confirm: true` gets a second press because the server said so, not
 * because this file worked it out — and a client that skipped the step would be
 * refused with a 428 rather than obeyed.
 */

/** Block kinds this build can draw. Anything else renders as nothing. */
export const BLOCK_KINDS = ['note', 'stats', 'list', 'actions', 'checklist', 'form'];

/**
 * Where an `open` action lands, by the server's screen name.
 *
 * The server validates against a list shared with the web app, which has
 * surfaces this one does not (and vice versa: music, boards and downloads live
 * INSIDE the Turtle tab here rather than as tabs of their own). An unmapped
 * name is left out deliberately — navigating to a guess is worse than saying
 * the screen isn't here.
 */
export const SCREEN_TABS = {
  chat: 'Turtle',
  tasks: 'Tasks',
  notes: 'Notes',
  photos: 'Photos',
  passwords: 'Vault',
  settings: 'Profile',
};

/** The tab an `open` action should navigate to, or null if this app lacks it. */
export function tabForScreen(screen) {
  return SCREEN_TABS[String(screen || '').toLowerCase()] || null;
}

/**
 * Fold a form's filled values into its submit call's body.
 *
 * Field values win over the assistant's pre-filled body for keys the form
 * declares — the point of the form is that the user is correcting or completing
 * what it guessed. Everything else in the body (ids, fixed flags the user never
 * saw) is carried through untouched.
 *
 * Blanks are dropped rather than sent: an empty optional field means "leave it
 * out", not "set it to nothing", and the difference matters to any endpoint
 * that treats `""` as a value it should store.
 */
export function mergeFormBody(fields, values, base) {
  const body = { ...(base || {}) };
  for (const field of fields || []) {
    const raw = values?.[field.name];
    if (raw === null || raw === undefined || raw === '') continue;
    body[field.name] = field.type === 'number' && String(raw).trim() !== '' && Number.isFinite(Number(raw))
      ? Number(raw)
      : raw;
  }
  return body;
}

/** Which required fields are still blank, by label. Empty → the form may submit. */
export function missingRequired(fields, values) {
  return (fields || [])
    .filter((f) => f.required && !String(values?.[f.name] ?? '').trim())
    .map((f) => f.label || f.name);
}

/**
 * Does this board already offer the proposed call as a button?
 *
 * The chat has two confirm affordances now: the older `intent` card
 * (`ApiProposalCard`) and a `call` action inside a block. The server emits BOTH
 * for the same proposed write, on purpose — the web app renders only blocks,
 * this app has only ever rendered intents, and they ship on different days.
 *
 * Now that this app draws blocks, showing both would put two buttons on screen
 * for one change, and a user cannot tell whether pressing both does it twice.
 * So the block wins and the card is suppressed: it is the one that names the
 * real effect underneath itself.
 */
export function blocksCoverProposal(blocks, proposal) {
  if (!proposal || !Array.isArray(blocks)) return false;
  const signature = proposal.signature || `${proposal.method} ${proposal.path}`;
  return blocks.some((block) => actionsOf(block).some(
    (action) => action?.kind === 'call'
      && (action.signature === signature
        || (action.method === proposal.method && action.path === proposal.path)),
  ));
}

/** Every action anywhere in one block — top level, per row, and a form's submit. */
export function actionsOf(block) {
  if (!block || typeof block !== 'object') return [];
  return [
    ...(Array.isArray(block.actions) ? block.actions : []),
    ...(block.submit ? [block.submit] : []),
    ...(Array.isArray(block.items) ? block.items : []).flatMap((item) => [
      ...(Array.isArray(item?.actions) ? item.actions : []),
      ...(item?.action ? [item.action] : []),
    ]),
  ].filter(Boolean);
}

/**
 * Keep only the blocks this build knows how to draw.
 *
 * A kind added to the server later must render as nothing rather than as a
 * best guess — the reply text stands on its own, which is the whole reason
 * blocks are an additive field. A client is allowed to be older than its pond.
 */
export function drawableBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((b) => b && BLOCK_KINDS.includes(b.kind) && typeof b.id === 'string');
}
