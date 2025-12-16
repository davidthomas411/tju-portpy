import styles from "./MetricsTable.module.css";

type Props = {
  metrics?: Record<string, Record<string, number>>;
};

const metricOrder = [
  { struct: "PTV", keys: ["D95", "D98", "D2"] },
  { struct: "ESOPHAGUS", keys: ["Dmean", "Dmax"] },
  { struct: "RECTUM", keys: ["Dmean", "Dmax", "D2cc"] },
  { struct: "BLADDER", keys: ["Dmean", "Dmax"] },
  { struct: "FEM_HEAD_L", keys: ["Dmax"] },
  { struct: "FEM_HEAD_R", keys: ["Dmax"] }
];

export default function MetricsTable({ metrics }: Props) {
  if (!metrics) return null;

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
          {metricOrder.map((row) =>
            row.keys.map((k, idx) => {
              const val = metrics[row.struct]?.[k];
              if (val === undefined) return null;
              return (
                <tr key={`${row.struct}-${k}`}>
                  {idx === 0 ? <td rowSpan={row.keys.length}>{row.struct}</td> : null}
                  <td>{k}</td>
                  <td>{val.toFixed(2)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
