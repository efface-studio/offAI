export type BudgetCheck = { ok: true; remainingCents: number } | { ok: false; reason: string };

/**
 * 본부 월 예산에서 새 세션 예산을 뺄 수 있는지 판단한다.
 * 세션 예산은 Managed Agents session budget으로 강제되므로, 여기서는 시작 전에 막는 역할만 한다.
 */
export function checkDivisionBudget(input: {
  monthlyBudgetCents: number;
  spentThisMonthCents: number;
  sessionBudgetCents: number;
}): BudgetCheck {
  const remaining = input.monthlyBudgetCents - input.spentThisMonthCents;
  if (remaining < input.sessionBudgetCents) {
    return {
      ok: false,
      reason: `본부 월 예산이 부족합니다 (남은 금액 ${formatUsd(Math.max(remaining, 0))}, 필요 ${formatUsd(input.sessionBudgetCents)})`,
    };
  }
  return { ok: true, remainingCents: remaining - input.sessionBudgetCents };
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Managed Agents list_cost.amount 는 센트 단위 정수 문자열이다 */
export function toMinorUnits(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("예산은 1센트 이상의 정수여야 합니다");
  return String(cents);
}

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
