import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGE_LABEL, findTeam } from "@offai/core";
import { getOrg } from "@/lib/data";
import { MODEL_LABEL, formatUsd } from "@/lib/format";

type Props = { params: Promise<{ teamId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const ref = findTeam(await getOrg(), teamId);
  return { title: ref?.team.name ?? "팀" };
}

export default async function TeamPage({ params }: Props) {
  const { teamId } = await params;
  const ref = findTeam(await getOrg(), teamId);
  if (!ref) notFound();
  const { division, team } = ref;

  return (
    <>
      <nav aria-label="이동 경로" className="crumbs">
        <Link href="/">조직도</Link>
        <span aria-hidden="true">/</span>
        <span>{division.name}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>{team.name}</h1>
          <p className="muted">
            {STAGE_LABEL[team.stage]} 담당 · 세션 상한 {formatUsd(team.sessionBudgetCents)}
            {team.labels.length > 0 && ` · label ${team.labels.join(", ")}`}
          </p>
        </div>
      </div>

      <ul className="role-details">
        {team.roles.map((role) => (
          <li key={role.id}>
            <article className="role-detail">
              <header className="role-detail__head">
                <h2>
                  {role.name}
                  {role.lead && <span className="tag">팀장 · 세션 coordinator</span>}
                </h2>
                <p>{role.responsibility}</p>
              </header>
              <dl className="role-detail__meta">
                <div>
                  <dt>모델</dt>
                  <dd>{MODEL_LABEL[role.model]}</dd>
                </div>
                <div>
                  <dt>effort</dt>
                  <dd>{role.effort}</dd>
                </div>
                <div>
                  <dt>도구</dt>
                  <dd>{role.tools === "full" ? "읽기·쓰기·bash" : "읽기 전용"}</dd>
                </div>
              </dl>
              <details className="role-detail__prompt">
                <summary>역할 지침 보기</summary>
                <pre>{role.instructions}</pre>
              </details>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
