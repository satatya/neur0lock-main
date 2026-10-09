import * as React from 'react';
import { View, StyleSheet, ViewStyle, Animated } from 'react-native';
import { cn } from './utils';

interface ProgressProps {
  value?: number; // 0-100
  max?: number;
  style?: ViewStyle;
  barStyle?: ViewStyle;
  animated?: boolean;
}

export function Progress({
  value = 0,
  max = 100,
  style,
  barStyle,
  animated = true,
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const animatedWidth = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (animated) {
      Animated.timing(animatedWidth, {
        toValue: percentage,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      animatedWidth.setValue(percentage);
    }
  }, [percentage, animated]);

  return (
    <View style={cn<ViewStyle>(styles.container, style)}>
      <Animated.View
        style={[
          styles.bar,
          barStyle,
          {
            width: animatedWidth.interpolate({
              inputRange: [0, 100],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 4,
  },
});

