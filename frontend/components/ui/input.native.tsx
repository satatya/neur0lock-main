import * as React from 'react';
import {
  TextInput,
  View,
  Text,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { cn } from './utils';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Input({
  label,
  error,
  containerStyle,
  inputStyle,
  leftIcon,
  rightIcon,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <View style={cn<ViewStyle>(styles.container, containerStyle)}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={cn<ViewStyle>(
          styles.inputContainer,
          isFocused && styles.inputContainerFocused,
          error && styles.inputContainerError,
        )}
      >
        {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}
        <TextInput
          style={cn<TextStyle>(styles.input, inputStyle)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholderTextColor="#94a3b8"
          {...props}
        />
        {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  inputContainerFocused: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    backgroundColor: '#ffffff',
  },
  inputContainerError: {
    borderColor: '#ef4444',
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 10,
  },
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
  error: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
  },
});

