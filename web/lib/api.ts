import { Objective, CaseManifest, RunArtifacts, RunStatus } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function fetchCases(): Promise<string[]> {
  const data = await http<{ cases: string[] }>("/cases");
  return data.cases;
}

export async function fetchCase(caseId: string): Promise<CaseManifest> {
  return http<CaseManifest>(`/cases/${caseId}`);
}

export async function startOptimize(config: any): Promise<{ run_id: string; status: RunStatus }> {
  return http<{ run_id: string; status: RunStatus }>("/optimize", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

export async function fetchRun(runId: string): Promise<{ run_id: string; status: RunStatus; artifacts?: RunArtifacts; error?: string }> {
  return http(`/runs/${runId}`);
}

export async function fetchRunLogs(runId: string): Promise<{ run_id: string; status: RunStatus; lines: string[] }> {
  return http(`/runs/${runId}/logs`);
}

export async function fetchRunProgress(runId: string): Promise<{ run_id: string; status: RunStatus; progress: any[] }> {
  return http(`/runs/${runId}/progress`);
}

export async function fetchSolverHealth(): Promise<{ mosek_import: boolean; mosek_license: boolean; solver_used: string | null; error?: string; license_file?: string }> {
  return http(`/health/solver`);
}

export async function ensurePatient(caseId: string): Promise<{ case_id: string; path: string }> {
  return http(`/ensure_patient/${caseId}`, { method: "POST" });
}

export async function fetchCtSlice(caseId: string, sliceIdx: number): Promise<any> {
  return http(`/cases/${caseId}/ct_slice/${sliceIdx}`);
}

export async function fetchReferenceDose(caseId: string): Promise<RunArtifacts & { case_id: string }> {
  return http(`/cases/${caseId}/reference_dose`);
}

export async function fetchDoseSlice(caseId: string, sliceIdx: number, thresholdGy?: number): Promise<{ slice_index: number; overlay_png: string; stats: any }> {
  const params = thresholdGy !== undefined ? `?threshold_gy=${encodeURIComponent(thresholdGy)}` : "";
  return http(`/cases/${caseId}/dose_slice/${sliceIdx}${params}`);
}

export async function fetchRunDoseSlice(runId: string, sliceIdx: number, thresholdGy?: number): Promise<{ slice_index: number; overlay_png: string; stats: any }> {
  const params = thresholdGy !== undefined ? `?threshold_gy=${encodeURIComponent(thresholdGy)}` : "";
  return http(`/runs/${runId}/dose_slice/${sliceIdx}${params}`);
}
