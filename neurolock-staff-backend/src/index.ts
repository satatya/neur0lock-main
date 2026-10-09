import { config } from './config/env';
import { aaaHealth } from './infra/aaa-client';
import { migrate } from './infra/db/migrate';
import { pingDatabase } from './infra/db/mysql-client';
import { trustedProxies } from './infra/trusted-proxy';
import { createServer } from './server';
import { seedDemoCareTeam, seedDemoNotes } from './services/demo-seed';

async function main() {
    if (await pingDatabase()) {
        console.log(`MySQL connected (${config.db.host}:${config.db.port}/${config.db.database})`);
        const created = await migrate();
        if (config.seedDemo) {
            const members = await seedDemoCareTeam(created.includes('patient_care_team')).catch((error) => {
                console.warn(`[startup] Could not seed demo care teams: ${error.message}`);
                return 0;
            });
            if (members) console.log(`Seeded ${members} demo care-team memberships`);
            const seeded = await seedDemoNotes().catch((error) => {
                console.warn(`[startup] Could not seed demo notes: ${error.message}`);
                return 0;
            });
            if (seeded) console.log(`Seeded ${seeded} encrypted demo therapy notes`);
        }
    } else {
        console.warn(`[startup] MySQL is not reachable at ${config.db.host}:${config.db.port}. Requests will fail until it is available.`);
    }

    const aaa = await aaaHealth();
    if (aaa.ok) {
        console.log(`AAA server connected (${config.aaa.url}; directory ${aaa.directory}, log server ${aaa.log_server})`);
    } else {
        console.warn(`[startup] AAA server is not reachable at ${config.aaa.url}. Sign-in will fail until it is available.`);
    }

    // Behind nginx: X-Forwarded-For only from the proxy itself; direct callers keep their socket address
    const proxies = config.trustProxy ? trustedProxies(config.trustProxyHosts) : null;
    await proxies?.start();

    const app = createServer({ trustProxy: proxies?.trust });
    // Bind explicitly to 0.0.0.0 so the server is reachable from other devices on the LAN
    app.listen(config.port, config.host, () => {
        console.log(`NeuroLock API listening on http://${config.host}:${config.port}/api (${config.env})`);
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
