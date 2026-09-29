// Lets "Ask the assistant" (from cooking mode) hand a starter question to the Assistant tab.
// AssistantScreen remounts fresh each time you switch to that tab, so a plain module-level
// variable, read once and cleared, is enough — no subscription needed.

let prefill = "";

export function setAssistantPrefill(text: string): void {
  prefill = text;
}

export function consumeAssistantPrefill(): string {
  const text = prefill;
  prefill = "";
  return text;
}
