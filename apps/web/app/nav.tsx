"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "조직도" },
  { href: "/office", label: "자리 배치도" },
  { href: "/tasks", label: "작업" },
  { href: "/reports", label: "보고" },
  { href: "/approvals", label: "승인함" },
  { href: "/settings", label: "설정" },
] as const;

export function Nav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="주 메뉴">
      <ul className="nav">
        {LINKS.map((link) => {
          const active = link.href === "/" ? pathname === "/" || pathname.startsWith("/teams") : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} className="nav__link" aria-current={active ? "page" : undefined}>
                {link.label}
                {link.href === "/approvals" && pendingApprovals > 0 && (
                  <span className="nav__badge" aria-label={`대기 ${pendingApprovals}건`}>
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
