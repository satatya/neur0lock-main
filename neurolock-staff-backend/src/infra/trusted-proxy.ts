/**
 * Decides whose X-Forwarded-For the API believes (Express `trust proxy`).
 *
 * Only the reverse proxy in front of the API (nginx, the `web` service in docker compose) is
 * trusted, and only as the direct peer: anyone calling the API directly (e.g. the mobile app on
 * port 4311) is identified by their socket address, whatever headers they send. That address feeds
 * the rate limiters and the X-Client-IP forwarded to the AAA server for its own limits and the
 * audit log. Hostnames are re-resolved periodically so a recreated proxy container is picked up;
 * a name that does not resolve trusts nothing (fail closed).
 */
import dns from 'dns';
import net from 'net';

/** Express `trust proxy` function: `hop` 0 is the socket peer, 1.. walk X-Forwarded-For right to left. */
export type TrustProxyFn = (address: string, hop: number) => boolean;

type Lookup = (hostname: string) => Promise<string[]>;

interface TrustedProxyOptions {
    lookup?: Lookup;
    /** Re-resolve interval once every hostname resolved. */
    refreshMs?: number;
    /** Re-resolve interval while a hostname is unresolved (e.g. the proxy container is still starting). */
    retryMs?: number;
}

export interface TrustedProxies {
    trust: TrustProxyFn;
    /** Re-resolves the configured hostnames now. */
    refresh: () => Promise<void>;
    /** Resolves now, then keeps re-resolving in the background until `stop()`. */
    start: () => Promise<void>;
    stop: () => void;
}

const systemLookup: Lookup = async (hostname) => (await dns.promises.lookup(hostname, { all: true })).map((entry) => entry.address);

/** `::ffff:10.0.0.2` (IPv4-mapped, from a dual-stack socket) and `10.0.0.2` are the same peer. */
const normalize = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

/** `entries`: hostnames (resolved via DNS) and/or literal IP addresses of the reverse proxy. */
export function trustedProxies(entries: string[], options: TrustedProxyOptions = {}): TrustedProxies {
    const { lookup = systemLookup, refreshMs = 30_000, retryMs = 2_000 } = options;
    const fixed = entries.filter((entry) => net.isIP(entry)).map(normalize);
    const hostnames = entries.filter((entry) => !net.isIP(entry));

    let trusted = new Set(fixed);
    let unresolved = hostnames.length > 0;
    let described = '';
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;

    const refresh = async () => {
        const resolved = await Promise.all(
            hostnames.map(async (host) => {
                try {
                    return (await lookup(host)).map(normalize);
                } catch {
                    return [];
                }
            }),
        );
        trusted = new Set([...fixed, ...resolved.flat()]);
        unresolved = resolved.some((addresses) => addresses.length === 0);

        const description = [
            ...fixed,
            ...hostnames.map((host, i) => `${host}=${resolved[i].length ? resolved[i].join('/') : 'unresolved'}`),
        ].join(', ');
        if (description !== described) {
            described = description;
            console.log(`[trust-proxy] X-Forwarded-For honoured only from: ${description}`);
        }
    };

    const schedule = () => {
        if (stopped || hostnames.length === 0) return;
        timer = setTimeout(() => {
            refresh().finally(schedule);
        }, unresolved ? retryMs : refreshMs);
        timer.unref();
    };

    return {
        trust: (address, hop) => hop === 0 && trusted.has(normalize(address)),
        refresh,
        start: async () => {
            stopped = false;
            await refresh();
            schedule();
        },
        stop: () => {
            stopped = true;
            clearTimeout(timer);
        },
    };
}
