import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseProposal,
  proposalDigest,
  type ApplyAttempt,
  type ApplyResult,
  type PreflightReport,
  type Proposal,
  type ProposalRecord,
  type ReviewDecision,
  type ReviewDraft,
} from "@roview/protocol";

const DEFAULT_RETENTION_DAYS = 30;
const TERMINAL_STATUSES = new Set(["CHANGES_REQUESTED", "REJECTED", "APPLIED", "APPLY_FAILED", "SUPERSEDED", "CANCELLED"]);
const INBOX_STATUS_PRIORITY: Record<ProposalRecord["status"], number> = {
  READY_FOR_REVIEW: 0,
  APPROVED: 0,
  PREFLIGHT: 0,
  APPLYING: 0,
  CONFLICTED: 1,
  APPLY_FAILED: 1,
  CHANGES_REQUESTED: 2,
  REJECTED: 2,
  APPLIED: 2,
  SUPERSEDED: 3,
  CANCELLED: 3,
};

interface PersistedStore {
  version: 2;
  records: ProposalRecord[];
  drafts: ReviewDraft[];
}

interface ProposalStoreOptions {
  persistencePath?: string;
  records?: ProposalRecord[];
  drafts?: ReviewDraft[];
  retentionDays?: number;
}

const recordKey = (proposal: Proposal) => `${proposal.proposalId}:${proposal.revision}`;

const draftKey = (proposalId: string, revision: number) => `${proposalId}:${revision}`;

const sameRevisionContent = (left: Proposal, right: Proposal) => {
  const { createdAt: _leftCreatedAt, ...leftContent } = left;
  const { createdAt: _rightCreatedAt, ...rightContent } = right;
  return proposalDigest(leftContent) === proposalDigest(rightContent);
};

export const sortInboxRecords = (records: ProposalRecord[]) => [...records].sort((left, right) => {
  const priority = INBOX_STATUS_PRIORITY[left.status] - INBOX_STATUS_PRIORITY[right.status];
  if (priority !== 0) return priority;
  const unread = Number(left.reviewedAt !== undefined) - Number(right.reviewedAt !== undefined);
  if (unread !== 0) return unread;
  const created = right.proposal.createdAt.localeCompare(left.proposal.createdAt);
  if (created !== 0) return created;
  const id = left.proposal.proposalId.localeCompare(right.proposal.proposalId);
  return id !== 0 ? id : right.proposal.revision - left.proposal.revision;
});

export class ProposalStore {
  readonly #records = new Map<string, ProposalRecord>();
  readonly #drafts = new Map<string, ReviewDraft>();
  readonly #persistencePath: string | undefined;
  readonly #retentionDays: number;
  #writeQueue = Promise.resolve();
  #changeCursor = 0;
  readonly #changeWaiters = new Set<() => void>();

  constructor(options: ProposalStoreOptions = {}) {
    this.#persistencePath = options.persistencePath;
    this.#retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    for (const record of options.records ?? []) this.#records.set(recordKey(record.proposal), record);
    for (const draft of options.drafts ?? []) this.#drafts.set(draftKey(draft.proposalId, draft.revision), draft);
  }

  static async open(persistencePath: string, retentionDays = DEFAULT_RETENTION_DAYS) {
    let records: ProposalRecord[] = [];
    let drafts: ReviewDraft[] = [];
    try {
      const parsed = JSON.parse(await readFile(persistencePath, "utf8")) as PersistedStore | { version: 1; records: ProposalRecord[] };
      if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.records)) throw new Error("Unsupported Roview store format");
      records = parsed.records.map((record) => {
        const proposal = parseProposal(record.proposal);
        const digest = proposalDigest(proposal);
        if (record.digest !== digest) throw new Error("Persisted proposal digest does not match its payload");
        return { ...record, proposal, digest };
      });
      drafts = parsed.version === 2 && Array.isArray(parsed.drafts) ? parsed.drafts : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const store = new ProposalStore({ persistencePath, records, drafts, retentionDays });
    const recovered = store.#recoverInterruptedApplies();
    const pruned = store.pruneExpired();
    if (recovered || pruned > 0) await store.flush();
    return store;
  }

  list() {
    return sortInboxRecords([...this.#records.values()]);
  }

  get(proposalId: string, revision: number) {
    return this.#records.get(`${proposalId}:${revision}`);
  }

  async put(record: ProposalRecord) {
    const key = recordKey(record.proposal);
    const existing = this.#records.get(key);
    if (existing) {
      if (sameRevisionContent(existing.proposal, record.proposal)) return existing;
      throw new Error("This proposal revision already exists with different content");
    }
    const lineage = [...this.#records.values()].filter((candidate) =>
      candidate.proposal.proposalId === record.proposal.proposalId
    );
    if (record.proposal.revision === 1 && lineage.length > 0) {
      throw new Error("This proposal lineage already has a root revision");
    }
    if (record.proposal.revision > 1) {
      const previousRevision = record.proposal.previousRevision;
      const previous = previousRevision === undefined ? undefined : this.get(record.proposal.proposalId, previousRevision);
      if (!previous) throw new Error("The declared previous revision does not exist");
      const latestRevision = Math.max(...lineage.map((candidate) => candidate.proposal.revision));
      if (previousRevision !== latestRevision) throw new Error("The declared previous revision is not the active lineage tip");
      if (["APPLYING", "APPLIED", "APPLY_FAILED"].includes(previous.status)) {
        throw new Error(`Cannot revise a lineage whose active revision is ${previous.status}`);
      }
      previous.status = "SUPERSEDED";
    }
    this.#records.set(key, record);
    this.pruneExpired();
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async decide(proposalId: string, revision: number, decision: ReviewDecision) {
    const record = this.get(proposalId, revision);
    if (!record) return undefined;
    if (decision.proposalDigest !== record.digest) throw new Error("Decision digest does not match the reviewed proposal");
    if (record.decision) {
      if (
        record.decision.kind === decision.kind
        && record.decision.proposalDigest === decision.proposalDigest
        && JSON.stringify(record.decision.comments) === JSON.stringify(decision.comments)
      ) return record;
      throw new Error("This proposal revision already has a decision");
    }
    if (record.status !== "READY_FOR_REVIEW") throw new Error(`Cannot decide a proposal in ${record.status}`);
    record.decision = decision;
    record.status = decision.kind === "APPROVE"
      ? "APPROVED"
      : decision.kind === "REJECT"
        ? "REJECTED"
        : "CHANGES_REQUESTED";
    await this.#deleteDraft(proposalId, revision, record.digest);
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async markReviewed(proposalId: string, revision: number) {
    const record = this.requireRecord(proposalId, revision);
    if (record.reviewedAt) return record;
    record.reviewedAt = new Date().toISOString();
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async cancel(proposalId: string, revision: number) {
    const record = this.requireRecord(proposalId, revision);
    if (!["READY_FOR_REVIEW", "APPROVED", "PREFLIGHT", "CONFLICTED", "CANCELLED"].includes(record.status)) {
      throw new Error(`Cannot cancel a proposal in ${record.status}`);
    }
    if (record.status === "CANCELLED") return record;
    record.status = "CANCELLED";
    await this.#deleteDraft(proposalId, revision, record.digest);
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async reportPreflight(proposalId: string, revision: number, report: PreflightReport) {
    const record = this.requireRecord(proposalId, revision);
    this.requireDigest(record, report.proposalDigest);
    if (record.preflight) {
      if (
        record.preflight.proposalDigest === report.proposalDigest
        && JSON.stringify(record.preflight.errors) === JSON.stringify(report.errors)
      ) return record;
      throw new Error("Preflight was already reported for this proposal revision");
    }
    if (record.status !== "APPROVED") throw new Error(`Cannot preflight a proposal in ${record.status}`);
    record.preflight = report;
    record.status = report.errors.length > 0 ? "CONFLICTED" : "PREFLIGHT";
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async beginApply(proposalId: string, revision: number, attempt: ApplyAttempt) {
    const record = this.requireRecord(proposalId, revision);
    this.requireDigest(record, attempt.proposalDigest);
    if (record.applyAttempt) return record;
    if (record.status !== "PREFLIGHT") throw new Error(`Cannot begin apply from ${record.status}`);
    record.applyAttempt = attempt;
    record.status = "APPLYING";
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async finishApply(proposalId: string, revision: number, result: ApplyResult) {
    const record = this.requireRecord(proposalId, revision);
    this.requireDigest(record, result.proposalDigest);
    if (!record.applyAttempt || record.applyAttempt.attemptId !== result.attemptId) {
      throw new Error("Apply attempt does not match the active proposal attempt");
    }
    if (record.applyResult) {
      if (
        record.applyResult.attemptId === result.attemptId
        && record.applyResult.proposalDigest === result.proposalDigest
        && record.applyResult.success === result.success
        && record.applyResult.message === result.message
      ) return record;
      throw new Error("A different result was already recorded for this apply attempt");
    }
    if (record.status !== "APPLYING") throw new Error(`Cannot finish apply from ${record.status}`);
    record.applyResult = result;
    record.status = result.success ? "APPLIED" : "APPLY_FAILED";
    await this.flush();
    this.#notifyChange();
    return record;
  }

  async deleteAll() {
    const deleted = this.#records.size;
    this.#records.clear();
    this.#drafts.clear();
    await this.flush();
    this.#notifyChange();
    return deleted;
  }

  get cursor() {
    return this.#changeCursor;
  }

  async waitForChange(after: number, timeoutMs: number) {
    if (after < this.#changeCursor) return this.#changeCursor;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.#changeWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.#changeWaiters.add(finish);
    });
    return this.#changeCursor;
  }

  getDraft(proposalId: string, revision: number) {
    const draft = this.#drafts.get(draftKey(proposalId, revision));
    return draft?.deletedAt ? undefined : draft;
  }

  async saveDraft(input: Omit<ReviewDraft, "generation" | "updatedAt">, expectedGeneration: number) {
    const record = this.requireRecord(input.proposalId, input.revision);
    this.requireDigest(record, input.proposalDigest);
    if (record.decision || record.status !== "READY_FOR_REVIEW") {
      throw new Error(`Cannot save a draft for a proposal in ${record.status}`);
    }
    const key = draftKey(input.proposalId, input.revision);
    const current = this.#drafts.get(key);
    if ((current?.generation ?? 0) !== expectedGeneration) {
      throw new Error("Draft generation is stale; reload before saving");
    }
    const draft: ReviewDraft = {
      ...input,
      generation: expectedGeneration + 1,
      updatedAt: new Date().toISOString(),
    };
    this.#drafts.set(key, draft);
    await this.flush();
    return draft;
  }

  async deleteDraft(proposalId: string, revision: number, proposalDigestValue: string, expectedGeneration: number) {
    const record = this.requireRecord(proposalId, revision);
    this.requireDigest(record, proposalDigestValue);
    const current = this.#drafts.get(draftKey(proposalId, revision));
    if ((current?.generation ?? 0) !== expectedGeneration) {
      throw new Error("Draft generation is stale; reload before deleting");
    }
    await this.#deleteDraft(proposalId, revision, proposalDigestValue);
    await this.flush();
    return { deleted: true, generation: expectedGeneration + 1 };
  }

  pruneExpired(now = Date.now()) {
    const cutoff = now - this.#retentionDays * 24 * 60 * 60 * 1_000;
    let deleted = 0;
    for (const [key, record] of this.#records) {
      if (TERMINAL_STATUSES.has(record.status) && Date.parse(record.proposal.createdAt) < cutoff) {
        this.#records.delete(key);
        this.#drafts.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  flush() {
    if (!this.#persistencePath) return Promise.resolve();
    const body = JSON.stringify({
      version: 2,
      records: this.list(),
      drafts: [...this.#drafts.values()],
    } satisfies PersistedStore, null, 2);
    const persistencePath = this.#persistencePath;
    this.#writeQueue = this.#writeQueue.then(async () => {
      await mkdir(dirname(persistencePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${persistencePath}.tmp`;
      await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, persistencePath);
    });
    return this.#writeQueue;
  }

  #recoverInterruptedApplies() {
    let recovered = false;
    for (const record of this.#records.values()) {
      if (record.status !== "APPLYING" || !record.applyAttempt) continue;
      record.status = "APPLY_FAILED";
      record.applyResult = {
        attemptId: record.applyAttempt.attemptId,
        proposalDigest: record.digest,
        success: false,
        message: "Companion restarted during apply. Inspect Studio and Undo if necessary; automatic replay is disabled.",
        completedAt: new Date().toISOString(),
      };
      recovered = true;
    }
    return recovered;
  }

  private requireRecord(proposalId: string, revision: number) {
    const record = this.get(proposalId, revision);
    if (!record) throw new Error("Proposal not found");
    return record;
  }

  private requireDigest(record: ProposalRecord, digest: string) {
    if (digest !== record.digest) throw new Error("Payload digest does not match the reviewed proposal");
  }

  async #deleteDraft(proposalId: string, revision: number, proposalDigestValue: string) {
    const key = draftKey(proposalId, revision);
    const current = this.#drafts.get(key);
    this.#drafts.set(key, {
      proposalId,
      revision,
      proposalDigest: proposalDigestValue,
      generation: (current?.generation ?? 0) + 1,
      comments: [],
      globalComment: "",
      viewedItemIds: [],
      updatedAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
    });
  }

  #notifyChange() {
    this.#changeCursor += 1;
    for (const waiter of this.#changeWaiters) waiter();
  }
}
