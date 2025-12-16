import StatusBadge from "./status-badge";
import styles from "./TopBar.module.css";

type Props = {
  cases: string[];
  selectedCase: string | null;
  onSelectCase: (id: string) => void;
  runStatus: string;
  onReoptimize: () => void;
  isRunning: boolean;
};

export default function TopBar({ cases, selectedCase, onSelectCase, runStatus, onReoptimize, isRunning }: Props) {
  return (
    <div className={`${styles.bar} card`}>
      <div className={styles.left}>
        <div className={styles.title}>PortPy VMAT Planner</div>
        <div className={styles.controls}>
          <label className={styles.label}>Case</label>
          <select className={styles.select} value={selectedCase || ""} onChange={(e) => onSelectCase(e.target.value)}>
            {cases.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <StatusBadge status={runStatus} />
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.buttonSecondary}>Load Run</button>
        <button className={styles.buttonSecondary}>Save Run</button>
        <button className={styles.buttonPrimary} onClick={onReoptimize} disabled={isRunning}>
          {isRunning ? "Optimizing…" : "Re-optimize"}
        </button>
      </div>
    </div>
  );
}
