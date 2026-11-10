import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGE_LABEL, STATUS_LABEL } from "@offai/core";
import { ActivityTimeline, StaffBoard } from "@/components/activity";
import { AutoRefresh } from "@/components/auto-refresh";
import { ReportCard } from "@/components/report-card";
import { getOrg, getTask, getTaskActivities, getTaskReports, type RunSummary } from "@/lib/data";
import { formatDate, formatUsd } from "@/lib/format";
import { approveDeploy, retryTask } from "../../actions";
import { Notice } from "../../notice";

type Props = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { taskId } = await params;
  const task = await getTask(taskId);
  return { title: task?.title ?? "작업" };
}

const RUN_STATUS = { running: "실행 중", completed: "완료", failed: "실패" } as const;

export default async function TaskPage({ params, searchParams }: Props) {
  const [{ taskId }, query] = await Promise.all([params, searchParams]);
  const [task, org, reports, activities] = await Promise.all([getTask(taskId), getOrg(), getTaskReports(taskId), getTaskActivities(taskId)]);
  if (!task) notFound();
  const teamName = (id: string | null) => org.divisions.flatMap((division) => division.teams).find((team) => team.id === id)?.name ?? id ?? "-";
  const github = `https://github.com/${task.repo}`;
  const live = task.status === "running" || task.status === "awaiting_approval";
  // 현재 단계의 최근 세션들 (팀별 마지막 세션)
  const stageRuns = task.runs.filter((run) => run.stage === task.stage);
  const latestByTeam = new Map(stageRuns.map((run) => [run.teamId, run]));
  const boards = [...latestByTeam.values()].map((run) => ({
    run,
    items: activities.filter((item) => item.runId === run.id),
  }));

  return (
    <>
      <nav aria-label="이동 경로" className="crumbs">
        <Link href="/tasks">작업</Link>
        <span aria-hidden="true">/</span>
        <span>{task.repo}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>
            {task.issueNumber !== null && <span className="muted">#{task.issueNumber} </span>}
            {task.title}
          </h1>
          <p className="task-head-meta">
            <span className={`stage stage--${task.stage}`}>{STAGE_LABEL[task.stage]}</span>
            <span>{STATUS_LABEL[task.status]}</span>
            <span>담당 {teamName(task.teamId)}</span>
            <span>재작업 {task.reworks}회</span>
            <span>사용 {formatUsd(task.spentCents)}</span>
          </p>
        </div>
        <div className="actions">
          {task.issueNumber !== null && (
            <a className="button button--ghost" href={`${github}/issues/${task.issueNumber}`} target="_blank" rel="noreferrer">
              Issue
            </a>
          )}
          {task.prNumber !== null && (
            <a className="button button--ghost" href={`${github}/pull/${task.prNumber}`} target="_blank" rel="noreferrer">
              PR #{task.prNumber}
            </a>
          )}
          {task.status === "escalated" && (
            <form action={retryTask}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className="button">
                다시 시도
              </button>
            </form>
          )}
          {task.status === "awaiting_deploy" && (
            <form action={approveDeploy}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className="button button--primary">
                배포 완료 기록
              </button>
            </form>
          )}
        </div>
      </div>
      <Notice saved={query.saved} error={query.error} savedText="반영했습니다" />
      <AutoRefresh active={live} />

      {task.reason && (
        <p className="notice notice--warn" role="status">
          {task.reason}
        </p>
      )}
      {task.status === "awaiting_merge" && <p className="notice notice--warn">검증을 통과했습니다. GitHub에서 PR을 검토하고 merge 하세요.</p>}
      {task.status === "awaiting_deploy" && (
        <p className="notice notice--warn">릴리스팀이 배포 요청서를 PR에 남겼습니다. production 배포를 마친 뒤 &lsquo;배포 완료 기록&rsquo;을 누르세요.</p>
      )}

      {boards.length > 0 && (
        <section aria-labelledby="now-title" className="now">
          <h2 id="now-title" className="section-title">
            지금 누가 무엇을
          </h2>
          <div className="now__boards">
            {boards.map(({ run, items }) => (
              <StaffBoard key={run.id} org={org} teamId={run.teamId} items={items} runActive={run.status === "running"} />
            ))}
          </div>
        </section>
      )}

      <div className="task-layout">
        <div>
        <section aria-labelledby="process-title" className="report-flow">
          <h2 id="process-title" className="section-title">
            작업 과정 {activities.length}
          </h2>
          <ActivityTimeline org={org} items={activities} runs={task.runs} />
        </section>

        <section aria-labelledby="flow-title" className="report-flow">
          <h2 id="flow-title" className="section-title">
            보고 흐름 {reports.length}
          </h2>
          {reports.length === 0 ? (
            <p className="muted">아직 보고가 없습니다.</p>
          ) : (
            <ol className="feed__list">
              {reports.map((report) => (
                <li key={report.id}>
                  <ReportCard report={report} org={org} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="runs-title">
          <h2 id="runs-title" className="section-title">
            팀 세션 {task.runs.length}
          </h2>
          {task.runs.length === 0 ? (
            <p className="muted">아직 실행된 세션이 없습니다.</p>
          ) : (
            <ol className="runs">
              {task.runs.map((run) => (
                <li key={run.id}>
                  <RunCard run={run} teamName={teamName(run.teamId)} />
                </li>
              ))}
            </ol>
          )}

          {task.findings.length > 0 && (
            <>
              <h2 className="section-title">대기 중인 수정 요청</h2>
              <ul className="bullets">
                {task.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        </div>

        <aside aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="section-title">
            기록
          </h2>
          <ol className="timeline">
            {task.events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.createdAt.toISOString()}>{formatDate(event.createdAt)}</time>
                <span className="timeline__actor">{event.actor}</span>
                <p>{event.message}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}

function RunCard({ run, teamName }: { run: RunSummary; teamName: string }) {
  return (
    <article className={`run run--${run.status}`}>
      <header className="run__head">
        <strong>
          {teamName} · {STAGE_LABEL[run.stage]}
        </strong>
        <span>{RUN_STATUS[run.status]}</span>
      </header>
      <p className="run__meta">
        <time dateTime={run.startedAt.toISOString()}>{formatDate(run.startedAt)}</time>
        <span>
          {formatUsd(run.costCents)} / {formatUsd(run.budgetCents)}
        </span>
        {run.sessionId && (
          <a href={`https://platform.claude.com/workspaces/default/sessions/${run.sessionId}`} target="_blank" rel="noreferrer">
            세션 기록
          </a>
        )}
      </p>
      {run.error && <p className="run__error">{run.error}</p>}
      {run.report && (
        <div className="run__report">
          <p>{run.report.summary}</p>
          {run.report.changes.length > 0 && <List title="변경" items={run.report.changes} />}
          {run.report.verification.length > 0 && <List title="검증" items={run.report.verification} />}
          {run.report.findings.length > 0 && <List title="수정 요청" items={run.report.findings} />}
          {run.report.notes.length > 0 && <List title="비고" items={run.report.notes} />}
        </div>
      )}
    </article>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="bullets">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
