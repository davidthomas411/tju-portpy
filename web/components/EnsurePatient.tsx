import styles from "./EnsurePatient.module.css";

type Props = {
  onEnsure: () => void;
  ensuring: boolean;
  caseId?: string | null;
  message?: string;
};

export default function EnsurePatient({ onEnsure, ensuring, caseId, message }: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.copy}>
        <div className={styles.title}>Case data</div>
        <div className={styles.subtitle}>
          Download CT, structures, and beams for {caseId || "this case"} so DVH/dose previews can render locally.
        </div>
      </div>
      <button className={styles.button} onClick={onEnsure} disabled={ensuring || !caseId}>
        {ensuring ? "Downloading…" : "Download / refresh"}
      </button>
      {message ? <div className={styles.msg}>{message}</div> : null}
    </div>
  );
}
