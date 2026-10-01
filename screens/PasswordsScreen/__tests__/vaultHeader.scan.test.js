/**
 * A WAY OUT BELONGS IN THE HEADER ROW, not floated on top of it.
 *
 * The Profile opens the vault as an EdgeSwipePage, so the vault needs a close
 * key. It used to get one as an absolutely-positioned chevron rendered as a
 * SIBLING of `<PasswordsScreen />`, at `left: 12`, over a header whose title
 * starts at `x: 16`.
 *
 * An absolute key reserves no layout room. The title therefore laid out as
 * though nothing were there, and "Passwords" was printed straight through the
 * chevron — two glyphs in the same place, which is not a spacing bug that can
 * be tuned away but the wrong shape: a key that is not IN the row cannot be
 * laid out beside.
 *
 * So the way out is a PROP. This is a scan rather than a render test because
 * what went wrong is structural — who owns the key — and that is visible in
 * the source without standing up the theme, the server and an unlocked vault.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const VAULT = 'screens/PasswordsScreen/index.jsx';
const PROFILE = 'screens/ProfileScreen/index.jsx';

describe('the vault owns its own way out', () => {
  test('the scan is reading the files it thinks it is', () => {
    expect(read(VAULT)).toMatch(/export default function PasswordsScreen/);
    expect(read(PROFILE)).toMatch(/<PasswordsScreen/);
  });

  test('PasswordsScreen takes an onBack and the key is a child of the header row', () => {
    const src = read(VAULT);
    expect(src).toMatch(/function PasswordsScreen\(\{\s*onBack\s*\}\)/);

    // The header row, from `<View style={styles.header}>` to its close. The key
    // and the title must both be inside it — that is the whole fix.
    const header = src.slice(src.indexOf('<View style={styles.header}>'));
    const keyAt = header.indexOf('onPress={onBack}');
    const titleAt = header.indexOf('Passwords</Text>');
    expect(keyAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(-1);
    // Leading key, then the title — the reading order of every other page.
    expect(keyAt).toBeLessThan(titleAt);
  });

  test('…and it is optional, because the Vault TAB has nowhere to go back to', () => {
    // Guarded rather than always drawn: a dead chevron on a destination is
    // worse than none.
    expect(read(VAULT)).toMatch(/\{!!onBack &&/);
  });

  test('the Profile hands the key over instead of floating one on top', () => {
    const src = read(PROFILE);
    expect(src).toMatch(/<PasswordsScreen\s+onBack=/);
    // The style the floating chevron used is gone, not merely unreferenced.
    expect(src).not.toMatch(/vaultBack/);
  });

  test('nothing is rendered over the vault page any more', () => {
    const src = read(PROFILE);
    // The vault's EdgeSwipePage should contain the screen and nothing else;
    // a sibling is how the old chevron got on top of the header.
    const open = src.indexOf('<PasswordsScreen');
    const close = src.indexOf('</EdgeSwipePage>', open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const between = src.slice(open, close);
    expect(between).not.toMatch(/chevron-left/);
  });
});
