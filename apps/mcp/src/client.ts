import { spawn } from "node:child_process";
import type { Proposal, ProposalRecord } from "@roview/protocol";

const DEFAULT_URL = "http://127.0.0.1:3219";
const DEFAULT_POLL_INTERVAL_MS = 750;
const REVIEW_TERMINAL_STATUSES = new Set(["CANCELLED"]);

interface RoviewClientOptions {
  baseUrl: string;
  token: string;
  pollIntervalMs?: number;
  request?: typeof fetch;
}

interface WaitOptions {
  timeoutSeconds: number;
  signal?: AbortSignal;
}

const requireLoopbackUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "http:") throw new Error("ROVIEW_URL must use HTTP for the loopback companion");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("ROVIEW_URL must point to a loopback companion");
  }
  return url.toString().replace(/\/$/, "");
};

const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error("Review wait was cancelled by the MCP client"));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new Error("Review wait was cancelled by the MCP client"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});

export const openReviewInBrowser = (url: string) => {
  const command = process.platform === "darwin"
    ? { executable: "open", args: [url] }
    : process.platform === "win32"
      ? { executable: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
      : { executable: "xdg-open", args: [url] };
  const child = spawn(command.executable, command.args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
};

export class RoviewClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #pollIntervalMs: number;
  readonly #request: typeof fetch;

  constructor(options: RoviewClientOptions) {
    if (!options.token) throw new Error("ROVIEW_TOKEN is required by the Roview MCP server");
    this.#baseUrl = requireLoopbackUrl(options.baseUrl);
    this.#token = options.token;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#request = options.request ?? fetch;
  }

  static fromEnvironment() {
    return new RoviewClient({
      baseUrl: process.env.ROVIEW_URL ?? DEFAULT_URL,
      token: process.env.ROVIEW_TOKEN ?? "",
    });
  }

  static async fromEnvironmentOrDiscovery() {
    const baseUrl = process.env.ROVIEW_URL ?? DEFAULT_URL;
    let token = process.env.ROVIEW_TOKEN ?? "";
    if (!token) {
      try {
        const response = await (fetch)(`${baseUrl}/v1/session`);
        if (response.ok) {
          const data = await response.json() as { token?: string };
          if (typeof data.token === "string") {
            token = data.token;
          }
        }
      } catch {
        // Fall back to environment check
      }
    }
    return new RoviewClient({ baseUrl, token });
  }

  reviewUrl() {
    const url = new URL("/review", this.#baseUrl);
    url.searchParams.set("token", this.#token);
    return url.toString();
  }

  submit(proposal: Proposal, signal?: AbortSignal) {
    return this.#json<ProposalRecord>("/v1/proposals", {
      method: "POST",
      body: JSON.stringify(proposal),
      ...(signal ? { signal } : {}),
    });
  }

  get(proposalId: string, revision: number, signal?: AbortSignal) {
    return this.#json<ProposalRecord>(
      `/v1/proposals/${encodeURIComponent(proposalId)}/${revision}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
  }

  async waitForDecision(proposalId: string, revision: number, options: WaitOptions) {
    const deadline = Date.now() + options.timeoutSeconds * 1_000;
    while (true) {
      const record = await this.get(proposalId, revision, options.signal);
      if (record.decision || REVIEW_TERMINAL_STATUSES.has(record.status)) {
        return { record, timedOut: false } as const;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { record, timedOut: true } as const;
      await delay(Math.min(this.#pollIntervalMs, remaining), options.signal);
    }
  }

  async #json<T>(path: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.#request(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      throw new Error(
        `Could not reach the Roview companion at ${this.#baseUrl}: ${error instanceof Error ? error.message : "request failed"}`,
      );
    }
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : `Roview companion returned HTTP ${response.status}`);
    }
    return body as T;
  }
}
