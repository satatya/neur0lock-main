import * as React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { cn } from './utils';

interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  style?: ViewStyle;
}

export function Separator({ orientation = 'horizontal', style }: SeparatorProps) {
  return (
    <View
      style={cn<ViewStyle>(
        styles.separator,
        orientation === 'vertical' ? styles.vertical : styles.horizontal,
        style,
      )}
    />
  );
}

const styles = StyleSheet.create({
  separator: {
    backgroundColor: '#e2e8f0',
  },
  horizontal: {
    height: 1,
    width: '100%',
  },
  vertical: {
    width: 1,
    height: '100%',
  },
});

