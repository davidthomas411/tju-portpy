import { Line, LineChart, Tooltip, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import styles from "./DVHChart.module.css";

type DVH = Record<string, { dose_gy: number[]; volume_perc: number[] }>;

type Props = {
  dvh?: DVH;
  selected: string[];
};

const palette = ["#1d5fa7", "#2d9d78", "#c0392b", "#f4a261", "#6c5ce7", "#2c3e50", "#8e44ad"];

export default function DVHChart({ dvh, selected }: Props) {
  const curves = dvh || {};
  const structNames =
    (selected && selected.length ? selected.filter((n) => curves[n]) : Object.keys(curves)) || Object.keys(curves);

  // Prepare entries and bail early if nothing usable
  const entries = structNames
    .map((name) => {
      const dose = curves[name]?.dose_gy || [];
      const vol = curves[name]?.volume_perc || [];
      return { name, dose, vol };
    })
    .filter((e) => e.dose.length > 0 && e.vol.length > 0);
  if (entries.length === 0) {
    return (
      <div className="card">
        <div className="section-title">Dose Volume Histogram</div>
        <div className={styles.chart}>
          <div className={styles.empty}>No DVH yet — run an optimization to view dose/volume curves.</div>
        </div>
      </div>
    );
  }

  // Build a unified dose axis from all dose points
  const allDosePoints = Array.from(
    new Set(
      entries
        .flatMap((e) => e.dose.map((d) => Number(d)))
        .filter((d) => Number.isFinite(d))
    )
  ).sort((a, b) => a - b);

  const rows = allDosePoints.map((doseVal) => {
    const row: any = { dose: doseVal };
    entries.forEach((e) => {
      // linear interpolate nearest segment
      let v = e.vol[e.vol.length - 1];
      for (let i = 0; i < e.dose.length; i++) {
        if (doseVal <= Number(e.dose[i])) {
          if (i === 0) {
            v = e.vol[0];
          } else {
            const d0 = Number(e.dose[i - 1]);
            const d1 = Number(e.dose[i]);
            const v0 = e.vol[i - 1];
            const v1 = e.vol[i];
            const t = d1 === d0 ? 0 : (doseVal - d0) / (d1 - d0);
            v = v0 + t * (v1 - v0);
          }
          break;
        }
      }
      row[e.name] = v;
    });
    return row;
  });

  const maxDoseRaw = allDosePoints.length ? allDosePoints[allDosePoints.length - 1] : 0;
  const maxDose = Math.max(10, Math.ceil(maxDoseRaw / 10) * 10);
  const doseTicks: number[] = [];
  for (let d = 0; d <= maxDose; d += 10) doseTicks.push(d);

  const axisColor = "var(--muted)";
  const hasData = rows.length > 0 && entries.length > 0;

  return (
    <div className="card">
      <div className="section-title">Dose Volume Histogram</div>
      <div className={styles.chart}>
        {hasData ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={rows} margin={{ top: 12, right: 140, bottom: 48, left: 64 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="dose"
                type="number"
                stroke={axisColor}
                tick={{ fill: axisColor, fontSize: 12 }}
                tickFormatter={(v) => (v != null ? Math.round(v).toString() : "")}
                allowDecimals={false}
                domain={[0, maxDose]}
                ticks={doseTicks}
                interval={0}
                tickMargin={12}
                padding={{ left: 10, right: 10 }}
                label={{ value: "Dose (Gy)", position: "outsideBottom", offset: 8, fill: axisColor }}
              />
              <YAxis
                stroke={axisColor}
                tick={{ fill: axisColor }}
                label={{ value: "Volume (%)", angle: -90, position: "insideLeft", offset: 10, fill: axisColor }}
                domain={[0, 100]}
              />
              <Tooltip formatter={(v: any) => (v != null && !isNaN(v) ? Number(v).toFixed(2) : v)} />
              <Legend
                wrapperStyle={{ color: axisColor }}
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="circle"
              />
              {structNames.map((name, idx) => {
                const isAlt = name.trim().endsWith("(B)");
                return (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={palette[idx % palette.length]}
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray={isAlt ? "6 4" : undefined}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>No DVH yet — run an optimization to view dose/volume curves.</div>
        )}
      </div>
    </div>
  );
}
