import type { Metadata } from "next";
import Link from "next/link";
import { getPendingApprovals, isPreview } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { decideApproval } from "../actions";
import { Notice, PreviewBanner } from "../notice";

export const metadata: Metadata = { title: "승인함" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ saved?: string }> };

export default async function ApprovalsPage({ searchParams }: Props) {
  const [approvals, query] = await Promise.all([getPendingApprovals(), searchParams]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>승인함</h1>
          <p className="muted">
            에이전트가 의존성 추가, DB 스키마 적용처럼 사람 확인이 필요한 명령을 실행하려 하면 여기서 멈춥니다. 24시간 안에 결정하지 않으면 거부됩니다.
          </p>
        </div>
      </div>
      {isPreview() ? <PreviewBanner /> : <Notice saved={query.saved} savedText="결정을 전달했습니다. worker가 몇 초 안에 에이전트에 알립니다." />}

      {approvals.length === 0 ? (
        <div className="empty">
          <p className="empty__title">승인을 기다리는 요청이 없습니다</p>
        </div>
      ) : (
        <ul className="approvals">
          {approvals.map((approval) => (
            <li key={approval.id} className="approval">
              <div className="approval__head">
                <Link href={`/tasks/${approval.taskId}`} className="task__title">
                  {approval.issueNumber !== null && `#${approval.issueNumber} `}
                  {approval.taskTitle}
                </Link>
                <time dateTime={approval.requestedAt.toISOString()}>{formatDate(approval.requestedAt)}</time>
              </div>
              <p className="muted">
                {approval.repo} · {approval.reason}
              </p>
              <pre className="approval__command">{approval.command}</pre>
              <form action={decideApproval} className="approval__actions">
                <input type="hidden" name="id" value={approval.id} />
                <button type="submit" name="decision" value="allow" className="button button--primary">
                  실행 허용
                </button>
                <button type="submit" name="decision" value="deny" className="button">
                  거부
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
