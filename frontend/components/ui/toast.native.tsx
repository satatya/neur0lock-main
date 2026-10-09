import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { IconButton } from 'react-native-paper';

type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = 'default', duration = 3000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = { id, message, variant, duration };
    
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View style={styles.container}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const translateY = React.useRef(new Animated.Value(-100)).current;
  const opacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const getVariantStyles = () => {
    switch (toast.variant) {
      case 'success':
        return { backgroundColor: '#10b981', borderColor: '#059669' };
      case 'error':
        return { backgroundColor: '#ef4444', borderColor: '#dc2626' };
      case 'warning':
        return { backgroundColor: '#f59e0b', borderColor: '#d97706' };
      case 'info':
        return { backgroundColor: '#3b82f6', borderColor: '#2563eb' };
      default:
        return { backgroundColor: '#1e293b', borderColor: '#0f172a' };
    }
  };

  const getIcon = () => {
    switch (toast.variant) {
      case 'success': return 'check-circle';
      case 'error': return 'alert-circle';
      case 'warning': return 'alert';
      case 'info': return 'information';
      default: return 'message-text';
    }
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        getVariantStyles(),
        { transform: [{ translateY }], opacity },
      ]}
    >
      <IconButton icon={getIcon()} size={20} iconColor="#ffffff" />
      <Text style={styles.message}>{toast.message}</Text>
      <TouchableOpacity onPress={onDismiss}>
        <IconButton icon="close" size={20} iconColor="#ffffff" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
    marginLeft: 8,
  },
});

