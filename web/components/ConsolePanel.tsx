import { useState, useRef, useEffect } from "react";

type Props = {
  lines: string[];
  title?: string;
};

export default function ConsolePanel({ lines, title = "Run Console" }: Props) {
  const [expanded, setExpanded] = useState(true);
  const containerRef = useAutoScroll(lines, expanded);
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {title}
        </div>
        <button onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12 }}>
          {expanded ? "Minimize" : "Expand"}
        </button>
      </div>
      {expanded ? (
        <div
          style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 10,
            minHeight: 200,
            maxHeight: 360,
            overflowY: "auto",
            fontFamily: "monospace",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.5,
            marginTop: 8
          }}
          ref={containerRef}
        >
          {lines.length === 0 ? (
            <div>Waiting for runs…</div>
          ) : (
            lines.map((line, idx) => <div key={idx}>{line}</div>)
          )}
        </div>
      ) : null}
    </div>
  );
}

function useAutoScroll(lines: string[], enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines, enabled]);
  return ref;
}
