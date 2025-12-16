export type Objective = {
  structure_name: string;
  type: string;
  weight: number;
  dose_gy?: number | string;
  dose_perc?: number;
  volume_perc?: number;
  volume_cc?: number;
  role: "target" | "oar";
  editable_weight?: boolean;
  editable_target?: boolean;
  default_weight?: number;
  default_dose_gy?: number | string;
  default_dose_perc?: number;
  default_volume_perc?: number;
  default_volume_cc?: number;
};

export type CaseManifest = {
  case_id: string;
  structures: string[];
  beams: { id: number; gantry_angle: number }[];
  objectives?: Objective[];
};

export type RunStatus = "queued" | "running" | "completed" | "failed" | "unknown";

export type RunArtifacts = {
  dvh?: Record<string, { dose_gy: number[]; volume_perc: number[] }>;
  metrics?: Record<string, Record<string, number>>;
  dose?: { dose_1d: number[]; path?: string };
  plan?: Record<string, any>;
};
