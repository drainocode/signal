"use client";
import { memo, useCallback } from "react";
import dynamic from "next/dynamic";
import type { UIMessage } from "ai";
import { isToolUIPart, getToolName } from "ai";
import { Bot, ExternalLink, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { ToolCallCard } from "./tool-call-card";
import { Button } from "@/components/ui/button";

const Markdown = dynamic(
  () => import("@/components/ui/markdown").then((m) => m.Markdown),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted-foreground/10 h-4 w-32 animate-pulse rounded" />
    ),
  },
);

interface ChatMessageBubbleProps {
  message: UIMessage;
  isStreaming?: boolean;
  onSuggestionClick?: (text: string) => void;
}

// ── Parse suggested-actions and mandate-card blocks out of raw text ──────────
interface ParsedSegment {
  type: "text" | "suggested-actions" | "mandate-card";
  content: string;
}

function parseMessageText(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  // Match ```suggested-actions ... ``` and ```mandate-card ... ``` blocks
  const pattern = /```(suggested-actions|mandate-card)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before this block
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", content: before });
    }
    segments.push({ type: match[1] as "suggested-actions" | "mandate-card", content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last block
  const after = text.slice(lastIndex).trim();
  if (after) segments.push({ type: "text", content: after });

  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}

// ── Suggested actions chips ──────────────────────────────────────────────────
function SuggestedActions({
  content,
  onAction,
}: {
  content: string;
  onAction?: (text: string) => void;
}) {
  let actions: string[] = [];
  try {
    actions = JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(actions) || actions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction?.(action)}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors text-left"
        >
          {action}
        </button>
      ))}
    </div>
  );
}

// ── Mandate card ─────────────────────────────────────────────────────────────
function MandateCard({ content }: { content: string }) {
  const router = useRouter();
  let data: { id?: string; name?: string; vertical?: string; targetCount?: number } = {};
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (!data.id) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(`/campaigns/${data.id}`)}
      className="border-border bg-background hover:bg-muted/30 mt-2 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{data.name ?? "Mandate"}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {[data.vertical, data.targetCount != null ? `${data.targetCount} targets` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <ExternalLink className="text-muted-foreground ml-3 h-4 w-4 shrink-0" />
    </button>
  );
}

// ── Markdown wrapper with horizontal scroll for tables ───────────────────────
function MarkdownWithScroll({ children }: { children: string }) {
  return (
    <div className="[&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full [&_table]:whitespace-nowrap [&_td]:px-3 [&_th]:px-3">
      <Markdown>{children}</Markdown>
    </div>
  );
}

function StreamingMarkdown({ text }: { text: string }) {
  return (
    <div className="animate-in fade-in-0 duration-300">
      <MarkdownWithScroll>{text}</MarkdownWithScroll>
    </div>
  );
}

export const ChatMessageBubble = memo(
  function ChatMessageBubble({ message, isStreaming, onSuggestionClick }: ChatMessageBubbleProps) {
    const isUser = message.role === "user";

    const handleAction = useCallback(
      (text: string) => {
        onSuggestionClick?.(text);
      },
      [onSuggestionClick],
    );

    if (isUser) {
      const textContent = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      return (
        <div className="flex justify-end gap-3 animate-in fade-in-0 duration-500">
          <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
            {textContent && (
              <p className="whitespace-pre-wrap">{textContent}</p>
            )}
          </div>
          <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <User className="text-primary h-4 w-4" />
          </div>
        </div>
      );
    }

    const parts = message.parts;
    const lastTextIndex = parts.reduce(
      (last, p, i) => (p.type === "text" ? i : last),
      -1,
    );
    const liveViewByToolCall = new Map<string, string>();
    for (const p of parts) {
      if (
        p.type === "data-browserbaseLiveView" &&
        typeof (p as { id?: unknown }).id === "string"
      ) {
        const d = (p as { data?: { url?: unknown } }).data;
        if (d && typeof d.url === "string") {
          liveViewByToolCall.set((p as { id: string }).id, d.url);
        }
      }
    }

    return (
      <div className="flex gap-3 animate-in fade-in-0 duration-500">
        <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Bot className="text-muted-foreground h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {parts.map((part, i) => {
            if (isToolUIPart(part)) {
              return (
                <ToolCallCard
                  key={part.toolCallId}
                  toolName={getToolName(part)}
                  state={part.state}
                  input={"input" in part ? part.input : undefined}
                  output={"output" in part ? part.output : undefined}
                  errorText={
                    "errorText" in part ? (part.errorText as string) : undefined
                  }
                  liveViewUrl={liveViewByToolCall.get(part.toolCallId)}
                />
              );
            }

            if (part.type === "text" && part.text) {
              const isLastText = i === lastTextIndex;
              const isActivelyStreaming = isStreaming && isLastText;
              const segments = parseMessageText(part.text);

              // If no special blocks found, render as before
              const hasSpecialBlocks = segments.some(
                (s) => s.type !== "text",
              );

              return (
                <div
                  key={`text-${i}`}
                  className="bg-muted/60 my-1 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm"
                >
                  {!hasSpecialBlocks ? (
                    isActivelyStreaming ? (
                      <StreamingMarkdown text={part.text} />
                    ) : (
                      <MarkdownWithScroll>{part.text}</MarkdownWithScroll>
                    )
                  ) : (
                    segments.map((seg, si) => {
                      if (seg.type === "text") {
                        return isActivelyStreaming && si === segments.length - 1 ? (
                          <StreamingMarkdown key={si} text={seg.content} />
                        ) : (
                          <MarkdownWithScroll key={si}>{seg.content}</MarkdownWithScroll>
                        );
                      }
                      if (seg.type === "suggested-actions") {
                        return (
                          <SuggestedActions
                            key={si}
                            content={seg.content}
                            onAction={handleAction}
                          />
                        );
                      }
                      if (seg.type === "mandate-card") {
                        return <MandateCard key={si} content={seg.content} />;
                      }
                      return null;
                    })
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    );
  },
  (prev, next) => {
    if (next.isStreaming) return false;
    return prev.message === next.message && prev.onSuggestionClick === next.onSuggestionClick;
  },
);
