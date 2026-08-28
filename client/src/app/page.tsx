"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
const PLACEHOLDER_PROMPTS = [
  "Find HVAC businesses in Texas with $2M+ revenue ready for acquisition",
  "Show me top scored acquisition targets in my pipeline",
  "Draft outreach emails for the Dallas mandate",
  "How is my current mandate performing?",
  "Find plumbing businesses in Florida ready for acquisition",
];

// Clicking a chip populates the input — user edits then sends manually
const SUGGESTED_CHIPS = [
  {
    label: "Discover targets",
    prompt: "Find HVAC businesses in Texas with $2M+ revenue ready for acquisition",
  },
  {
    label: "Enrich my list",
    prompt: "I have a list of businesses I want to enrich and score for acquisition readiness",
  },
  {
    label: "Launch outreach",
    prompt: "Set up outreach for my top acquisition targets in the Dallas mandate",
  },
  {
    label: "Track performance",
    prompt: "How is my current mandate performing? Show me outreach stats",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isAnimating, setIsAnimating] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animStateRef = useRef({
    promptIdx: 0,
    charIdx: 0,
    deleting: false,
    paused: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  });

  // Typewriter — animates the input value directly
  useEffect(() => {
    if (!isAnimating) return;

    const state = animStateRef.current;

    const tick = () => {
      if (!animStateRef.current) return;
      const current = PLACEHOLDER_PROMPTS[state.promptIdx];

      if (state.paused) {
        state.paused = false;
        state.deleting = true;
        state.timer = setTimeout(tick, 1800);
        return;
      }

      if (!state.deleting) {
        if (state.charIdx < current.length) {
          state.charIdx++;
          setInput(current.slice(0, state.charIdx));
          state.timer = setTimeout(tick, 48);
        } else {
          state.paused = true;
          state.timer = setTimeout(tick, 0);
        }
      } else {
        if (state.charIdx > 0) {
          state.charIdx--;
          setInput(current.slice(0, state.charIdx));
          state.timer = setTimeout(tick, 20);
        } else {
          state.deleting = false;
          state.promptIdx = (state.promptIdx + 1) % PLACEHOLDER_PROMPTS.length;
          state.timer = setTimeout(tick, 400);
        }
      }
    };

    state.timer = setTimeout(tick, 800);
    return () => {
      if (state.timer) clearTimeout(state.timer);
    };
  }, [isAnimating]);

  const stopAnimation = () => {
    if (!isAnimating) return;
    setIsAnimating(false);
    if (animStateRef.current.timer) clearTimeout(animStateRef.current.timer);
    setInput("");
  };

  const handleFocus = () => stopAnimation();

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    stopAnimation();
    setInput(e.target.value);
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isAnimating) return;
    const id = crypto.randomUUID();
    router.push(`/chat/${id}?q=${encodeURIComponent(text)}`);
  };

  // Chip click — populate input only, stop animation, focus
  const onChipClick = (prompt: string) => {
    stopAnimation();
    setInput(prompt);
    setTimeout(() => {
      textareaRef.current?.focus();
      // Move cursor to end
      const len = prompt.length;
      textareaRef.current?.setSelectionRange(len, len);
      // Resize textarea
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    }, 10);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      // Stop animation, populate input with enrichment prompt
      stopAnimation();
      const prompt = `I have uploaded a CSV file called "${file.name}" with a list of businesses. Please enrich and score them for acquisition readiness.`;
      setInput(prompt);
      setTimeout(() => textareaRef.current?.focus(), 10);
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = "";
  };

  const handleBlur = () => {
    // Resume animation if user left the input empty
    if (!input.trim()) {
      setIsAnimating(true);
      animStateRef.current.charIdx = 0;
      animStateRef.current.deleting = false;
      animStateRef.current.paused = false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-16">
      {/* Heading */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Acquisition Intelligence
        </h1>
        <p className="text-muted-foreground mt-2.5 text-sm sm:text-base">
          Discover, enrich, and reach acquisition targets. Ask anything.
        </p>
      </div>

      {/* Large centered input — Claude/Ahrefs style */}
      <div className="w-full max-w-2xl">
        <div className="border-border bg-background focus-within:border-foreground/30 focus-within:ring-1 focus-within:ring-foreground/20 relative rounded-2xl border shadow-sm transition-all">
          {/* Hidden CSV file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvUpload}
          />

          {/* Textarea — taller, more breathing room */}
          <textarea
            ref={textareaRef}
            value={input}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder=""
            rows={3}
            className="text-foreground w-full resize-none bg-transparent px-5 pb-14 pt-4 text-sm leading-relaxed outline-none"
            style={{ minHeight: "100px", maxHeight: "240px" }}
          />

          {/* Bottom bar — attachment on left, send on right */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3">
            {/* + button — opens CSV file picker */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              title="Upload CSV of businesses for enrichment"
            >
              <Plus className="h-4 w-4" />
            </button>

            {/* Send button */}
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!input.trim() || isAnimating}
              className="h-8 w-8 rounded-xl"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Suggested use case chips — clicking populates input, user edits then sends */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUGGESTED_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onChipClick(chip.prompt)}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

