import Link from "next/link";
import { OUTCOME_LABEL, STAGE_LABEL, findTeam, leadOf, type Org } from "@offai/core";
import { Avatar } from "@/components/avatar";
import type { ReportItem } from "@/lib/data";
import { formatDate } from "@/lib/format";

type Props = { report: ReportItem; org: Org; showTask?: boolean };

/** 팀 보고(팀장 명의) 또는 본부 보고(본부장 명의) 한 건 */
export function ReportCard({ report, org, showTask = false }: Props) {
  const division = org.divisions.find((item) => item.id === report.divisionId);
  const team = report.teamId ? findTeam(org, report.teamId)?.team : undefined;
  const lead = team ? leadOf(team) : undefined;
  const next = report.nextTeamId ? (findTeam(org, report.nextTeamId)?.team.name ?? report.nextTeamId) : report.nextHuman;

  const author =
    report.level === "division"
      ? { seed: `head-${report.divisionId}`, name: division?.head.name ?? "본부장", gender: division?.head.gender ?? "female", title: `${division?.name ?? report.divisionId} 본부장 · 경력 ${division?.head.years ?? 0}년` }
      : { seed: lead?.id ?? report.teamId ?? "team", name: lead?.person.name ?? "팀장", gender: lead?.person.gender ?? "male", title: `${team?.name ?? report.teamId} 팀장${lead ? ` · 경력 ${lead.person.years}년` : ""}` };

  return (
    <article className={`report report--${report.level} report--${report.outcome}`}>
      <Avatar seed={author.seed} gender={author.gender} name={author.name} divisionId={report.divisionId} size={36} senior />
      <div className="report__main">
        <header className="report__head">
          <span className="report__author">
            <strong>{author.name}</strong> {author.title}
          </span>
          <span className="report__kind">{report.level === "division" ? "본부 보고" : "팀 보고"}</span>
          <span className={`stage stage--${report.stage}`}>{STAGE_LABEL[report.stage]}</span>
          <span className={`outcome outcome--${report.outcome}`}>{OUTCOME_LABEL[report.outcome]}</span>
          <time dateTime={report.createdAt.toISOString()}>{formatDate(report.createdAt)}</time>
        </header>
        {showTask && (
          <Link href={`/tasks/${report.taskId}`} className="report__task">
            {report.issueNumber !== null && `#${report.issueNumber} `}
            {report.taskTitle}
          </Link>
        )}
        <p className="report__summary">{report.summary}</p>
        {report.body && (
          <details className="report__body">
            <summary>자세히</summary>
            <pre>{report.body}</pre>
          </details>
        )}
        {report.level === "division" && next && (
          <p className="report__next">
            <span aria-hidden="true">→</span> 다음 {report.nextTeamId ? "담당" : ""} <strong>{next}</strong>
          </p>
        )}
      </div>
    </article>
  );
}
