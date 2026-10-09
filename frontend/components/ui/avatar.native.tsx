import * as React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle, TextStyle, ImageStyle } from 'react-native';
import { cn } from './utils';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  source?: { uri: string } | number;
  size?: AvatarSize;
  fallback?: string;
  style?: ViewStyle;
}

interface AvatarImageProps {
  source: { uri: string } | number;
  style?: ImageStyle;
}

interface AvatarFallbackProps {
  children?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const sizeMap = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

export function Avatar({ source, size = 'md', fallback, style }: AvatarProps) {
  const [imageError, setImageError] = React.useState(false);
  const avatarSize = sizeMap[size];

  return (
    <View
      style={cn<ViewStyle>(
        styles.avatar,
        { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
        style,
      )}
    >
      {source && !imageError ? (
        <Image
          source={source}
          style={styles.image}
          onError={() => setImageError(true)}
        />
      ) : (
        <AvatarFallback
          style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
        >
          <Text style={[styles.fallbackText, { fontSize: avatarSize / 2.5 }]}>
            {fallback || '?'}
          </Text>
        </AvatarFallback>
      )}
    </View>
  );
}

export function AvatarImage({ source, style }: AvatarImageProps) {
  return <Image source={source} style={cn<ImageStyle>(styles.image, style)} />;
}

export function AvatarFallback({ children, style, textStyle }: AvatarFallbackProps) {
  return (
    <View style={cn<ViewStyle>(styles.fallback, style)}>
      {typeof children === 'string' ? (
        <Text style={cn<TextStyle>(styles.fallbackText, textStyle)}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
  },
  fallbackText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});

