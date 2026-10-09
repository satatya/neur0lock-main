import * as React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { cn } from './utils';

interface TabsProps {
  defaultValue: string;
  children: React.ReactNode;
  style?: ViewStyle;
  onValueChange?: (value: string) => void;
}

interface TabsListProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

const TabsContext = React.createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

export function Tabs({ defaultValue, children, style, onValueChange }: TabsProps) {
  const [value, setValue] = React.useState(defaultValue);

  const handleValueChange = React.useCallback((newValue: string) => {
    setValue(newValue);
    onValueChange?.(newValue);
  }, [onValueChange]);

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
      <View style={cn<ViewStyle>(styles.tabs, style)}>{children}</View>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, style }: TabsListProps) {
  return <View style={cn<ViewStyle>(styles.tabsList, style)}>{children}</View>;
}

export function TabsTrigger({ value, children, style }: TabsTriggerProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');

  const isActive = context.value === value;

  return (
    <TouchableOpacity
      style={cn<ViewStyle>(
        styles.tabsTrigger,
        isActive && styles.tabsTriggerActive,
        style,
      )}
      onPress={() => context.onValueChange(value)}
      activeOpacity={0.7}
    >
      {typeof children === 'string' ? (
        <Text
          style={cn<TextStyle>(
            styles.tabsTriggerText,
            isActive && styles.tabsTriggerTextActive,
          )}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}

export function TabsContent({ value, children, style }: TabsContentProps) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  if (context.value !== value) return null;

  return <View style={cn<ViewStyle>(styles.tabsContent, style)}>{children}</View>;
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
  },
  tabsList: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 4,
  },
  tabsTrigger: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsTriggerActive: {
    backgroundColor: '#3b82f6',
  },
  tabsTriggerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
  },
  tabsTriggerTextActive: {
    color: '#ffffff',
  },
  tabsContent: {
    marginTop: 16,
  },
});

