import { noteShareText } from '../noteShareText';

describe('noteShareText', () => {
  it('a plain note shares as its own body, with nothing added', () => {
    expect(noteShareText({ content: 'milk, bread, tea' })).toBe('milk, bread, tea');
  });

  it('puts a blank line between the title and the body', () => {
    expect(noteShareText({ title: 'Roof quote', content: '£4,200 incl. scaffolding' }))
      .toBe('Roof quote\n\n£4,200 incl. scaffolding');
  });

  it('reads headline → summary → link for an unfurled shared link', () => {
    expect(noteShareText({
      title: 'The Tyranny of the Marginal User',
      description: 'Why software gets worse as it gets more popular.',
      content: 'https://nothinghuman.substack.com/p/the-tyranny-of-the-marginal-user',
    })).toBe(
      'The Tyranny of the Marginal User\n\n'
      + 'Why software gets worse as it gets more popular.\n\n'
      + 'https://nothinghuman.substack.com/p/the-tyranny-of-the-marginal-user',
    );
  });

  it('does not send a part twice when the unfurl copied the title into the description', () => {
    expect(noteShareText({ title: 'Example', description: 'Example', content: 'https://example.com' }))
      .toBe('Example\n\nhttps://example.com');
  });

  it('keeps the body intact — newlines, indentation and all', () => {
    const content = 'Steps:\n  1. thaw\n  2. season\n\n  3. roast';
    expect(noteShareText({ content })).toBe(content);
  });

  it('trims the edges of each part rather than shipping stray whitespace', () => {
    expect(noteShareText({ title: '  Packing list \n', content: '\n socks\n' }))
      .toBe('Packing list\n\nsocks');
  });

  it('leaves tags out — they are filing, not content', () => {
    expect(noteShareText({ content: 'call the vet', tags: ['errands', 'pets/mabel'] }))
      .toBe('call the vet');
  });

  it('skips parts that are absent, empty or whitespace-only', () => {
    expect(noteShareText({ title: '', description: '   ', content: 'just this' })).toBe('just this');
    expect(noteShareText({ title: 'Only a title' })).toBe('Only a title');
  });

  it('shares a to-do the same way a note does', () => {
    expect(noteShareText({ type: 'todo', content: 'renew the passport', done: false }))
      .toBe('renew the passport');
  });

  it('is empty for an empty or missing note, so a caller can decline to open the sheet', () => {
    expect(noteShareText(null)).toBe('');
    expect(noteShareText(undefined)).toBe('');
    expect(noteShareText({})).toBe('');
    expect(noteShareText({ content: '   ' })).toBe('');
  });
});
