import Link from "next/link";
import { STAGES, STAGE_LABEL, byRank, type Division, type Team } from "@offai/core";
import { Avatar } from "@/components/avatar";
import { getMonthlySpend, getOrg, isPreview } from "@/lib/data";
import { MODEL_LABEL, formatUsd } from "@/lib/format";
import { PreviewBanner } from "./notice";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const [org, spend] = await Promise.all([getOrg(), getMonthlySpend()]);
  const teams = org.divisions.flatMap((division) => division.teams);
  const people = teams.flatMap((team) => team.roles);
  const monthlyBudget = org.divisions.reduce((sum, division) => sum + division.monthlyBudgetCents, 0);
  const women = people.filter((role) => role.person.gender === "female").length;

  return (
    <div className="bleed">
      <div className="page-head">
        <div>
          <h1>조직도</h1>
          <p className="muted">
            {org.name} · 대상 레포 {org.repos.join(", ")}
          </p>
        </div>
        <dl className="stats">
          <div>
            <dt>본부</dt>
            <dd>{org.divisions.length}</dd>
          </div>
          <div>
            <dt>팀</dt>
            <dd>{teams.length}</dd>
          </div>
          <div>
            <dt>직원</dt>
            <dd>
              {people.length}
              <small>
                여 {women} · 남 {people.length - women}
              </small>
            </dd>
          </div>
          <div>
            <dt>월 예산</dt>
            <dd>{formatUsd(monthlyBudget)}</dd>
          </div>
        </dl>
      </div>

      {isPreview() && <PreviewBanner />}
      <section className="chart" aria-label="조직 구조">
        <div className="chart__root">
          <span className="chart__root-name">{org.name}</span>
          <span className="chart__root-meta">대표 · merge와 production 배포 승인</span>
        </div>
        <ul className="chart__divisions">
          {org.divisions.map((division) => (
            <DivisionColumn key={division.id} division={division} spentCents={spend.get(division.id) ?? 0} />
          ))}
        </ul>
      </section>

      <section className="flow" aria-labelledby="flow-title">
        <h2 id="flow-title">작업 흐름</h2>
        <ol className="flow__steps">
          {STAGES.map((stage) => {
            const owners = org.divisions.filter((division) => division.teams.some((team) => team.stage === stage));
            return (
              <FlowStep key={stage} title={STAGE_LABEL[stage]} owner={owners.map((division) => division.name).join(" · ")}>
                {stage === "verify" ? (
                  <FlowStep human title="merge" owner="사람" />
                ) : stage === "release" ? (
                  <FlowStep human title="production 배포" owner="사람" />
                ) : null}
              </FlowStep>
            );
          })}
        </ol>
        <p className="muted">
          보안팀·법무팀·디자인팀은 관련 label이나 파일 변경이 있을 때만 참여합니다. 검증에서 수정 요청이 나오면 구현으로 돌아가고, 최대 {org.maxReworks}회를 넘으면
          사람에게 넘깁니다.
        </p>
      </section>
    </div>
  );
}

function FlowStep({ title, owner, human = false, children }: { title: string; owner: string; human?: boolean; children?: React.ReactNode }) {
  return (
    <>
      <li className={human ? "flow__human" : undefined}>
        <strong>{title}</strong>
        <span>{owner}</span>
      </li>
      {children}
    </>
  );
}

function DivisionColumn({ division, spentCents }: { division: Division; spentCents: number }) {
  const usage = Math.min(spentCents / division.monthlyBudgetCents, 1);
  return (
    <li className={`division${division.teams.length > 3 ? " division--wide" : ""}`}>
      <div className="division__head">
        <div className="division__title">
          <Avatar seed={`head-${division.id}`} gender={division.head.gender} name={division.head.name} divisionId={division.id} size={40} senior />
          <div>
            <h2>
              <Link href={`/divisions/${division.id}`} className="division__link">
                {division.name}
              </Link>
            </h2>
            <p className="division__leader" title={division.head.background || undefined}>
              본부장 {division.head.name} · 경력 {division.head.years}년
            </p>
          </div>
        </div>
        <p className="division__mission">{division.mission}</p>
        <div className="budget" aria-label={`월 예산 ${formatUsd(division.monthlyBudgetCents)} 중 ${formatUsd(spentCents)} 사용`}>
          <div className="budget__bar">
            <span style={{ width: `${usage * 100}%` }} />
          </div>
          <span className="budget__text">
            {formatUsd(spentCents)} / {formatUsd(division.monthlyBudgetCents)}
          </span>
        </div>
      </div>
      <ul className="division__teams">
        {division.teams.map((team) => (
          <TeamCard key={team.id} team={team} divisionId={division.id} />
        ))}
      </ul>
    </li>
  );
}

function TeamCard({ team, divisionId }: { team: Team; divisionId: string }) {
  return (
    <li className="team">
      <Link href={`/teams/${team.id}`} className="team__link">
        <div className="team__head">
          <h3>{team.name}</h3>
          <span className={`stage stage--${team.stage}`}>
            {STAGE_LABEL[team.stage]}
            {team.assignment === "conditional" && " · 조건부"}
          </span>
        </div>
        <ul className="members">
          {byRank(team.roles).map((role) => (
            <li key={role.id} className="member">
              <Avatar seed={role.id} gender={role.person.gender} name={role.person.name} divisionId={divisionId} size={32} senior={role.rank === "팀장"} />
              <span className="member__text">
                <span className="member__name">
                  {role.person.name} <span className={`rank rank--${role.rank === "팀장" ? "lead" : "staff"}`}>{role.rank}</span>
                </span>
                <span className="member__job" title={role.person.background || undefined}>
                  {role.name} · {role.person.years}년 · {MODEL_LABEL[role.model]}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="team__foot">
          <span>세션 상한 {formatUsd(team.sessionBudgetCents)}</span>
          {team.labels.length > 0 && <span>{team.labels.join(" ")}</span>}
        </div>
      </Link>
    </li>
  );
}
