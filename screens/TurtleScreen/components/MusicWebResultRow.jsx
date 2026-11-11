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
import { webResultMeta } from '../../../services/webMusicSearch';

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

function MusicWebResultRow({ result, theme, tint, playing, downloadState, onPreview, onDownload }) {
  const c = theme.colors;
  return (
    <View style={styles.inset}>
      <VaultResultRow
        theme={theme}
        name={result.title}
        meta={webResultMeta(result)}
        accessibilityLabel={`Preview ${result.title}`}
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
                a cover, so the marker comes here instead. */}
            {playing ? <Icon name="volume-high" size={18} color={tint} /> : null}
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
