import type { Metadata } from "next";
import { gateMode } from "@/lib/auth";
import { login } from "../actions";

export const metadata: Metadata = { title: "로그인" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const mode = gateMode();

  return (
    <section className="login" aria-labelledby="login-title">
      <h1 id="login-title">offAI 콘솔</h1>
      {mode === "locked" ? (
        <p className="notice notice--error" role="alert">
          OFFAI_ADMIN_PASSWORD 가 설정되지 않아 production 에서 콘솔을 열 수 없습니다.
        </p>
      ) : mode === "open" ? (
        <p className="muted">개발 환경이라 비밀번호 없이 열려 있습니다.</p>
      ) : (
        <form action={login} className="form">
          <label className="field">
            <span>관리자 비밀번호</span>
            <input type="password" name="password" autoComplete="current-password" required autoFocus />
          </label>
          {error && (
            <p className="notice notice--error" role="alert">
              비밀번호가 맞지 않습니다
            </p>
          )}
          <button type="submit" className="button button--primary">
            로그인
          </button>
        </form>
      )}
    </section>
  );
}
