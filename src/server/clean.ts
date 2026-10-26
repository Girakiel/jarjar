// Normalizers for settings that come from the dashboard or from stored JSON.
import { DEVICES, type Device } from '../shared/protocol';

export function cleanText(value: unknown, fallback: string, max = 200): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

export function cleanColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Page patterns, from an array or one-per-line text. */
export function cleanPatterns(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : [];
  const patterns = list.map((p) => String(p).trim().slice(0, 200)).filter(Boolean);
  return [...new Set(patterns)].slice(0, 50);
}

/** A non-empty subset of devices; anything invalid means "all devices". */
export function cleanDevices(value: unknown): Device[] {
  const list = Array.isArray(value) ? value.filter((d): d is Device => DEVICES.includes(d as Device)) : [];
  return list.length ? DEVICES.filter((d) => list.includes(d)) : [...DEVICES];
}

export function parseJsonObject(text: string | null | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(text ?? '');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
