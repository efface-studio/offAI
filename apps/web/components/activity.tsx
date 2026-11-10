import { STAGE_LABEL, byRank, findTeam, type Org, type Role, type Team } from "@offai/core";
import { Avatar } from "@/components/avatar";
import type { ActivityItem, RunSummary } from "@/lib/data";
import { formatDate } from "@/lib/format";

function findRole(org: Org, roleId: string | null): { role: Role; team: Team; divisionId: string } | null {
  if (!roleId) return null;
  for (const division of org.divisions) {
    for (const team of division.teams) {
      const role = team.roles.find((item) => item.id === roleId);
      if (role) return { role, team, divisionId: division.id };
    }
  }
  return null;
}

function who(org: Org, roleId: string | null): string {
  const found = findRole(org, roleId);
  return found ? `${found.role.person.name} ${found.role.rank}` : "팀원";
}

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  session_started: "세션 시작",
  member_joined: "투입",
  delegated: "지시",
  member_report: "보고",
  tool: "작업",
  lead_message: "메모",
  policy: "정책",
  session_finished: "세션 종료",
};

/** 활동 한 줄의 제목 (누가 → 누구에게 무엇을) */
function headline(org: Org, item: ActivityItem): string {
  const actor = who(org, item.actorRoleId);
  switch (item.kind) {
    case "delegated":
      return `${actor} → ${who(org, item.targetRoleId)}에게 지시`;
    case "member_report":
      return `${actor} → ${who(org, item.targetRoleId)}에게 보고`;
    case "member_joined":
      return `${actor} 투입`;
    case "policy":
      return `${actor} 명령이 정책에 막힘`;
    default:
      return actor;
  }
}

/** 세션별로 묶은 작업 과정 타임라인 */
export function ActivityTimeline({ org, items, runs }: { org: Org; items: ActivityItem[]; runs: RunSummary[] }) {
  if (items.length === 0) return <p className="muted">아직 기록된 활동이 없습니다.</p>;
  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = item.runId ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="activity-groups">
      {[...groups.entries()].map(([runId, list]) => {
        const run = runs.find((item) => item.id === runId);
        const team = findTeam(org, list[0]!.teamId)?.team;
        return (
          <section key={runId} className="activity-group" aria-label={`${team?.name ?? list[0]!.teamId} 세션`}>
            <h3 className="activity-group__title">
              {team?.name ?? list[0]!.teamId}
              {run && <span className={`stage stage--${run.stage}`}>{STAGE_LABEL[run.stage]}</span>}
              {run && <span className="muted">{run.status === "running" ? "진행 중" : run.status === "completed" ? "완료" : "실패"}</span>}
            </h3>
            <ol className="activity">
              {list.map((item) => {
                const actor = findRole(org, item.actorRoleId);
                const long = item.kind === "delegated" || item.kind === "member_report" || item.kind === "lead_message";
                return (
                  <li key={item.id} className={`activity__item activity__item--${item.kind}`}>
                    {actor ? (
                      <Avatar seed={actor.role.id} gender={actor.role.person.gender} name={actor.role.person.name} divisionId={actor.divisionId} size={26} senior={actor.role.rank === "팀장"} />
                    ) : (
                      <span className="activity__dot" aria-hidden="true" />
                    )}
                    <div className="activity__main">
                      <p className="activity__head">
                        <span className="activity__kind">{KIND_LABEL[item.kind]}</span>
                        <strong>{headline(org, item)}</strong>
                        <time dateTime={item.createdAt.toISOString()}>{formatDate(item.createdAt)}</time>
                      </p>
                      {item.kind === "tool" ? (
                        <code className="activity__code">{item.detail}</code>
                      ) : long ? (
                        <details className="activity__text" open={item.kind !== "lead_message"}>
                          <summary>{item.detail.split("\n")[0]}</summary>
                          {item.detail.includes("\n") && <pre>{item.detail}</pre>}
                        </details>
                      ) : (
                        item.kind !== "member_joined" && <p className="activity__detail">{item.detail}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

type MemberStatus = { label: string; tone: "working" | "reported" | "idle" | "lead"; detail: string };

/** 팀원별 현재 상태: 최근 세션 활동에서 계산한다 */
export function staffStatus(team: Team, items: ActivityItem[], runActive: boolean): Map<string, MemberStatus> {
  const result = new Map<string, MemberStatus>();
  for (const role of team.roles) result.set(role.id, { label: "대기", tone: "idle", detail: "아직 투입되지 않음" });
  for (const item of items) {
    if (item.kind === "delegated" && item.targetRoleId && result.has(item.targetRoleId)) {
      result.set(item.targetRoleId, { label: "작업 중", tone: "working", detail: `지시: ${item.detail.split("\n")[0]}` });
    }
    if (!item.actorRoleId || !result.has(item.actorRoleId)) continue;
    const role = team.roles.find((r) => r.id === item.actorRoleId)!;
    if (role.rank === "팀장") {
      result.set(role.id, { label: runActive ? "주관 중" : "세션 종료", tone: "lead", detail: item.detail.split("\n")[0] ?? "" });
    } else if (item.kind === "member_report") {
      result.set(role.id, { label: "보고 완료", tone: "reported", detail: item.detail.split("\n")[0] ?? "" });
    } else if (item.kind !== "member_joined" || result.get(role.id)?.tone === "idle") {
      result.set(role.id, { label: "작업 중", tone: "working", detail: item.kind === "member_joined" ? "투입됨" : item.detail.split("\n")[0] ?? "" });
    }
  }
  return result;
}

/** 지금 누가 무엇을 하고 있는지: 팀별 직원 카드 */
export function StaffBoard({ org, teamId, items, runActive }: { org: Org; teamId: string; items: ActivityItem[]; runActive: boolean }) {
  const ref = findTeam(org, teamId);
  if (!ref) return null;
  const status = staffStatus(ref.team, items, runActive);
  return (
    <section className="staff" aria-label={`${ref.team.name} 직원 현황`}>
      <h3 className="staff__title">
        {ref.team.name} {runActive ? <span className="dot dot--working" aria-hidden="true" /> : null}
        <span className="muted">{runActive ? "작업 중" : "최근 세션"}</span>
      </h3>
      <ul className="staff__grid">
        {byRank(ref.team.roles).map((role) => {
          const current = status.get(role.id)!;
          return (
            <li key={role.id} className={`staff__card staff__card--${current.tone}`}>
              <Avatar seed={role.id} gender={role.person.gender} name={role.person.name} divisionId={ref.division.id} size={36} senior={role.rank === "팀장"} />
              <div className="staff__text">
                <p>
                  <strong>{role.person.name}</strong> <span className="muted">{role.rank} · {role.name}</span>
                </p>
                <p className="staff__state">{current.label}</p>
                <p className="staff__detail" title={current.detail}>
                  {current.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
