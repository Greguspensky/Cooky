import { useEffect, useRef } from "react";
import { tg } from "../telegram";
import { setDevBackButton, setDevMainButton } from "./devButtonBar";

/**
 * Shows Telegram's MainButton with `text` while this component is mounted, calling `onClick`.
 * Outside Telegram (no `tg`), mirrors the same text/action into DevActionBar instead, so
 * `npm run dev` in a plain browser stays usable.
 *
 * `onClick` is read via a ref rather than as an effect dependency, on purpose: a screen that
 * re-renders often (e.g. a countdown timer ticking every second) would otherwise recreate its
 * callback each render, and including it in the dependency array would hide-then-show the
 * button every time — visible as a constant blip. Only a real change to `text`/`visible` should
 * touch the button; the click always calls whatever `onClick` was passed most recently.
 */
export function useMainButton(text: string, onClick: () => void, visible = true): void {
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const app = tg;
    const handleClick = () => onClickRef.current();
    if (app) {
      if (!visible) return;
      app.MainButton.setText(text).show().onClick(handleClick);
      return () => {
        app.MainButton.offClick(handleClick).hide();
      };
    }
    setDevMainButton(visible ? { text, onClick: handleClick } : null);
    return () => setDevMainButton(null);
  }, [text, visible]);
}

/** Shows Telegram's BackButton (or the dev fallback outside Telegram) while mounted. See
 * useMainButton's note on why `onClick` is read via a ref instead of as a dependency. */
export function useBackButton(onClick: () => void, visible = true): void {
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const app = tg;
    const handleClick = () => onClickRef.current();
    if (app) {
      if (!visible) return;
      app.BackButton.show().onClick(handleClick);
      return () => {
        app.BackButton.offClick(handleClick).hide();
      };
    }
    setDevBackButton(visible ? { text: "Back", onClick: handleClick } : null);
    return () => setDevBackButton(null);
  }, [visible]);
}
