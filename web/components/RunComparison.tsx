import { useMemo, useState } from "react";
import styles from "./RunComparison.module.css";
import DVHChart from "./DVHChart";
import { RunArtifacts } from "../lib/types";

type Props = {
  runs: Record<string, RunArtifacts>;
};

export default function RunComparison({ runs }: Props) {
  const runIds = Object.keys(runs);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  const dvh = useMemo(() => {
    const merged: any = {};
    if (a && runs[a]?.dvh) {
      Object.entries(runs[a].dvh!).forEach(([k, v]) => (merged[`${k} (A)`] = v));
    }
    if (b && runs[b]?.dvh) {
      Object.entries(runs[b].dvh!).forEach(([k, v]) => (merged[`${k} (B)`] = v));
    }
    return merged;
  }, [a, b, runs]);

  return (
    <div className="card">
      <div className="section-title">Run Comparison</div>
      <div className={styles.pickers}>
        <div className={styles.selector}>
          <label>Run A</label>
          <select value={a || ""} onChange={(e) => setA(e.target.value || null)}>
            <option value="">Select</option>
            {runIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.selector}>
          <label>Run B</label>
          <select value={b || ""} onChange={(e) => setB(e.target.value || null)}>
            <option value="">Select</option>
            {runIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      </div>
      <DVHChart dvh={dvh} selected={Object.keys(dvh)} />
    </div>
  );
}
