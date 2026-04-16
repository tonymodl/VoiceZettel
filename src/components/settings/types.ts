import type { LucideIcon } from "lucide-react";

export type SettingsSectionId = "notes" | "tasks" | "widgets" | "ai" | "agents" | "prompts" | "logs" | "admin";

export interface SettingsMenuItem {
    id: SettingsSectionId;
    label: string;
    icon: LucideIcon;
}
