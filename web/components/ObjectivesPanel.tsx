import { Objective } from "../lib/types";
import styles from "./ObjectivesPanel.module.css";

type Props = {
  objectives: Objective[];
  onChange: (next: Objective[]) => void;
};

export default function ObjectivesPanel({ objectives, onChange }: Props) {
  const update = (idx: number, patch: Partial<Objective>) => {
    const next = [...objectives];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const reset = (idx: number) => {
    const obj = objectives[idx];
    update(idx, {
      weight: obj.default_weight ?? obj.weight,
      dose_gy: obj.default_dose_gy ?? obj.dose_gy,
      dose_perc: obj.default_dose_perc ?? obj.dose_perc,
      volume_perc: obj.default_volume_perc ?? obj.volume_perc,
      volume_cc: obj.default_volume_cc ?? obj.volume_cc
    });
  };

  const prettyType = (type: string) =>
    type
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const targetLabel = (obj: Objective) => {
    const parts: string[] = [];
    if (obj.dose_gy !== undefined) parts.push(`${obj.dose_gy} Gy`);
    if (obj.dose_perc !== undefined) parts.push(`${obj.dose_perc}% Rx`);
    if (obj.volume_perc !== undefined) parts.push(`@ ${obj.volume_perc}% vol`);
    if (obj.volume_cc !== undefined) parts.push(`@ ${obj.volume_cc} cc`);
    return parts.join(" • ");
  };

  return (
    <div className="card">
      <div className="section-title">Structures & Objectives</div>
      <div className={styles.list}>
        {objectives.map((obj, idx) => (
          <div key={`${obj.structure_name}-${idx}`} className={styles.row}>
            <div className={styles.header}>
              <div className={styles.chip} style={{ background: obj.role === "target" ? "var(--accent)" : "#7b8ba1" }} />
              <div className={styles.name}>{obj.structure_name}</div>
              <span className={`${styles.tag} ${obj.role === "target" ? styles.tagTarget : styles.tagOar}`}>
                {obj.role.toUpperCase()}
              </span>
              <span className={styles.objType}>{prettyType(obj.type)}</span>
            </div>
            <div className={styles.controlsStack}>
              <div className={styles.sliderRow}>
                <div className={styles.sliderLabel}>
                  <span>Weight</span>
                  <span className={styles.sliderValue}>{obj.weight}</span>
                </div>
                <div className={styles.sliderShell}>
                  <input
                    className={styles.slider}
                    type="range"
                    min={0}
                    max={Math.max(500, (obj.default_weight ?? obj.weight ?? 0) * 4)}
                    step={Math.max(1, Math.round((obj.default_weight ?? obj.weight ?? 1) / 10))}
                    value={obj.weight}
                    onChange={(e) => update(idx, { weight: Number(e.target.value) })}
                  />
                  <div
                    className={styles.sliderTrack}
                    style={{
                      width: `${Math.min(
                        100,
                        (obj.weight / (Math.max(1, (obj.default_weight ?? obj.weight ?? 1) * 4))) * 100
                      )}%`
                    }}
                  />
                </div>
              </div>

              {obj.dose_gy !== undefined || obj.dose_perc !== undefined ? (
                <div className={styles.targetRow}>
                  <div className={styles.labelBlock}>
                    <div className={styles.label}>Target</div>
                    <div className={styles.targetHint}>{targetLabel(obj)}</div>
                  </div>
                  <div className={styles.targetInputs}>
                    <input
                      className={styles.number}
                      type="number"
                      value={(obj.dose_gy as number) ?? obj.dose_perc ?? ""}
                      onChange={(e) =>
                        update(
                          idx,
                          obj.dose_gy !== undefined ? { dose_gy: Number(e.target.value) } : { dose_perc: Number(e.target.value) }
                        )
                      }
                    />
                    <span className={styles.unit}>{obj.dose_gy !== undefined ? "Gy" : "% Rx"}</span>
                    {obj.volume_perc !== undefined || obj.volume_cc !== undefined ? (
                      <span className={styles.volumeBadge}>
                        {obj.volume_perc !== undefined ? `${obj.volume_perc}%` : `${obj.volume_cc} cc`}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className={styles.footer}>
              <button className={styles.reset} onClick={() => reset(idx)}>
                Reset to default
              </button>
              <div className={styles.targetHint}>{obj.volume_perc ? `Applies at ${obj.volume_perc}% volume` : "Dose-based objective"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
