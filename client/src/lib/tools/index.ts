/**
 * lib/tools/index.ts
 * Tractus tool suite with workspace publishing.
 */

import {
  getBusinesses,
  getBusinessDetail,
  getContacts,
  getSignalEvents,
  createMandate,
  getMandate,
  listMandates,
  addBusinessToMandate,
  getMandateSummary,
  getBenchmark,
  createOutreachSequence,
  draftAcquisitionEmails,
  getOutreachQueue,
  approveBulkOutreach,
  getPipelineStats,
  updateBusinessStatus,
} from "./tractus-tools";
import { publishWorkspaceView } from "./workspace-tool";
import { getPostHogClient } from "@/lib/posthog-server";

const rawTools = {
  // ── Workspace publishing ───────────────────────────────────────────────────
  publishWorkspaceView,

  // ── Discovery ──────────────────────────────────────────────────────────────
  getBusinesses,
  getBusinessDetail,
  getContacts,
  getSignalEvents,

  // ── Mandates ───────────────────────────────────────────────────────────────
  createMandate,
  getMandate,
  listMandates,
  addBusinessToMandate,
  getMandateSummary,

  // ── Benchmark ──────────────────────────────────────────────────────────────
  getBenchmark,

  // ── Outreach ───────────────────────────────────────────────────────────────
  createOutreachSequence,
  draftAcquisitionEmails,
  getOutreachQueue,
  approveBulkOutreach,

  // ── Pipeline ───────────────────────────────────────────────────────────────
  getPipelineStats,
  updateBusinessStatus,
};

type ToolCtx = { userId?: string; mandateId?: string | null };

type ToolWithExecute = {
  execute?: (input: unknown, opts: unknown) => unknown;
  [k: string]: unknown;
};

function withTelemetry<T extends ToolWithExecute>(name: string, t: T): T {
  const originalExecute = t.execute;
  if (!originalExecute) return t;

  const wrapped = async (input: unknown, opts: unknown) => {
    const start = Date.now();
    const ctx = (opts as { experimental_context?: ToolCtx } | undefined)
      ?.experimental_context;
    const distinctId = ctx?.userId ?? "anonymous";
    let success = true;
    let errorMessage: string | undefined;

    try {
      return await originalExecute(input, opts);
    } catch (err) {
      success = false;
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      try {
        getPostHogClient().capture({
          distinctId,
          event: "tool_called",
          properties: {
            tool_name: name,
            success,
            duration_ms: Date.now() - start,
            mandate_id: ctx?.mandateId ?? null,
            ...(errorMessage ? { error: errorMessage.slice(0, 500) } : undefined),
          },
        });
      } catch {
        // never let telemetry break tool execution
      }
    }
  };

  return { ...t, execute: wrapped } as T;
}

export const allTools = Object.fromEntries(
  Object.entries(rawTools).map(([name, t]) => [
    name,
    withTelemetry(name, t as ToolWithExecute),
  ]),
) as typeof rawTools;
