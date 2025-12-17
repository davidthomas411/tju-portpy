type Row = {
  Constraint?: string;
  "Structure Name"?: string;
  Limit?: string | number | null;
  Goal?: string | number | null;
  "Plan Value"?: string | number | null;
};

type Props = {
  criteria?: Row[];
};

export default function ClinicalCriteriaTable({ criteria }: Props) {
  if (!criteria || criteria.length === 0) return null;
  const headers = ["Constraint", "Structure", "Limit", "Goal", "Plan Value"];
  return (
    <div className="card">
      <div className="section-title">Clinical Criteria</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px" }}>{row.Constraint || ""}</td>
                <td style={{ padding: "6px 8px" }}>{row["Structure Name"] || ""}</td>
                <td style={{ padding: "6px 8px" }}>{row.Limit ?? ""}</td>
                <td style={{ padding: "6px 8px" }}>{row.Goal ?? ""}</td>
                <td style={{ padding: "6px 8px", color: "var(--accent)" }}>{row["Plan Value"] ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
