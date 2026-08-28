import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { MODELS } from "@/lib/ai/models";
import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import { getPostHogClient } from "@/lib/posthog-server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { allTools } from "@/lib/tools";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const MAX_INPUT_CHARS = 150_000;

function trimMessages(messages: ModelMessage[]): ModelMessage[] {
  let totalChars = 0;
  for (const msg of messages) totalChars += JSON.stringify(msg).length;
  if (totalChars <= MAX_INPUT_CHARS) return messages;
  const first = messages[0];
  const rest = messages.slice(1);
  const kept: ModelMessage[] = [];
  let budget = MAX_INPUT_CHARS - JSON.stringify(first).length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const size = JSON.stringify(rest[i]).length;
    if (budget - size < 0) break;
    budget -= size;
    kept.unshift(rest[i]);
  }
  return [first, ...kept];
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { user } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    messages: uiMessages,
    campaignId,
    mandateId: rawMandateId,
    chatId,
    pageContext,
  } = body as {
    messages: UIMessage[];
    campaignId?: string;
    mandateId?: string;
    chatId?: string;
    pageContext?: string;
  };

  const mandateId = rawMandateId ?? campaignId ?? undefined;

  // Pull sender identity from user_settings so agent never has to ask
  let senderName: string | null = null;
  let senderTitle: string | null = null;
  let firmName: string | null = null;
  try {
    const adminClient = getAdminClient();
    const { data: settings } = await adminClient
      .from("user_settings")
      .select("sender_name, sender_email")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fall back to system row if no user-specific row exists
    const { data: systemSettings } = !settings
      ? await adminClient
          .from("user_settings")
          .select("sender_name, sender_email")
          .eq("user_id", "system")
          .maybeSingle()
      : { data: null };

    const resolved = settings ?? systemSettings;
    if (resolved?.sender_name) {
      // sender_name may be "James Wright, Managing Partner at Atlantic Capital"
      // or just "James Wright" — parse it
      const parts = resolved.sender_name.split(",").map((s: string) => s.trim());
      senderName = parts[0] ?? null;
      senderTitle = parts[1] ?? null;
      // Extract firm from "Managing Partner at Atlantic Capital"
      const atIdx = (senderTitle ?? "").indexOf(" at ");
      if (atIdx !== -1) {
        firmName = senderTitle!.slice(atIdx + 4).trim();
        senderTitle = senderTitle!.slice(0, atIdx).trim();
      }
    }
  } catch {
    // Non-fatal — agent will use defaults
  }

  const modelMessages = trimMessages(await convertToModelMessages(uiMessages));
  if (modelMessages.length > 0) {
    const lastIdx = modelMessages.length - 1;
    modelMessages[lastIdx] = {
      ...modelMessages[lastIdx],
      providerOptions: {
        ...modelMessages[lastIdx].providerOptions,
        anthropic: {
          ...(modelMessages[lastIdx].providerOptions?.anthropic ?? {}),
          cacheControl: { type: "ephemeral" },
        },
      },
    };
  }

  const systemPrompt = buildSystemPrompt({
    mandateId,
    pageContext,
    senderName,
    senderTitle,
    firmName,
  });

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        model: anthropic(MODELS.CHAT),
        system: systemPrompt,
        messages: modelMessages,
        tools: allTools,
        maxOutputTokens: 8192,
        stopWhen: stepCountIs(25),
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
        experimental_context: {
          writer,
          userId: user.id,
          mandateId: mandateId ?? null,
        },
        onFinish({ usage }) {
          trackUsage({
            service: "claude",
            operation: "chat",
            tokens_input: usage.inputTokens ?? 0,
            tokens_output: usage.outputTokens ?? 0,
            estimated_cost_usd: estimateClaudeCostFromUsage("sonnet", usage),
            metadata: {
              model: "claude-sonnet-4-6",
              cache_creation_tokens: usage.inputTokenDetails?.cacheWriteTokens,
              cache_read_tokens: usage.inputTokenDetails?.cacheReadTokens,
            },
            campaign_id: mandateId,
            user_id: user.id,
          });
          getPostHogClient().capture({
            distinctId: user.id,
            event: "chat_completed",
            properties: {
              mandate_id: mandateId ?? null,
              chat_id: chatId ?? null,
              tokens_input: usage.inputTokens ?? 0,
              tokens_output: usage.outputTokens ?? 0,
            },
          });
        },
      });
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
