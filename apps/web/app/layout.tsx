import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "offAI", template: "%s · offAI" },
  description: "AI 조직 운영 콘솔",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="brand">
              offAI
            </Link>
            <Nav />
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
