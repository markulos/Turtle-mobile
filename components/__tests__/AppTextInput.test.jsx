/**
 * AppTextInput is now the field behind every composer and form in the app, so
 * what it promises has to hold: the box does not move, the native placeholder
 * is still there (invisible) for VoiceOver and for getByPlaceholderText, and
 * the drawn one carries the field's own type.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import AppTextInput from '../AppTextInput';

const flat = (node) => StyleSheet.flatten(node.props.style) || {};

describe('AppTextInput placeholder', () => {
  test('draws its own, and keeps the native one transparent', async () => {
    const view = await render(
      <AppTextInput value="" placeholder="Add a comment…" placeholderTextColor="#777" placeholderTestID="ph" testID="in" />,
    );
    expect(view.getByTestId('ph').props.children).toBe('Add a comment…');
    expect(flat(view.getByTestId('ph')).color).toBe('#777');
    // The prop survives so the two things that hang off it still work.
    expect(view.getByTestId('in').props.placeholder).toBe('Add a comment…');
    expect(view.getByTestId('in').props.placeholderTextColor).toBe('transparent');
    expect(view.getByPlaceholderText('Add a comment…')).toBeTruthy();
  });

  test('the drawn placeholder takes the field\'s type, so the two match', async () => {
    const view = await render(
      <AppTextInput
        value=""
        placeholder="Search"
        placeholderTestID="ph"
        style={{ fontSize: 15, fontWeight: '600', textAlign: 'center', color: '#fff' }}
      />,
    );
    const s = flat(view.getByTestId('ph'));
    expect(s.fontSize).toBe(15);
    expect(s.fontWeight).toBe('600');
    expect(s.textAlign).toBe('center');
    // The field's INK is not the placeholder's — that comes from placeholderTextColor.
    expect(s.color).toBeUndefined();
  });

  test('goes the moment there is text, controlled or not', async () => {
    const controlled = await render(<AppTextInput value="typed" placeholder="Search" placeholderTestID="ph" />);
    expect(controlled.queryByTestId('ph')).toBeNull();

    // Uncontrolled: nothing tells the component it is no longer empty except
    // watching what is typed. Without that the placeholder sits over the text.
    const loose = await render(<AppTextInput placeholder="Search" placeholderTestID="ph" testID="in" />);
    expect(loose.getByTestId('ph')).toBeTruthy();
    await fireEvent.changeText(loose.getByTestId('in'), 'x');
    expect(loose.queryByTestId('ph')).toBeNull();
  });

  test('a defaultValue counts as already filled', async () => {
    const view = await render(<AppTextInput defaultValue="25" placeholder="25" placeholderTestID="ph" />);
    expect(view.queryByTestId('ph')).toBeNull();
  });

  test('still reports what the caller typed', async () => {
    const onChangeText = jest.fn();
    const view = await render(<AppTextInput placeholder="Search" testID="in" onChangeText={onChangeText} />);
    await fireEvent.changeText(view.getByTestId('in'), 'warm');
    expect(onChangeText).toHaveBeenCalledWith('warm');
  });
});

describe('AppTextInput box', () => {
  test('SHARES its sizing with the wrapper, so a percentage still resolves', async () => {
    // Only on the wrapper, a `width: 100%` field would collapse: a percentage
    // against an auto-width parent is auto. Only on the input, the wrapper
    // collapses instead. Both carry it, and each resolves one level up.
    const view = await render(
      <AppTextInput value="" placeholder="p" testID="in" wrapStyle={{ opacity: 1 }} style={{ flex: 1, height: 44, width: '100%' }} />,
    );
    const input = view.getByTestId('in');
    const wrap = input.parent;
    expect(flat(input).height).toBe(44);
    expect(flat(wrap).height).toBe(44);
    expect(flat(wrap).flex).toBe(1);
    expect(flat(wrap).width).toBe('100%');
  });

  test('MOVES its offsets to the wrapper, so nothing is applied twice', async () => {
    const view = await render(
      <AppTextInput value="" placeholder="p" testID="in" style={{ marginTop: 12, alignSelf: 'flex-end', height: 40 }} />,
    );
    const input = view.getByTestId('in');
    const wrap = input.parent;
    expect(flat(wrap).marginTop).toBe(12);
    expect(flat(wrap).alignSelf).toBe('flex-end');
    // Left on both, a 12 pt margin would become 24.
    expect(flat(input).marginTop).toBeUndefined();
    expect(flat(input).alignSelf).toBeUndefined();
  });

  test('keeps the field\'s own padding and colour where they belong', async () => {
    const view = await render(
      <AppTextInput value="" placeholder="p" testID="in" style={{ paddingHorizontal: 14, color: '#fff', fontSize: 15 }} />,
    );
    const s = flat(view.getByTestId('in'));
    expect(s.paddingHorizontal).toBe(14);
    expect(s.color).toBe('#fff');
    expect(s.fontSize).toBe(15);
  });
});

describe('AppTextInput placeholder placement', () => {
  // The placeholder sits in the field's CONTENT box — inside the border and the
  // padding — because that is where the field's own text sits. The chat
  // composer pads 12 above and 4 below; centring on the whole box instead of
  // the content box would leave the placeholder 4 pt off its own text.
  const boxOf = (view) => {
    const ph = view.getByTestId('ph');
    return flat(ph.parent);
  };

  test('a single line is centred in the content box, both paddings counted', async () => {
    const view = await render(
      <AppTextInput value="" placeholder="Message…" placeholderTestID="ph"
        style={{ paddingTop: 12, paddingBottom: 4, paddingHorizontal: 18 }} />,
    );
    const box = boxOf(view);
    expect(box.justifyContent).toBe('center');
    expect(box.paddingTop).toBe(12);
    expect(box.paddingBottom).toBe(4);
    expect(box.paddingLeft).toBe(18);
    expect(box.paddingRight).toBe(18);
  });

  test('a multiline field starts at the top, where its first line does', async () => {
    const view = await render(
      <AppTextInput value="" multiline placeholder="Add a note…" placeholderTestID="ph"
        style={{ paddingVertical: 12, paddingHorizontal: 14 }} />,
    );
    const box = boxOf(view);
    expect(box.justifyContent).toBe('flex-start');
    expect(box.paddingTop).toBe(12);
    // The bottom padding plays no part in where the FIRST line sits.
    expect(box.paddingBottom).toBe(0);
  });

  test('a border is part of the inset, or the text starts a pixel in from it', async () => {
    const view = await render(
      <AppTextInput value="" placeholder="25" placeholderTestID="ph"
        style={{ borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, textAlign: 'center' }} />,
    );
    const box = boxOf(view);
    expect(box.borderLeftWidth).toBe(1);
    expect(box.borderRightWidth).toBe(1);
    expect(flat(view.getByTestId('ph')).textAlign).toBe('center');
  });
});
