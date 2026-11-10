import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <p className="empty__title">찾는 페이지가 없습니다</p>
      <Link href="/">조직도로 돌아가기</Link>
    </div>
  );
}
