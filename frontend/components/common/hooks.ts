import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import { isCancelled } from '../../context/StepUpContext';
import { useToast } from '../ui';

export interface AsyncState<T> {
    data: T | undefined;
    loading: boolean;
    error: ApiError | null;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/** Loads data from the API and exposes loading/error state plus a reload function. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = [], options: { enabled?: boolean } = {}): AsyncState<T> {
    const { enabled = true } = options;
    const [data, setData] = useState<T | undefined>(undefined);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<ApiError | null>(null);
    const mounted = useRef(true);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    const reload = useCallback(async () => {
        if (!enabled) return;
        setLoading(true);
        setError(null);
        try {
            const result = await loaderRef.current();
            if (mounted.current) setData(result);
        } catch (e) {
            if (mounted.current) setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
        } finally {
            if (mounted.current) setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, ...deps]);

    useEffect(() => {
        mounted.current = true;
        void reload();
        return () => {
            mounted.current = false;
        };
    }, [reload]);

    return { data, loading, error, reload, setData };
}

/** Toast helper that turns API errors into readable messages and ignores cancelled re-auth prompts. */
export function useErrorToast() {
    const { showToast } = useToast();
    return useCallback(
        (error: unknown, fallback = 'Something went wrong') => {
            if (isCancelled(error)) return;
            const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
            showToast(message || fallback, 'error', 4000);
        },
        [showToast],
    );
}
