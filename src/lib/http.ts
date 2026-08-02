import type { SafeHtml } from './html';

export async function parseForm(request: Request): Promise<Record<string, string>> {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

export function htmlResponse(body: SafeHtml, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body.value, { ...init, headers });
}

export function textResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(body, { ...init, headers });
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location } });
}

export function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
