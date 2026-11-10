/** 전역 Git 규칙(브랜치, 커밋, PR 형식)을 코드로 고정한다. */

export const BRANCH_TYPES = ["feat", "fix", "refactor", "chore", "docs", "test", "perf", "ci"] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

const LABEL_TO_TYPE: Record<string, BranchType> = {
  "✨ feature": "feat",
  "🐛 bug": "fix",
  "♻️ refactor": "refactor",
  "🔧 maintenance": "chore",
  "📝 documentation": "docs",
  "🔒 security": "fix",
};

export function branchTypeFor(labels: readonly string[]): BranchType {
  for (const label of labels) {
    const type = LABEL_TO_TYPE[label];
    if (type) return type;
  }
  return "feat";
}

/** 영문/숫자만 남겨 짧은 slug를 만든다. 한글 제목이면 "task"를 쓴다. */
export function slugify(title: string, maxLength = 32): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "task";
}

export function branchName(input: { issueNumber: number; title: string; labels: readonly string[] }): string {
  return `${branchTypeFor(input.labels)}/${input.issueNumber}-${slugify(input.title)}`;
}

export function prTitle(issueNumber: number, description: string): string {
  return `🔀 :: (#${issueNumber}) ${description}`;
}

export type PrBody = { cause: string[]; changes: string[]; verification: string[]; notes: string[]; issueNumber: number };

export function prBody(body: PrBody): string {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "-");
  return [
    "## 원인",
    list(body.cause),
    "",
    "## 수정",
    list(body.changes),
    "",
    "## 검증",
    list(body.verification),
    "",
    "## 비고",
    list(body.notes),
    "",
    "---",
    `Closes #${body.issueNumber}`,
  ].join("\n");
}

const PROTECTED = new Set(["main", "master"]);

export function isProtectedBranch(name: string): boolean {
  return PROTECTED.has(name.replace(/^refs\/heads\//, ""));
}
