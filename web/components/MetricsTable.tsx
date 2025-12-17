import styles from "./MetricsTable.module.css";

type Props = {
  metrics?: Record<string, Record<string, number>>;
};

const preferredOrder = ["PTV", "ESOPHAGUS", "CORD", "HEART", "LUNG_L", "LUNG_R", "RECTUM", "BLADDER", "FEM_HEAD_L", "FEM_HEAD_R"];

export default function MetricsTable({ metrics }: Props) {
  if (!metrics || Object.keys(metrics).length === 0) return null;

  const structs = Array.from(
    new Set([
      ...preferredOrder.filter((s) => metrics[s]),
      ...Object.keys(metrics).filter((s) => !preferredOrder.includes(s))
    ])
  );

  return (
    <div className="card">
      <div className="section-title">Key Metrics</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Structure</th>
            <th>Metric</th>
            <th>Value (Gy)</th>
          </tr>
        </thead>
        <tbody>
          {structs.map((struct) => {
            const entries = Object.entries(metrics[struct] || {});
            if (entries.length === 0) return null;
            return entries.map(([k, val], idx) => (
              <tr key={`${struct}-${k}`}>
                {idx === 0 ? <td rowSpan={entries.length}>{struct}</td> : null}
                <td>{k}</td>
                <td>{val.toFixed(2)}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
