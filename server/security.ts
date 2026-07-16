import { randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "steward_token";

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function requestHasSessionToken(request: Request, expected: string): boolean {
  const query = new URL(request.url).searchParams.get("token");
  const presented = query !== null ? query : cookieValue(request);
  return presented !== null && equalSecret(presented, expected);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}
