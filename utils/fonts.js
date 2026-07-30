/**
 * App typeface.
 *
 * Artifakt Element (Production Type) is a commercial licence, so it can't be
 * bundled. Figtree is the closest openly-licensed match: the same low-contrast
 * humanist-geometric skeleton, open apertures and slightly squared bowls, at a
 * comparable optical size — it reads as the same kind of friendly, neutral UI
 * sans rather than a generic grotesque.
 *
 * React Native does NOT synthesise weights for custom fonts: `fontWeight` is
 * ignored once `fontFamily` names a bundled face, so every weight is its own
 * family name. Always pick from FONTS rather than pairing a family with a
 * numeric weight.
 *
 * Loading is centralised in App.js behind the existing startup gate, so no
 * screen ever paints text in a face that isn't ready.
 */
import {
  useFonts,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';

export const FONTS = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
};

/** Loads the app typeface. Returns true once every weight is registered. */
export const useAppFonts = () => {
  const [loaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  return loaded;
};
