import crypto from 'node:crypto';
import type http from 'node:http';

export function generateDashboardToken(masterKey: Buffer): string {
  return crypto.createHash('sha256').update(masterKey).digest('hex').slice(0, 32);
}

export function checkAuth(req: http.IncomingMessage, token: string): boolean {
  // 1. Bearer header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === token;
  }

  // 2. Cookie session
  const cookieHeader = req.headers.cookie ?? '';
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'vigilclaw_session' && v === token) return true;
  }

  // 3. ?token= query param
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('token') === token;
}

export function setSessionCookie(res: import('node:http').ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `vigilclaw_session=${token}; HttpOnly; Path=/; SameSite=Strict`);
}
