import React from 'react';
import { PatientListScreenNew } from './PatientListScreenNew';

/** Kept for existing navigation routes: shows the live patient list. */
export function PatientRecordsScreenNew({ navigation }: { navigation: any }) {
  return <PatientListScreenNew navigation={navigation} />;
}
