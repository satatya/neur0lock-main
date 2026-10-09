import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from 'react-native-paper';
import { Card, CardHeader, CardTitle, CardContent, Input, Button, Alert, useToast } from './ui';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { API_BASE_URL, DEMO_ACCOUNTS, DEMO_PASSWORD } from '../config';

interface LoginScreenNewProps {
  navigation: any;
}

export function LoginScreenNew({ navigation }: LoginScreenNewProps) {
  const { login, signOutMessage, clearSignOutMessage } = useAuth();
  const { showToast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [errorTitle, setErrorTitle] = useState('Authentication Error');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (signOutMessage) setError(signOutMessage);
  }, [signOutMessage]);

  const handleSubmit = async () => {
    setError('');
    setErrorTitle('Authentication Error');
    clearSignOutMessage();
    if (!identifier.trim() || !password) {
      setError('Please enter your username (or email) and password');
      return;
    }
    setLoading(true);
    try {
      const result = await login(identifier, password);
      // The navigator switches to the verification step, the role chooser (administrators) or the dashboard.
      if (result === 'signedIn') showToast('Signed in securely', 'success');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'ACCOUNT_LOCKED') {
          navigation.navigate('AccountLockedNew', {
            email: identifier.trim().toLowerCase(),
            lockReason: e.details?.lock_reason,
            lockedUntil: e.details?.locked_until,
            message: e.message,
          });
          setPassword('');
          return;
        }
        if (e.code === 'ACCOUNT_PENDING') setErrorTitle('Awaiting administrator approval');
        else if (e.code === 'ACCOUNT_REJECTED') setErrorTitle('Registration not approved');
        setAttemptsRemaining(typeof e.details?.attempts_remaining === 'number' ? e.details.attempts_remaining : null);
        setError(e.message);
      } else {
        setError('Login failed. Please try again.');
      }
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (username: string) => {
    setIdentifier(username);
    setPassword(DEMO_PASSWORD);
    setError('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('WelcomeNew'))}>
            <IconButton icon="arrow-left" size={24} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Secure Login</Text>
            <Text style={styles.headerSubtitle}>Access your healthcare portal</Text>
          </View>
        </View>

        <View style={styles.content}>
          <Card style={styles.authCard}>
            <CardHeader style={styles.cardHeader}>
              <View style={styles.cardHeaderContent}>
                <View style={styles.cardIcon}>
                  <IconButton icon="lock" size={20} iconColor="#ffffff" />
                </View>
                <CardTitle>Sign In</CardTitle>
              </View>
            </CardHeader>
            <CardContent>
              <Input
                label="Username or email"
                placeholder="e.g. jsmith or you@clinic.org"
                value={identifier}
                onChangeText={setIdentifier}
                leftIcon={<IconButton icon="account" size={20} />}
                containerStyle={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
              />
              <Input
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                leftIcon={<IconButton icon="key" size={20} />}
                containerStyle={styles.passwordInput}
                textContentType="password"
                onSubmitEditing={handleSubmit}
              />
              <Button onPress={handleSubmit} disabled={!identifier || !password || loading} loading={loading} style={styles.submitButton}>
                <IconButton icon="lock" size={20} iconColor="#ffffff" />
                <Text style={styles.submitButtonText}>Sign In Securely</Text>
              </Button>
            </CardContent>
          </Card>

          {error ? (
            <Alert
              variant={attemptsRemaining !== null && attemptsRemaining <= 2 ? 'destructive' : 'warning'}
              title={errorTitle}
              description={
                attemptsRemaining !== null
                  ? `${error}. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before the account is locked.`
                  : error
              }
              style={styles.alert}
            />
          ) : null}

          <Text style={styles.biometricHint}>
            🔐 You are signed straight into the role assigned to your account. Accounts with authenticator-app MFA are asked for a 6-digit code next; biometric unlock can be enabled in Settings.
          </Text>

          {__DEV__ ? (
            <Card style={styles.demoCard}>
              <CardContent style={styles.demoContent}>
                <Text style={styles.demoTitle}>Demo accounts (tap to fill)</Text>
                {DEMO_ACCOUNTS.map((account) => (
                  <TouchableOpacity key={account.username} onPress={() => fillDemo(account.username)}>
                    <Text style={styles.demoText}>
                      • {account.role}: <Text style={styles.demoEmail}>{account.username}</Text>
                    </Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.demoText}>• Password: {DEMO_PASSWORD}</Text>
                <Text style={styles.demoServer}>Server: {API_BASE_URL}</Text>
              </CardContent>
            </Card>
          ) : null}

          <TouchableOpacity style={styles.forgotPassword} onPress={() => navigation.navigate('ForgotPasswordNew', { email: identifier })}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.signupLink} onPress={() => navigation.navigate('SignupNew')}>
            <Text style={styles.signupText}>
              New to NeuroLock? <Text style={styles.forgotPasswordText}>Create an account</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Security Notice */}
        <View style={styles.securityNotice}>
          <View style={styles.securityItem}>
            <IconButton icon="shield-check" size={16} iconColor="#10b981" />
            <Text style={styles.securityText}>Lockout after 5 failed attempts</Text>
          </View>
          <View style={styles.dot} />
          <View style={styles.securityItem}>
            <IconButton icon="lock" size={16} iconColor="#10b981" />
            <Text style={styles.securityText}>Every access is audited</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    marginBottom: 24,
  },
  headerText: {
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1e293b',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 24,
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  input: {
    marginBottom: 16,
  },
  authCard: {
    marginBottom: 16,
  },
  cardHeader: {
    backgroundColor: '#e0f2fe',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  cardHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 36,
    height: 36,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  passwordInput: {
    marginBottom: 20,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  alert: {
    marginBottom: 16,
  },
  biometricHint: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  demoCard: {
    backgroundColor: '#e0f2fe',
    borderColor: '#bae6fd',
    marginBottom: 16,
  },
  demoContent: {
    padding: 16,
  },
  demoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3b82f6',
    marginBottom: 8,
    textAlign: 'center',
  },
  demoText: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 6,
  },
  demoEmail: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  demoServer: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
  },
  forgotPassword: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  signupLink: {
    alignItems: 'center',
    marginTop: -12,
    marginBottom: 24,
  },
  signupText: {
    fontSize: 14,
    color: '#64748b',
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '500',
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginTop: 16,
  },
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  securityText: {
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
});
