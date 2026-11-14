import {
  MAX_LOOKS, NAME_MAX, addLook, captureLook, cleanName, isWearing, newLookId,
  normalizeLook, readLooks, removeLook, renameLook, wornLook,
} from '../savedLooks';

/**
 * The rules a saved look has to follow.
 *
 * None of this is about pixels — the picker draws these and has its own
 * tests. What is pinned here is everything that decides whether a look you
 * saved is still the look you get back: what a capture includes, what
 * survives a round trip through storage, and what happens to a store written
 * by a build that is not this one.
 */

const SETTINGS = {
  dockIndicator: 'underline',
  dockStyle: 'custom',
  dockColor: '#101614',
  dockInk: 'dark',
  dockInkColor: '#223344',
  dockGlow: 1.5,
  dockGlowColor: '#4FD8F5',
  accentColor: '#C9A227',
  dockTheme: '',
};

describe('what a look captures', () => {
  test('every setting the panel can change', () => {
    expect(captureLook(SETTINGS)).toEqual({
      indicator: 'underline',
      style: 'custom',
      color: '#101614',
      ink: 'dark',
      inkColor: '#223344',
      glow: 1.5,
      glowColor: '#4FD8F5',
      accent: '#C9A227',
      themeKey: '',
    });
  });

  test('the THEME KEY rides along, or a composed look comes back flat', () => {
    // A theme may override fields no setting has a slot for — Godzilla's
    // unselected glyphs, its rim. Those cannot be rebuilt from backdrop and
    // accent, so a look saved while wearing one has to remember which one.
    expect(captureLook({ ...SETTINGS, dockTheme: 'godzilla' }).themeKey).toBe('godzilla');
  });

  test('glow 0 is a real setting, not an absent one', () => {
    // "Off" has to survive. Anything leaning on falsiness here turns every
    // saved look with the glow off back into a look with it on.
    expect(captureLook({ ...SETTINGS, dockGlow: 0 }).glow).toBe(0);
  });

  test('junk in any field lands on something usable', () => {
    const look = captureLook({
      dockIndicator: 'sideways', dockStyle: 'velvet', dockColor: 'not a colour',
      dockInk: 'puce', dockGlow: 'loads', accentColor: undefined, dockTheme: 7,
    });
    expect(look).toEqual({
      indicator: 'chip', style: 'smoked', color: null, ink: 'auto',
      inkColor: null, glow: 1, glowColor: null, accent: null, themeKey: '',
    });
  });

  test('an out-of-range glow is clamped rather than stored', () => {
    expect(captureLook({ ...SETTINGS, dockGlow: 99 }).glow).toBe(2);
    expect(captureLook({ ...SETTINGS, dockGlow: -5 }).glow).toBe(0);
  });
});

describe('names', () => {
  test('trimmed, collapsed, and capped', () => {
    expect(cleanName('  Late   night  ')).toBe('Late night');
    expect(cleanName('x'.repeat(NAME_MAX + 20))).toHaveLength(NAME_MAX);
  });

  test('a look with no name is not a look', () => {
    expect(normalizeLook({ id: 'a', name: '   ' })).toBeNull();
    expect(addLook([], { id: 'a', name: '  ' })).toEqual([]);
  });
});

describe('the store, read back', () => {
  const entry = { id: 'a', name: 'Night', savedAt: 5, ...captureLook(SETTINGS) };

  test('a round trip through JSON keeps every field', () => {
    const [back] = readLooks(JSON.stringify([entry]));
    expect(back).toEqual(entry);
  });

  test('a store written by nobody at all is empty, not an error', () => {
    // This runs at app start on data this build did not write. Throwing here
    // is an app that opens on a white screen.
    for (const junk of ['', 'not json', '{}', 'null', '[1,2,3]', undefined]) {
      expect(readLooks(junk)).toEqual([]);
    }
  });

  test('one unreadable look does not take the others with it', () => {
    const list = readLooks(JSON.stringify([entry, null, { name: 'no id' }, 42]));
    expect(list.map((l) => l.name)).toEqual(['Night']);
  });

  test('duplicate ids are dropped — they would eat each other later', () => {
    const list = readLooks(JSON.stringify([entry, { ...entry, name: 'Other' }]));
    expect(list).toHaveLength(1);
  });

  test('a store longer than the cap is cut to it', () => {
    const many = Array.from({ length: MAX_LOOKS + 6 }, (_, i) => ({ ...entry, id: `id-${i}`, name: `n${i}` }));
    expect(readLooks(JSON.stringify(many))).toHaveLength(MAX_LOOKS);
  });
});

describe('adding, renaming, removing', () => {
  const mk = (id, name, over = {}) => ({ id, name, ...captureLook({ ...SETTINGS, ...over }) });

  test('the newest is first — it is the one you just made', () => {
    const list = addLook(addLook([], mk('a', 'One')), mk('b', 'Two'));
    expect(list.map((l) => l.name)).toEqual(['Two', 'One']);
  });

  test('saving over a name you already used REPLACES it', () => {
    // Not an error: "save" onto a name you recognise is the ordinary way to
    // update something, and two tiles with one label cannot be told apart.
    const first = addLook([], mk('a', 'Night', { dockGlow: 0 }));
    const again = addLook(first, mk('b', 'night ', { dockGlow: 2 }));
    expect(again).toHaveLength(1);
    expect(again[0].glow).toBe(2);
  });

  test('the cap holds, and it is the oldest that goes', () => {
    let list = [];
    for (let i = 0; i < MAX_LOOKS + 3; i += 1) list = addLook(list, mk(`id-${i}`, `n${i}`));
    expect(list).toHaveLength(MAX_LOOKS);
    expect(list[0].name).toBe(`n${MAX_LOOKS + 2}`);
    expect(list.some((l) => l.name === 'n0')).toBe(false);
  });

  test('renaming onto ANOTHER look’s name is refused', () => {
    // Unlike saving, there is no "you meant to overwrite it" reading of this.
    const list = addLook(addLook([], mk('a', 'One')), mk('b', 'Two'));
    expect(renameLook(list, 'b', 'one').map((l) => l.name)).toEqual(['Two', 'One']);
    expect(renameLook(list, 'b', 'Three').map((l) => l.name)).toEqual(['Three', 'One']);
    // …but renaming a look to what it is already called is not a collision.
    expect(renameLook(list, 'b', 'Two').map((l) => l.name)).toEqual(['Two', 'One']);
  });

  test('removing takes exactly one', () => {
    const list = addLook(addLook([], mk('a', 'One')), mk('b', 'Two'));
    expect(removeLook(list, 'a').map((l) => l.name)).toEqual(['Two']);
    expect(removeLook(list, 'nope')).toHaveLength(2);
  });

  test('an id is never handed out twice, even in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLookId()));
    expect(ids.size).toBe(50);
  });
});

describe('which one you are wearing', () => {
  const saved = { id: 'a', name: 'Night', ...captureLook(SETTINGS) };

  test('the one whose every field matches', () => {
    expect(isWearing(saved, SETTINGS)).toBe(true);
    expect(wornLook([saved], SETTINGS)).toBe(saved);
  });

  test('nudge ANY setting and you are no longer wearing it', () => {
    // Worked out by comparison rather than remembered, so nothing has to be
    // cleared when a control moves — a tile that stayed ticked while you
    // edited under it would be lying about what is on screen.
    for (const [k, v] of Object.entries({
      dockIndicator: 'chip', dockStyle: 'paper', dockColor: '#FFFFFF',
      dockInk: 'light', dockGlow: 0, dockGlowColor: '#FF0000',
      accentColor: '#FF0000', dockTheme: 'godzilla',
    })) {
      expect(isWearing(saved, { ...SETTINGS, [k]: v })).toBe(false);
    }
    expect(wornLook([saved], { ...SETTINGS, dockGlow: 0 })).toBeNull();
  });
});
