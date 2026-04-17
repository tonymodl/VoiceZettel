import type { LucideIcon } from "lucide-react";

export type SettingsSectionId = "notes" | "tasks" | "widgets" | "ai" | "context" | "agents" | "prompts" | "logs" | "admin" | "docs";

export interface SettingsMenuItem {
    id: SettingsSectionId;
    label: string;
    icon: LucideIcon;
}
