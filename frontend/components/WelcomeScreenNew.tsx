import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { Button, Badge } from './ui';

interface WelcomeScreenNewProps {
  navigation: any;
}

export function WelcomeScreenNew({ navigation }: WelcomeScreenNewProps) {
  return (
    <LinearGradient
      colors={['#e0f2fe', '#f8fafc', '#ffffff']}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {/* Logo/App Icon */}
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={['#3b82f6', '#2563eb']}
              style={styles.logoGradient}
            >
              <IconButton icon="shield-check" size={56} iconColor="#ffffff" />
            </LinearGradient>
            <View style={styles.lockBadge}>
              <IconButton icon="lock" size={24} iconColor="#ffffff" />
            </View>
          </View>

          {/* App Name */}
          <Text style={styles.appName}>NeuroLock</Text>
          <Text style={styles.subtitle}>Secure Patient Records Management</Text>

          {/* Trust Indicators */}
          <View style={styles.trustIndicators}>
            <View style={styles.trustItem}>
              <IconButton icon="shield-check" size={16} iconColor="#10b981" />
              <Text style={styles.trustText}>Role-Based Access</Text>
            </View>
            <View style={styles.dot} />
            <View style={styles.trustItem}>
              <IconButton icon="lock" size={16} iconColor="#10b981" />
              <Text style={styles.trustText}>Encrypted Records</Text>
            </View>
          </View>

          {/* Main Actions */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('LoginNew')}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#3b82f6', '#2563eb']}
                style={styles.buttonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <IconButton icon="lock" size={20} iconColor="#ffffff" />
                <Text style={styles.primaryButtonText}> Secure Login</Text>
              </LinearGradient>
            </TouchableOpacity>

            <Button
              variant="outline"
              onPress={() => navigation.navigate('SignupNew')}
              style={styles.secondaryButton}
            >
              <IconButton icon="account-plus" size={20} iconColor="#3b82f6" />
              <Text style={styles.secondaryButtonText}>Create an account</Text>
            </Button>

            <Button
              variant="outline"
              onPress={() => navigation.navigate('HelpNew')}
              style={styles.secondaryButton}
            >
              <IconButton icon="help-circle" size={20} iconColor="#3b82f6" />
              <Text style={styles.secondaryButtonText}>Help & Support</Text>
            </Button>
          </View>

          {/* Feature Pills */}
          <TouchableOpacity style={styles.featurePills} onPress={() => navigation.navigate('HelpNew')} activeOpacity={0.8}>
            <Badge variant="success" style={styles.featurePill}>
              Multi-Factor Auth
            </Badge>
            <Badge variant="default" style={styles.featurePill}>
              Role-Based Access
            </Badge>
            <Badge variant="success" style={styles.featurePill}>
              Audit Logging
            </Badge>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Version 2.0.0</Text>
          <Text style={styles.copyrightText}>© 2025 NeuroLock. All rights reserved.</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    position: 'relative',
    marginBottom: 32,
  },
  logoGradient: {
    width: 112,
    height: 112,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  lockBadge: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    width: 48,
    height: 48,
    backgroundColor: '#10b981',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  appName: {
    fontSize: 36,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 12,
    maxWidth: 280,
  },
  trustIndicators: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 48,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trustText: {
    fontSize: 13,
    color: '#64748b',
    marginLeft: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#64748b',
    marginHorizontal: 12,
  },
  actionsContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  primaryButton: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginLeft: -8,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
  secondaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3b82f6',
    marginLeft: 8,
  },
  featurePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 32,
    gap: 8,
    maxWidth: 400,
  },
  featurePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  footer: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 8,
  },
  copyrightText: {
    fontSize: 11,
    color: '#94a3b8',
  },
});
