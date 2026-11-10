import type { Metadata } from "next";
import Link from "next/link";
import { STAGES, STAGE_LABEL, STATUS_LABEL, findTeam, leadOf, type Org } from "@offai/core";
import { Avatar } from "@/components/avatar";
import { AutoRefresh } from "@/components/auto-refresh";
import { getOrg, getProjects, isPreview, type ProjectTask } from "@/lib/data";
import { formatDate, formatUsd } from "@/lib/format";
import { PreviewBanner } from "../notice";

export const metadata: Metadata = { title: "프로젝트" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const org = await getOrg();
  const projects = await getProjects(org.repos);
  const live = projects.some((project) => project.active.some((task) => task.status === "running"));

  return (
    <div className="bleed">
      <div className="page-head">
        <div>
          <h1>프로젝트</h1>
          <p className="muted">레포마다 진행 중인 지시와, 지금 어느 팀의 누가 무엇을 하고 있는지 보여줍니다.</p>
        </div>
        <AutoRefresh active={live} />
      </div>
      {isPreview() && <PreviewBanner />}

      <div className="projects">
        {projects.map((project) => (
          <section key={project.repo} className="project" aria-labelledby={`p-${project.repo}`}>
            <header className="project__head">
              <h2 id={`p-${project.repo}`}>
                <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer">
                  {project.repo}
                </a>
              </h2>
              <span className="muted">
                진행 {project.active.length} · 완료 {project.doneCount}
              </span>
            </header>
            {project.active.length === 0 ? (
              <p className="muted">진행 중인 지시가 없습니다.</p>
            ) : (
              <ul className="project__tasks">
                {project.active.map((task) => (
                  <ProjectRow key={task.id} task={task} org={org} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ProjectRow({ task, org }: { task: ProjectTask; org: Org }) {
  const ref = task.teamId ? findTeam(org, task.teamId) : undefined;
  const actor = task.lastActivity?.actorRoleId ? ref?.team.roles.find((role) => role.id === task.lastActivity?.actorRoleId) : undefined;
  const face = actor ?? (ref ? leadOf(ref.team) : undefined);
  const stageIndex = STAGES.indexOf(task.stage);

  return (
    <li className="project-task">
      <div className="project-task__top">
        <Link href={`/tasks/${task.id}`} className="task__title">
          {task.issueNumber !== null && `#${task.issueNumber} `}
          {task.title}
        </Link>
        <span className="muted">{STATUS_LABEL[task.status]}</span>
      </div>
      <ol className="stepper" aria-label="진행 단계">
        {STAGES.map((stage, index) => (
          <li key={stage} className={index < stageIndex ? "is-done" : index === stageIndex ? "is-current" : undefined}>
            {STAGE_LABEL[stage]}
          </li>
        ))}
      </ol>
      <div className="project-task__now">
        {face && ref && <Avatar seed={face.id} gender={face.person.gender} name={face.person.name} divisionId={ref.division.id} size={28} senior={face.rank === "팀장"} />}
        <p>
          {ref ? (
            <>
              <strong>{ref.team.name}</strong>
              {face && ` ${face.person.name} ${face.rank}`}
            </>
          ) : (
            "담당 팀 배정 전"
          )}
          {task.lastActivity && <span className="project-task__activity"> — {task.lastActivity.detail.split("\n")[0]}</span>}
        </p>
        <span className="muted small-meta">
          {formatUsd(task.spentCents)}
          {task.lastActivity && ` · ${formatDate(task.lastActivity.at)}`}
        </span>
      </div>
    </li>
  );
}
