import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGE_LABEL, byRank } from "@offai/core";
import { Avatar } from "@/components/avatar";
import { ReportCard } from "@/components/report-card";
import { getDivisionWeek, getOrg, getRecentReports } from "@/lib/data";
import { formatUsd } from "@/lib/format";

type Props = { params: Promise<{ divisionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { divisionId } = await params;
  const division = (await getOrg()).divisions.find((item) => item.id === divisionId);
  return { title: division?.name ?? "본부" };
}

export default async function DivisionPage({ params }: Props) {
  const { divisionId } = await params;
  const org = await getOrg();
  const division = org.divisions.find((item) => item.id === divisionId);
  if (!division) notFound();
  const [reports, week] = await Promise.all([getRecentReports(60, { divisionId }), getDivisionWeek()]);
  const stats = week.get(divisionId);
  const people = division.teams.reduce((sum, team) => sum + team.roles.length, 0);

  return (
    <>
      <nav aria-label="이동 경로" className="crumbs">
        <Link href="/">조직도</Link>
        <span aria-hidden="true">/</span>
        <span>{division.name}</span>
      </nav>
      <div className="page-head">
        <div className="division-hero">
          <Avatar seed={`head-${division.id}`} gender={division.head.gender} name={division.head.name} divisionId={division.id} size={56} senior />
          <div>
            <h1>{division.name}</h1>
            <p className="muted">
              본부장 {division.head.name} · 경력 {division.head.years}년{division.head.background && ` · ${division.head.background}`}
            </p>
            <p className="muted">{division.mission}</p>
          </div>
        </div>
        <dl className="stats">
          <div>
            <dt>팀</dt>
            <dd>{division.teams.length}</dd>
          </div>
          <div>
            <dt>직원</dt>
            <dd>{people}</dd>
          </div>
          <div>
            <dt>최근 7일 세션</dt>
            <dd>{stats?.sessions ?? 0}</dd>
          </div>
          <div>
            <dt>최근 7일 사용</dt>
            <dd>{formatUsd(stats?.costCents ?? 0)}</dd>
          </div>
        </dl>
      </div>

      <section aria-labelledby="teams-title">
        <h2 id="teams-title" className="section-title">
          소속 팀
        </h2>
        <ul className="division-teams">
          {division.teams.map((team) => (
            <li key={team.id}>
              <Link href={`/teams/${team.id}`} className="division-team">
                <strong>{team.name}</strong>
                <span className="muted">
                  {STAGE_LABEL[team.stage]}
                  {team.assignment === "conditional" ? " · 조건부" : ""} · {team.domain}
                </span>
                <span className="avatar-row">
                  {byRank(team.roles).map((role) => (
                    <Avatar key={role.id} seed={role.id} gender={role.person.gender} name={`${role.person.name} ${role.rank}`} divisionId={division.id} size={28} senior={role.rank === "팀장"} />
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="inbox-title">
        <h2 id="inbox-title" className="section-title">
          본부 보고함
        </h2>
        {reports.length === 0 ? (
          <p className="muted">아직 보고가 없습니다.</p>
        ) : (
          <ol className="feed__list">
            {reports.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} org={org} showTask />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
