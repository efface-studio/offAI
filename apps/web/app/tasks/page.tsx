import type { Metadata } from "next";
import Link from "next/link";
import { HUMAN_STATUSES, STAGE_LABEL, STATUS_LABEL, type TaskStatus } from "@offai/core";
import { getTasks, type TaskSummary } from "@/lib/data";
import { formatDate, formatUsd } from "@/lib/format";

export const metadata: Metadata = { title: "작업" };
export const dynamic = "force-dynamic";

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: "대기", statuses: ["queued"] },
  { title: "진행 중", statuses: ["running"] },
  { title: "사람 확인", statuses: [...HUMAN_STATUSES] },
  { title: "완료", statuses: ["done"] },
];

export default async function TasksPage() {
  const tasks = await getTasks();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>작업</h1>
          <p className="muted">GitHub Issue 하나가 작업 하나입니다. 대상 레포의 Issue에 offai label을 붙이면 접수됩니다.</p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">
          <p className="empty__title">아직 접수된 작업이 없습니다</p>
          <p className="muted">worker가 실행 중이고 GitHub App이 대상 레포에 설치되어 있어야 Issue가 들어옵니다.</p>
        </div>
      ) : (
        <div className="board">
          {COLUMNS.map((column) => {
            const items = tasks.filter((task) => column.statuses.includes(task.status));
            return (
              <section key={column.title} className="board__column" aria-label={column.title}>
                <h2>
                  {column.title} <span className="count">{items.length}</span>
                </h2>
                <ul>
                  {items.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function TaskCard({ task }: { task: TaskSummary }) {
  return (
    <li className="task">
      <div className="task__meta">
        <span className={`stage stage--${task.stage}`}>{STAGE_LABEL[task.stage]}</span>
        <span>{STATUS_LABEL[task.status]}</span>
      </div>
      <Link href={`/tasks/${task.id}`} className="task__title">
        {task.issueNumber !== null && `#${task.issueNumber} `}
        {task.title}
      </Link>
      {task.reason && <p className="task__reason">{task.reason}</p>}
      <div className="task__foot">
        <span>{task.repo}</span>
        {task.prNumber !== null && (
          <a href={`https://github.com/${task.repo}/pull/${task.prNumber}`} target="_blank" rel="noreferrer">
            PR #{task.prNumber}
          </a>
        )}
        <span>{formatUsd(task.spentCents)}</span>
        <time dateTime={task.updatedAt.toISOString()}>{formatDate(task.updatedAt)}</time>
      </div>
    </li>
  );
}
