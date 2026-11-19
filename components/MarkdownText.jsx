/**
 * MarkdownText — draws a chat reply with its Markdown applied: headings,
 * bullet / numbered lists, code blocks, inline code, bold, italic, strike,
 * links, quotes, rules. Backed by utils/markdownLite (pure data), so this is
 * only nested <Text> and a few <View>s — no dependency, no WebView.
 *
 * Colours come from the bubble it sits in: pass the same `style` the plain
 * text used (font size / line height / colour) and the renderer derives the
 * rest — code on a translucent field, links in the accent, quotes with a bar.
 *
 * EVERY BLOCK IS SELECTABLE. A fence always was, because a fence is the shape
 * a reply uses for the things you are meant to take; but the rest of a reply
 * is just as often the part you want — a sentence out of an answer, an
 * address, one line of a list — and there was no way to lift it. Selection is
 * the platform's own long-press: handles, a magnifier and the system's Copy,
 * which is where everyone already looks for it.
 */
import React, { memo, useMemo } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { parseMarkdown } from '../utils/markdownLite';
import CopyKey from './CopyKey';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Parse once per distinct text, app-wide: a recycled list cell mounts a new
// component instance for the same message, and useMemo would parse again.
const PARSE_CACHE_MAX = 300;
const parseCache = new Map();
function parseCached(text) {
  const key = String(text || '');
  const hit = parseCache.get(key);
  if (hit) return hit;
  const blocks = parseMarkdown(key);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.delete(parseCache.keys().next().value);
  parseCache.set(key, blocks);
  return blocks;
}

function openLink(url) {
  Linking.openURL(url).catch(() => {});
}

function Spans({ spans, colors }) {
  return spans.map((s, i) => {
    const style = [
      s.bold && styles.bold,
      s.italic && styles.italic,
      s.strike && styles.strike,
      s.code && [styles.code, { backgroundColor: colors.codeBg, color: colors.codeText }],
      s.link && [styles.link, { color: colors.link }],
    ].filter(Boolean);
    return (
      <Text
        key={i}
        style={style.length ? style : undefined}
        onPress={s.link ? () => openLink(s.link) : undefined}
        accessibilityRole={s.link ? 'link' : undefined}
      >
        {s.text}
      </Text>
    );
  });
}

/**
 * A fenced block, with the one control it has ever needed.
 *
 * The copy key is the whole reason this is a component rather than three lines
 * in the switch below: a fence is the shape a reply uses for the things you are
 * meant to TAKE — a prompt to paste somewhere else, a command to run, a snippet.
 * Selecting that by hand on a phone means a long-press and two drag handles
 * over monospaced text in a scrolling transcript, which is the worst selection
 * surface the app has.
 *
 * It is deliberately not on every block. A paragraph is to read; a fence is to
 * use. Putting a key on both would make neither mean anything — so the control
 * appears exactly where the reply's own formatting says "this is an artefact".
 * The WHOLE message has its own key, in the bubble's corner, and any part of
 * it can be selected by hand; this one is for the artefact alone.
 */
function CodeBlock({ block, base, colors, gap, style: blockStyle }) {
  return (
    <View style={[styles.codeBlock, { backgroundColor: colors.codeBg }, gap]}>
      {/* Language on the left when the fence declared one, key on the right.
          A row above the code rather than a floating overlay: code wraps, and
          an absolutely-positioned key would sit on top of the first line of
          exactly the text it is offering to copy. */}
      <View style={styles.codeBar}>
        <Text style={[styles.codeLang, { color: colors.muted }]} numberOfLines={1}>
          {block.lang || ''}
        </Text>
        <CopyKey
          text={block.text}
          color={colors.muted}
          doneColor={colors.copyDone || colors.muted}
          accessibilityLabel={block.lang ? `Copy this ${block.lang} block` : 'Copy this block'}
          testID="markdown-copy-code"
          style={styles.copyKey}
        />
      </View>
      <Text style={[base, styles.codeBlockText, { color: colors.codeText }, blockStyle]} selectable>
        {block.text}
      </Text>
    </View>
  );
}

function MarkdownText({ text, style, theme, testID, numberOfLines = 0 }) {
  const all = useMemo(() => parseCached(text), [text]);
  /**
   * CLAMPED, for a list row.
   *
   * Mark's note "Hyperlink in notes": a note's row is two lines of preview,
   * and it still has to show its formatting and its links. Rendering every
   * block and letting the row clip them is not the same thing — a clipped
   * code fence or a half-drawn list is worse than the plain text it
   * replaced, and the blocks below the fold would still be measured and
   * laid out for every row in a scrolling list.
   *
   * So a clamp means ONE block, with the platform's own line clamp on it.
   * The rest of the note is in the note; this is the look at it.
   */
  const blocks = numberOfLines > 0 ? all.slice(0, 1) : all;
  const flat = StyleSheet.flatten(style) || {};
  const textColor = flat.color || theme?.colors?.textPrimary || '#fff';
  const fontSize = flat.fontSize || 15;
  const lineHeight = flat.lineHeight || Math.round(fontSize * 1.35);
  const colors = useMemo(() => ({
    codeBg: 'rgba(127,127,127,0.18)',
    codeText: textColor,
    link: theme?.colors?.accentInfo || '#60A5FA',
    quoteBar: 'rgba(127,127,127,0.5)',
    rule: 'rgba(127,127,127,0.35)',
    muted: theme?.colors?.textSecondary || textColor,
    copyDone: theme?.colors?.accentSuccess || theme?.colors?.primary || textColor,
  }), [textColor, theme]);
  const base = [style, { color: textColor, fontSize, lineHeight }];
  /**
   * Selection is OFF while clamped. A long-press on a row already means
   * something (the note's own actions), and the platform's selection
   * handles would swallow it.
   */
  const clamp = numberOfLines > 0 ? { numberOfLines, selectable: false } : null;

  return (
    <View testID={testID}>
      {blocks.map((b, i) => {
        const gap = i < blocks.length - 1 ? { marginBottom: 6 } : null;
        switch (b.type) {
          case 'heading': {
            const size = b.level === 1 ? fontSize + 4 : b.level === 2 ? fontSize + 2 : fontSize + 1;
            return (
              <Text key={i} selectable {...clamp} style={[base, styles.bold, { fontSize: size, lineHeight: Math.round(size * 1.3) }, gap, i > 0 && { marginTop: 4 }]}>
                <Spans spans={b.spans} colors={colors} />
              </Text>
            );
          }
          case 'list':
            return (
              <View key={i} style={gap}>
                {b.items.map((it, j) => (
                  <View key={j} style={[styles.listRow, { paddingLeft: 4 + it.depth * 14 }]}>
                    <Text selectable style={[base, styles.marker]}>{b.ordered ? `${it.number ?? j + 1}.` : '•'}</Text>
                    <Text selectable {...clamp} style={[base, styles.listText]}>
                      <Spans spans={it.spans} colors={colors} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'code':
            return <CodeBlock key={i} block={b} base={base} colors={colors} gap={gap} />;
          case 'quote':
            return (
              <View key={i} style={[styles.quote, { borderLeftColor: colors.quoteBar }, gap]}>
                <Text selectable style={[base, { color: colors.muted }]}>
                  <Spans spans={b.spans} colors={colors} />
                </Text>
              </View>
            );
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: colors.rule }, gap]} />;
          default:
            return (
              <Text key={i} selectable {...clamp} style={[base, gap]}>
                <Spans spans={b.spans} colors={colors} />
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  code: {
    fontFamily: MONO,
    fontSize: 13,
    borderRadius: 4,
    paddingHorizontal: 3,
  },
  link: { textDecorationLine: 'underline' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  marker: {
    width: 20,
    textAlign: 'right',
    marginRight: 6,
  },
  listText: {
    flex: 1,
    flexShrink: 1,
  },
  codeBlock: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  // The fence's own header strip. `minHeight` rather than a fixed height so the
  // row keeps its 20pt even when there is no language to print.
  codeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
    marginBottom: 4,
  },
  codeLang: {
    flexShrink: 1,
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'lowercase',
    opacity: 0.8,
  },
  copyKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
  },
  codeBlockText: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 18,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 10,
  },
  rule: {
    height: StyleSheet.hairlineWidth * 2,
    marginVertical: 4,
  },
});

export default memo(MarkdownText);
