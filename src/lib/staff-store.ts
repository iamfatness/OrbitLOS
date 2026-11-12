import type { Store } from "./store";
import { workspaceGuide, type Brokerage } from "./brokerage-model";

export interface StaffIdentity {
  email: string;
  name: string;
}

export type WorkspaceStaff = StaffIdentity & { brokerage: Brokerage };

export interface StaffEmailProof {
  email: string;
  brokerageId: string | null;
  browserHash: string;
  codeHash: string;
  now: number;
}

export interface GoogleAttempt {
  state: string;
  browserHash: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  brokerageId: string | null;
  guide: ReturnType<typeof workspaceGuide>;
}

export interface StaffAuthStore {
  startGoogle(attempt: GoogleAttempt, now: number): Promise<void>;
  consumeGoogle(state: string, browserHash: string, now: number): Promise<Pick<GoogleAttempt, "nonce" | "verifier" | "brokerageId" | "guide"> | null>;
  createStaffSession(tokenHash: string, identity: StaffIdentity, expiresAt: number, now: number, method?: "google" | "email"): Promise<void>;
  getStaffSession(tokenHash: string, now: number): Promise<StaffIdentity | null>;
  removeStaffSession(tokenHash: string): Promise<void>;
}

export function readStaffSession(db: Store, tokenHash: string, now: number) {
  const match = db.prepare("SELECT email, name, method FROM staff_sessions WHERE tokenHash = ? AND expiresAt > ?").get(tokenHash, now);
  return match ? { identity: { email: String(match.email), name: String(match.name) }, method: match.method } : null;
}

export function staffAuthStore(db: Store): StaffAuthStore {
  return {
    async startGoogle(attempt, now) {
      db.transaction(() => {
        db.prepare("DELETE FROM staff_google_attempts WHERE expiresAt <= ?").run(now);
        db.prepare("INSERT INTO staff_google_attempts (state, browserHash, nonce, verifier, expiresAt, brokerageId, guide) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(attempt.state, attempt.browserHash, attempt.nonce, attempt.verifier, attempt.expiresAt, attempt.brokerageId, attempt.guide);
      });
    },
    async consumeGoogle(state, browserHash, now) {
      return db.transaction(() => {
        const match = db.prepare("SELECT nonce, verifier, brokerageId, guide FROM staff_google_attempts WHERE state = ? AND browserHash = ? AND expiresAt > ?")
          .get(state, browserHash, now);
        if (!match) return null;
        db.prepare("DELETE FROM staff_google_attempts WHERE state = ?").run(state);
        return { nonce: String(match.nonce), verifier: String(match.verifier),
          brokerageId: typeof match.brokerageId === "string" ? match.brokerageId : null, guide: workspaceGuide(match.guide) };
      });
    },
    async createStaffSession(tokenHash, identity, expiresAt, now, method = "google") {
      db.transaction(() => {
        db.prepare("DELETE FROM staff_sessions WHERE expiresAt <= ?").run(now);
        db.prepare("INSERT INTO staff_sessions (tokenHash, email, name, expiresAt, method) VALUES (?, ?, ?, ?, ?)")
          .run(tokenHash, identity.email, identity.name, expiresAt, method);
      });
    },
    async getStaffSession(tokenHash, now) {
      return readStaffSession(db, tokenHash, now)?.identity ?? null;
    },
    async removeStaffSession(tokenHash) {
      db.prepare("DELETE FROM staff_sessions WHERE tokenHash = ?").run(tokenHash);
    },
  };
}
