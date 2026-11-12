/**
 * MusicWebResultRow — one YouTube hit, in the vault's shared result row.
 *
 * Deliberately the SAME row as a library match (VaultResultRow): you are
 * looking for one thing by name in both scopes, and switching the toggle
 * should change where the rows come from and nothing else about reading them.
 * The two differences are the ones that carry meaning:
 *
 *   • the leading square holds the video's thumbnail rather than a note glyph,
 *     because a cover is how you tell four uploads of the same song apart;
 *
 *   • there is a trailing DOWNLOAD key. Tapping the row previews it (bytes
 *     through the pond, nothing kept); the key is the one that commits it to
 *     the library. Keeping them apart is the whole point of a preview — the
 *     wrong Nightcall should cost a listen, not a file.
 */
import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { VaultResultRow } from './VaultSearchDock';
import PreparingRing from './PreparingRing';
import { webResultMeta } from '../../../services/webMusicSearch';
import { preparingLabel } from '../../../services/preparingProgress';

/** The download key's four states. `queued` is terminal on this screen: from
 *  there the DownloadsPill owns the progress, app-wide. */
function DownloadKey({ state, label, tint, c, onPress }) {
  if (state === 'sending') {
    return (
      <View style={styles.key}>
        <ActivityIndicator size="small" color={c.textTertiary} />
      </View>
    );
  }
  if (state === 'queued') {
    return (
      // Not a button any more — it is a receipt. Enqueuing the same track
      // twice is two copies in the library, and the tap that does it is the
      // one you make while wondering whether the first worked.
      <View style={styles.key} accessibilityLabel={`${label} is downloading`}>
        <Icon name="check-circle" size={22} color={tint} />
      </View>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={state === 'failed' ? `Retry downloading ${label}` : `Download ${label}`}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
      onPress={onPress}
      style={styles.key}
    >
      <Icon
        name={state === 'failed' ? 'alert-circle-outline' : 'arrow-down-circle-outline'}
        size={22}
        color={state === 'failed' ? (c.danger || c.textTertiary) : c.textTertiary}
      />
    </TouchableOpacity>
  );
}

function MusicWebResultRow({
  result, theme, tint, playing, preparing, preparingPct = 0, preparingStalled = false,
  downloadState, onPreview, onDownload,
}) {
  const c = theme.colors;
  // The percentage goes in the WORDS, not inside the ring: at 20pt a ring has
  // no room for legible type, and this line is already the one saying what the
  // wait is for. See services/preparingProgress.js for what the number means —
  // the first half of it is an estimate, deliberately, and past twenty seconds
  // with nothing in hand the words drop the number and say so instead.
  const waiting = preparingLabel(preparingPct, { stalled: preparingStalled });
  return (
    <View style={styles.inset}>
      <VaultResultRow
        theme={theme}
        name={result.title}
        // While the pond is still turning this video into a playable URL the
        // row says so IN PLACE OF the channel line. Without it the row looked
        // identical to one that had been tapped and done nothing.
        meta={preparing ? waiting : webResultMeta(result)}
        // The row IS the retry — tapping it previews again — so once the wait
        // has stalled the label has to offer that, not keep narrating a
        // percentage that has stopped moving.
        accessibilityLabel={
          preparing
            ? (preparingStalled
              ? `Still finding the audio for ${result.title}, tap to try again`
              : `${waiting} for ${result.title}`)
            : `Preview ${result.title}`
        }
        onPress={onPreview}
        leading={result.thumbnail ? (
          <Image
            source={{ uri: result.thumbnail }}
            style={StyleSheet.absoluteFill}
            // A 16:9 still in a square: cover, so it crops to the middle
            // rather than letterboxing into two grey bars.
            contentFit="cover"
            transition={120}
            // The thumbnail is the ONE third-party URL the phone fetches for
            // this feature, and i.ytimg.com paths are stable and unsigned —
            // so they are worth keeping on disk between searches.
            cachePolicy="disk"
            accessible={false}
          />
        ) : (
          <Icon name="youtube" size={22} color={c.textSecondary} />
        )}
        trailing={(
          <View style={styles.trailing}>
            {/* While it is the playing track the row says so in the same place
                a library row does — in the square — but the square is holding
                a cover, so the marker comes here instead. A filling ring takes
                that spot while the pond is still finding the audio, so the
                marker never jumps position between the two states. */}
            {preparing
              ? (preparingStalled
                // A ring frozen at 69% is the thing being fixed here. The
                // glyph that replaces it is the one the words just promised,
                // in the slot the eye is already on - saying "tap to try
                // again" while a progress ring spins beside it is two
                // different claims about the same wait.
                ? <Icon name="refresh" size={18} color={c.textTertiary} />
                : <PreparingRing percent={preparingPct} tint={tint} track={c.border} />)
              : playing ? <Icon name="volume-high" size={18} color={tint} /> : null}
            <DownloadKey
              state={downloadState}
              label={result.title}
              tint={tint}
              c={c}
              onPress={onDownload}
            />
          </View>
        )}
      />
    </View>
  );
}

export default memo(MusicWebResultRow);

const styles = StyleSheet.create({
  // 14 + the shared row's own 2 = the 16 every other row on this page uses.
  // See the long note in MusicVault's renderSearchRow for why it is here and
  // not on the list or in the shared row.
  inset: { paddingHorizontal: 14 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  key: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
