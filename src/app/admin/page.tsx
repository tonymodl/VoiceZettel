"use client";

import { lazy, Suspense } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { LogsTab } from "@/components/admin/LogsTab";
import { PromptsTab } from "@/components/admin/PromptsTab";
import { UsersTab } from "@/components/admin/UsersTab";
import MissionControlTab from "@/components/admin/MissionControlTab";
import WorkspaceTab from "@/components/admin/WorkspaceTab";
import { useAdminStore } from "@/stores/adminStore";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

// Antigravity Phase 4: Lazy load heavy admin tabs (84KB + 78KB = 162KB)
// These are loaded only when user switches to the corresponding tab.
const DashboardTab = lazy(() =>
    import("@/components/admin/DashboardTab").then((m) => ({ default: m.DashboardTab }))
);
const TelegramTab = lazy(() =>
    import("@/components/admin/TelegramTab").then((m) => ({ default: m.TelegramTab }))
);
const DunbarTab = lazy(() =>
    import("@/components/admin/DunbarTab").then((m) => ({ default: m.DunbarTab }))
);

function LoadingSkeleton() {
    return (
        <div className="space-y-4 animate-pulse">
            <div className="h-6 w-48 rounded-lg bg-zinc-800" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-32 rounded-xl bg-zinc-800/50" />
                ))}
            </div>
        </div>
    );
}

const TAB_TITLES: Record<string, string> = {
    dashboard: "📊 Дашборд",
    logs: "📋 Логи",
    prompts: "🧠 Промпты",
    telegram: "📨 Telegram",
    dunbar: "👥 Круги Данбара",
    users: "👥 Пользователи",
    "mission-control": "🛰️ Mission Control",
    workspace: "📄 Документы",
};

export default function AdminPage() {
    const activeTab = useAdminStore((s) => s.activeTab);

    return (
        <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
            {/* Sidebar — hidden on mobile, visible on desktop */}
            <AdminSidebar />

            {/* Main content — always full width on mobile */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Top bar */}
                <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-zinc-950/90 px-4 backdrop-blur-xl">
                    {/* Spacer for mobile hamburger */}
                    <div className="w-9 md:hidden" />

                    <h1 className="text-sm font-semibold text-zinc-200">
                        {TAB_TITLES[activeTab]}
                    </h1>

                    <div className="flex-1" />

                    {/* Metrics — hidden on small mobile */}
                    <div className="hidden items-center gap-2 sm:flex">
                        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[11px]">
                            <span className="text-zinc-600">RAM</span>
                            <span className="font-medium text-zinc-400">2.1 GB</span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[11px]">
                            <span className="text-zinc-600">CPU</span>
                            <span className="font-medium text-zinc-400">8%</span>
                        </div>
                    </div>

                    <Link
                        href="/"
                        className="flex items-center gap-1 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[11px] text-violet-400 transition-all hover:bg-violet-500/10 hover:shadow-[0_0_10px_rgba(139,92,246,0.15)]"
                    >
                        <ArrowLeft className="size-3" />
                        <span className="hidden sm:inline">Назад</span>
                    </Link>
                </header>

                {/* Tab content */}
                <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4">
                    {activeTab === "dashboard" && (
                        <Suspense fallback={<LoadingSkeleton />}>
                            <DashboardTab />
                        </Suspense>
                    )}
                    {activeTab === "logs" && <LogsTab />}
                    {activeTab === "prompts" && <PromptsTab />}
                    {activeTab === "telegram" && (
                        <Suspense fallback={<LoadingSkeleton />}>
                            <TelegramTab />
                        </Suspense>
                    )}
                    {activeTab === "users" && <UsersTab />}
                    {activeTab === "dunbar" && (
                        <Suspense fallback={<LoadingSkeleton />}>
                            <DunbarTab />
                        </Suspense>
                    )}
                    {activeTab === "mission-control" && <MissionControlTab />}
                    {activeTab === "workspace" && <WorkspaceTab />}
                </main>
            </div>
        </div>
    );
}
