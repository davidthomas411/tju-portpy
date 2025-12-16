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

export async function ensurePatient(caseId: string): Promise<{ case_id: string; path: string }> {
  return http(`/ensure_patient/${caseId}`, { method: "POST" });
}

export async function fetchCtSlice(caseId: string, sliceIdx: number): Promise<any> {
  return http(`/cases/${caseId}/ct_slice/${sliceIdx}`);
}
