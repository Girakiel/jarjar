// Bundles the browser tracker and the Node server with esbuild.
// Usage: node scripts/build.mjs [tracker|server|all] [--watch]
import * as esbuild from 'esbuild';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const target = args.find((a) => !a.startsWith('--')) ?? 'all';

const configs = {
  tracker: {
    entryPoints: ['src/tracker/index.ts'],
    outfile: 'dist/public/t.js',
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'iife',
    target: ['es2019'],
    legalComments: 'none',
  },
  server: {
    entryPoints: ['src/server/index.ts'],
    outfile: 'dist/server/index.js',
    bundle: true,
    sourcemap: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
  },
};

const selected = target === 'all' ? Object.keys(configs) : [target];
for (const name of selected) {
  const config = configs[name];
  if (!config) throw new Error(`Unknown build target: ${name}`);
  if (watch) {
    const ctx = await esbuild.context({ ...config, logLevel: 'info' });
    await ctx.watch();
  } else {
    await esbuild.build({ ...config, logLevel: 'warning' });
    console.log(`built ${name} -> ${config.outfile}`);
  }
}
