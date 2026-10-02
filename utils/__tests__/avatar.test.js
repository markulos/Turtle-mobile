/**
 * The animal avatar catalogue, and the one invariant that cannot be allowed to
 * break: `AVATAR_ANIMALS` is indexed by a hash of the user's id, so reordering
 * it or inserting into it silently reassigns the avatar of every person in
 * every pond who has never picked one.
 *
 * The frozen assignments below were captured from the shipped implementation.
 * If one of them fails, the list was edited — that is the whole point of them,
 * and the fix is to put the list back, not to update the expectation.
 */
import {
  AVATAR_ANIMALS,
  AVATAR_CHOICES,
  avatarAnimal,
  avatarEmoji,
  avatarGlyph,
  avatarTint,
  generatedName,
  isAvatarChoice,
} from '../avatar';

// Read off DISK rather than required: jest's moduleNameMapper rewrites
// `react-native-vector-icons/*` to `@expo/vector-icons/*`, so a plain require
// of the glyphmap cannot resolve. Both sets are checked, because the mapper
// means tests see one and the device renders the other — and a name has to be
// in both for the icon to be real in each.
const fs = require('fs');
const path = require('path');
const readGlyphmap = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8'));
const GLYPHMAP = readGlyphmap('node_modules/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
const EXPO_GLYPHMAP = readGlyphmap('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

describe('the deterministic pool is frozen', () => {
  test('known identities keep the animal they were already given', () => {
    expect(avatarAnimal('anon')).toBe('elephant');
    expect(avatarAnimal('sub:123')).toBe('koala');
    expect(avatarAnimal('phone:+15551234567')).toBe('pig');
    expect(avatarAnimal('u_owner')).toBe('fish');
    expect(avatarAnimal('user_owner')).toBe('rodent');
  });

  test('and the names built from them', () => {
    expect(generatedName('anon')).toBe('Quiet Elephant');
    expect(generatedName('sub:123')).toBe('Gentle Koala');
    expect(generatedName('user_owner')).toBe('Bold Rodent');
  });

  test('every name in the pool is a REAL icon in the bundled font', () => {
    // An unknown name renders as an empty box rather than failing loudly,
    // which is why this is checked rather than trusted ('squirrel' and
    // 'raccoon' are both absent from this font — hence the emoji catalogue).
    expect(AVATAR_ANIMALS.filter((n) => !(n in GLYPHMAP))).toEqual([]);
    expect(AVATAR_ANIMALS.filter((n) => !(n in EXPO_GLYPHMAP))).toEqual([]);
  });

  test('the tint is stable and in the board-disc family', () => {
    expect(avatarTint('sub:123')).toBe(avatarTint('sub:123'));
    expect(avatarTint('sub:123')).toMatch(/^hsl\(\d{1,3}, 55%, 55%\)$/);
  });
});

describe('the pickable catalogue', () => {
  test('raccoon is in it — the animal that started all this', () => {
    expect(isAvatarChoice('raccoon')).toBe(true);
    expect(avatarEmoji('raccoon')).toBe('🦝');
  });

  test('it includes the animals the icon font cannot draw at all', () => {
    for (const key of ['raccoon', 'fox', 'bear', 'otter', 'hedgehog', 'squirrel']) {
      expect(isAvatarChoice(key)).toBe(true);
      // The reason the catalogue is emoji at all. If a future font update adds
      // these, this flips — and switching them to icons becomes a real option.
      expect(key in GLYPHMAP).toBe(false);
      expect(key in EXPO_GLYPHMAP).toBe(false);
    }
  });

  test('every entry is complete and unique', () => {
    const keys = AVATAR_CHOICES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of AVATAR_CHOICES) {
      expect(a.key).toMatch(/^[a-z]+$/);
      expect(a.emoji.length).toBeGreaterThan(0);
      // The label is the noun that goes into a generated name, so it has to be
      // capitalised prose rather than the key.
      expect(a.label).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  test('an unknown key is not a choice', () => {
    expect(isAvatarChoice('tyrannosaurus')).toBe(false);
    expect(isAvatarChoice('')).toBe(false);
    expect(isAvatarChoice(null)).toBe(false);
    expect(isAvatarChoice(undefined)).toBe(false);
    expect(avatarEmoji('tyrannosaurus')).toBe('');
  });
});

describe('avatarGlyph', () => {
  test('a chosen animal draws as an emoji', () => {
    expect(avatarGlyph('sub:123', 'raccoon')).toEqual({ emoji: '🦝', icon: null });
  });

  test('no choice draws as the assigned silhouette', () => {
    expect(avatarGlyph('sub:123', null)).toEqual({ emoji: null, icon: 'koala' });
    expect(avatarGlyph('sub:123')).toEqual({ emoji: null, icon: 'koala' });
  });

  test('a key nobody recognises falls back rather than drawing nothing', () => {
    // A value written by a newer build, or corrupted storage. An avatar is
    // chrome: it must never be the thing that renders blank.
    expect(avatarGlyph('sub:123', 'tyrannosaurus')).toEqual({ emoji: null, icon: 'koala' });
  });
});

describe('the generated name follows the chosen animal', () => {
  // The actual ask: "change gentle sheep to gentle raccoon".
  test('the adjective stays and only the noun moves', () => {
    // An identity whose assigned animal IS sheep, so this is the real journey.
    const sheepId = AVATAR_ANIMALS.includes('sheep') ? findIdWithAnimal('sheep') : null;
    expect(sheepId).toBeTruthy();
    const before = generatedName(sheepId);
    expect(before).toMatch(/ Sheep$/);
    const adjective = before.replace(/ Sheep$/, '');
    expect(generatedName(sheepId, 'raccoon')).toBe(`${adjective} Raccoon`);
  });

  test('re-picking does not re-roll the adjective', () => {
    const a = generatedName('sub:123', 'raccoon');
    const b = generatedName('sub:123', 'fox');
    expect(a.split(' ')[0]).toBe(b.split(' ')[0]);
  });

  test('an unknown choice keeps the assigned noun', () => {
    expect(generatedName('sub:123', 'tyrannosaurus')).toBe('Gentle Koala');
  });
});

/** Search for an identity string whose ASSIGNED animal is `animal`. */
function findIdWithAnimal(animal) {
  for (let i = 0; i < 5000; i += 1) {
    const id = `probe:${i}`;
    if (avatarAnimal(id) === animal) return id;
  }
  return null;
}
