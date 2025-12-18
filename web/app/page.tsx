 "use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fetchCases,
  fetchCase,
  startOptimize,
  fetchRun,
  ensurePatient,
  fetchReferenceDose,
  fetchRunLogs,
  fetchRunProgress,
  fetchSolverHealth,
  fetchRunsList
} from "../lib/api";
import { Objective, RunArtifacts, RunStatus, RunSummary } from "../lib/types";
import TopBar from "../components/TopBar";
import ObjectivesPanel from "../components/ObjectivesPanel";
import DVHChart from "../components/DVHChart";
import DoseViewer from "../components/DoseViewer";
import RunComparison from "../components/RunComparison";
import EnsurePatient from "../components/EnsurePatient";
import ConsolePanel from "../components/ConsolePanel";
import PrescriptionPane from "../components/PrescriptionPane";
import ProgressCharts from "../components/ProgressCharts";
import ClinicalCriteriaBars from "../components/ClinicalCriteriaBars";
import styles from "./page.module.css";

export default function HomePage() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <HomePageInner />
    </QueryClientProvider>
  );
}

function HomePageInner() {
  const qc = useQueryClient();
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runsHistory, setRunsHistory] = useState<Record<string, RunArtifacts>>({});
  const [runSummaries, setRunSummaries] = useState<Record<string, RunSummary>>({});
  const [displayPlanId, setDisplayPlanId] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<RunStatus>("unknown");
  const [ensuring, setEnsuring] = useState(false);
  const [ensureMsg, setEnsureMsg] = useState<string | undefined>(undefined);
  const [loadingReference, setLoadingReference] = useState(false);
  const [referenceError, setReferenceError] = useState<string | undefined>(undefined);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(380);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<any[]>([]);
  const [solverHealth, setSolverHealth] = useState<any | null>(null);
  const [voxelDs, setVoxelDs] = useState<[number, number, number]>([2, 2, 1]);
  const [voxelDsText, setVoxelDsText] = useState<string>("2,2,1");
  const [beamletDs, setBeamletDs] = useState<number>(2);
  const [beamIdsText, setBeamIdsText] = useState<string>("");
  const [maxTime, setMaxTime] = useState<number>(21600); // seconds
  const [gap, setGap] = useState<number>(0.05);
  const [referenceLoaded, setReferenceLoaded] = useState<boolean>(false);
  const appendConsole = (line: string) =>
    setConsoleLines((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()}  ${line}`]);

  // Fetch cases list
  const casesQuery = useQuery({
    queryKey: ["cases"],
    queryFn: fetchCases
  });

  // Fetch manifest for selected case
  const caseQuery = useQuery({
    queryKey: ["case", selectedCase],
    queryFn: () => fetchCase(selectedCase!),
    enabled: !!selectedCase
  });

  const runsListQuery = useQuery({
    queryKey: ["runs-list", selectedCase],
    queryFn: () => fetchRunsList(selectedCase || undefined),
    enabled: !!selectedCase
  });

  // Auto-select first case when loaded
  useEffect(() => {
    if (!selectedCase && casesQuery.data && casesQuery.data.length > 0) {
      setSelectedCase(casesQuery.data[0]);
    }
  }, [casesQuery.data, selectedCase]);

  useEffect(() => {
    // clear run context when switching cases
    setRunId(null);
    setRunsHistory({});
    setRunSummaries({});
    setDisplayPlanId(null);
    setPollStatus("unknown");
    setReferenceError(undefined);
    setLogRunId(null);
    setConsoleLines([]);
    setReferenceLoaded(false);
  }, [selectedCase]);

  // Seed objectives when case manifest arrives (placeholder defaults)
  useEffect(() => {
    if (caseQuery.data?.objectives) {
      const seeds = caseQuery.data.objectives.map((obj) => ({
        ...obj,
        default_weight: obj.default_weight ?? obj.weight,
        default_dose_gy: obj.default_dose_gy ?? obj.dose_gy,
        default_dose_perc: obj.default_dose_perc ?? obj.dose_perc
      }));
      setObjectives(seeds);
    } else if (caseQuery.data && caseQuery.data.structures) {
      const seeds = (caseQuery.data.structures || [])
        .filter((s) => ["PTV", "ESOPHAGUS", "HEART", "CORD", "LUNG_R", "LUNG_L"].includes(s))
        .map<Objective>((name, idx) => ({
          structure_name: name,
          type: "quadratic",
          weight: 10,
          role: name.startsWith("PTV") ? "target" : "oar",
          editable_weight: true
        }));
      setObjectives(seeds);
    }
  }, [caseQuery.data?.case_id]);

  useEffect(() => {
    if (runsListQuery.data) {
      const summaries: Record<string, RunSummary> = {};
      runsListQuery.data
        .filter((r) => !selectedCase || r.patient_id === selectedCase)
        .forEach((r) => {
          summaries[r.run_id] = r;
          if (!runsHistory[r.run_id]) {
            fetchRun(r.run_id).then((res) => {
              if (res.artifacts) {
                setRunsHistory((prev) => ({ ...prev, [r.run_id]: res.artifacts! }));
              }
            });
          }
        });
      setRunSummaries(summaries);
    }
  }, [runsListQuery.data, runsHistory, selectedCase]);

  // Auto-load reference once per case
  useEffect(() => {
    const refKey = selectedCase ? `${selectedCase}-reference` : null;
    if (!selectedCase || referenceLoaded) return;
    setLoadingReference(true);
    loadReferenceDose()
      .then(() => {
        setReferenceLoaded(true);
        if (refKey) setDisplayPlanId(refKey);
      })
      .catch(() => setReferenceLoaded(false))
      .finally(() => setLoadingReference(false));
  }, [selectedCase, referenceLoaded]);

  // Mutation: start optimization
  const optimizeMutation = useMutation({
    mutationFn: (config: any) => startOptimize(config),
    onSuccess: (res) => {
      setRunId(res.run_id);
      setPollStatus(res.status);
      appendConsole(`Run ${res.run_id} queued`);
      setLogRunId(res.run_id);
      pollRun(res.run_id);
    }
  });

  const pollRun = async (id: string) => {
    let keepPolling = true;
    let lastStatus: RunStatus | null = null;
    while (keepPolling) {
      const res = await fetchRun(id);
      setPollStatus(res.status);
      if (res.status !== lastStatus) {
        appendConsole(`Run ${id} status: ${res.status}`);
        lastStatus = res.status;
      }
      if (res.status === "completed" && res.artifacts) {
        setRunsHistory((prev) => ({ ...prev, [id]: res.artifacts! }));
        if (res.artifacts?.config) {
          setRunSummaries((prev) => ({
            ...prev,
            [id]: { run_id: id, patient_id: res.artifacts?.config?.patient_id, status: "completed", config: res.artifacts.config }
          }));
        }
        setDisplayPlanId(id);
        keepPolling = false;
      } else if (res.status === "failed") {
        if (res.error) appendConsole(`Run ${id} error: ${res.error}`);
        keepPolling = false;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    qc.invalidateQueries({ queryKey: ["runs"] });
  };

  const loadReferenceDose = async () => {
    if (!selectedCase) return;
    setLoadingReference(true);
    setReferenceError(undefined);
    try {
      const res = await fetchReferenceDose(selectedCase);
      const runKey = `${selectedCase}-reference`;
      const artifacts: RunArtifacts = {
        dvh: res.dvh,
        metrics: res.metrics,
        dose: res.dose,
        plan: res.plan,
        clinical_criteria: (res as any).clinical_criteria
      };
      setRunsHistory((prev) => ({ ...prev, [runKey]: artifacts }));
      setRunId(runKey);
      setPollStatus("completed");
      appendConsole(`Reference dose loaded for ${selectedCase}`);
      setLogRunId(runKey);
    } catch (e: any) {
      console.error(e);
      setReferenceError(e?.message || String(e));
      appendConsole(`Reference dose failed: ${e?.message || e}`);
    } finally {
      setLoadingReference(false);
    }
  };

  const latestRun = useMemo<RunArtifacts | null>(() => {
    if (runId && runsHistory[runId]) return runsHistory[runId];
    return null;
  }, [runId, runsHistory]);
  // Preferred plan to display (clinical/dose/DVH)
  const displayPlan = useMemo<RunArtifacts | null>(() => {
    if (displayPlanId && runsHistory[displayPlanId]) return runsHistory[displayPlanId];
    const refKey = selectedCase ? `${selectedCase}-reference` : null;
    if (refKey && runsHistory[refKey]) return runsHistory[refKey];
    if (latestRun) return latestRun;
    // fall back to any run in history
    const first = Object.values(runsHistory)[0];
    return first || null;
  }, [displayPlanId, runsHistory, latestRun, selectedCase]);

  useEffect(() => {
    // auto-select a plan to display when history changes
    const refKey = selectedCase ? `${selectedCase}-reference` : null;
    if (!displayPlanId) {
      if (refKey && runsHistory[refKey]) {
        setDisplayPlanId(refKey);
      } else if (latestRun && runId && runsHistory[runId]) {
        setDisplayPlanId(runId);
      }
    }
  }, [displayPlanId, runsHistory, latestRun, runId, selectedCase]);
  const planForDisplay =
    latestRun?.plan ||
    (caseQuery.data
      ? {
          prescription_gy: caseQuery.data.prescription_gy,
          num_fractions: caseQuery.data.num_fractions,
          beam_ids: caseQuery.data.beams?.map((b) => b.id)
        }
      : null);

  // When case metadata is available, seed beam IDs and voxel text
  useEffect(() => {
    if (caseQuery.data?.beams?.length) {
      const ids = caseQuery.data.beams.map((b) => b.id);
      setBeamIdsText(ids.join(","));
    }
    setVoxelDsText(voxelDs.join(","));
  }, [caseQuery.data]);

  const handleSelectPlan = async (id: string | null) => {
    setDisplayPlanId(id);
    if (id && !runsHistory[id]) {
      try {
        const res = await fetchRun(id);
        if (res.artifacts) {
          setRunsHistory((prev) => ({ ...prev, [id]: res.artifacts! }));
        }
      } catch (e) {
        console.error("Failed to fetch run", id, e);
      }
    }
  };

  // Ensure clinical criteria are present for the selected plan
  useEffect(() => {
    const id = displayPlanId;
    if (!id) return;
    const artifacts = runsHistory[id];
    if (artifacts && artifacts.clinical_criteria) return;
    fetchRun(id)
      .then((res) => {
        if (res.artifacts) {
          setRunsHistory((prev) => ({ ...prev, [id]: res.artifacts! }));
        }
      })
      .catch(() => {});
  }, [displayPlanId, runsHistory]);

  // Poll run logs when a run is active
  useEffect(() => {
    if (!logRunId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchRunLogs(logRunId);
        if (res.lines && res.lines.length > 0) {
          setConsoleLines(res.lines);
        }
        if (res.status === "completed" || res.status === "failed") {
          clearInterval(interval);
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [logRunId]);

  // Poll run progress
  useEffect(() => {
    if (!logRunId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchRunProgress(logRunId);
        if (res.progress && res.progress.length > 0) {
          setProgress(res.progress);
        }
        if (res.status === "completed" || res.status === "failed") {
          clearInterval(interval);
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [logRunId]);

  // Fetch solver health on load
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchSolverHealth();
        setSolverHealth(res);
      } catch (e) {
        setSolverHealth({ error: String(e) });
      }
    })();
  }, []);

  // draggable splitters for panels
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging || !gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      if (dragging === "left") {
        const newW = e.clientX - rect.left;
        setLeftWidth(Math.min(Math.max(newW, 220), 520));
      } else if (dragging === "right") {
        const newW = rect.right - e.clientX;
        setRightWidth(Math.min(Math.max(newW, 260), 700));
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div className={styles.page}>
      <TopBar
        cases={casesQuery.data || []}
        selectedCase={selectedCase}
        onSelectCase={(id) => setSelectedCase(id)}
        runStatus={pollStatus}
        solverHealth={solverHealth}
        onReoptimize={() =>
          optimizeMutation.mutate({
            patient_id: selectedCase,
            voxel_down_sample_factors: voxelDs,
            beamlet_down_sample_factor: beamletDs,
            beam_ids: (() => {
              const parsed = beamIdsText
                .split(",")
                .map((p) => parseInt(p.trim(), 10))
                .filter((n) => Number.isFinite(n));
              if (parsed.length) return parsed;
              return caseQuery.data?.beams?.map((b) => b.id);
            })(),
            solver: "MOSEK",
            mosek_params: {
              MSK_DPAR_MIO_MAX_TIME: maxTime,
              MSK_DPAR_MIO_TOL_REL_GAP: gap
            },
            objective_overrides: objectives.map((o) => ({
              structure_name: o.structure_name,
              type: o.type,
              weight: o.weight,
              dose_gy: o.dose_gy,
              dose_perc: o.dose_perc
            }))
          })
        }
        isRunning={pollStatus === "running" || pollStatus === "queued"}
      />

      <div className={styles.grid} style={{ gridTemplateColumns: `${leftWidth}px 8px 1fr 8px ${rightWidth}px` }} ref={gridRef}>
        <div className={styles.left}>
          <EnsurePatient
            ensuring={ensuring}
            caseId={selectedCase}
            message={ensureMsg}
            onEnsure={async () => {
              if (!selectedCase) return;
              setEnsuring(true);
              setEnsureMsg("Requesting download...");
              appendConsole(`Ensure patient ${selectedCase} requested`);
              try {
                const resp = await ensurePatient(selectedCase);
                setEnsureMsg(`Download/refresh completed: ${resp.path}`);
                appendConsole(`Ensure patient ${selectedCase} completed`);
                await qc.invalidateQueries({ queryKey: ["cases"] });
                await qc.invalidateQueries({ queryKey: ["case", selectedCase] });
              } catch (e) {
                console.error(e);
                setEnsureMsg(String(e));
                appendConsole(`Ensure patient ${selectedCase} failed: ${String(e)}`);
              } finally {
                setEnsuring(false);
              }
            }}
          />
          <ConsolePanel lines={consoleLines} />
          <ObjectivesPanel objectives={objectives} onChange={setObjectives} />
        </div>

        <div
          className={styles.handle}
          onMouseDown={() => setDragging("left")}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left panel"
        />

        <div className={styles.center}>
          <PrescriptionPane plan={planForDisplay} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>Displayed Plan</div>
            <select
              value={displayPlanId || ""}
              onChange={(e) => handleSelectPlan(e.target.value || null)}
              style={{ padding: 6, borderRadius: 8, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              <option value="">Latest</option>
              {(() => {
                const refKey = selectedCase ? `${selectedCase}-reference` : null;
                const refOption = refKey ? (
                  <option key={refKey} value={refKey}>
                    {refKey} (reference{runsHistory[refKey] ? "" : " - load to view"})
                  </option>
                ) : null;
                const sorted = Object.keys(runSummaries)
                  .filter((id) => {
                    if (refKey && id === refKey) return false;
                    const summary = runSummaries[id];
                    return !selectedCase || summary?.patient_id === selectedCase;
                  })
                  .sort((a, b) => {
                    const aTime = runSummaries[a]?.created || a;
                    const bTime = runSummaries[b]?.created || b;
                    return aTime < bTime ? 1 : -1;
                  });
                const options = sorted.map((id) => {
                  const summary = runSummaries[id];
                  const cfg = summary?.config || (runsHistory[id] as any)?.config;
                  const labelParts = [];
                  if (cfg?.voxel_down_sample_factors) labelParts.push(`ds ${cfg.voxel_down_sample_factors.join("x")}`);
                  if (cfg?.beamlet_down_sample_factor) labelParts.push(`bl ${cfg.beamlet_down_sample_factor}`);
                  if (cfg?.mosek_params?.MSK_DPAR_MIO_MAX_TIME)
                    labelParts.push(`t ${Math.round((cfg.mosek_params.MSK_DPAR_MIO_MAX_TIME / 3600) * 10) / 10}h`);
                  return (
                    <option key={id} value={id}>
                      {labelParts.length ? `${id} (${labelParts.join(", ")})` : id}
                    </option>
                  );
                });
                return (
                  <>
                    {refOption}
                    {options}
                  </>
                );
              })()}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Voxel ds</label>
            <input
              type="text"
              value={voxelDsText}
              onChange={(e) => {
                const txt = e.target.value;
                setVoxelDsText(txt);
                const parts = txt
                  .split(",")
                  .map((p) => parseInt(p.trim(), 10))
                  .filter((n) => Number.isFinite(n));
                if (parts.length === 3) setVoxelDs([parts[0], parts[1], parts[2]]);
              }}
              style={{ padding: 6, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Beamlet ds</label>
            <input
              type="number"
              min={1}
              value={beamletDs}
              onChange={(e) => setBeamletDs(parseInt(e.target.value || "1", 10))}
              style={{ padding: 6, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Max time (h)</label>
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={Math.round((maxTime / 3600) * 10) / 10}
              onChange={(e) => setMaxTime(Math.max(0, parseFloat(e.target.value || "0")) * 3600)}
              style={{ padding: 6, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
            <label style={{ fontSize: 12, color: "var(--muted)" }}>MOSEK gap</label>
            <input
              type="number"
              min={0.0}
              step={0.01}
              value={gap}
              onChange={(e) => setGap(parseFloat(e.target.value || "0") || 0)}
              style={{ padding: 6, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Beam IDs</label>
            <input
              type="text"
              placeholder="0,11,22,33,44,55,66"
              value={beamIdsText}
              onChange={(e) => setBeamIdsText(e.target.value)}
              style={{ padding: 6, borderRadius: 6, background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border)" }}
            />
          </div>
          <DVHChart dvh={displayPlan?.dvh} selected={objectives.map((o) => o.structure_name)} />
          <ClinicalCriteriaBars
            criteria={
              displayPlan?.clinical_criteria ||
              latestRun?.clinical_criteria ||
              (selectedCase ? runsHistory[`${selectedCase}-reference`]?.clinical_criteria : null) ||
              []
            }
            dvh={displayPlan?.dvh}
          />
          <ProgressCharts data={progress} status={pollStatus} />
          <RunComparison runs={runsHistory} />
        </div>

        <div
          className={styles.handle}
          onMouseDown={() => setDragging("right")}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
        />

        <div className={styles.right}>
          <DoseViewer
            dose={displayPlan?.dose}
            structures={caseQuery.data?.structures || []}
            caseId={selectedCase}
            onLoadReference={loadReferenceDose}
            loadingReference={loadingReference}
            referenceError={referenceError}
            selectedPlanId={displayPlanId}
            selectedPlanIsReference={displayPlanId ? displayPlanId.includes("reference") : true}
          />
        </div>
      </div>
    </div>
  );
}
