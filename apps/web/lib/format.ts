import { formatUsd, type ModelId } from "@offai/core";

export { formatUsd };

export const MODEL_LABEL: Record<ModelId, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}
