import type { Gender } from "@offai/core";

const SKIN = ["#f6d7c3", "#eec1a2", "#e0ac86", "#c98f6a"] as const;
const HAIR = ["#1f1a17", "#3b2a20", "#5a3b28", "#2a2a35"] as const;
const DIVISION_COLOR: Record<string, string> = {
  planning: "#e8a33d",
  product: "#3b6fd8",
  quality: "#7a5cd6",
  risk: "#d0533f",
  business: "#d9468f",
  operations: "#2f9a8a",
};
const FALLBACK_COLOR = "#6b7280";

/** 문자열에서 안정적인 정수를 얻는다 (같은 직원은 항상 같은 모습) */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Props = {
  seed: string;
  gender: Gender;
  name: string;
  divisionId?: string;
  size?: number;
  /** 팀장·본부장은 재킷을 입힌다 */
  senior?: boolean;
};

export function Avatar({ seed, gender, name, divisionId, size = 40, senior = false }: Props) {
  const h = hash(seed);
  const skin = SKIN[h % SKIN.length]!;
  const hair = HAIR[(h >> 3) % HAIR.length]!;
  const style = (h >> 6) % 3;
  const glasses = (h >> 9) % 4 === 0;
  const shirt = (divisionId && DIVISION_COLOR[divisionId]) || FALLBACK_COLOR;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={name} className="avatar">
      <circle cx="32" cy="32" r="32" className="avatar__bg" />
      {/* 몸 */}
      <path d="M10 66 C10 51 20 45 32 45 C44 45 54 51 54 66 Z" fill={shirt} />
      {senior && (
        <>
          <path d="M10 66 C10 51 20 45 32 45 L32 66 Z" fill="#000" opacity="0.18" />
          <path d="M28 45 L32 54 L36 45 Z" fill="#fff" opacity="0.9" />
        </>
      )}
      {/* 뒷머리: 몸 위, 얼굴 뒤 */}
      {gender === "female" && style === 0 && <path d="M17 30 C16 16 23 11 32 11 C41 11 48 16 47 30 L48 50 C44 52 40 51 38 49 L26 49 C24 51 20 52 16 50 Z" fill={hair} />}
      {gender === "female" && style === 1 && <path d="M18 29 C17 16 24 11.5 32 11.5 C40 11.5 47 16 46 29 L46.5 39 C42 41 22 41 17.5 39 Z" fill={hair} />}
      {gender === "female" && style === 2 && (
        <>
          <path d="M19 28 C18 16 25 12 32 12 C39 12 46 16 45 28 Z" fill={hair} />
          <ellipse cx="46.5" cy="24" rx="4.5" ry="9" transform="rotate(18 46.5 24)" fill={hair} />
        </>
      )}
      <rect x="28" y="36" width="8" height="10" rx="3" fill={skin} />
      {/* 얼굴 */}
      <ellipse cx="32" cy="27" rx="11" ry="12" fill={skin} />
      {/* 앞머리 */}
      {gender === "female" ? (
        <path d="M20.5 27 C19.5 16 25 12.5 32 12.5 C39 12.5 44.5 16 43.5 27 C41 20.5 35 18.5 29 20 C25.5 21 22.5 23.5 20.5 27 Z" fill={hair} />
      ) : style === 0 ? (
        <path d="M21 24 C20 15 26 12.5 32 12.5 C38 12.5 44 15 43 24 C41 19 37 17.5 32 17.5 C27 17.5 23 19 21 24 Z" fill={hair} />
      ) : style === 1 ? (
        <path d="M21 25 C19.5 15 25 12 32 12 C39.5 12 44.5 15.5 43 25 C42 19 39 16.5 34 17.5 C31 18 28 20 21 25 Z" fill={hair} />
      ) : (
        <path d="M21.5 22 C21.5 15.5 26 13.5 32 13.5 C38 13.5 42.5 15.5 42.5 22 C40 18.5 36 17 32 17 C28 17 24 18.5 21.5 22 Z" fill={hair} />
      )}
      {/* 눈·입 */}
      <circle cx="27.8" cy="28" r="1.3" fill="#2b2420" />
      <circle cx="36.2" cy="28" r="1.3" fill="#2b2420" />
      <path d="M29 33.2 Q32 35.4 35 33.2" stroke="#9a5a48" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {glasses && (
        <g stroke="#2b2420" strokeWidth="1.1" fill="none">
          <circle cx="27.8" cy="28" r="3.4" />
          <circle cx="36.2" cy="28" r="3.4" />
          <path d="M31.2 28 L32.8 28" />
        </g>
      )}
    </svg>
  );
}
