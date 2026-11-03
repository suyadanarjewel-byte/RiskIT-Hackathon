"use client";

import type { AuditLogEntry } from "../../lib/types";
import { useI18n } from "../I18nProvider";
import { useFormat } from "../ui";

/** Readable audit trail; the raw entries (original AI output, findings, decisions) are expandable. */
export function AuditLog({ entries }: { entries: AuditLogEntry[] }) {
  const { t } = useI18n();
  const fmt = useFormat();
  return (
    <section className="card" aria-labelledby="audit-title">
      <h2 id="audit-title">{t("audit.title")}</h2>
      <p className="src">{t("audit.sub")}</p>
      <details className="audit">
        <summary>{t("audit.show", { n: entries.length })}</summary>
        <div className="table-wrap">
          <table className="review audit-table">
            <thead><tr><th scope="col">UTC</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmt.when(e.timestamp)}</td>
                  <td>{e.actor.type}<div className="src">{e.actor.id}</div></td>
                  <td><code>{e.action}</code></td>
                  <td><details><summary className="src">JSON</summary><pre>{JSON.stringify(e.details, null, 2)}</pre></details></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
