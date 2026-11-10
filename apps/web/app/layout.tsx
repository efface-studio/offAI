import type { Metadata } from "next";
import Link from "next/link";
import { gateMode } from "@/lib/auth";
import { getPendingApprovalCount } from "@/lib/data";
import { logout } from "./actions";
import { Nav } from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "offAI", template: "%s · offAI" },
  description: "AI 조직 운영 콘솔",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pending = await getPendingApprovalCount().catch(() => 0);
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="brand">
              offAI
            </Link>
            <Nav pendingApprovals={pending} />
            {gateMode() === "password" && (
              <form action={logout} className="site-header__end">
                <button type="submit" className="button button--ghost">
                  로그아웃
                </button>
              </form>
            )}
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
