"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 진행 중인 화면을 주기적으로 다시 불러온다 (탭이 보일 때만) */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, router]);
  return active ? (
    <p className="live" role="status">
      <span className="dot dot--working" aria-hidden="true" />
      실시간 갱신 중
    </p>
  ) : null;
}
