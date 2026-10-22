/**
 * "Transcribe this video" — the choice, on the house two-detent sheet.
 *
 * Two rows, because there are two outcomes worth wanting: the words on their
 * own, or the words AND the audio kept as a track beside the video. The
 * second is offered only where the pond says it can do it; where it cannot,
 * the row stays visible and says why, because "that pond is older than this
 * app" is a fact worth reading once rather than a mystery every time.
 *
 * Options (model, separate speakers) are deliberately NOT here. They live on
 * the Transcribe page, they are remembered there, and putting a second copy
 * of them in front of someone who tapped a video is a form to fill in where a
 * choice was asked for. This sheet starts the run at the pond's own defaults
 * and the page it opens is where everything else about the job lives.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import ViewerSheet from '../PhotoViewer/ViewerSheet';
import { tapHaptic } from '../../../../utils/haptics';
import { itemTitle, modeOffers, videoProblem } from '../../../../utils/videoTranscribe';

export default function VideoTranscribeSheet({
  item, capabilities, onPick, onClose, theme, bottomInset = 0,
}) {
  const c = theme.colors;
  const offers = modeOffers(capabilities);
  const problem = videoProblem(item, capabilities);

  return (
    <ViewerSheet
      title="Transcribe"
      subtitle={itemTitle(item)}
      doneLabel="Cancel"
      onDone={onClose}
      onClose={onClose}
      theme={theme}
      bottomInset={bottomInset}
      testID="video-transcribe-sheet"
    >
      {problem ? (
        <Text style={[styles.hint, { color: c.accentError || '#e5484d' }]}>{problem}</Text>
      ) : offers.map((offer) => (
        <Pressable
          key={offer.mode}
          disabled={!offer.available}
          onPressIn={offer.available ? tapHaptic : undefined}
          onPress={() => onPick(offer.mode)}
          accessibilityRole="button"
          accessibilityLabel={offer.title}
          accessibilityState={{ disabled: !offer.available }}
          testID={`transcribe-mode-${offer.mode}`}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: !offer.available ? 0.55 : pressed ? 0.6 : 1,
            },
          ]}
        >
          <Icon name={offer.icon} size={24} color={offer.available ? c.primary : c.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>{offer.title}</Text>
            <Text style={[styles.detail, { color: c.textMuted }]}>{offer.why || offer.detail}</Text>
          </View>
          {offer.available && <Icon name="chevron-right" size={22} color={c.textMuted} />}
        </Pressable>
      ))}
    </ViewerSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 17 },
  hint: { fontSize: 13, lineHeight: 19, paddingVertical: 8 },
});
