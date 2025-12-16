import { useEffect, useMemo, useState } from "react";
import { fetchCtSlice } from "../lib/api";
import styles from "./DoseViewer.module.css";

type Props = {
  dose?: { dose_1d?: number[]; path?: string };
  structures: string[];
  caseId?: string | null;
};

export default function DoseViewer({ dose, structures, caseId }: Props) {
  const [sliceIdx, setSliceIdx] = useState(60);
  const [ctSlice, setCtSlice] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ctSlice?.num_slices && sliceIdx >= ctSlice.num_slices) {
      setSliceIdx(Math.max(ctSlice.num_slices - 1, 0));
    }
  }, [ctSlice?.num_slices]);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    fetchCtSlice(caseId, sliceIdx)
      .then((res) => setCtSlice(res))
      .catch((err) => {
        console.error(err);
        setError(err.message);
        setCtSlice(null);
      })
      .finally(() => setLoading(false));
  }, [caseId, sliceIdx]);

  const doseStats = useMemo(() => {
    if (!dose?.dose_1d || dose.dose_1d.length === 0) return null;
    const max = Math.max(...dose.dose_1d);
    const mean = dose.dose_1d.reduce((acc, v) => acc + v, 0) / dose.dose_1d.length;
    return { max, mean };
  }, [dose]);

  return (
    <div className="card">
      <div className="section-title">Dose Viewer (Axial)</div>
      <div className={styles.viewport}>
        {ctSlice?.image_png ? (
          <div className={styles.readout}>
            <img className={styles.ctImage} src={ctSlice.image_png} alt={`CT slice ${sliceIdx}`} />
            <div className={styles.metaRow}>
              <div>Slice {ctSlice.slice_index + 1} / {ctSlice.num_slices}</div>
              <div>HU mean {ctSlice.stats?.mean_hu?.toFixed(1)}</div>
              <div>Window C {ctSlice.window?.center} / W {ctSlice.window?.width}</div>
            </div>
          </div>
        ) : loading ? (
          <div className={styles.placeholder}>Loading CT slice…</div>
        ) : (
          <div className={styles.placeholder}>
            {error
              ? `CT not available: ${error}`
              : "No CT slice loaded yet. Download case data and ensure slice index is within range."}
          </div>
        )}
      </div>
      <div className={styles.controls}>
        <label>Slice</label>
        <input
          type="range"
          min={0}
          max={ctSlice?.num_slices ? ctSlice.num_slices - 1 : 120}
          value={sliceIdx}
          onChange={(e) => setSliceIdx(Number(e.target.value))}
          disabled={!caseId}
        />
      </div>

      <div className={styles.sectionSplit} />

      <div className={styles.viewport}>
        {doseStats ? (
          <div className={styles.readout}>
            <div className={styles.stat}>
              <span>Mean</span>
              <strong>{doseStats.mean.toFixed(2)} Gy</strong>
            </div>
            <div className={styles.stat}>
              <span>Max</span>
              <strong>{doseStats.max.toFixed(2)} Gy</strong>
            </div>
            <div className={styles.downloadRow}>
              <div>Contours: {structures.slice(0, 4).join(", ") || "loading..."}</div>
              {dose?.path ? (
                <a className={styles.download} href={dose.path} download>
                  Download dose (npz)
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={styles.placeholder}>
            No dose loaded. Run optimization to preview axial dose and contours.
          </div>
        )}
      </div>

      {ctSlice?.debug ? (
        <div className={styles.debug}>
          <div>CT path: {ctSlice.debug.ct_path} ({ctSlice.debug.ct_exists ? "found" : "missing"})</div>
          <div>Folder contents: {ctSlice.debug.folder_listing?.join(", ") || "n/a"}</div>
          {ctSlice.debug.ct_keys ? <div>Datasets: {ctSlice.debug.ct_keys.join(", ")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
