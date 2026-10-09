import * as React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { cn } from './utils';

interface CardProps {
  children?: React.ReactNode;
  style?: ViewStyle;
}

interface CardHeaderProps {
  children?: React.ReactNode;
  style?: ViewStyle;
}

interface CardTitleProps {
  children?: React.ReactNode;
  style?: TextStyle;
}

interface CardDescriptionProps {
  children?: React.ReactNode;
  style?: TextStyle;
}

interface CardContentProps {
  children?: React.ReactNode;
  style?: ViewStyle;
}

interface CardFooterProps {
  children?: React.ReactNode;
  style?: ViewStyle;
}

interface CardActionProps {
  children?: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return <View style={cn<ViewStyle>(styles.card, style)}>{children}</View>;
}

export function CardHeader({ children, style }: CardHeaderProps) {
  return <View style={cn<ViewStyle>(styles.header, style)}>{children}</View>;
}

export function CardTitle({ children, style }: CardTitleProps) {
  return (
    <Text style={cn<TextStyle>(styles.title, style)}>
      {children}
    </Text>
  );
}

export function CardDescription({ children, style }: CardDescriptionProps) {
  return (
    <Text style={cn<TextStyle>(styles.description, style)}>
      {children}
    </Text>
  );
}

export function CardContent({ children, style }: CardContentProps) {
  return <View style={cn<ViewStyle>(styles.content, style)}>{children}</View>;
}

export function CardFooter({ children, style }: CardFooterProps) {
  return <View style={cn<ViewStyle>(styles.footer, style)}>{children}</View>;
}

export function CardAction({ children, style }: CardActionProps) {
  return <View style={cn<ViewStyle>(styles.action, style)}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  action: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
});

