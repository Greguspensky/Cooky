// Outside Telegram (e.g. `npm run dev` in a plain browser, per the README's local-dev flow)
// there's no native MainButton/BackButton at all. useMainButton/useBackButton mirror their
// state here when `tg` is unavailable, so DevActionBar can render an on-page stand-in.
// On a real Telegram client this store is never written to, so it renders nothing.

export interface DevButtonConfig {
  text: string;
  onClick: () => void;
}

let mainButton: DevButtonConfig | null = null;
let backButton: DevButtonConfig | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setDevMainButton(config: DevButtonConfig | null): void {
  mainButton = config;
  emit();
}

export function setDevBackButton(config: DevButtonConfig | null): void {
  backButton = config;
  emit();
}

export function getDevMainButton(): DevButtonConfig | null {
  return mainButton;
}

export function getDevBackButton(): DevButtonConfig | null {
  return backButton;
}

export function subscribeDevButtons(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
