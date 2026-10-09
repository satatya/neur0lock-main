import React from 'react';
import { RoleDashboard } from './dashboard/RoleDashboard';

/**
 * Therapist dashboard. Tabs and actions are generated from the signed-in user's role
 * permissions (loaded from the API), so administrators can change what this role can do at
 * runtime without code changes.
 */
export function TherapistDashboardNew({ navigation }: { navigation: any }) {
    return <RoleDashboard navigation={navigation} />;
}

export default TherapistDashboardNew;