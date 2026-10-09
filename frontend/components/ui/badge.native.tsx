import * as React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { cn } from './utils';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

interface BadgeProps {
  variant?: BadgeVariant;
  children?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Badge({
  variant = 'default',
  children,
  style,
  textStyle,
}: BadgeProps) {
  return (
    <View
      style={cn<ViewStyle>(
        styles.badge,
        styles[`${variant}Badge` as keyof typeof styles] as ViewStyle,
        style,
      )}
    >
      <Text
        style={cn<TextStyle>(
          styles.text,
          styles[`${variant}Text` as keyof typeof styles] as TextStyle,
          textStyle,
        )}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Variants
  defaultBadge: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  defaultText: {
    color: '#ffffff',
  },
  secondaryBadge: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  secondaryText: {
    color: '#0f172a',
  },
  destructiveBadge: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  destructiveText: {
    color: '#ffffff',
  },
  outlineBadge: {
    backgroundColor: 'transparent',
    borderColor: '#e2e8f0',
  },
  outlineText: {
    color: '#0f172a',
  },
  successBadge: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  successText: {
    color: '#ffffff',
  },
  warningBadge: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  warningText: {
    color: '#ffffff',
  },
});

