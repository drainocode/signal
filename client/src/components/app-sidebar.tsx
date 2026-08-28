"use client";
import { SafeLink } from "@/components/safe-link";
import { usePathname } from "next/navigation";
import {
  Home,
  Briefcase,
  Mail,
  Settings,
} from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { SidebarCampaigns } from "@/components/sidebar-campaigns";
import { useCampaign } from "@/lib/campaign-context";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Home", url: "/", icon: Home },
  { title: "All Mandates", url: "/campaigns", icon: Briefcase },
  { title: "Outreach", url: "/outreach", icon: Mail },
];

const defaultUser = { name: "", email: "", avatar: "" };

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { activeCampaignId, setActiveCampaignId } = useCampaign();
  const pathname = usePathname();

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<SafeLink href="/" />}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">T</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Tractus</span>
                <span className="text-sidebar-foreground/50 truncate text-xs">
                  Acquisition Intelligence
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.url === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.url);

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<SafeLink href={item.url} />}
                      tooltip={item.title}
                      isActive={isActive}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarCampaigns
          activeCampaignId={activeCampaignId}
          onSelectCampaign={setActiveCampaignId}
        />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<SafeLink href="/settings" />}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <NavUser user={defaultUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
