import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors } from './layout';
import { MODAL_ANIMATION_FADE } from './modal';

/**
 * Cross-platform confirm/notice dialogs (React Native's Alert.alert with buttons does not work on web).
 */
interface ConfirmOptions {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
}

interface NoticeOptions {
    title: string;
    message?: string;
    /** Monospace values the user may need to copy, e.g. backup codes or a reset code. */
    codes?: string[];
}

interface DialogContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    notice: (options: NoticeOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
    const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
    const [noticeOptions, setNoticeOptions] = useState<NoticeOptions | null>(null);
    const [copied, setCopied] = useState(false);
    const confirmResolver = useRef<((value: boolean) => void) | null>(null);
    const noticeResolver = useRef<(() => void) | null>(null);

    const confirm = useCallback((options: ConfirmOptions) => {
        return new Promise<boolean>((resolve) => {
            confirmResolver.current = resolve;
            setConfirmOptions(options);
        });
    }, []);

    const notice = useCallback((options: NoticeOptions) => {
        return new Promise<void>((resolve) => {
            noticeResolver.current = resolve;
            setCopied(false);
            setNoticeOptions(options);
        });
    }, []);

    const closeConfirm = (value: boolean) => {
        setConfirmOptions(null);
        confirmResolver.current?.(value);
        confirmResolver.current = null;
    };

    const closeNotice = () => {
        setNoticeOptions(null);
        noticeResolver.current?.();
        noticeResolver.current = null;
    };

    return (
        <DialogContext.Provider value={{ confirm, notice }}>
            {children}
            <Modal visible={Boolean(confirmOptions)} transparent animationType={MODAL_ANIMATION_FADE} onRequestClose={() => closeConfirm(false)}>
                <View style={styles.overlay}>
                    <View style={styles.card}>
                        <Text style={styles.title}>{confirmOptions?.title}</Text>
                        {confirmOptions?.message ? <Text style={styles.message}>{confirmOptions.message}</Text> : null}
                        <View style={styles.buttons}>
                            <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => closeConfirm(false)}>
                                <Text style={styles.secondaryText}>{confirmOptions?.cancelText ?? 'Cancel'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.button, confirmOptions?.destructive ? styles.danger : styles.primary]}
                                onPress={() => closeConfirm(true)}
                            >
                                <Text style={styles.primaryText}>{confirmOptions?.confirmText ?? 'Confirm'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
            <Modal visible={Boolean(noticeOptions)} transparent animationType={MODAL_ANIMATION_FADE} onRequestClose={closeNotice}>
                <View style={styles.overlay}>
                    <View style={styles.card}>
                        <Text style={styles.title}>{noticeOptions?.title}</Text>
                        {noticeOptions?.message ? <Text style={styles.message}>{noticeOptions.message}</Text> : null}
                        {noticeOptions?.codes?.length ? (
                            <ScrollView style={styles.codes} contentContainerStyle={styles.codesContent}>
                                {noticeOptions.codes.map((code) => (
                                    <Text key={code} style={styles.code} selectable>
                                        {code}
                                    </Text>
                                ))}
                            </ScrollView>
                        ) : null}
                        <View style={styles.buttons}>
                            {noticeOptions?.codes?.length ? (
                                <TouchableOpacity
                                    style={[styles.button, styles.secondary]}
                                    onPress={async () => {
                                        await Clipboard.setStringAsync(noticeOptions.codes!.join('\n'));
                                        setCopied(true);
                                    }}
                                >
                                    <Text style={styles.secondaryText}>{copied ? 'Copied ✓' : 'Copy'}</Text>
                                </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity style={[styles.button, styles.primary]} onPress={closeNotice}>
                                <Text style={styles.primaryText}>Done</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </DialogContext.Provider>
    );
}

export function useDialog(): DialogContextValue {
    const context = useContext(DialogContext);
    if (!context) throw new Error('useDialog must be used within DialogProvider');
    return context;
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 16, padding: 22 },
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    message: { fontSize: 14, color: '#475569', marginTop: 8, lineHeight: 20 },
    codes: { maxHeight: 260, marginTop: 14, backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    codesContent: { padding: 12, gap: 6 },
    code: {
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
        fontSize: 16,
        color: colors.text,
        letterSpacing: 1,
        textAlign: 'center',
    },
    buttons: { flexDirection: 'row', gap: 12, marginTop: 20 },
    button: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
    primary: { backgroundColor: colors.primary },
    danger: { backgroundColor: colors.danger },
    secondary: { backgroundColor: '#f1f5f9' },
    primaryText: { color: '#fff', fontWeight: '600' },
    secondaryText: { color: '#334155', fontWeight: '600' },
});
