import type { ClosingPause } from "./model";
import type { Store } from "./store";

export const reopenedMockUwmAtSql = (loanId: string) => `(SELECT max(json_extract(condition.value, '$.mockReopenedAt'))
  FROM submissions file JOIN json_each(CASE WHEN json_valid(file.conditions) THEN file.conditions ELSE '[]' END) condition
  WHERE file.loanId = ${loanId} AND file.lender = 'UWM' AND file.syncedAt IS NOT NULL
    AND json_extract(condition.value, '$.satisfiedAt') IS NULL)`;

export function readClosingPauses(db: Store, loanIds: string[]) {
  const holds = new Map<string, ClosingPause>();
  if (!loanIds.length) return holds;
  const rows = db.prepare(`SELECT loan.id, profile.closingDate, ${reopenedMockUwmAtSql("loan.id")} AS since
    FROM json_each(?) selected JOIN loans loan ON loan.id = selected.value
    LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id
    WHERE loan.stage = 'Clear to Close' AND progress.fundingDate IS NULL`).all(JSON.stringify(loanIds));
  for (const { id, closingDate, since } of rows) {
    if (typeof since === "string" && since) holds.set(String(id), { label: closingDate ? "Funding on hold" : "Closing on hold", since });
  }
  return holds;
}

export function initializeProcessingConditions(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS processing_open_conditions (
    submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    conditionId TEXT NOT NULL, title TEXT NOT NULL, openedAt TEXT, reopenedAt TEXT, manualOwner TEXT,
    PRIMARY KEY(submissionId, conditionId)
  );
  CREATE INDEX IF NOT EXISTS processing_conditions_by_age
    ON processing_open_conditions(openedAt, submissionId, conditionId) WHERE openedAt IS NOT NULL;
  CREATE INDEX IF NOT EXISTS uwm_condition_openings_by_time ON uwm_alerts(submissionId, conditionId, detectedAt DESC)
    WHERE conditionId IS NOT NULL;`);
  const existingColumns = new Set(db.prepare("PRAGMA table_info(processing_open_conditions)").all().map(({ name }) => name));
  if (!existingColumns.has("reopenedAt")) db.exec("ALTER TABLE processing_open_conditions ADD COLUMN reopenedAt TEXT");
  if (!existingColumns.has("manualOwner")) db.exec("ALTER TABLE processing_open_conditions ADD COLUMN manualOwner TEXT");
  db.exec(`CREATE INDEX IF NOT EXISTS processing_conditions_by_reopening
    ON processing_open_conditions(substr(reopenedAt, 1, 10), submissionId, conditionId) WHERE reopenedAt IS NOT NULL;`);
  const items = "json_each(CASE WHEN json_valid(file.conditions) THEN file.conditions ELSE '[]' END) item";
  const open = `json_type(item.value, '$.id') = 'text' AND json_extract(item.value, '$.satisfiedAt') IS NULL
    AND (file.syncedAt IS NOT NULL OR json_extract(item.value, '$.manual') IS NOT NULL)`;
  const opening = `json_extract(item.value, '$.mockReopenedAt'), json_extract(item.value, '$.manual.openedAt'),
    (SELECT max(alert.detectedAt) FROM uwm_alerts alert WHERE alert.submissionId = file.id
      AND alert.conditionId = json_extract(item.value, '$.id'))`;
  const lastReopening = (submission: string, condition: string) => `(SELECT CASE kind WHEN 'Reopened condition' THEN detectedAt END
    FROM uwm_alerts WHERE submissionId = ${submission} AND conditionId = ${condition} AND kind IN ('New condition', 'Reopened condition')
    ORDER BY detectedAt DESC, rowid DESC LIMIT 1)`;
  const reopened = `coalesce(json_extract(item.value, '$.mockReopenedAt'), json_extract(item.value, '$.manual.reopenedAt'),
    ${lastReopening("file.id", "json_extract(item.value, '$.id')")})`;
  const columns = "(submissionId, conditionId, title, openedAt, reopenedAt, manualOwner)";
  const owner = "json_extract(item.value, '$.manual.owner')";
  const identity = "file.id, json_extract(item.value, '$.id'), coalesce(json_extract(item.value, '$.category'), 'Lender condition')";
  const reconcile = `
    DELETE FROM processing_open_conditions WHERE submissionId = NEW.id AND conditionId NOT IN (
      SELECT json_extract(item.value, '$.id') FROM submissions file JOIN ${items} WHERE file.id = NEW.id AND ${open}
    );
    INSERT INTO processing_open_conditions ${columns}
    SELECT ${identity}, coalesce(${opening}, file.syncedAt), ${reopened}, ${owner}
      FROM submissions file JOIN ${items} WHERE file.id = NEW.id AND ${open}
    ON CONFLICT(submissionId, conditionId) DO UPDATE SET title = excluded.title, reopenedAt = excluded.reopenedAt, manualOwner = excluded.manualOwner
      WHERE title <> excluded.title OR reopenedAt IS NOT excluded.reopenedAt OR manualOwner IS NOT excluded.manualOwner;`;
  if (db.prepare("SELECT count(*) AS versions FROM settings WHERE key IN ('processingConditionsV1', 'processingConditionsV2')").get()?.versions !== 2) {
    db.exec(`DROP TRIGGER IF EXISTS processing_conditions_insert;
      DROP TRIGGER IF EXISTS processing_conditions_update;
      INSERT INTO processing_open_conditions ${columns}
      SELECT ${identity}, coalesce(${opening}), ${reopened}, ${owner} FROM submissions file JOIN ${items} WHERE ${open}
      ON CONFLICT(submissionId, conditionId) DO UPDATE SET reopenedAt = excluded.reopenedAt, manualOwner = excluded.manualOwner;
      INSERT OR IGNORE INTO settings VALUES ('processingConditionsV1', '1'), ('processingConditionsV2', '1');`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS processing_conditions_insert AFTER INSERT ON submissions BEGIN ${reconcile} END;
    CREATE TRIGGER IF NOT EXISTS processing_conditions_update AFTER UPDATE OF conditions, syncedAt ON submissions BEGIN ${reconcile} END;
    CREATE TRIGGER IF NOT EXISTS processing_conditions_alert AFTER INSERT ON uwm_alerts
      WHEN NEW.kind IN ('New condition', 'Reopened condition') AND NEW.conditionId IS NOT NULL BEGIN
        UPDATE processing_open_conditions SET reopenedAt = ${lastReopening("NEW.submissionId", "NEW.conditionId")}
          WHERE submissionId = NEW.submissionId AND conditionId = NEW.conditionId;
      END;`);
}
