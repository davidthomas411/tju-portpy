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
  fetchSolverHealth
} from "../lib/api";
import { Objective, RunArtifacts, RunStatus } from "../lib/types";
import TopBar from "../components/TopBar";
import ObjectivesPanel from "../components/ObjectivesPanel";
import DVHChart from "../components/DVHChart";
import MetricsTable from "../components/MetricsTable";
import DoseViewer from "../components/DoseViewer";
import RunComparison from "../components/RunComparison";
import EnsurePatient from "../components/EnsurePatient";
import ConsolePanel from "../components/ConsolePanel";
import PrescriptionPane from "../components/PrescriptionPane";
import ProgressCharts from "../components/ProgressCharts";
import ClinicalCriteriaTable from "../components/ClinicalCriteriaTable";
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
    setPollStatus("unknown");
    setReferenceError(undefined);
    setLogRunId(null);
    setConsoleLines([]);
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
        plan: res.plan
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
          <PrescriptionPane plan={latestRun?.plan || null} />
          <DVHChart dvh={latestRun?.dvh} selected={objectives.map((o) => o.structure_name)} />
          <MetricsTable metrics={latestRun?.metrics} />
          <ClinicalCriteriaTable criteria={latestRun?.clinical_criteria} />
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
            dose={latestRun?.dose}
            structures={caseQuery.data?.structures || []}
            caseId={selectedCase}
            onLoadReference={loadReferenceDose}
            loadingReference={loadingReference}
            referenceError={referenceError}
          />
        </div>
      </div>
    </div>
  );
}
