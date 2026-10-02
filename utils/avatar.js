/**
 * Animal avatars — assigned by default, CHOSEN when the user says otherwise.
 *
 * Every user starts with an animal silhouette on a tinted disc, derived from
 * their identity string: no upload flow, no asset files, no server round-trip,
 * and the same animal and tint on every device because both come from a hash
 * of the id rather than from storage.
 *
 * The hash is the one already used for board discs in ConversationsOverlay
 * (`h = h * 31 + charCode`), so avatars and board colours come from the same
 * family of hues and sit together without clashing.
 *
 * ─── Two renderings, and why ───────────────────────────────────────────────
 *
 * The DEFAULT is a MaterialCommunityIcons silhouette (`AVATAR_ANIMALS`). A
 * CHOSEN animal is an EMOJI (`AVATAR_CHOICES`). That is not an inconsistency
 * for its own sake — it is forced, and then turns out to be better:
 *
 *   · The icon font simply has no raccoon. Nor fox, bear, otter, hedgehog or
 *     squirrel: verified against the bundled glyphmap, all 6596 names of it.
 *     Adding a font that does have them is a native change, which means an
 *     EAS build and a new runtime that no phone is on — for a picture.
 *   · Emoji need no asset, render in full colour, and every animal anyone
 *     might want already exists in one.
 *   · And it keeps the picker UNIFORM: every option is drawn the same way,
 *     rather than half silhouettes and half colour.
 *
 * The hard constraint this respects: `AVATAR_ANIMALS` is the pool
 * `avatarAnimal()` hashes over, so it must NOT be reordered or extended.
 * Doing either would silently reassign the avatar of every person in every
 * pond who has never made a choice.
 */

/**
 * The deterministic pool. FROZEN ORDER — see above: `avatarAnimal()` indexes
 * into this by hash, so appending to it or sorting it changes who is what.
 *
 * Every name was checked against the bundled MaterialCommunityIcons glyphmap;
 * an unknown name renders as an empty box, so the list is verified rather than
 * assumed ('squirrel', for instance, does NOT exist).
 */
export const AVATAR_ANIMALS = [
  'dog', 'cat', 'owl', 'rabbit', 'panda', 'penguin', 'koala', 'turtle',
  'bird', 'fish', 'horse', 'cow', 'pig', 'sheep', 'duck', 'butterfly',
  'bee', 'snail', 'spider', 'elephant', 'jellyfish', 'ladybug', 'bat',
  'dolphin', 'shark', 'snake', 'unicorn', 'kangaroo', 'rodent',
];

/**
 * What the picker offers. Order is what the user scrolls past, so it runs
 * familiar-first rather than alphabetically — and unlike AVATAR_ANIMALS this
 * list is free to grow, because nothing hashes into it.
 *
 * `key` is what gets stored (lowercase, one word). `label` is the noun that
 * goes into a generated name, so "raccoon" reads back as "Gentle Raccoon".
 */
export const AVATAR_CHOICES = [
  { key: 'raccoon', label: 'Raccoon', emoji: '🦝' },
  { key: 'fox', label: 'Fox', emoji: '🦊' },
  { key: 'bear', label: 'Bear', emoji: '🐻' },
  { key: 'otter', label: 'Otter', emoji: '🦦' },
  { key: 'hedgehog', label: 'Hedgehog', emoji: '🦔' },
  { key: 'squirrel', label: 'Squirrel', emoji: '🐿️' },
  { key: 'wolf', label: 'Wolf', emoji: '🐺' },
  { key: 'dog', label: 'Dog', emoji: '🐶' },
  { key: 'cat', label: 'Cat', emoji: '🐱' },
  { key: 'rabbit', label: 'Rabbit', emoji: '🐰' },
  { key: 'hamster', label: 'Hamster', emoji: '🐹' },
  { key: 'panda', label: 'Panda', emoji: '🐼' },
  { key: 'koala', label: 'Koala', emoji: '🐨' },
  { key: 'sloth', label: 'Sloth', emoji: '🦥' },
  { key: 'tiger', label: 'Tiger', emoji: '🐯' },
  { key: 'lion', label: 'Lion', emoji: '🦁' },
  { key: 'monkey', label: 'Monkey', emoji: '🐵' },
  { key: 'elephant', label: 'Elephant', emoji: '🐘' },
  { key: 'giraffe', label: 'Giraffe', emoji: '🦒' },
  { key: 'zebra', label: 'Zebra', emoji: '🦓' },
  { key: 'deer', label: 'Deer', emoji: '🦌' },
  { key: 'horse', label: 'Horse', emoji: '🐴' },
  { key: 'cow', label: 'Cow', emoji: '🐮' },
  { key: 'pig', label: 'Pig', emoji: '🐷' },
  { key: 'sheep', label: 'Sheep', emoji: '🐑' },
  { key: 'goat', label: 'Goat', emoji: '🐐' },
  { key: 'owl', label: 'Owl', emoji: '🦉' },
  { key: 'penguin', label: 'Penguin', emoji: '🐧' },
  { key: 'duck', label: 'Duck', emoji: '🦆' },
  { key: 'parrot', label: 'Parrot', emoji: '🦜' },
  { key: 'swan', label: 'Swan', emoji: '🦢' },
  { key: 'peacock', label: 'Peacock', emoji: '🦚' },
  { key: 'frog', label: 'Frog', emoji: '🐸' },
  { key: 'turtle', label: 'Turtle', emoji: '🐢' },
  { key: 'snake', label: 'Snake', emoji: '🐍' },
  { key: 'crocodile', label: 'Crocodile', emoji: '🐊' },
  { key: 'dolphin', label: 'Dolphin', emoji: '🐬' },
  { key: 'whale', label: 'Whale', emoji: '🐳' },
  { key: 'shark', label: 'Shark', emoji: '🦈' },
  { key: 'octopus', label: 'Octopus', emoji: '🐙' },
  { key: 'crab', label: 'Crab', emoji: '🦀' },
  { key: 'butterfly', label: 'Butterfly', emoji: '🦋' },
  { key: 'bee', label: 'Bee', emoji: '🐝' },
  { key: 'ladybug', label: 'Ladybug', emoji: '🐞' },
  { key: 'snail', label: 'Snail', emoji: '🐌' },
  { key: 'bat', label: 'Bat', emoji: '🦇' },
  { key: 'kangaroo', label: 'Kangaroo', emoji: '🦘' },
  { key: 'unicorn', label: 'Unicorn', emoji: '🦄' },
  { key: 'dragon', label: 'Dragon', emoji: '🐲' },
];

const CHOICE_BY_KEY = new Map(AVATAR_CHOICES.map((a) => [a.key, a]));

/** Is this a animal someone may actually have picked? */
export const isAvatarChoice = (key) => CHOICE_BY_KEY.has(String(key || ''));

/** The emoji for a chosen animal, or '' for anything unrecognised. */
export const avatarEmoji = (key) => CHOICE_BY_KEY.get(String(key || ''))?.emoji || '';

// Adjectives for the generated display name. Paired with the user's own animal
// so the name and the picture always agree ("Swift Otter" over an otter disc).
const NAME_ADJECTIVES = [
  'Swift', 'Quiet', 'Clever', 'Bright', 'Bold', 'Gentle', 'Wild', 'Lucky',
  'Brave', 'Sunny', 'Wise', 'Nimble', 'Calm', 'Merry', 'Keen', 'Noble',
];

/** Stable non-negative hash of any string. Same shape as `boardColor`'s. */
const hashOf = (value) => {
  const s = String(value || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 1000003;
  return h;
};

/** The DEFAULT animal glyph for an identity — the icon-font name it hashes to. */
export const avatarAnimal = (id) => AVATAR_ANIMALS[hashOf(id) % AVATAR_ANIMALS.length];

/**
 * What to actually DRAW for someone: `{ emoji }` when they have chosen an
 * animal, `{ icon }` when they have not.
 *
 * One call, so no surface has to know there are two renderings — a site that
 * branched on it by hand is a site that will forget to, and the avatar is
 * drawn in eight places.
 */
export const avatarGlyph = (id, chosen) => (
  isAvatarChoice(chosen)
    ? { emoji: avatarEmoji(chosen), icon: null }
    : { emoji: null, icon: avatarAnimal(id) }
);

/**
 * The disc tint for an identity — a hue from the same 55%/55% HSL family the
 * board discs use, so a person's avatar reads as part of the same set.
 * Offset by a second hash so two users with adjacent animals don't also get
 * adjacent hues.
 */
export const avatarTint = (id) => `hsl(${hashOf(`${id}#tint`) % 360}, 55%, 55%)`;

/**
 * A display name for someone who hasn't set one: adjective + their animal,
 * capitalised ("Clever Panda"). Deterministic, so the name doesn't change every
 * launch — but it is only a DEFAULT: the profile lets the user overwrite it.
 *
 * The ADJECTIVE always comes from the id, and only the noun follows a choice:
 * picking a raccoon turns "Gentle Sheep" into "Gentle Raccoon", which is the
 * point. Re-hashing the adjective off the new animal would rename the person
 * as a side effect of changing their picture.
 */
export const generatedName = (id, chosen) => {
  const noun = isAvatarChoice(chosen)
    ? CHOICE_BY_KEY.get(chosen).label
    : (() => { const a = avatarAnimal(id); return `${a.charAt(0).toUpperCase()}${a.slice(1)}`; })();
  const adjective = NAME_ADJECTIVES[hashOf(`${id}#adj`) % NAME_ADJECTIVES.length];
  return `${adjective} ${noun}`;
};

/** Everything a surface needs to paint one avatar, in one call. */
export const avatarFor = (id, chosen) => ({
  animal: avatarAnimal(id),
  ...avatarGlyph(id, chosen),
  tint: avatarTint(id),
  name: generatedName(id, chosen),
});
