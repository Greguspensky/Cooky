import { useEffect } from "react";
import { tg } from "../telegram";
import { setDevBackButton, setDevMainButton } from "./devButtonBar";

/**
 * Shows Telegram's MainButton with `text` while this component is mounted, calling `onClick`.
 * Outside Telegram (no `tg`), mirrors the same text/action into DevActionBar instead, so
 * `npm run dev` in a plain browser stays usable.
 */
export function useMainButton(text: string, onClick: () => void, visible = true): void {
  useEffect(() => {
    const app = tg;
    if (app) {
      if (!visible) return;
      app.MainButton.setText(text).show().onClick(onClick);
      return () => {
        app.MainButton.offClick(onClick).hide();
      };
    }
    setDevMainButton(visible ? { text, onClick } : null);
    return () => setDevMainButton(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, onClick, visible]);
}

/** Shows Telegram's BackButton (or the dev fallback outside Telegram) while mounted. */
export function useBackButton(onClick: () => void, visible = true): void {
  useEffect(() => {
    const app = tg;
    if (app) {
      if (!visible) return;
      app.BackButton.show().onClick(onClick);
      return () => {
        app.BackButton.offClick(onClick).hide();
      };
    }
    setDevBackButton(visible ? { text: "Back", onClick } : null);
    return () => setDevBackButton(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClick, visible]);
}
