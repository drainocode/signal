"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { SquarePen, Briefcase, ChevronRight, Zap, Loader2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { loadChat, saveChat } from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Summarize chat title on finish / unmount
// ─────────────────────────────────────────────────────────────────────────────

function summarizeChat(chatId: string) {
  const body = JSON.stringify({ chatId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/chat/summarize", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/chat/summarize", { method: "POST", body, keepalive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mandate card — rendered inline in chat when agent creates a mandate
// Agent outputs: ```mandate-card\n{"id":"...","name":"...","vertical":"...","targetCount":3}\n```
// ─────────────────────────────────────────────────────────────────────────────

const MANDATE_CARD_REGEX = /```mandate-card\s*\n([\s\S]*?)\n```/g;

interface MandateCardData {
  id: string;
  name: string;
  vertical: string;
  targetCount?: number;
}

function MandateCard({ data }: { data: MandateCardData }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/campaigns/${data.id}`)}
      className="border-border bg-background hover:bg-muted/40 my-2 flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors"
    >
      <div className="bg-primary/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <Briefcase className="text-primary h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{data.name}</p>
        <p className="text-muted-foreground text-xs capitalize">
          {data.vertical}{data.targetCount ? ` · ${data.targetCount} targets` : ""}
        </p>
      </div>
      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
    </button>
  );
}

// Parse mandate cards and strip their code blocks from message text
function parseMandateCards(text: string): { cleaned: string; cards: MandateCardData[] } {
  const cards: MandateCardData[] = [];
  const cleaned = text.replace(MANDATE_CARD_REGEX, (_match, json) => {
    try {
      const data = JSON.parse(json.trim());
      if (data.id && data.name) cards.push(data as MandateCardData);
    } catch { /* skip invalid */ }
    return "";
  }).trim();
  return { cleaned, cards };
}

// Process messages — strip mandate cards from text, collect card data
function processMessages(messages: UIMessage[]): Array<UIMessage & { mandateCards?: MandateCardData[] }> {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const allCards: MandateCardData[] = [];
    const newParts = (msg.parts ?? []).map((part) => {
      if (part.type !== "text") return part;
      const text = (part as { type: "text"; text: string }).text ?? "";
      const { cleaned, cards } = parseMandateCards(text);
      allCards.push(...cards);
      return { ...part, text: cleaned };
    });
    return { ...msg, parts: newParts, mandateCards: allCards.length > 0 ? allCards : undefined };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested action chips — Origami-style collapsible
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTED_ACTIONS_REGEX = /```suggested-actions\s*\n([\s\S]*?)\n```/;

function parseSuggestedActions(messages: UIMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      if (part.type !== "text") continue;
      const text = (part as { type: "text"; text: string }).text ?? "";
      const match = text.match(SUGGESTED_ACTIONS_REGEX);
      if (match) {
        try {
          const actions = JSON.parse(match[1].trim());
          if (Array.isArray(actions) && actions.length > 0) return actions.slice(0, 3) as string[];
        } catch { /* skip */ }
      }
    }
    break;
  }
  return [];
}

function stripSuggestedActions(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const newParts = (msg.parts ?? []).map((part) => {
      if (part.type !== "text") return part;
      const text = (part as { type: "text"; text: string }).text ?? "";
      return { ...part, text: text.replace(SUGGESTED_ACTIONS_REGEX, "").trim() };
    });
    return { ...msg, parts: newParts };
  });
}

function SuggestedActionChips({
  actions,
  onSelect,
  isStreaming,
}: {
  actions: string[];
  onSelect: (action: string) => void;
  isStreaming: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (actions.length > 0) setCollapsed(false);
  }, [actions.join("|")]);

  if (actions.length === 0 || isStreaming) return null;

  if (collapsed) {
    return (
      <div className="px-3 pb-1.5 pt-1">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="border-border bg-background hover:bg-muted/50 shadow-sm inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors"
        >
          <Zap className="h-3 w-3" />
          <span className="font-medium">Suggested Next Actions</span>
          <svg className="h-3 w-3 ml-0.5" viewBox="0 0 12 12" fill="none">
            <path d="M2 8L6 4L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pb-1.5 pt-1">
      <div className="border-border bg-background rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Zap className="text-muted-foreground h-3 w-3" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Suggested Next Actions
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none">
              <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className="border-border border-t" />
        <div className="divide-border divide-y">
          {actions.map((action, i) => (
            <button
              key={action}
              type="button"
              onClick={() => onSelect(action)}
              className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
              <span className="border-border bg-muted/50 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className="text-xs leading-relaxed group-hover:text-foreground text-foreground/80">
                {action}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom message renderer — wraps ChatMessages output to inject mandate cards
// ─────────────────────────────────────────────────────────────────────────────

function MessagesWithCards({
  messages,
  isLoading,
  onSuggestionClick,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  onSuggestionClick: (text: string) => void;
}) {
  const processed = processMessages(messages);

  // Collect all mandate cards to render after the messages
  const allCards = processed.flatMap((m) => m.mandateCards ?? []);

  // Pass cleaned messages to ChatMessages
  const cleanedForDisplay = processed.map(({ mandateCards: _mc, ...rest }) => rest) as UIMessage[];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatMessages
        messages={cleanedForDisplay}
        isLoading={isLoading}
        onSuggestionClick={onSuggestionClick}
      />
      {/* Mandate cards rendered below messages, above input */}
      {allCards.length > 0 && (
        <div className="border-border border-t px-4 py-3 space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Mandate created
          </p>
          {allCards.map((card) => (
            <MandateCard key={card.id} data={card} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatView — Signal's original single-pane layout
// ─────────────────────────────────────────────────────────────────────────────

function ChatView({
  chatId,
  initialMessages,
  initialTitle,
  autoSendText,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  initialTitle?: string | null;
  autoSendText?: string;
}) {
  const [input, setInput] = useState("");
  const { activeCampaignId } = useCampaign();
  const { register } = useStreaming();
  const { userId } = useAuth();
  const router = useRouter();
  const didAutoSend = useRef(false);
  const needsSummary = useRef(false);
  const turnCount = useRef(0);

  const { messages, sendMessage, status, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    onFinish({ messages: allMessages }) {
      if (userId) {
        saveChat(createClient(), userId, chatId, allMessages, activeCampaignId ?? undefined);
      }
      turnCount.current++;
      if (turnCount.current === 1) {
        summarizeChat(chatId);
      } else {
        needsSummary.current = true;
      }
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading) return register("main-chat");
  }, [isLoading, register]);

  // Summarize on unmount / tab hide
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && needsSummary.current) {
        needsSummary.current = false;
        summarizeChat(chatId);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (needsSummary.current) {
        needsSummary.current = false;
        summarizeChat(chatId);
      }
    };
  }, [chatId]);

  const requestOptions = {
    body: {
      chatId,
      ...(activeCampaignId ? { mandateId: activeCampaignId } : {}),
    },
  };

  // Auto-send initial query — only fires on brand new chats
  useEffect(() => {
    if (autoSendText && !didAutoSend.current && initialMessages.length === 0) {
      didAutoSend.current = true;
      sendMessage({ text: autoSendText }, requestOptions);
      router.replace(`/chat/${chatId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendText, initialMessages.length]);

  const onSubmit = () => {
    if (!input.trim()) return;
    sendMessage({ text: input }, requestOptions);
    setInput("");
  };

  const onCsvUpload = (content: string, fileName: string) => {
    const msg = `I'm uploading a CSV file (${fileName}) with a list of businesses. Please enrich and score them for acquisition readiness.\n\n\`\`\`csv\n${content}\n\`\`\``;
    sendMessage({ text: msg }, requestOptions);
  };

  const suggestedActions = parseSuggestedActions(messages);
  const cleanedMessages = stripSuggestedActions(messages);

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {initialTitle?.trim() || "New chat"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Start new chat"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/")}
        >
          <SquarePen className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages + mandate cards */}
      <MessagesWithCards
        messages={cleanedMessages}
        isLoading={isLoading}
        onSuggestionClick={(text) => sendMessage({ text }, requestOptions)}
      />

      {/* Suggested action chips */}
      <SuggestedActionChips
        actions={suggestedActions}
        onSelect={(action) => sendMessage({ text: action }, requestOptions)}
        isStreaming={isLoading}
      />

      {/* Input */}
      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onStop={stop}
        onCsvUpload={onCsvUpload}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page loader
// ─────────────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { id: chatId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoSendText = searchParams.get("q") ?? undefined;
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [initialTitle, setInitialTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadChat(createClient(), chatId).then((chat) => {
      if (cancelled) return;
      setInitialMessages(chat?.messages ?? []);
      setInitialTitle((chat as { title?: string | null } | null)?.title ?? null);
    });
    return () => { cancelled = true; };
  }, [chatId]);

  if (initialMessages === null) {
    return (
      <div className="bg-background flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <ChatView
      chatId={chatId}
      initialMessages={initialMessages}
      initialTitle={initialTitle}
      autoSendText={autoSendText}
    />
  );
}
