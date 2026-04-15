import { z } from "zod";

export const NotificationLevelSchema = z.enum(["info", "warning", "error"]);
export type NotificationLevel = z.infer<typeof NotificationLevelSchema>;

export const NotificationCategorySchema = z.enum(["system", "whats_new"]);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export interface AppNotification {
    id: string;
    message: string;
    level: NotificationLevel;
    timestamp: string;
    read: boolean;
    category?: NotificationCategory;
}
