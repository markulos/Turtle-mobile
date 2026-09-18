/**
 * MarkdownText — draws a chat reply with its Markdown applied: headings,
 * bullet / numbered lists, code blocks, inline code, bold, italic, strike,
 * links, quotes, rules. Backed by utils/markdownLite (pure data), so this is
 * only nested <Text> and a few <View>s — no dependency, no WebView.
 *
 * Colours come from the bubble it sits in: pass the same `style` the plain
 * text used (font size / line height / colour) and the renderer derives the
 * rest — code on a translucent field, links in the accent, quotes with a bar.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { parseMarkdown } from '../utils/markdownLite';
import { copyText } from '../utils/copyText';
import { tapHaptic } from '../utils/haptics';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
// The copy key's visible box is ~16pt tall; this is what gets it to 44.
const HIT_SLOP_10 = { top: 14, bottom: 14, left: 10, right: 10 };

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
 * appears exactly where the reply's own formatting says "this is an artefact",
 * and a reply with no fences shows no keys at all.
 */
function CodeBlock({ block, base, colors, gap, style: blockStyle }) {
  // null → idle; otherwise the word to show back ('Copied' / 'Shared').
  const [done, setDone] = useState(null);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = useCallback(async () => {
    tapHaptic();
    const result = await copyText(block.text);
    // 'none' means the clipboard was unavailable AND the share sheet was
    // dismissed — claiming "Copied" there would be a lie.
    if (result === 'none' || !alive.current) return;
    setDone(result === 'shared' ? 'Shared' : 'Copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (alive.current) setDone(null); }, 1600);
  }, [block.text]);

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
        <Pressable
          onPress={onCopy}
          hitSlop={HIT_SLOP_10}
          accessibilityRole="button"
          accessibilityLabel={block.lang ? `Copy this ${block.lang} block` : 'Copy this block'}
          testID="markdown-copy-code"
          style={({ pressed }) => [styles.copyKey, pressed && { opacity: 0.6 }]}
        >
          <Icon
            name={done ? 'check' : 'content-copy'}
            size={13}
            color={done ? (colors.copyDone || colors.muted) : colors.muted}
          />
          <Text style={[styles.copyKeyText, { color: done ? (colors.copyDone || colors.muted) : colors.muted }]}>
            {done || 'Copy'}
          </Text>
        </Pressable>
      </View>
      <Text style={[base, styles.codeBlockText, { color: colors.codeText }, blockStyle]} selectable>
        {block.text}
      </Text>
    </View>
  );
}

function MarkdownText({ text, style, theme, testID }) {
  const blocks = useMemo(() => parseCached(text), [text]);
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

  return (
    <View testID={testID}>
      {blocks.map((b, i) => {
        const gap = i < blocks.length - 1 ? { marginBottom: 6 } : null;
        switch (b.type) {
          case 'heading': {
            const size = b.level === 1 ? fontSize + 4 : b.level === 2 ? fontSize + 2 : fontSize + 1;
            return (
              <Text key={i} style={[base, styles.bold, { fontSize: size, lineHeight: Math.round(size * 1.3) }, gap, i > 0 && { marginTop: 4 }]}>
                <Spans spans={b.spans} colors={colors} />
              </Text>
            );
          }
          case 'list':
            return (
              <View key={i} style={gap}>
                {b.items.map((it, j) => (
                  <View key={j} style={[styles.listRow, { paddingLeft: 4 + it.depth * 14 }]}>
                    <Text style={[base, styles.marker]}>{b.ordered ? `${it.number ?? j + 1}.` : '•'}</Text>
                    <Text style={[base, styles.listText]}>
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
                <Text style={[base, { color: colors.muted }]}>
                  <Spans spans={b.spans} colors={colors} />
                </Text>
              </View>
            );
          case 'rule':
            return <View key={i} style={[styles.rule, { backgroundColor: colors.rule }, gap]} />;
          default:
            return (
              <Text key={i} style={[base, gap]}>
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
  copyKeyText: {
    fontSize: 11,
    fontWeight: '600',
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
