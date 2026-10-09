import * as React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { cn } from './utils';

type AlertVariant = 'default' | 'destructive' | 'success' | 'warning';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

export function Alert({
  variant = 'default',
  title,
  description,
  children,
  style,
  icon,
}: AlertProps) {
  return (
    <View
      style={cn<ViewStyle>(
        styles.alert,
        styles[`${variant}Alert` as keyof typeof styles] as ViewStyle,
        style,
      )}
    >
      {icon && <View style={styles.icon}>{icon}</View>}
      <View style={styles.content}>
        {title && (
          <Text
            style={cn<TextStyle>(
              styles.title,
              styles[`${variant}Title` as keyof typeof styles] as TextStyle,
            )}
          >
            {title}
          </Text>
        )}
        {description && (
          <Text
            style={cn<TextStyle>(
              styles.description,
              styles[`${variant}Description` as keyof typeof styles] as TextStyle,
            )}
          >
            {description}
          </Text>
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  icon: {
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Variants
  defaultAlert: {
    backgroundColor: '#f0f9ff',
    borderColor: '#bae6fd',
  },
  defaultTitle: {
    color: '#0369a1',
  },
  defaultDescription: {
    color: '#075985',
  },
  destructiveAlert: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  destructiveTitle: {
    color: '#dc2626',
  },
  destructiveDescription: {
    color: '#991b1b',
  },
  successAlert: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  successTitle: {
    color: '#16a34a',
  },
  successDescription: {
    color: '#15803d',
  },
  warningAlert: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  warningTitle: {
    color: '#d97706',
  },
  warningDescription: {
    color: '#b45309',
  },
});

