import { useSyncExternalStore } from "react";
import { getDevBackButton, getDevMainButton, subscribeDevButtons } from "./hooks/devButtonBar";

/**
 * On-page stand-in for Telegram's MainButton/BackButton, for `npm run dev` in a plain browser.
 * Stays empty on a real Telegram client, since nothing ever writes to the dev button store there.
 */
export function DevActionBar() {
  const main = useSyncExternalStore(subscribeDevButtons, getDevMainButton);
  const back = useSyncExternalStore(subscribeDevButtons, getDevBackButton);

  if (!main && !back) return null;

  return (
    <div className="dev-action-bar">
      {back && (
        <button className="dev-back-button" onClick={back.onClick}>
          ← {back.text}
        </button>
      )}
      {main && (
        <button className="button dev-main-button" onClick={main.onClick}>
          {main.text}
        </button>
      )}
    </div>
  );
}
