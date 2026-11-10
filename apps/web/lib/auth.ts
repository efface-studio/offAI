/**
 * 관리자 비밀번호 게이트. proxy(Edge/Node 공용)에서도 쓰므로 Web Crypto 만 사용한다.
 * - OFFAI_ADMIN_PASSWORD 가 있으면: 로그인 쿠키가 있어야 접근 가능
 * - 없으면: 개발 환경에서는 열어 두고, production 에서는 막는다
 */
export const SESSION_COOKIE = "offai_session";

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function adminPassword(): string | null {
  return process.env.OFFAI_ADMIN_PASSWORD || null;
}

export function gateMode(): "open" | "password" | "locked" {
  if (adminPassword()) return "password";
  return process.env.NODE_ENV === "production" ? "locked" : "open";
}

export async function sessionToken(password: string): Promise<string> {
  return hmac(password, "offai-console-session-v1");
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  const password = adminPassword();
  if (!password || !cookie) return false;
  const expected = await sessionToken(password);
  if (cookie.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= cookie.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** 비밀번호 비교 (길이 노출 외 상수 시간) */
export async function checkPassword(input: string): Promise<boolean> {
  const password = adminPassword();
  if (!password) return false;
  const [a, b] = await Promise.all([sessionToken(input), sessionToken(password)]);
  return a === b;
}
