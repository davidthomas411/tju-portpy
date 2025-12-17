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

function toNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  const s = String(val);
  const m = s.match(/[-+]?[0-9]*\.?[0-9]+/);
  return m ? Number(m[0]) : null;
}

export default function ClinicalCriteriaBars({ criteria }: Props) {
  if (!criteria || criteria.length === 0) return null;

  // Merge duplicate V(xGy) rows per structure by folding limit/goal into one entry
  const merged: Row[] = [];
  const byKey: Record<string, Row> = {};
  criteria.forEach((row) => {
    const key = `${row["Constraint"] || ""}-${row["Structure Name"] || ""}`;
    if (!byKey[key]) {
      byKey[key] = { ...row };
    } else {
      const tgt = byKey[key];
      if (row.Limit !== undefined && row.Limit !== null) tgt.Limit = row.Limit;
      if (row.Goal !== undefined && row.Goal !== null) tgt.Goal = row.Goal;
      if (row["Plan Value"] !== undefined && row["Plan Value"] !== null) tgt["Plan Value"] = row["Plan Value"];
    }
  });
  Object.values(byKey).forEach((r) => merged.push(r));

  return (
    <div className="card">
      <div className="section-title">Clinical Criteria</div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 100px 100px 1fr", gap: 8, alignItems: "center", marginBottom: 4, fontSize: 12, color: "var(--muted)" }}>
        <div style={{ fontWeight: 600, color: "var(--text)" }}>Constraint</div>
        <div>Limit</div>
        <div>Goal</div>
        <div>Plan Value</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {merged.map((row, idx) => {
          const planVal = toNumber(row["Plan Value"]);
          const limitVal = toNumber(row.Limit);
          const goalValRaw = toNumber(row.Goal);
          const goalVal = goalValRaw !== null ? goalValRaw : limitVal; // if no goal, treat limit as goal so it's not all red
          const maxRef = Math.max(planVal || 0, limitVal || 0, goalVal || 0) || 1;
          const scale = 1.2; // leave headroom
          const widthPct = Math.min(100, (planVal || 0) / (maxRef * scale) * 100);
          const goalPct = goalVal ? (goalVal / (maxRef * scale)) * 100 : 0;
          const limitPct = limitVal ? (limitVal / (maxRef * scale)) * 100 : 0;
          let statusColor = "var(--muted)";
          if (planVal !== null && limitVal !== null) {
            if (planVal <= (goalVal ?? limitVal)) statusColor = "#8bc34a"; // green
            else if (planVal <= limitVal) statusColor = "#f6a623"; // orange
            else statusColor = "#ff5f6d"; // red
          }

          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "160px 100px 100px 1fr", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 12, color: statusColor }}>
                <div style={{ fontWeight: 600 }}>{row.Constraint || ""}</div>
                <div style={{ color: "var(--muted)" }}>{row["Structure Name"] || ""}</div>
              </div>
              <div style={{ fontSize: 12 }}>{row.Limit ?? ""}</div>
              <div style={{ fontSize: 12 }}>{row.Goal ?? ""}</div>
              <div style={{ position: "relative", height: 20, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    height: "100%",
                    width: `${goalPct}%`,
                    background: "linear-gradient(90deg, #9acd32, #7fbf23)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: `${goalPct}%`,
                    height: "100%",
                    width: `${Math.max(0, limitPct - goalPct)}%`,
                    background: "linear-gradient(90deg, #f6a623, #f39c12)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: `${limitPct}%`,
                    height: "100%",
                    right: 0,
                    background: "linear-gradient(90deg, #ff5f6d, #ff2d55)",
                  }}
                />
                {planVal !== null && (
                  <div
                    title={String(planVal)}
                    style={{
                      position: "absolute",
                      top: -2,
                      left: `${widthPct}%`,
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "6px solid transparent",
                      borderRight: "6px solid transparent",
                      borderTop: "8px solid var(--text)",
                    }}
                  />
                )}
                <div style={{ position: "absolute", right: 6, top: 0, bottom: 0, display: "flex", alignItems: "center", fontSize: 12 }}>
                  {planVal !== null ? planVal : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
