import styles from "./status-badge.module.css";

type Props = { status: string };

export default function StatusBadge({ status }: Props) {
  const map: Record<string, string> = {
    running: styles.running,
    queued: styles.queued,
    completed: styles.completed,
    failed: styles.failed
  };
  const cls = map[status] || styles.unknown;
  return <span className={`${styles.badge} ${cls}`}>{status || "unknown"}</span>;
}
