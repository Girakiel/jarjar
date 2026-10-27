import { buildApp } from './app';
import { loadConfig } from './config';
import { scheduleRetention } from './retention';

const config = loadConfig();
const { app, db } = await buildApp({ config });

const stopRetention = scheduleRetention(db, config.retentionDays, (msg) => app.log.info(msg));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopRetention();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`jarjar is running on http://localhost:${config.port} (data: ${config.dataDir})`);
