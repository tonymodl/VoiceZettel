import type { LucideIcon } from "lucide-react";

export type SettingsSectionId = "notes" | "widgets" | "ai" | "agents" | "prompts" | "logs" | "admin";

export interface SettingsMenuItem {
    id: SettingsSectionId;
    label: string;
    icon: LucideIcon;
}
