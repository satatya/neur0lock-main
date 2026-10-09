import * as React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  View,
} from 'react-native';
import { cn } from './utils';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'default',
  size = 'default',
  onPress,
  disabled = false,
  loading = false,
  children,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const buttonStyles = [
    styles.button,
    styles[`${variant}Button` as keyof typeof styles] as ViewStyle,
    // Sizes use their own keys: `${size}Button` would make size "default" pick up the default (blue) variant
    size !== 'default' && (styles[`size_${size}Button` as keyof typeof styles] as ViewStyle),
    disabled && styles.disabledButton,
    style,
  ];

  const textStyles = [
    styles.text,
    styles[`${variant}Text` as keyof typeof styles] as TextStyle,
    size !== 'default' && (styles[`size_${size}Text` as keyof typeof styles] as TextStyle),
    disabled && styles.disabledText,
    textStyle,
  ];

  return (
    <TouchableOpacity
      style={cn<ViewStyle>(...buttonStyles)}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? '#3b82f6' : '#ffffff'}
        />
      ) : (
        <View style={styles.content}>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          {typeof children === 'string' ? (
            <Text style={cn<TextStyle>(...textStyles)}>{children}</Text>
          ) : (
            children
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    marginRight: 4,
  },
  text: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Variants
  defaultButton: {
    backgroundColor: '#3b82f6',
  },
  defaultText: {
    color: '#ffffff',
  },
  destructiveButton: {
    backgroundColor: '#ef4444',
  },
  destructiveText: {
    color: '#ffffff',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  outlineText: {
    color: '#1e293b',
  },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
  },
  secondaryText: {
    color: '#0f172a',
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: '#3b82f6',
  },
  linkButton: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  linkText: {
    color: '#3b82f6',
    textDecorationLine: 'underline',
  },
  // Sizes
  size_smButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  size_smText: {
    fontSize: 12,
  },
  size_lgButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  size_lgText: {
    fontSize: 16,
  },
  size_iconButton: {
    width: 40,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  size_iconText: {
    fontSize: 14,
  },
  // States
  disabledButton: {
    opacity: 0.5,
  },
  disabledText: {
    opacity: 0.5,
  },
});

