import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EFFORTS, MODEL_IDS, RANKS, STAGE_LABEL, byRank, findTeam, type Rank, type Role } from "@offai/core";
import { Avatar } from "@/components/avatar";
import { ReportCard } from "@/components/report-card";
import { getOrg, getRecentReports, isPreview } from "@/lib/data";
import { MODEL_LABEL, formatUsd } from "@/lib/format";
import { addRole, removeRole, updateTeam } from "../../actions";
import { Notice, PreviewBanner } from "../../notice";

type Props = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const ref = findTeam(await getOrg(), teamId);
  return { title: ref?.team.name ?? "팀" };
}

const TOOL_LABEL = { full: "읽기·쓰기·bash", read_only: "읽기 전용" } as const;
const STAFF_RANKS = RANKS.filter((rank) => rank !== "팀장");

export default async function TeamPage({ params, searchParams }: Props) {
  const [{ teamId }, query] = await Promise.all([params, searchParams]);
  const org = await getOrg();
  const ref = findTeam(org, teamId);
  if (!ref) notFound();
  const { division, team } = ref;
  const readOnly = isPreview();
  const reports = await getRecentReports(30, { teamId });

  return (
    <>
      <nav aria-label="이동 경로" className="crumbs">
        <Link href="/">조직도</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/divisions/${division.id}`}>{division.name}</Link>
      </nav>
      <div className="page-head">
        <div>
          <h1>{team.name}</h1>
          <p className="muted">
            {STAGE_LABEL[team.stage]} {team.assignment === "conditional" ? "조건부 참여" : "주 담당"} · 세션 상한 {formatUsd(team.sessionBudgetCents)} · 직원{" "}
            {team.roles.length}명
          </p>
        </div>
        <ul className="avatar-row" aria-label="팀원">
          {byRank(team.roles).map((role) => (
            <li key={role.id}>
              <Avatar seed={role.id} gender={role.person.gender} name={`${role.person.name} ${role.rank}`} divisionId={division.id} size={36} senior={role.rank === "팀장"} />
            </li>
          ))}
        </ul>
      </div>
      {readOnly ? <PreviewBanner /> : <Notice saved={query.saved} error={query.error} savedText="저장했습니다. worker가 다음 주기에 에이전트를 갱신합니다." />}

      <section aria-labelledby="team-inbox" className="team-inbox">
        <h2 id="team-inbox" className="section-title">
          팀 보고함 {reports.length}
        </h2>
        {reports.length === 0 ? (
          <p className="muted">아직 보고가 없습니다. 팀원 보고와 팀장 보고가 이곳에 쌓입니다.</p>
        ) : (
          <details className="panel" open={reports.length <= 5}>
            <summary>최근 보고 {reports.length}건</summary>
            <ol className="feed__list">
              {reports.map((report) => (
                <li key={report.id}>
                  <ReportCard report={report} org={org} showTask />
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      <form action={updateTeam} className="team-form">
        <input type="hidden" name="teamId" value={team.id} />
        <fieldset disabled={readOnly} className="team-form__fields">
          <section className="panel" aria-labelledby="team-basics">
            <h2 id="team-basics">팀 설정</h2>
            <div className="grid-4">
              <label className="field">
                <span>팀 이름</span>
                <input name="name" defaultValue={team.name} required maxLength={40} />
              </label>
              <label className="field">
                <span>전문 분야</span>
                <input name="domain" defaultValue={team.domain} maxLength={60} placeholder="웹 프론트엔드" />
              </label>
              <label className="field">
                <span>참여 방식</span>
                <select name="assignment" defaultValue={team.assignment}>
                  <option value="primary">주 담당</option>
                  <option value="conditional">조건부 (label·경로가 맞을 때만)</option>
                </select>
              </label>
              <label className="field">
                <span>세션 상한 (USD)</span>
                <input name="sessionBudget" type="number" min="0.01" step="0.01" defaultValue={(team.sessionBudgetCents / 100).toFixed(2)} required />
              </label>
            </div>
            <div className="grid-2">
              <label className="field">
                <span>label (쉼표로 구분)</span>
                <input name="labels" defaultValue={team.labels.join(", ")} placeholder="주 담당: 우선 배정 / 조건부: 참여 조건" />
              </label>
              <label className="field">
                <span>참여 경로 glob (조건부 팀, 한 줄에 하나)</span>
                <textarea name="triggerPaths" rows={2} defaultValue={team.triggerPaths.join("\n")} placeholder="**/auth/**" />
              </label>
            </div>
          </section>

          <ul className="role-details">
            {byRank(team.roles).map((role) => (
              <li key={role.id}>
                <RoleEditor role={role} divisionId={division.id} />
              </li>
            ))}
          </ul>

          {!readOnly && (
            <div className="form-actions">
              <button type="submit" className="button button--primary">
                팀 저장
              </button>
            </div>
          )}
        </fieldset>
      </form>

      {!readOnly && (
        <details className="panel add-role">
          <summary>직원 추가</summary>
          <form action={addRole} className="form">
            <input type="hidden" name="teamId" value={team.id} />
            <div className="grid-4">
              <label className="field">
                <span>이름</span>
                <input name="personName" required maxLength={20} />
              </label>
              <label className="field">
                <span>성별</span>
                <select name="gender" defaultValue="female">
                  <option value="female">여성</option>
                  <option value="male">남성</option>
                </select>
              </label>
              <label className="field">
                <span>직급</span>
                <select name="rank" defaultValue="선임">
                  {STAFF_RANKS.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>직원 ID</span>
                <input name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder={`${team.id}-analyst`} />
              </label>
            </div>
            <div className="grid-4">
              <label className="field">
                <span>경력 (년)</span>
                <input name="years" type="number" min="0" max="50" defaultValue={10} required />
              </label>
              <label className="field">
                <span>경력 배경</span>
                <input name="background" maxLength={200} placeholder="빅테크 프론트엔드 개발" />
              </label>
              <label className="field">
                <span>직무</span>
                <input name="name" required maxLength={40} placeholder="데이터 분석" />
              </label>
              <label className="field">
                <span>책임</span>
                <input name="responsibility" required maxLength={200} />
              </label>
            </div>
            <ModelFields defaults={{ model: "claude-sonnet-5-5", effort: "medium", tools: "read_only" }} />
            <label className="field">
              <span>업무 지침</span>
              <textarea name="instructions" rows={4} required maxLength={4000} />
            </label>
            <div className="form-actions">
              <button type="submit" className="button">
                직원 추가
              </button>
            </div>
          </form>
        </details>
      )}
    </>
  );
}

function RoleEditor({ role, divisionId }: { role: Role; divisionId: string }) {
  const prefix = `role.${role.id}`;
  const lead = role.rank === "팀장";
  return (
    <article className="role-detail">
      <header className="role-detail__head">
        <div className="role-detail__who">
          <Avatar seed={role.id} gender={role.person.gender} name={role.person.name} divisionId={divisionId} size={48} senior={lead} />
          <div>
            <h2>
              {role.person.name} <span className={`rank rank--${lead ? "lead" : "staff"}`}>{role.rank}</span>
              {lead && <span className="tag">세션 coordinator</span>}
            </h2>
            <p>
              {role.name} · 경력 {role.person.years}년{role.person.background && ` · ${role.person.background}`}
            </p>
          </div>
        </div>
        {!lead && (
          <button type="submit" formAction={removeRole} formNoValidate name="roleId" value={role.id} className="button button--ghost">
            내보내기
          </button>
        )}
      </header>
      <div className="grid-4">
        <label className="field">
          <span>이름</span>
          <input name={`${prefix}.personName`} defaultValue={role.person.name} required maxLength={20} />
        </label>
        <label className="field">
          <span>성별</span>
          <select name={`${prefix}.gender`} defaultValue={role.person.gender}>
            <option value="female">여성</option>
            <option value="male">남성</option>
          </select>
        </label>
        <label className="field">
          <span>직급</span>
          {lead ? (
            <>
              <input value="팀장" disabled />
              <input type="hidden" name={`${prefix}.rank`} value="팀장" />
            </>
          ) : (
            <select name={`${prefix}.rank`} defaultValue={role.rank}>
              {STAFF_RANKS.map((rank: Rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="field">
          <span>직무</span>
          <input name={`${prefix}.name`} defaultValue={role.name} required maxLength={40} />
        </label>
      </div>
      <div className="grid-3">
        <label className="field">
          <span>경력 (년)</span>
          <input name={`${prefix}.years`} type="number" min="0" max="50" defaultValue={role.person.years} required />
        </label>
        <label className="field">
          <span>경력 배경</span>
          <input name={`${prefix}.background`} defaultValue={role.person.background} maxLength={200} />
        </label>
        <label className="field">
          <span>책임</span>
          <input name={`${prefix}.responsibility`} defaultValue={role.responsibility} required maxLength={200} />
        </label>
      </div>
      <ModelFields prefix={prefix} defaults={role} />
      <details className="role-detail__prompt">
        <summary>업무 지침</summary>
        <textarea name={`${prefix}.instructions`} defaultValue={role.instructions} rows={8} required maxLength={4000} />
      </details>
    </article>
  );
}

function ModelFields({ prefix, defaults }: { prefix?: string; defaults: Pick<Role, "model" | "effort" | "tools"> }) {
  const name = (key: string) => (prefix ? `${prefix}.${key}` : key);
  return (
    <div className="grid-3">
      <label className="field">
        <span>모델</span>
        <select name={name("model")} defaultValue={defaults.model}>
          {MODEL_IDS.map((model) => (
            <option key={model} value={model}>
              {MODEL_LABEL[model]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>effort</span>
        <select name={name("effort")} defaultValue={defaults.effort}>
          {EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>도구</span>
        <select name={name("tools")} defaultValue={defaults.tools}>
          {Object.entries(TOOL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
