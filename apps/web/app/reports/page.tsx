import type { Metadata } from "next";
import { Avatar } from "@/components/avatar";
import { ReportCard } from "@/components/report-card";
import { getDivisionWeek, getExecutiveDigest, getOrg, getRecentReports, isPreview } from "@/lib/data";
import Link from "next/link";
import { formatUsd } from "@/lib/format";
import { PreviewBanner } from "../notice";

export const metadata: Metadata = { title: "보고" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ level?: string }> };

export default async function ReportsPage({ searchParams }: Props) {
  const [org, week, reports, digest, query] = await Promise.all([getOrg(), getDivisionWeek(), getRecentReports(150), getExecutiveDigest(), searchParams]);
  const level = query.level === "division" || query.level === "team" || query.level === "member" ? query.level : "all";
  const visible = level === "all" ? reports : reports.filter((report) => report.level === level);

  return (
    <div className="bleed">
      <div className="page-head">
        <div>
          <h1>보고</h1>
          <p className="muted">팀원 → 팀장 → 본부장 → 대표 순서로 보고가 올라갑니다. 단계가 끝나면 본부장이 본부 보고와 함께 다음 팀에 일을 넘깁니다.</p>
        </div>
      </div>
      {isPreview() && <PreviewBanner />}

      <section aria-labelledby="ceo-title" className="ceo">
        <h2 id="ceo-title" className="section-title">
          대표 보고
        </h2>
        <div className="ceo__grid">
          <ul className="ceo__todo" aria-label="사람이 처리할 일">
            <li>
              <Link href="/tasks">
                <strong>{digest.awaitingMerge}</strong> merge 대기
              </Link>
            </li>
            <li>
              <Link href="/tasks">
                <strong>{digest.awaitingDeploy}</strong> 배포 승인 대기
              </Link>
            </li>
            <li>
              <Link href="/approvals">
                <strong>{digest.approvals}</strong> 명령 승인 대기
              </Link>
            </li>
            <li className={digest.escalated ? "is-bad" : undefined}>
              <Link href="/tasks">
                <strong>{digest.escalated}</strong> 사람 확인 필요
              </Link>
            </li>
            <li>
              <span>
                <strong>{digest.running}</strong> AI 조직이 진행 중
              </span>
            </li>
          </ul>
          <div className="ceo__divisions">
            <h3>본부별 최근 24시간</h3>
            {digest.divisionToday.length === 0 ? (
              <p className="muted">최근 24시간 본부 보고가 없습니다.</p>
            ) : (
              <ul>
                {digest.divisionToday.map((report) => {
                  const division = org.divisions.find((item) => item.id === report.divisionId);
                  return (
                    <li key={report.id}>
                      <strong>{division?.name ?? report.divisionId}</strong> <span className="muted">{division?.head.name} 본부장</span> — {report.summary}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="week-title" className="week">
        <h2 id="week-title" className="section-title">
          본부별 최근 7일
        </h2>
        <ul className="week__grid">
          {org.divisions.map((division) => {
            const stats = week.get(division.id);
            return (
              <li key={division.id} className="week__card">
                <header className="week__head">
                  <Avatar seed={`head-${division.id}`} gender={division.head.gender} name={division.head.name} divisionId={division.id} size={32} senior />
                  <div>
                    <strong>{division.name}</strong>
                    <span className="muted"> · {division.head.name} 본부장</span>
                  </div>
                </header>
                <dl className="week__stats">
                  <div>
                    <dt>세션</dt>
                    <dd>{stats?.sessions ?? 0}</dd>
                  </div>
                  <div>
                    <dt>완료</dt>
                    <dd>{stats?.completed ?? 0}</dd>
                  </div>
                  <div>
                    <dt>수정 요청</dt>
                    <dd>{stats?.changesRequested ?? 0}</dd>
                  </div>
                  <div>
                    <dt>진행 불가</dt>
                    <dd className={stats?.blocked ? "is-bad" : undefined}>{stats?.blocked ?? 0}</dd>
                  </div>
                  <div>
                    <dt>사용</dt>
                    <dd>{formatUsd(stats?.costCents ?? 0)}</dd>
                  </div>
                </dl>
                <p className="week__latest">{stats?.latest ? stats.latest.summary : "최근 본부 보고가 없습니다"}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="feed-title" className="feed">
        <div className="feed__head">
          <h2 id="feed-title" className="section-title">
            보고 피드
          </h2>
          <nav aria-label="보고 종류" className="segmented">
            <a href="/reports" aria-current={level === "all" ? "page" : undefined}>
              전체
            </a>
            <a href="/reports?level=division" aria-current={level === "division" ? "page" : undefined}>
              본부 보고
            </a>
            <a href="/reports?level=team" aria-current={level === "team" ? "page" : undefined}>
              팀 보고
            </a>
            <a href="/reports?level=member" aria-current={level === "member" ? "page" : undefined}>
              팀원 보고
            </a>
          </nav>
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            <p className="empty__title">아직 보고가 없습니다</p>
            <p className="muted">작업이 접수되어 팀 세션이 끝나면 이곳에 보고가 쌓입니다.</p>
          </div>
        ) : (
          <ol className="feed__list">
            {visible.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} org={org} showTask />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
