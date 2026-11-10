import Link from "next/link";
import { STAGE_LABEL, leadOf, type Division, type Team } from "@offai/core";
import { getMonthlySpend, getOrg } from "@/lib/data";
import { MODEL_LABEL, formatUsd } from "@/lib/format";

export default async function OrgChartPage() {
  const [org, spend] = await Promise.all([getOrg(), getMonthlySpend()]);
  const teams = org.divisions.flatMap((division) => division.teams);
  const roles = teams.flatMap((team) => team.roles);
  const monthlyBudget = org.divisions.reduce((sum, division) => sum + division.monthlyBudgetCents, 0);

  return (
    <>
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
            <dt>역할</dt>
            <dd>{roles.length}</dd>
          </div>
          <div>
            <dt>월 예산</dt>
            <dd>{formatUsd(monthlyBudget)}</dd>
          </div>
        </dl>
      </div>

      <section className="chart" aria-label="조직 구조">
        <div className="chart__root">
          <span className="chart__root-name">{org.name}</span>
          <span className="chart__root-meta">사람 승인: merge · production 배포</span>
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
          <li>
            <strong>구현</strong>
            <span>제품개발본부</span>
          </li>
          <li>
            <strong>검증</strong>
            <span>품질본부</span>
          </li>
          <li className="flow__human">
            <strong>merge</strong>
            <span>사람</span>
          </li>
          <li>
            <strong>배포 준비</strong>
            <span>운영본부</span>
          </li>
          <li className="flow__human">
            <strong>production 배포</strong>
            <span>사람</span>
          </li>
          <li>
            <strong>운영</strong>
            <span>운영본부</span>
          </li>
        </ol>
        <p className="muted">
          검증에서 수정 요청이 나오면 구현으로 돌아갑니다. 최대 {org.maxReworks}회까지 반복하고, 넘으면 사람에게 넘깁니다.
        </p>
      </section>
    </>
  );
}

function DivisionColumn({ division, spentCents }: { division: Division; spentCents: number }) {
  const usage = Math.min(spentCents / division.monthlyBudgetCents, 1);
  return (
    <li className="division">
      <div className="division__head">
        <h2>{division.name}</h2>
        <p>{division.mission}</p>
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
          <TeamCard key={team.id} team={team} />
        ))}
      </ul>
    </li>
  );
}

function TeamCard({ team }: { team: Team }) {
  const lead = leadOf(team);
  const members = team.roles.filter((role) => !role.lead);
  return (
    <li className="team">
      <Link href={`/teams/${team.id}`} className="team__link">
        <div className="team__head">
          <h3>{team.name}</h3>
          <span className={`stage stage--${team.stage}`}>{STAGE_LABEL[team.stage]}</span>
        </div>
        <ul className="roles">
          <li className="role role--lead">
            <span className="role__name">{lead.name}</span>
            <span className="role__model">{MODEL_LABEL[lead.model]}</span>
          </li>
          {members.map((role) => (
            <li key={role.id} className="role">
              <span className="role__name">{role.name}</span>
              <span className="role__model">{MODEL_LABEL[role.model]}</span>
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
