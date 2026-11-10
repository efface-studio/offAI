"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "조직도" },
  { href: "/tasks", label: "작업" },
  { href: "/approvals", label: "승인함" },
] as const;

export function Nav() {
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
