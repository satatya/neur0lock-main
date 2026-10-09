import 'react-native-gesture-handler';
import React from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from './context/AuthContext';
import { StepUpProvider } from './context/StepUpContext';
import { DialogProvider } from './components/common/dialogs';
import { ToastProvider, useToast } from './components/ui';
import { roleTheme } from './constants/permissions';

import { WelcomeScreenNew } from './components/WelcomeScreenNew';
import { LoginScreenNew } from './components/LoginScreenNew';
import { MFASelectionScreenNew } from './components/MFASelectionScreenNew';
import { OTPVerificationScreenNew } from './components/OTPVerificationScreenNew';
import { BiometricScreenNew } from './components/BiometricScreenNew';
import { RoleSelectionScreenNew } from './components/RoleSelectionScreenNew';
import { MyAccessScreenNew } from './components/MyAccessScreenNew';
import { SignupScreenNew } from './components/SignupScreenNew';
import { PatientDashboardNew } from './components/PatientDashboardNew';
import { PsychiatristDashboardNew } from './components/PsychiatristDashboardNew';
import { PsychologistDashboardNew } from './components/PsychologistDashboardNew';
import { TherapistDashboardNew } from './components/TherapistDashboardNew';
import { NurseDashboardNew } from './components/NurseDashboardNew';
import { AdminDashboardNew } from './components/AdminDashboardNew';
import { StaffDashboardNew } from './components/StaffDashboardNew';
import { PatientListScreenNew } from './components/PatientListScreenNew';
import { PatientProfileScreenNew } from './components/PatientProfileScreenNew';
import { PatientRecordsScreenNew } from './components/PatientRecordsScreenNew';
import { TherapyNotesScreenNew } from './components/TherapyNotesScreenNew';
import { SecureNoteEditorNew } from './components/SecureNoteEditorNew';
import { StaffActivityLogsScreenNew } from './components/StaffActivityLogsScreenNew';
import { SecurityAlertsScreenNew } from './components/SecurityAlertsScreenNew';
import { SettingsScreenNew } from './components/SettingsScreenNew';
import { HelpScreenNew } from './components/HelpScreenNew';
import { BackupCodesScreenNew } from './components/BackupCodesScreenNew';
import { MultiFactorAuth } from './components/MultiFactorAuth';
import AccountLockedScreenNew from './components/AccountLockedScreenNew';
import DeviceRegistrationScreenNew from './components/DeviceRegistrationScreenNew';
import OfflineModeScreenNew from './components/OfflineModeScreenNew';
import ReAuthenticationPromptNew from './components/ReAuthenticationPromptNew';
import ForgotPasswordScreenNew from './components/ForgotPasswordScreenNew';

const Stack = createStackNavigator();

/**
 * Screens are grouped by authentication state, so signed-out users can never navigate to
 * clinical screens and signing in/out swaps the whole stack.
 */
function RootNavigator() {
  const { status, user, signOutMessage, lockNotice } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>NeuroLock</Text>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (status === 'biometricLock') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="BiometricNew" component={BiometricScreenNew} />
        <Stack.Screen name="HelpNew" component={HelpScreenNew} />
      </Stack.Navigator>
    );
  }

  if (status === 'mfa') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="OTPVerificationNew" component={OTPVerificationScreenNew} />
        <Stack.Screen name="MFASelectionNew" component={MFASelectionScreenNew} />
        <Stack.Screen name="BackupCodesNew" component={BackupCodesScreenNew} />
        <Stack.Screen name="AccountLockedNew" component={AccountLockedScreenNew} />
        <Stack.Screen name="HelpNew" component={HelpScreenNew} />
      </Stack.Navigator>
    );
  }

  // Administrators pick which role to use after signing in (Administrator included).
  if (status === 'chooseRole' && user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="RoleSelectionNew" component={RoleSelectionScreenNew} />
        <Stack.Screen name="HelpNew" component={HelpScreenNew} />
      </Stack.Navigator>
    );
  }

  if (status === 'signedIn' && user) {
    // Everyone lands on the dashboard of their (effective) role; patients get the patient portal.
    // Keyed by role so switching role (administrators) rebuilds the stack on the right dashboard.
    const home = user.portal_uid ? 'PatientDashboardNew' : roleTheme(user.role, user.role_name).screen;
    return (
      <Stack.Navigator key={`${user.role ?? 'none'}:${user.portal_uid ?? ''}`} initialRouteName={home} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="PatientDashboardNew" component={PatientDashboardNew} />
        <Stack.Screen name="PsychiatristDashboardNew" component={PsychiatristDashboardNew} />
        <Stack.Screen name="PsychologistDashboardNew" component={PsychologistDashboardNew} />
        <Stack.Screen name="TherapistDashboardNew" component={TherapistDashboardNew} />
        <Stack.Screen name="NurseDashboardNew" component={NurseDashboardNew} />
        <Stack.Screen name="AdminDashboardNew" component={AdminDashboardNew} />
        <Stack.Screen name="StaffDashboardNew" component={StaffDashboardNew} />
        <Stack.Screen name="PatientListNew" component={PatientListScreenNew} />
        <Stack.Screen name="PatientRecordsNew" component={PatientRecordsScreenNew} />
        <Stack.Screen name="PatientProfileNew" component={PatientProfileScreenNew} />
        <Stack.Screen name="TherapyNotesNew" component={TherapyNotesScreenNew} />
        <Stack.Screen name="SecureNoteEditorNew" component={SecureNoteEditorNew} />
        <Stack.Screen name="ReAuthenticationPromptNew" component={ReAuthenticationPromptNew} />
        <Stack.Screen name="StaffActivityLogsNew" component={StaffActivityLogsScreenNew} />
        <Stack.Screen name="SecurityAlertsNew" component={SecurityAlertsScreenNew} />
        <Stack.Screen name="SettingsNew" component={SettingsScreenNew} />
        <Stack.Screen name="MultiFactorAuth" component={MultiFactorAuth} />
        <Stack.Screen name="BackupCodesNew" component={BackupCodesScreenNew} />
        <Stack.Screen name="DeviceRegistrationNew" component={DeviceRegistrationScreenNew} />
        <Stack.Screen name="MyAccessNew" component={MyAccessScreenNew} />
        <Stack.Screen name="OfflineModeNew" component={OfflineModeScreenNew} />
        <Stack.Screen name="HelpNew" component={HelpScreenNew} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={lockNotice ? 'AccountLockedNew' : signOutMessage ? 'LoginNew' : 'WelcomeNew'}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="WelcomeNew" component={WelcomeScreenNew} />
      <Stack.Screen name="LoginNew" component={LoginScreenNew} />
      <Stack.Screen name="SignupNew" component={SignupScreenNew} />
      <Stack.Screen name="ForgotPasswordNew" component={ForgotPasswordScreenNew} />
      <Stack.Screen name="AccountLockedNew" component={AccountLockedScreenNew} initialParams={lockNotice ?? undefined} />
      <Stack.Screen name="HelpNew" component={HelpScreenNew} />
    </Stack.Navigator>
  );
}

/**
 * Android back button, last resort: React Navigation pops screens and screens handle their own
 * tabs/steps first. When nothing is left to go back to, ask for a second press instead of
 * dropping out of the app straight away.
 */
function HardwareBackGuard() {
  const { showToast } = useToast();
  const lastPress = React.useRef(0);
  React.useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const guard = BackHandler.addEventListener('hardwareBackPress', () => {
      const now = Date.now();
      if (now - lastPress.current < 2000) return false; // second press: let Android close the app
      lastPress.current = now;
      showToast('Press back again to exit NeuroLock', 'default', 2000);
      return true;
    });
    // Development diagnostics: shows in the Metro terminal whenever the app receives a back press.
    let logger: { remove: () => void } | undefined;
    const timer = __DEV__
      ? setTimeout(() => {
          logger = BackHandler.addEventListener('hardwareBackPress', () => {
            console.log('[back] hardware back press received by NeuroLock');
            return false;
          });
        }, 0)
      : undefined;
    return () => {
      guard.remove();
      logger?.remove();
      if (timer) clearTimeout(timer);
    };
  }, [showToast]);
  return null;
}

/** Records user interaction for the inactivity auto sign-out. */
function ActivityTracker({ children }: { children: React.ReactNode }) {
  const { touch } = useAuth();
  return (
    <View
      style={styles.flex}
      onStartShouldSetResponderCapture={() => {
        touch();
        return false;
      }}
    >
      {children}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <ToastProvider>
          <AuthProvider>
            <DialogProvider>
              <StepUpProvider>
                <ActivityTracker>
                  <NavigationContainer documentTitle={{ formatter: () => 'NeuroLock' }}>
                    <StatusBar style="auto" />
                    <HardwareBackGuard />
                    <RootNavigator />
                  </NavigationContainer>
                </ActivityTracker>
              </StepUpProvider>
            </DialogProvider>
          </AuthProvider>
        </ToastProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', gap: 16 },
  splashTitle: { fontSize: 28, fontWeight: '700', color: '#1e293b' },
});
