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
  const settingsNote = "Current settings: 7 beams (11° step), voxel ds [2,2,1], beamlet ds 2, MOSEK gap 5%, max time 6h";
  const version = "Version 0.9.0";
  const changeLog = "Latest: per-plan DVH/clinical criteria recompute, coverage coloring, patient-run filtering.";
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
          <span className={styles.settingsNote}>{version} — {changeLog}</span>
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
