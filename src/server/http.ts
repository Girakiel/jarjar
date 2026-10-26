import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const gzip = promisify(zlib.gzip);
export const gunzip = promisify(zlib.gunzip);

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);

export function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function int(value: unknown, fallback = 0): number {
  return Math.round(num(value, fallback));
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

export function acceptsGzip(request: FastifyRequest): boolean {
  return /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''));
}

/** Sends JSON, gzipped when it's large enough to be worth it. */
export async function sendJson(request: FastifyRequest, reply: FastifyReply, body: string): Promise<FastifyReply> {
  reply.type('application/json; charset=utf-8');
  if (body.length > 8192 && acceptsGzip(request)) {
    reply.header('Content-Encoding', 'gzip').header('Vary', 'Accept-Encoding');
    return reply.send(await gzip(body));
  }
  return reply.send(body);
}

/** Sends data that is already stored gzipped, decompressing only for clients that can't take gzip. */
export async function sendGzippedJson(request: FastifyRequest, reply: FastifyReply, data: Uint8Array): Promise<FastifyReply> {
  reply.type('application/json; charset=utf-8').header('Vary', 'Accept-Encoding');
  if (acceptsGzip(request)) return reply.header('Content-Encoding', 'gzip').send(Buffer.from(data));
  return reply.send(await gunzip(data));
}

/** Converts a "days" query param into a [from, to) window in ms. */
export function rangeFromQuery(query: Record<string, unknown>, now = Date.now()): { from: number; to: number; days: number } {
  const days = clamp(int(query.days, 30), 1, 365);
  return { from: now - days * 86_400_000, to: now + 60_000, days };
}
