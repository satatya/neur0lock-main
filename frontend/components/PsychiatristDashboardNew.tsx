import React from 'react';
import { RoleDashboard } from './dashboard/RoleDashboard';

/**
 * Psychiatrist dashboard. Tabs and actions are generated from the signed-in user's role
 * permissions (loaded from the API), so administrators can change what this role can do at
 * runtime without code changes.
 */
export function PsychiatristDashboardNew({ navigation }: { navigation: any }) {
    return <RoleDashboard navigation={navigation} />;
}

export default PsychiatristDashboardNew;