import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/server/*.ts and the bundled dist/server/index.js both sit two levels below the repo root.
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  retentionDays: number;
  trustProxy: boolean;
  secureCookies: boolean;
  dashboardDir: string;
  publicDir: string;
  staticDir: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: int('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dataDir: path.resolve(process.env.JARJAR_DATA_DIR || path.join(ROOT_DIR, 'data')),
    retentionDays: int('JARJAR_RETENTION_DAYS', 30),
    trustProxy: bool('JARJAR_TRUST_PROXY', false),
    secureCookies: bool('JARJAR_SECURE_COOKIES', false),
    dashboardDir: path.join(ROOT_DIR, 'dist/dashboard'),
    publicDir: path.join(ROOT_DIR, 'dist/public'),
    staticDir: path.join(ROOT_DIR, 'public'),
    ...overrides,
  };
}
