import { useEffect, useMemo, useState } from "react";
import { fetchCtSlice, fetchDoseSlice, fetchRunDoseSlice } from "../lib/api";
import { DoseInfo } from "../lib/types";
import styles from "./DoseViewer.module.css";

type Props = {
  dose?: DoseInfo;
  structures: string[];
  caseId?: string | null;
  onLoadReference?: () => void;
  loadingReference?: boolean;
  referenceError?: string;
  selectedPlanId?: string | null;
  selectedPlanIsReference?: boolean;
};

export default function DoseViewer({
  dose,
  structures,
  caseId,
  onLoadReference,
  loadingReference,
  referenceError,
  selectedPlanId,
  selectedPlanIsReference
}: Props) {
  const [sliceIdx, setSliceIdx] = useState(60);
  const [ctSlice, setCtSlice] = useState<any | null>(null);
  const [doseOverlay, setDoseOverlay] = useState<{ overlay_png: string; stats?: any } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doseError, setDoseError] = useState<string | null>(null);
  const [thresholdGy, setThresholdGy] = useState<number>(0);

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

  useEffect(() => {
    if (!caseId && !selectedPlanId) {
      setDoseOverlay(null);
      return;
    }
    setDoseError(null);
    const loader = selectedPlanId && !selectedPlanIsReference
      ? fetchRunDoseSlice(selectedPlanId, sliceIdx, thresholdGy)
      : fetchDoseSlice(caseId!, sliceIdx, thresholdGy);
    loader
      .then((res) => setDoseOverlay(res))
      .catch((err) => {
        console.error(err);
        setDoseOverlay(null);
        setDoseError(err.message);
      });
  }, [caseId, sliceIdx, thresholdGy, selectedPlanId, selectedPlanIsReference]);

  const doseStats = useMemo(() => {
    if (dose?.stats?.mean_gy !== undefined && dose?.stats?.max_gy !== undefined) {
      return { max: dose.stats.max_gy, mean: dose.stats.mean_gy };
    }
    if (!dose?.dose_1d || dose.dose_1d.length === 0) return null;
    const max = Math.max(...dose.dose_1d);
    const mean = dose.dose_1d.reduce((acc, v) => acc + v, 0) / dose.dose_1d.length;
    return { max, mean };
  }, [dose]);

  return (
    <div className="card">
      <div className={styles.header}>
        <div className="section-title">Dose Viewer (Axial)</div>
        <button
          className={styles.action}
          onClick={() => onLoadReference?.()}
          disabled={!caseId || loadingReference || !onLoadReference}
        >
          {loadingReference ? "Loading prior plan/dose…" : "Load prior plan/dose"}
        </button>
      </div>
      <div className={styles.viewport}>
        {ctSlice?.image_png ? (
          <div className={styles.readout}>
            <div className={styles.overlayWrap}>
              <img className={styles.ctImage} src={ctSlice.image_png} alt={`CT slice ${sliceIdx}`} />
              {doseOverlay?.overlay_png ? (
                <img className={styles.overlayImage} src={doseOverlay.overlay_png} alt="Dose overlay" />
              ) : null}
              {selectedPlanId && !selectedPlanIsReference ? (
                <div className={styles.note}>Showing optimized dose overlay</div>
              ) : null}
              <div className={styles.threshold}>
                <label>Threshold (Gy)</label>
                <div className={styles.thresholdControls}>
                  <input
                    type="number"
                    value={thresholdGy}
                    min={0}
                    max={1000}
                    step={0.5}
                    onChange={(e) => setThresholdGy(Number(e.target.value) || 0)}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(Math.ceil(doseOverlay?.stats?.max_gy || 80), 80)}
                    step={0.5}
                    value={thresholdGy}
                    onChange={(e) => setThresholdGy(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
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
            {dose?.source ? <div className={styles.metaRow}>Source: {dose.source}</div> : null}
          </div>
        ) : (
          <div className={styles.placeholder}>
            No dose loaded. Run optimization or load the prior plan/dose.
          </div>
        )}
      </div>

      {referenceError ? <div className={styles.placeholder}>{referenceError}</div> : null}
      {doseError && !doseOverlay ? <div className={styles.placeholder}>Dose overlay unavailable: {doseError}</div> : null}

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
