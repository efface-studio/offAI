import type { Metadata } from "next";
import { getPendingApprovals } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "승인함" };

export default async function ApprovalsPage() {
  const approvals = await getPendingApprovals();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>승인함</h1>
          <p className="muted">
            에이전트가 의존성 추가, DB 스키마 적용처럼 사람 확인이 필요한 명령을 실행하려 하면 여기서 멈춥니다.
          </p>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="empty">
          <p className="empty__title">승인을 기다리는 요청이 없습니다</p>
        </div>
      ) : (
        <ul className="approvals">
          {approvals.map((approval) => (
            <li key={approval.id} className="approval">
              <div className="approval__head">
                <strong>{approval.taskTitle}</strong>
                <time dateTime={approval.requestedAt.toISOString()}>{formatDate(approval.requestedAt)}</time>
              </div>
              <pre className="approval__command">{approval.command}</pre>
              <p className="muted">{approval.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
