import type { Metadata } from "next";
import Link from "next/link";
import { STAGE_LABEL, byRank, type Division, type Role, type Team } from "@offai/core";
import { Avatar } from "@/components/avatar";
import { getOrg, getTeamActivity, isPreview, type TeamActivity } from "@/lib/data";
import { PreviewBanner } from "../notice";

export const metadata: Metadata = { title: "자리 배치도" };
export const dynamic = "force-dynamic";

const ACTIVITY_LABEL = { working: "근무 중", waiting: "승인 대기" } as const;

export default async function OfficePage() {
  const [org, activity] = await Promise.all([getOrg(), getTeamActivity()]);
  const working = [...activity.values()].filter((item) => item.state === "working").length;

  return (
    <div className="bleed">
      <div className="page-head">
        <div>
          <h1>자리 배치도</h1>
          <p className="muted">본부별 구역과 팀 자리입니다. 작업을 맡은 팀은 모니터가 켜집니다.</p>
        </div>
        <dl className="stats">
          <div>
            <dt>근무 중인 팀</dt>
            <dd>{working}</dd>
          </div>
        </dl>
      </div>
      {isPreview() && <PreviewBanner />}

      <div className="floor" role="list" aria-label="사무실 층 배치">
        {org.divisions.map((division) => (
          <Zone key={division.id} division={division} activity={activity} />
        ))}
        <section className="zone zone--common" role="listitem" aria-label="공용 공간">
          <h2 className="zone__name">공용 공간</h2>
          <div className="commons">
            <div className="room">
              <strong>대표실</strong>
              <span>merge · production 배포 승인</span>
            </div>
            <div className="room">
              <strong>회의실</strong>
              <span>기획 명세 공유</span>
            </div>
            <Link href="/approvals" className="room room--link">
              <strong>결재함</strong>
              <span>사람 확인이 필요한 명령</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Zone({ division, activity }: { division: Division; activity: Map<string, TeamActivity> }) {
  return (
    <section className={`zone zone--${division.id}${division.teams.length > 3 ? " zone--wide" : ""}`} role="listitem" aria-labelledby={`zone-${division.id}`}>
      <header className="zone__head">
        <h2 className="zone__name" id={`zone-${division.id}`}>
          {division.name}
        </h2>
        <div className="head-desk">
          <Avatar seed={`head-${division.id}`} gender={division.head.gender} name={division.head.name} divisionId={division.id} size={30} senior />
          <span>
            본부장 <strong>{division.head.name}</strong>
          </span>
        </div>
      </header>
      <div className="pods">
        {division.teams.map((team) => (
          <Pod key={team.id} team={team} divisionId={division.id} activity={activity.get(team.id)} />
        ))}
      </div>
    </section>
  );
}

function Pod({ team, divisionId, activity }: { team: Team; divisionId: string; activity: TeamActivity | undefined }) {
  const roles = byRank(team.roles);
  return (
    <article className={`pod${activity ? ` pod--${activity.state}` : ""}`} aria-label={`${team.name} 자리`}>
      <header className="pod__head">
        <Link href={`/teams/${team.id}`} className="pod__name">
          {team.name}
        </Link>
        <span className="pod__stage">{STAGE_LABEL[team.stage]}</span>
      </header>
      <ul className="desks">
        {roles.map((role) => (
          <Desk key={role.id} role={role} divisionId={divisionId} active={Boolean(activity)} />
        ))}
      </ul>
      <p className="pod__status">
        {activity ? (
          <Link href={`/tasks/${activity.taskId}`}>
            <span className={`dot dot--${activity.state}`} aria-hidden="true" />
            {ACTIVITY_LABEL[activity.state]} · {activity.taskTitle}
          </Link>
        ) : (
          <>
            <span className="dot" aria-hidden="true" />
            대기
          </>
        )}
      </p>
    </article>
  );
}

function Desk({ role, divisionId, active }: { role: Role; divisionId: string; active: boolean }) {
  const lead = role.rank === "팀장";
  return (
    <li className={`desk${lead ? " desk--lead" : ""}${active ? " desk--on" : ""}`}>
      <div className="desk__seat">
        <Avatar seed={role.id} gender={role.person.gender} name={role.person.name} divisionId={divisionId} size={36} senior={lead} />
      </div>
      <div className="desk__top" aria-hidden="true">
        <span className="desk__monitor" />
      </div>
      <span className="desk__label">
        <strong>{role.person.name}</strong> {role.rank}
      </span>
    </li>
  );
}
