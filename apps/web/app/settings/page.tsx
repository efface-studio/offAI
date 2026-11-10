import type { Metadata } from "next";
import { STAGES, STAGE_LABEL } from "@offai/core";
import { getOrgWithVersion, isPreview } from "@/lib/data";
import { addTeam, removeTeam, updateSettings } from "../actions";
import { Notice, PreviewBanner } from "../notice";

export const metadata: Metadata = { title: "설정" };

type Props = { searchParams: Promise<{ saved?: string; error?: string }> };

export default async function SettingsPage({ searchParams }: Props) {
  const [{ org, version }, query] = await Promise.all([getOrgWithVersion(), searchParams]);
  const readOnly = isPreview();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>설정</h1>
          <p className="muted">조직 설정 v{version}. 저장할 때마다 새 버전이 기록되고, worker가 바뀐 역할만 에이전트에 반영합니다.</p>
        </div>
      </div>
      {readOnly ? <PreviewBanner /> : <Notice saved={query.saved} error={query.error} />}

      <form action={updateSettings}>
        <fieldset disabled={readOnly} className="team-form__fields">
          <section className="panel" aria-labelledby="general">
            <h2 id="general">작업 범위</h2>
            <label className="field">
              <span>대상 레포 (한 줄에 하나, owner/name)</span>
              <textarea name="repos" rows={3} defaultValue={org.repos.join("\n")} required />
            </label>
            <p className="muted small">보안·법무 검토가 붙는 경로는 각 팀 화면의 &lsquo;참여 경로&rsquo;에서 정합니다.</p>
            <label className="field field--narrow">
              <span>검증 실패 후 재구현 한도</span>
              <input name="maxReworks" type="number" min="0" max="5" defaultValue={org.maxReworks} required />
            </label>
          </section>

          <section className="panel" aria-labelledby="divisions">
            <h2 id="divisions">본부</h2>
            <ul className="division-settings">
              {org.divisions.map((division) => (
                <li key={division.id} className="grid-6">
                  <label className="field">
                    <span>본부 이름</span>
                    <input name={`division.${division.id}.name`} defaultValue={division.name} required maxLength={40} />
                  </label>
                  <label className="field">
                    <span>임무</span>
                    <input name={`division.${division.id}.mission`} defaultValue={division.mission} required maxLength={200} />
                  </label>
                  <label className="field">
                    <span>본부장</span>
                    <input name={`division.${division.id}.headName`} defaultValue={division.head.name} required maxLength={20} />
                  </label>
                  <label className="field">
                    <span>본부장 경력 (년)</span>
                    <input name={`division.${division.id}.headYears`} type="number" min="0" max="50" defaultValue={division.head.years} required />
                  </label>
                  <label className="field">
                    <span>본부장 성별</span>
                    <select name={`division.${division.id}.headGender`} defaultValue={division.head.gender}>
                      <option value="female">여성</option>
                      <option value="male">남성</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>월 예산 (USD)</span>
                    <input
                      name={`division.${division.id}.budget`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      defaultValue={(division.monthlyBudgetCents / 100).toFixed(2)}
                      required
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>

          {!readOnly && (
            <div className="form-actions">
              <button type="submit" className="button button--primary">
                설정 저장
              </button>
            </div>
          )}
        </fieldset>
      </form>

      {!readOnly && (
        <section className="panel" aria-labelledby="teams">
          <h2 id="teams">팀 추가·삭제</h2>
          <form action={addTeam} className="form">
            <div className="grid-4">
              <label className="field">
                <span>본부</span>
                <select name="divisionId">
                  {org.divisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>팀 ID</span>
                <input name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="mobile" />
              </label>
              <label className="field">
                <span>팀 이름</span>
                <input name="name" required maxLength={40} placeholder="Mobile팀" />
              </label>
              <label className="field">
                <span>단계</span>
                <select name="stage">
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABEL[stage]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid-4">
              <label className="field">
                <span>참여 방식</span>
                <select name="assignment">
                  <option value="primary">주 담당</option>
                  <option value="conditional">조건부</option>
                </select>
              </label>
              <label className="field">
                <span>전문 분야</span>
                <input name="domain" maxLength={60} placeholder="모바일 앱 개발" />
              </label>
              <label className="field">
                <span>label (쉼표로 구분)</span>
                <input name="labels" placeholder="📱 ios" />
              </label>
              <label className="field">
                <span>팀장 이름</span>
                <input name="leadName" required maxLength={20} />
              </label>
              <label className="field">
                <span>팀장 성별</span>
                <select name="leadGender">
                  <option value="female">여성</option>
                  <option value="male">남성</option>
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="button">
                팀 추가
              </button>
            </div>
          </form>

          <ul className="team-list">
            {org.divisions.flatMap((division) =>
              division.teams.map((team) => (
                <li key={team.id}>
                  <span>
                    {division.name} · <strong>{team.name}</strong> · {STAGE_LABEL[team.stage]}
                    {team.assignment === "conditional" ? " (조건부)" : ""} · {team.roles.length}명
                  </span>
                  <form action={removeTeam}>
                    <input type="hidden" name="teamId" value={team.id} />
                    <button type="submit" className="button button--ghost">
                      삭제
                    </button>
                  </form>
                </li>
              )),
            )}
          </ul>
        </section>
      )}
    </>
  );
}
