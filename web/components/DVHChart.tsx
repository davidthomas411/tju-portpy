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
  const structNames = selected.filter((n) => curves[n]) || Object.keys(curves);
  const maxLen = Math.max(...structNames.map((n) => curves[n]?.dose_gy?.length || 0), 0);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const row: any = {};
    structNames.forEach((name) => {
      row["dose"] = curves[name].dose_gy[i] ?? row["dose"];
      row[name] = curves[name].volume_perc[i];
    });
    rows.push(row);
  }

  const axisColor = "var(--muted)";
  const hasData = rows.length > 0 && structNames.length > 0;

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
                stroke={axisColor}
                tick={{ fill: axisColor }}
                tickFormatter={(v) => (v != null ? Math.round(v) : "")}
                allowDecimals={false}
                label={{ value: "Dose (Gy)", position: "insideBottom", offset: -20, fill: axisColor }}
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
              {structNames.map((name, idx) => (
                <Line key={name} type="monotone" dataKey={name} stroke={palette[idx % palette.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.empty}>No DVH yet — run an optimization to view dose/volume curves.</div>
        )}
      </div>
    </div>
  );
}
