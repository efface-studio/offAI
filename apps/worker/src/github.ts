import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export type RepoRef = { owner: string; repo: string };

export function parseRepo(fullName: string): RepoRef {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`레포 이름 형식이 아닙니다: ${fullName}`);
  return { owner, repo };
}

/**
 * GitHub App 설치 토큰으로 동작하는 클라이언트.
 * 앱은 브랜치 보호 규칙의 bypass 목록에 넣지 않는다. 그래야 merge가 사람에게만 남는다.
 */
export class GitHub {
  private readonly app: Octokit;
  private readonly installations = new Map<string, number>();

  constructor(private readonly credentials: { appId: string; privateKey: string }) {
    this.app = new Octokit({ authStrategy: createAppAuth, auth: credentials });
  }

  private async installationId(fullName: string): Promise<number> {
    const cached = this.installations.get(fullName);
    if (cached) return cached;
    const { data } = await this.app.rest.apps.getRepoInstallation(parseRepo(fullName));
    this.installations.set(fullName, data.id);
    return data.id;
  }

  /** 레포 범위 클라이언트 */
  async forRepo(fullName: string): Promise<Octokit> {
    const installationId = await this.installationId(fullName);
    return new Octokit({ authStrategy: createAppAuth, auth: { ...this.credentials, installationId } });
  }

  /** 에이전트 세션의 github_repository 리소스에 넘길 단기 토큰 */
  async installationToken(fullName: string): Promise<string> {
    const installationId = await this.installationId(fullName);
    const auth = createAppAuth({ ...this.credentials, installationId });
    const result = await auth({ type: "installation" });
    return result.token;
  }

  async findOpenPr(fullName: string, branch: string): Promise<number | null> {
    const client = await this.forRepo(fullName);
    const { owner, repo } = parseRepo(fullName);
    const { data } = await client.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open", per_page: 1 });
    return data[0]?.number ?? null;
  }

  async branchExists(fullName: string, branch: string): Promise<boolean> {
    const client = await this.forRepo(fullName);
    try {
      await client.rest.repos.getBranch({ ...parseRepo(fullName), branch });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async createPr(
    fullName: string,
    input: { title: string; body: string; head: string; base: string; labels: string[]; assignee: string },
  ): Promise<number> {
    const client = await this.forRepo(fullName);
    const ref = parseRepo(fullName);
    const { data } = await client.rest.pulls.create({ ...ref, title: input.title, body: input.body, head: input.head, base: input.base });
    if (input.labels.length > 0) {
      await client.rest.issues.addLabels({ ...ref, issue_number: data.number, labels: input.labels });
    }
    await client.rest.issues.addAssignees({ ...ref, issue_number: data.number, assignees: [input.assignee] });
    return data.number;
  }

  async comment(fullName: string, issueNumber: number, body: string): Promise<void> {
    const client = await this.forRepo(fullName);
    await client.rest.issues.createComment({ ...parseRepo(fullName), issue_number: issueNumber, body });
  }

  async createIssue(fullName: string, input: { title: string; body: string; labels: string[]; assignee: string }): Promise<number> {
    const client = await this.forRepo(fullName);
    const { data } = await client.rest.issues.create({
      ...parseRepo(fullName),
      title: input.title,
      body: input.body,
      labels: input.labels,
      assignees: [input.assignee],
    });
    return data.number;
  }

  async changedFiles(fullName: string, prNumber: number): Promise<string[]> {
    const client = await this.forRepo(fullName);
    const files = await client.paginate(client.rest.pulls.listFiles, { ...parseRepo(fullName), pull_number: prNumber, per_page: 100 });
    return files.map((file) => file.filename);
  }

  async defaultBranch(fullName: string): Promise<string> {
    const client = await this.forRepo(fullName);
    const { data } = await client.rest.repos.get(parseRepo(fullName));
    return data.default_branch;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status: unknown }).status === 404;
}
