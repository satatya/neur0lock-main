import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from './common/layout';
import { PatientsModule } from './dashboard/PatientsModule';

interface PatientListScreenNewProps {
  navigation: any;
}

/** Full-screen patient list (same permission rules as the dashboard's Patients tab). */
export function PatientListScreenNew({ navigation }: PatientListScreenNewProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Patient Records" subtitle="Secure patient management" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey((k) => k + 1)} />}
        keyboardShouldPersistTaps="handled"
      >
        <PatientsModule navigation={navigation} refreshKey={refreshKey} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40, maxWidth: 1000, width: '100%', alignSelf: 'center' },
});
