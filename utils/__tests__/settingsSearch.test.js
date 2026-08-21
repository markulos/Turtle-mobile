import { normalize, tokenize, withinOneEdit, matchesQuery } from '../settingsSearch';

describe('normalize', () => {
  it('lowercases, strips accents and collapses punctuation', () => {
    expect(normalize('Café  Notifications!')).toBe('cafe notifications');
    expect(normalize('Dark-Mode')).toBe('dark mode');
    expect(normalize('  ')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('tokenize', () => {
  it('splits on any punctuation run and drops empties', () => {
    expect(tokenize('dark  mode')).toEqual(['dark', 'mode']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('withinOneEdit', () => {
  it('accepts one substitution, insertion or deletion', () => {
    expect(withinOneEdit('cache', 'cache')).toBe(true);
    expect(withinOneEdit('chache', 'cache')).toBe(true);   // insertion
    expect(withinOneEdit('cahe', 'cache')).toBe(true);     // deletion
    expect(withinOneEdit('cacke', 'cache')).toBe(true);    // substitution
  });

  it('rejects two or more edits', () => {
    expect(withinOneEdit('ccakke', 'cache')).toBe(false);
    expect(withinOneEdit('calendar', 'cache')).toBe(false);
  });

  it('rejects a length gap bigger than one', () => {
    expect(withinOneEdit('ca', 'cache')).toBe(false);
  });
});

describe('matchesQuery', () => {
  const DARK = 'Dark Mode theme appearance night';
  const NOTIF = 'Notifications push alerts reminders';

  it('matches everything when the query is empty', () => {
    // The unfiltered screen leans on this.
    expect(matchesQuery('', DARK)).toBe(true);
    expect(matchesQuery('   ', DARK)).toBe(true);
  });

  it('matches on a substring of the terms', () => {
    expect(matchesQuery('dark', DARK)).toBe(true);
    expect(matchesQuery('appear', DARK)).toBe(true);
  });

  it('requires EVERY token to match, so more words narrow the result', () => {
    expect(matchesQuery('dark theme', DARK)).toBe(true);
    // 'cache' appears nowhere in DARK — an OR match would wrongly keep this row.
    expect(matchesQuery('dark cache', DARK)).toBe(false);
  });

  it('forgives a single typo in a word of four characters or more', () => {
    expect(matchesQuery('notifcations', NOTIF)).toBe(true);
    expect(matchesQuery('chache', 'Clear cache storage')).toBe(true);
  });

  it('forgives a typo in a prefix of a longer term word', () => {
    expect(matchesQuery('notifcation', NOTIF)).toBe(true);
  });

  it('does not fuzzy-match tokens shorter than four characters', () => {
    // At one to three characters nearly everything is within one edit, which
    // would return the whole settings list and read as a broken search box.
    expect(matchesQuery('z', DARK)).toBe(false);
    expect(matchesQuery('car', DARK)).toBe(false);
  });

  it('is accent and case insensitive', () => {
    expect(matchesQuery('CAFE', 'Café settings')).toBe(true);
    expect(matchesQuery('café', 'Cafe settings')).toBe(true);
  });

  it('never matches a setting with empty terms unless the query is empty', () => {
    expect(matchesQuery('dark', '')).toBe(false);
    expect(matchesQuery('', '')).toBe(true);
  });
});
