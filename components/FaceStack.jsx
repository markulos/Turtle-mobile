/**
 * FaceStack — the people on a thing, as overlapping discs, sized to the room.
 *
 * ONE definition of a rule the app keeps re-implementing (STYLE-RULES §5): the
 * owner first and on top, duplicates collapsed, a picture where someone has set
 * one and the generated disc as the FALLBACK — never the other way round — and
 * everyone who does not fit turned into a "+n".
 *
 * WIDTH DECIDES, not a count. A stack is the only thing in a caption row that
 * cannot shrink or ellipsize, so it is what pushes a board's name off the end of
 * its card. The caller measures the room it can spare (`available`) and the
 * stack takes no more than that; `utils/faceStack` holds the arithmetic and its
 * tests.
 *
 * Z-ORDER IS EXPLICIT. Paint order would bury the first face under whoever was
 * added last, which reads backwards — the owner is the one that should overlap
 * their neighbour, not be overlapped by them.
 */
import React, { memo, useMemo } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AnimalAvatar from './AnimalAvatar';
import { resolveAvatarUrl } from '../utils/avatarUrl';
import { facesThatFit, overlapFor, rosterOf } from '../utils/faceStack';

function FaceStack({
  /** [{ userId, name, avatarUrl }] — owner first. */
  people,
  /** How much horizontal room the row can give this stack. */
  available,
  size = 18,
  max = 4,
  theme,
  /** Origin for relative avatar paths — the pond answers on several names. */
  baseUrl,
  /** Optional: makes the whole stack one target (a list of who, never a row of
   *  targets — overlapped discs are not something you can aim at). */
  onPress,
  accessibilityLabel,
  style,
}) {
  const roster = useMemo(() => rosterOf(people), [people]);
  const overlap = overlapFor(size);
  const { shown, overflow } = facesThatFit({ total: roster.length, available, size, max, overlap });

  if (!roster.length || (!shown && !overflow)) return null;

  const faces = roster.slice(0, shown);
  const ring = theme?.colors?.background || '#000';
  const body = (
    <View style={[styles.row, style]} pointerEvents={onPress ? 'none' : 'auto'}>
      {faces.map((person, i) => {
        const uri = resolveAvatarUrl(person.avatarUrl, baseUrl);
        return (
          <View
            key={person.userId || person.id || person.name || i}
            style={[
              styles.face,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: ring,
                marginLeft: i === 0 ? 0 : -overlap,
                // First listed sits on top of the one after it.
                zIndex: faces.length - i,
              },
            ]}
          >
            {/* The generated disc is UNDER the photo, not instead of it: a
                picture still loading, or one that fails, then shows a face
                rather than a hole. */}
            <AnimalAvatar id={person.userId || person.id || person.name} size={size} fallbackLabel={person.name} />
            {uri ? (
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                transition={120}
                recyclingKey={`face:${uri}`}
              />
            ) : null}
          </View>
        );
      })}
      {overflow > 0 ? (
        <View
          style={[
            styles.face,
            styles.more,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: ring,
              backgroundColor: theme?.colors?.surfaceHighlight || '#333',
              marginLeft: faces.length ? -overlap : 0,
              zIndex: 0,
            },
          ]}
        >
          <Text
            style={[styles.moreText, { color: theme?.colors?.textSecondary || '#fff', fontSize: Math.round(size * 0.45) }]}
            numberOfLines={1}
          >
            {`+${overflow}`}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || `${roster.length} ${roster.length === 1 ? 'person' : 'people'}`}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  // The ring is what separates one disc from the one it overlaps; without it
  // two dark avatars merge into a single blob.
  face: { overflow: 'hidden', borderWidth: 1.5 },
  more: { alignItems: 'center', justifyContent: 'center' },
  moreText: { fontWeight: '700' },
});

export default memo(FaceStack);
