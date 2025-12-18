import StatusBadge from "./status-badge";
import styles from "./TopBar.module.css";

type Props = {
  cases: string[];
  selectedCase: string | null;
  onSelectCase: (id: string) => void;
  runStatus: string;
  onReoptimize: () => void;
  isRunning: boolean;
  solverHealth?: { mosek_import: boolean; mosek_license: boolean; solver_used: string | null; error?: string };
};

export default function TopBar({ cases, selectedCase, onSelectCase, runStatus, onReoptimize, isRunning, solverHealth }: Props) {
  const solverOk = solverHealth?.mosek_import && solverHealth?.mosek_license;
  const settingsNote = "Current settings: 5 beams, voxel ds [8,8,2], beamlet ds 8, MOSEK gap 10%, max time 600s";
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
          <span className={styles.solver}>
            Solver:{" "}
            <span className={solverOk ? styles.solverOk : styles.solverBad}>
              {solverOk ? "MOSEK ready" : solverHealth?.error ? "MOSEK unavailable" : "checking..."}
            </span>
          </span>
          <span className={styles.settingsNote}>{settingsNote}</span>
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
