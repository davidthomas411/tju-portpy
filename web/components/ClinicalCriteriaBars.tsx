type Row = {
  Constraint?: string;
  "Structure Name"?: string;
  Limit?: string | number | null;
  Goal?: string | number | null;
  "Plan Value"?: string | number | null;
};

type Props = {
  criteria?: Row[];
  dvh?: Record<string, { dose_gy: number[]; volume_perc: number[] }>;
};

function toNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  const s = String(val);
  const m = s.match(/[-+]?[0-9]*\.?[0-9]+/);
  return m ? Number(m[0]) : null;
}

function volumeAtDose(structName: string, doseGy: number, dvh?: Record<string, { dose_gy: number[]; volume_perc: number[] }>) {
  if (!dvh || !dvh[structName]) return null;
  const doses = dvh[structName].dose_gy || [];
  const vols = dvh[structName].volume_perc || [];
  if (!doses.length || !vols.length) return null;
  for (let i = 0; i < doses.length; i++) {
    if (doses[i] >= doseGy) {
      return vols[i];
    }
  }
  return vols[vols.length - 1] ?? null;
}

function meanDose(structName: string, dvh?: Record<string, { dose_gy: number[]; volume_perc: number[] }>) {
  if (!dvh || !dvh[structName]) return null;
  const doses = dvh[structName].dose_gy || [];
  const vols = dvh[structName].volume_perc || [];
  if (doses.length < 2) return null;
  let area = 0;
  for (let i = 0; i < doses.length - 1; i++) {
    const d0 = doses[i];
    const d1 = doses[i + 1];
    const v0 = vols[i] / 100;
    const v1 = vols[i + 1] / 100;
    area += ((v0 + v1) / 2) * (d1 - d0);
  }
  return area;
}

function maxDose(structName: string, dvh?: Record<string, { dose_gy: number[]; volume_perc: number[] }>) {
  if (!dvh || !dvh[structName]) return null;
  const doses = dvh[structName].dose_gy || [];
  if (!doses.length) return null;
  return doses[doses.length - 1];
}

export default function ClinicalCriteriaBars({ criteria, dvh }: Props) {
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
          let planVal = toNumber(row["Plan Value"]);
          // Derive plan value from DVH when missing
          if (planVal === null && dvh) {
            const constraintText = (row.Constraint || "").toLowerCase();
            const struct = row["Structure Name"] || "";
            const doseMatch = constraintText.match(/v\(([\d\.]+)\s*gy\)/i);
            if (doseMatch) {
              const doseGy = parseFloat(doseMatch[1]);
              const vol = volumeAtDose(struct, doseGy, dvh);
              if (vol !== null && vol !== undefined) planVal = vol;
            } else if (constraintText.includes("mean")) {
              const md = meanDose(struct, dvh);
              if (md !== null) planVal = md;
            } else if (constraintText.includes("max")) {
              const mx = maxDose(struct, dvh);
              if (mx !== null) planVal = mx;
            }
          }
          const limitVal = toNumber(row.Limit);
          const goalValRaw = toNumber(row.Goal);
          const goalVal = goalValRaw !== null ? goalValRaw : limitVal; // if no goal, treat limit as goal so it's not all red
          const maxRef = Math.max(planVal || 0, limitVal || 0, goalVal || 0) || 1;
          const scale = 1.2; // leave headroom
          const planPct = Math.min(100, (planVal || 0) / (maxRef * scale) * 100);
          const goalPct = goalVal ? (goalVal / (maxRef * scale)) * 100 : 0;
          const limitPct = limitVal ? (limitVal / (maxRef * scale)) * 100 : 0;
          const nameUpper = (row["Structure Name"] || "").toUpperCase();
          const constraintText = (row.Constraint || "").toLowerCase();
          const isTarget = ["PTV", "GTV", "CTV", "ITV"].some((t) => nameUpper.includes(t));
          const isCoverage =
            isTarget &&
            (constraintText.includes("coverage") ||
              constraintText.includes("dose_volume") ||
              constraintText.includes("v(")); // only targets use higher-is-better for V()
          let statusColor = "var(--muted)";
          if (planVal !== null && (limitVal !== null || goalVal !== null)) {
            const tgt = goalVal ?? limitVal ?? 0;
            const lim = limitVal ?? goalVal ?? tgt;
            if (isCoverage) {
              // For coverage, higher is better
              const limThresh = lim ?? tgt;
              if (planVal >= tgt) {
                statusColor = "#8bc34a";
              } else if (planVal >= limThresh) {
                statusColor = "#f6a623";
              } else {
                statusColor = "#ff5f6d";
              }
            } else {
              // For OAR limits, lower is better
              if (planVal <= tgt) statusColor = "#8bc34a";
              else if (planVal <= lim) statusColor = "#f6a623";
              else statusColor = "#ff5f6d";
            }
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
                {isCoverage ? (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        height: "100%",
                        width: `${limitPct}%`,
                        background: "linear-gradient(90deg, #ff5f6d, #ff2d55)"
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: `${limitPct}%`,
                        height: "100%",
                        width: `${Math.max(0, goalPct - limitPct)}%`,
                        background: "linear-gradient(90deg, #f6a623, #f39c12)"
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: `${goalPct}%`,
                        height: "100%",
                        right: 0,
                        background: "linear-gradient(90deg, #9acd32, #7fbf23)"
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        height: "100%",
                        width: `${goalPct}%`,
                        background: "linear-gradient(90deg, #9acd32, #7fbf23)"
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: `${goalPct}%`,
                        height: "100%",
                        width: `${Math.max(0, limitPct - goalPct)}%`,
                        background: "linear-gradient(90deg, #f6a623, #f39c12)"
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: `${limitPct}%`,
                        height: "100%",
                        right: 0,
                        background: "linear-gradient(90deg, #ff5f6d, #ff2d55)"
                      }}
                    />
                  </>
                )}
                {planVal !== null && (
                  <div
                    title={String(planVal)}
                    style={{
                      position: "absolute",
                      top: -2,
                      left: `${planPct}%`,
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
