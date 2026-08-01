/**
 * Deterministic animal avatars.
 *
 * Every user gets an animal silhouette on a tinted disc, assigned from their
 * identity string — no upload flow, no asset files, no server round-trip. The
 * same user always gets the same animal and the same tint, on every device,
 * because both are derived from a hash of the id rather than stored anywhere.
 *
 * The hash is the one already used for board discs in ConversationsOverlay
 * (`h = h * 31 + charCode`), so avatars and board colours come from the same
 * family of hues and sit together without clashing.
 *
 * Every glyph below was checked against the bundled MaterialCommunityIcons
 * glyphmap — an unknown name renders as an empty box, so the list is verified
 * rather than assumed ('squirrel', for instance, does NOT exist).
 */

export const AVATAR_ANIMALS = [
  'dog', 'cat', 'owl', 'rabbit', 'panda', 'penguin', 'koala', 'turtle',
  'bird', 'fish', 'horse', 'cow', 'pig', 'sheep', 'duck', 'butterfly',
  'bee', 'snail', 'spider', 'elephant', 'jellyfish', 'ladybug', 'bat',
  'dolphin', 'shark', 'snake', 'unicorn', 'kangaroo', 'rodent',
];

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

/** The animal glyph for an identity. */
export const avatarAnimal = (id) => AVATAR_ANIMALS[hashOf(id) % AVATAR_ANIMALS.length];

/**
 * The disc tint for an identity — a hue from the same 55%/55% HSL family the
 * board discs use, so a person's avatar reads as part of the same set.
 * Offset by a second hash so two users with adjacent animals don't also get
 * adjacent hues.
 */
export const avatarTint = (id) => `hsl(${hashOf(`${id}#tint`) % 360}, 55%, 55%)`;

/**
 * A display name for someone who hasn't set one: adjective + their own animal,
 * capitalised ("Clever Panda"). Deterministic, so the name doesn't change every
 * launch — but it is only a DEFAULT: the profile lets the user overwrite it.
 */
export const generatedName = (id) => {
  const animal = avatarAnimal(id);
  const adjective = NAME_ADJECTIVES[hashOf(`${id}#adj`) % NAME_ADJECTIVES.length];
  return `${adjective} ${animal.charAt(0).toUpperCase()}${animal.slice(1)}`;
};

/** Everything a surface needs to paint one avatar, in one call. */
export const avatarFor = (id) => ({
  animal: avatarAnimal(id),
  tint: avatarTint(id),
  name: generatedName(id),
});
