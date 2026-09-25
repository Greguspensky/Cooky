// Thin typed wrapper around window.Telegram.WebApp (loaded by telegram-web-app.js in index.html).
// Only the parts the app uses are typed here.

interface BottomButton {
  setText(text: string): BottomButton;
  show(): BottomButton;
  hide(): BottomButton;
  onClick(cb: () => void): BottomButton;
  offClick(cb: () => void): BottomButton;
}

interface BackButton {
  show(): BackButton;
  hide(): BackButton;
  onClick(cb: () => void): BackButton;
  offClick(cb: () => void): BackButton;
}

export interface WebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; last_name?: string; photo_url?: string };
    start_param?: string;
  };
  platform: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: BottomButton;
  BackButton: BackButton;
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;

/**
 * Signed launch data for /api/auth. Outside Telegram (e.g. `npm run dev` in a browser) it's
 * empty; in development we fall back to VITE_DEV_INIT_DATA from `npm run dev:initdata`.
 */
export function getInitData(): string {
  if (tg?.initData) return tg.initData;
  if (import.meta.env.DEV) return import.meta.env.VITE_DEV_INIT_DATA ?? "";
  return "";
}

/**
 * Deep-link parameter. Telegram passes it as start_param for t.me/<bot>/<app>?startapp=… links;
 * web_app buttons sent by the bot carry it as a `startapp` query parameter instead.
 */
export function getStartParam(): string | undefined {
  return (
    tg?.initDataUnsafe.start_param ||
    new URLSearchParams(window.location.search).get("startapp") ||
    undefined
  );
}

export function haptic(kind: "tap" | "success" | "error"): void {
  try {
    if (kind === "tap") tg?.HapticFeedback.selectionChanged();
    else tg?.HapticFeedback.notificationOccurred(kind);
  } catch {
    // Older clients without haptics.
  }
}
