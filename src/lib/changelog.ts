import type { NotificationLevel } from "@/types/notification";

export interface ChangelogEntry {
    id: string;
    message: string;
    level: NotificationLevel;
    date: string;
}

/**
 * Changelog — добавляйте новые записи СВЕРХУ.
 * id должен быть уникальным (используется для отслеживания прочитанных).
 */
export const CHANGELOG: ChangelogEntry[] = [
    {
        id: "telegram-export-dashboard-2026-04-15",
        message: "📊 Экспорт Telegram переработан — отслеживание статусов, журнал ошибок, все чаты на одном экране",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "user-management-2026-04-15",
        message: "👥 Управление пользователями — добавляйте email в админке, только они смогут войти через Google",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "whats-new-section-2026-04-15",
        message: "📢 В колокольчике появилась рубрика «Что нового» — следите за обновлениями!",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "multimodal-chat-2026-04-15",
        message: "🖼 Мультимодальный чат — прикрепляйте фото и документы, ИИ их поймёт и обсудит с вами",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "telegram-delete-obsidian-2026-04-15",
        message: "🗑 Telegram: кнопка «Удалить из Obsidian» для экспортированных чатов + прогресс-бары с процентами",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "telegram-live-sync-blacklist-2026-04-15",
        message: "🚫 Live-синхронизация: можно банить ненужные чаты прямо из ленты",
        level: "info",
        date: "2026-04-15",
    },
    {
        id: "lavalier-mode-2026-02-27",
        message: "🎙 Режим петлички — свайпни шар влево, ИИ слушает встречу и делает протокол",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "attach-files-2026-02-27",
        message: "🆕 Добавлена функция прикрепления файлов (фото, документы, аудио) к чату",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "ai-log-analysis-2026-02-27",
        message: "🤖 В настройках появилась кнопка «Анализ ИИ» — ИИ проверит логи за вас",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "google-auth-2026-02-27",
        message: "🔐 Добавлена авторизация через Google-аккаунт",
        level: "info",
        date: "2026-02-27",
    },
    {
        id: "notification-bell-2026-02-26",
        message: "🔔 Уведомления теперь в колокольчике в шапке",
        level: "info",
        date: "2026-02-26",
    },
    {
        id: "counter-sound-2026-02-26",
        message: "🔊 Добавлен звук при обновлении счётчиков",
        level: "info",
        date: "2026-02-26",
    },
];
