// React Native utility for merging styles
import { StyleProp, ViewStyle, TextStyle, ImageStyle } from 'react-native';

export function cn<T extends ViewStyle | TextStyle | ImageStyle>(
  ...styles: (StyleProp<T> | undefined | false | null)[]
): StyleProp<T> {
  return styles.filter(Boolean).flat() as StyleProp<T>;
}
