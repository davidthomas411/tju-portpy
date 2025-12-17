import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";

type ProgressPoint = {
  iter?: number;
  pcost?: number;
  dcost?: number;
  gap?: number;
  pres?: number;
  dres?: number;
  runtime_seconds?: number;
  ts?: number;
};

type Props = {
  data: ProgressPoint[];
  status?: string;
};

export default function ProgressCharts({ data, status }: Props) {
  if (!data || data.length === 0) return null;
  const axisColor = "var(--muted)";
  const [nowTs, setNowTs] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!data.length) return;
    const done = status === "completed" || status === "failed";
    if (done) return;
    const id = setInterval(() => setNowTs(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [data.length, status]);
  const startTs = data.reduce((min, d) => (d.ts && d.ts < min ? d.ts : min), data[0]?.ts || nowTs);
  const latestTs = data.reduce((max, d) => (d.ts && d.ts > max ? d.ts : max), startTs);
  const endTs = status === "completed" || status === "failed" ? latestTs : Math.max(latestTs, nowTs);
  const elapsedSec = Math.max(0, endTs - startTs);
  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };
  const logTicks = (key: keyof ProgressPoint) => {
    const vals = data.map((d) => d[key] || 0).filter((v) => v > 0);
    if (!vals.length) return [];
    const minE = Math.floor(Math.log10(Math.min(...vals)));
    const maxE = Math.ceil(Math.log10(Math.max(...vals)));
    const ticks = [];
    for (let e = minE; e <= maxE; e++) {
      ticks.push(Math.pow(10, e));
    }
    return ticks;
  };
  const sci = (v: any) => {
    if (v === 0 || v === undefined || v === null) return v;
    const abs = Math.abs(Number(v));
    if (abs >= 1e4 || abs <= 1e-3) return Number(v).toExponential(1);
    return Number(v).toFixed(2);
  };
  const charts = [
    { title: "Gap", key: "gap", log: true },
    { title: "Primal residual", key: "pres", log: true },
    { title: "Dual residual", key: "dres", log: true },
    { title: "Objective", key: ["pcost", "dcost"], log: false },
    { title: "Runtime (s)", key: "runtime_seconds", log: false },
    { title: "Iter vs Runtime", key: "iter", log: false, xKey: "iter", yKey: "runtime_seconds" },
  ];

  const chartData = data.filter((d) => d.iter !== undefined);

  return (
    <div className="card">
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Solver Progress</span>
        <span style={{ color: "var(--accent-2)", fontSize: 12 }}>Elapsed: {fmtElapsed(elapsedSec)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {charts.map((c) => (
          <div key={c.title} style={{ background: "rgba(0,0,0,0.25)", borderRadius: 10, padding: 8, border: "1px solid var(--border)" }}>
            <div style={{ color: "var(--accent-2)", fontSize: 12, marginBottom: 4 }}>{c.title}</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey={c.xKey || "iter"}
                    stroke={axisColor}
                    tick={{ fill: axisColor, fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <YAxis
                    stroke={axisColor}
                    tick={{ fill: axisColor, fontSize: 11 }}
                    scale={c.log ? "log" : "linear"}
                    domain={
                      c.log
                        ? [
                            (chartData && chartData.length && logTicks(c.key as keyof ProgressPoint)[0]) || "auto",
                            (chartData && chartData.length && logTicks(c.key as keyof ProgressPoint).slice(-1)[0]) || "auto"
                          ]
                        : ["auto", "auto"]
                    }
                    ticks={c.log ? logTicks(c.key as keyof ProgressPoint) : undefined}
                    tickFormatter={c.log ? (v) => `1e${Math.log10(v)}` : sci}
                    allowDataOverflow
                  />
                  <Tooltip />
                  {Array.isArray(c.key)
                    ? c.key.map((k, idx) => (
                        <Line key={k} type="monotone" dataKey={k} stroke={idx === 0 ? "#66b8ff" : "#ff9f43"} dot={false} strokeWidth={2} />
                      ))
                    : c.yKey
                    ? (
                        <Line type="monotone" dataKey={c.yKey} stroke="#66b8ff" dot={false} strokeWidth={2} />
                      )
                    : (
                        <Line type="monotone" dataKey={c.key as string} stroke="#66b8ff" dot={false} strokeWidth={2} />
                      )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
