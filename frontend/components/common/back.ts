import { useCallback, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Android hardware/gesture back for the focused screen. Return true when handled; returning false
 * lets React Navigation pop the screen (or the app-level guard ask before exiting).
 */
export function useHardwareBack(handler: () => boolean) {
    const ref = useRef(handler);
    ref.current = handler;
    useFocusEffect(
        useCallback(() => {
            if (Platform.OS !== 'android') return undefined;
            const subscription = BackHandler.addEventListener('hardwareBackPress', () => ref.current());
            return () => subscription.remove();
        }, []),
    );
}

/** In-screen tabs with history, so the back button returns to the previously opened tab. */
export function useTabHistory<T extends string | undefined>(initial: T) {
    const [active, setActiveState] = useState<T>(initial);
    const history = useRef<T[]>([]);

    const setActive = useCallback((next: T) => {
        setActiveState((current) => {
            if (next !== current && current !== undefined) history.current.push(current);
            return next;
        });
    }, []);

    /** Silent switch (no history), e.g. when the open tab disappears after a permission change. */
    const resetActive = useCallback((next: T) => {
        history.current = [];
        setActiveState(next);
    }, []);

    useHardwareBack(() => {
        const previous = history.current.pop();
        if (previous === undefined) return false;
        setActiveState(previous);
        return true;
    });

    return [active, setActive, resetActive] as const;
}
