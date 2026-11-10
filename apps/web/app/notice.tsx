type Props = { saved?: string | string[] | undefined; error?: string | string[] | undefined; savedText?: string };

/** server action 뒤 redirect 쿼리(saved / error)를 안내 문구로 보여준다 */
export function Notice({ saved, error, savedText = "저장했습니다" }: Props) {
  const message = typeof error === "string" ? error : null;
  if (message) {
    return (
      <p className="notice notice--error" role="alert">
        {message}
      </p>
    );
  }
  if (saved) {
    return (
      <p className="notice" role="status">
        {savedText}
      </p>
    );
  }
  return null;
}

export function PreviewBanner() {
  return (
    <p className="notice notice--muted">
      미리보기 모드입니다. DATABASE_URL 이 없어 기본 조직을 읽기 전용으로 보여줍니다.
    </p>
  );
}
