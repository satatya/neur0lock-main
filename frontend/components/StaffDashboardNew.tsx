import React from 'react';
import { RoleDashboard } from './dashboard/RoleDashboard';

/**
 * custom-role dashboard. Tabs and actions are generated from the signed-in user's role
 * permissions (loaded from the API), so administrators can change what this role can do at
 * runtime without code changes.
 */
export function StaffDashboardNew({ navigation }: { navigation: any }) {
    return <RoleDashboard navigation={navigation} />;
}

export default StaffDashboardNew;