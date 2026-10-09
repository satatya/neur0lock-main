import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Card, CardContent } from '../ui';

export const colors = {
    primary: '#3b82f6',
    primaryDark: '#2563eb',
    text: '#0f172a',
    muted: '#64748b',
    subtle: '#94a3b8',
    border: '#e2e8f0',
    background: '#f8fafc',
    danger: '#dc2626',
    success: '#059669',
    warning: '#d97706',
};

export function ScreenHeader({
    title,
    subtitle,
    onBack,
    right,
}: {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    right?: React.ReactNode;
}) {
    return (
        <View style={styles.screenHeader}>
            {onBack ? (
                <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityLabel="Go back">
                    <Text style={styles.backText}>←</Text>
                </TouchableOpacity>
            ) : null}
            <View style={styles.screenHeaderText}>
                <Text style={styles.screenTitle} numberOfLines={1}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text style={styles.screenSubtitle} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {right}
        </View>
    );
}

export function SectionHeader({ title, action, subtitle }: { title: string; subtitle?: string; action?: React.ReactNode }) {
    return (
        <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
            </View>
            {action}
        </View>
    );
}

export function ActionButton({
    label,
    onPress,
    variant = 'primary',
    disabled,
    small,
    style,
}: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
    disabled?: boolean;
    small?: boolean;
    style?: ViewStyle;
}) {
    return (
        <TouchableOpacity
            style={[styles.action, styles[`action_${variant}`], small && styles.actionSmall, disabled && styles.actionDisabled, style]}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.75}
        >
            <Text style={[styles.actionText, styles[`actionText_${variant}`], small && styles.actionTextSmall]}>{label}</Text>
        </TouchableOpacity>
    );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
    return (
        <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.centeredText}>{label}</Text>
        </View>
    );
}

export function ErrorView({ message, onRetry, retryLabel = 'Try again' }: { message: string; onRetry?: () => void; retryLabel?: string }) {
    return (
        <View style={styles.centered}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{message}</Text>
            {onRetry ? <ActionButton label={retryLabel} onPress={onRetry} variant="secondary" small style={{ marginTop: 12 }} /> : null}
        </View>
    );
}

export function EmptyState({ icon = '📭', message }: { icon?: string; message: string }) {
    return (
        <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{icon}</Text>
            <Text style={styles.emptyText}>{message}</Text>
        </View>
    );
}

export function Restricted({ message = 'Your role does not have access to this information.' }: { message?: string }) {
    return (
        <Card style={styles.restricted}>
            <CardContent style={styles.restrictedContent}>
                <Text style={styles.restrictedIcon}>🔒</Text>
                <Text style={styles.restrictedText}>{message}</Text>
            </CardContent>
        </Card>
    );
}

export function StatGrid({ items }: { items: { label: string; value: string | number; icon?: string; color?: string }[] }) {
    return (
        <View style={styles.statGrid}>
            {items.map((item) => (
                <Card key={item.label} style={styles.statCard}>
                    <CardContent style={styles.statContent}>
                        {item.icon ? <Text style={styles.statIcon}>{item.icon}</Text> : null}
                        <Text style={[styles.statValue, item.color ? { color: item.color } : null]}>{item.value}</Text>
                        <Text style={styles.statLabel}>{item.label}</Text>
                    </CardContent>
                </Card>
            ))}
        </View>
    );
}

export function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
    return (
        <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{label}</Text>
            {typeof value === 'string' || typeof value === 'number' || value === undefined || value === null ? (
                <Text style={styles.infoValue}>{value === undefined || value === null || value === '' ? '—' : value}</Text>
            ) : (
                value
            )}
        </View>
    );
}

/** Horizontal pill selector used for sub-views and filters. */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmented}>
            {options.map((option) => (
                <TouchableOpacity
                    key={option.value}
                    onPress={() => onChange(option.value)}
                    style={[styles.segment, value === option.value && styles.segmentActive]}
                    activeOpacity={0.75}
                >
                    <Text style={[styles.segmentText, value === option.value && styles.segmentTextActive]}>{option.label}</Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screenHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 12,
    },
    backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
    backText: { fontSize: 22, color: colors.text },
    screenHeaderText: { flex: 1 },
    screenTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
    screenSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
    sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    sectionSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
    action: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
    actionSmall: { paddingHorizontal: 10, paddingVertical: 6 },
    actionDisabled: { opacity: 0.45 },
    action_primary: { backgroundColor: colors.primary },
    action_secondary: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
    action_danger: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
    action_success: { backgroundColor: '#d1fae5', borderWidth: 1, borderColor: '#a7f3d0' },
    action_ghost: { backgroundColor: 'transparent' },
    actionText: { fontSize: 14, fontWeight: '600' },
    actionTextSmall: { fontSize: 12 },
    actionText_primary: { color: '#fff' },
    actionText_secondary: { color: '#334155' },
    actionText_danger: { color: colors.danger },
    actionText_success: { color: colors.success },
    actionText_ghost: { color: colors.primary },
    centered: { padding: 32, alignItems: 'center', justifyContent: 'center' },
    centeredText: { marginTop: 12, color: colors.muted },
    errorIcon: { fontSize: 32 },
    errorText: { marginTop: 8, color: colors.danger, textAlign: 'center' },
    empty: { alignItems: 'center', paddingVertical: 28 },
    emptyIcon: { fontSize: 32, marginBottom: 8 },
    emptyText: { color: colors.muted, textAlign: 'center' },
    restricted: { marginVertical: 8, backgroundColor: '#f8fafc' },
    restrictedContent: { alignItems: 'center', paddingVertical: 24 },
    restrictedIcon: { fontSize: 28, marginBottom: 8 },
    restrictedText: { color: colors.muted, textAlign: 'center' },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    statCard: { flexGrow: 1, flexBasis: '22%', minWidth: 140 },
    statContent: { alignItems: 'center', paddingVertical: 14 },
    statIcon: { fontSize: 20, marginBottom: 4 },
    statValue: { fontSize: 22, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'center' },
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12 },
    infoLabel: { fontSize: 13, color: colors.muted, flexShrink: 0 },
    infoValue: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 1, textAlign: 'right' },
    segmented: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
    segment: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border },
    segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    segmentText: { fontSize: 13, color: '#334155', fontWeight: '500' },
    segmentTextActive: { color: '#fff' },
});
