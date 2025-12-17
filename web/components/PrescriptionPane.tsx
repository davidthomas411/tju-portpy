type Props = {
  plan?: {
    prescription_gy?: number;
    num_fractions?: number;
    patient_id?: string;
    beam_ids?: number[];
    source?: string;
  } | null;
};

export default function PrescriptionPane({ plan }: Props) {
  const total = plan?.prescription_gy;
  const fx = plan?.num_fractions;
  const perFx = total && fx ? total / fx : undefined;
  const beams = plan?.beam_ids ? plan.beam_ids.length : undefined;

  return (
    <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
      <div className="section-title" style={{ margin: 0 }}>
        Prescription
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
        <Info label="Total (Gy)" value={total ? total.toFixed(1) : "—"} />
        <Info label="Fractions" value={fx ?? "—"} />
        <Info label="Per fraction" value={perFx ? perFx.toFixed(2) + " Gy" : "—"} />
        <Info label="Beam control points" value={beams ?? "—"} />
        <Info label="Patient" value={plan?.patient_id ?? "—"} />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ color: "var(--muted)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "var(--text)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
