"use client";

import { useEffect, useRef, useState } from "react";
import { SafeLink } from "@/components/safe-link";
import { Briefcase, Loader2 } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface MandateItem {
  id: string;
  name: string;
  vertical: string | null;
  updated_at: string;
}

interface SidebarCampaignsProps {
  activeCampaignId: string | null;
  onSelectCampaign: (id: string | null) => void;
}

export function SidebarCampaigns({
  activeCampaignId,
  onSelectCampaign: _onSelectCampaign,
}: SidebarCampaignsProps) {
  const [mandates, setMandates] = useState<MandateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetch = async () => {
      try {
        const res = await window.fetch("/api/mandates");
        if (!res.ok) return;
        const data = await res.json() as MandateItem[];
        if (!mountedRef.current) return;
        setMandates(data.slice(0, 8));
        setLoading(false);
      } catch {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetch();
    const interval = setInterval(fetch, 10000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent Mandates</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {loading && (
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {!loading && mandates.length === 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<SafeLink href="/" />}
                className="text-muted-foreground"
              >
                <span className="text-xs">No mandates yet</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {mandates.map((mandate) => (
            <SidebarMenuItem key={mandate.id}>
              <SidebarMenuButton
                isActive={activeCampaignId === mandate.id}
                render={<SafeLink href={`/campaigns/${mandate.id}`} />}
                tooltip={mandate.name}
              >
                <div className="relative">
                  <Briefcase className="h-4 w-4 shrink-0" />
                  {/* Blue dot — indicates this mandate is active/recently worked on */}
                  {activeCampaignId === mandate.id && (
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </div>
                <span className="truncate">{mandate.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
