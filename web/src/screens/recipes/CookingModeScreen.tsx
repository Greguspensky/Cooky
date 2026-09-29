import { useEffect, useMemo, useState } from "react";
import type { Ingredient } from "../../../../lib/recipe";
import type { RecipeWithMeta } from "../../lib/recipesApi";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import { haptic } from "../../telegram";

interface ActiveTimer {
  id: string;
  label: string;
  endsAt: number;
  done: boolean;
}

/** Two quick tones via the Web Audio API — no audio asset needed. Called once per second for as
 * long as a timer sits "done" and undismissed, so it reads as an alarm ringing, not one beep. */
function playAlarm(): void {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [0, 0.18].forEach((offset) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.15);
    });
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Some browsers require a user gesture before audio; a missed beep isn't worth surfacing.
  }
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CookingModeScreen({
  recipe,
  scaledIngredients,
  onExit,
  onAskAssistant,
}: {
  recipe: RecipeWithMeta;
  scaledIngredients: Ingredient[];
  onExit: () => void;
  onAskAssistant: (prefill: string) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [timers, setTimers] = useState<ActiveTimer[]>([]);

  const steps = recipe.steps;
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  // Keeps the screen on for as long as cooking mode is open, where the browser supports it.
  useEffect(() => {
    let sentinel: WakeLockSentinel | undefined;
    navigator.wakeLock
      ?.request("screen")
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {
        // Not fatal — some platforms (older iOS WebViews) don't support this yet.
      });
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, []);

  // One shared ticker for however many timers are running, rather than one interval each.
  // While at least one timer is "done", this rings every second until it's dismissed — a single
  // beep at zero is too easy to miss over the sound of actual cooking.
  useEffect(() => {
    const id = setInterval(() => {
      setTimers((prev) => {
        if (prev.length === 0) return prev; // nothing to update or ring; skip the re-render
        const next = prev.map((t) => (!t.done && Date.now() >= t.endsAt ? { ...t, done: true } : t));
        if (next.some((t) => t.done)) {
          haptic("success");
          playAlarm();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const anyStepTagged = useMemo(() => steps.some((s) => s.ingredient_ids.length > 0), [steps]);
  const stepIngredients = useMemo(() => {
    if (!step) return [];
    if (step.ingredient_ids.length > 0) {
      return scaledIngredients.filter((i) => step.ingredient_ids.includes(i.id));
    }
    // Only fall back to the full list when nothing in the recipe was tagged at all — a step
    // that's genuinely ingredient-free (e.g. "let it rest") should just show nothing.
    return anyStepTagged ? [] : scaledIngredients;
  }, [step, scaledIngredients, anyStepTagged]);

  function startTimer() {
    if (!step?.timer_seconds) return;
    haptic("tap");
    setTimers((prev) => [
      ...prev,
      { id: `${stepIndex}-${Date.now()}`, label: `Step ${stepIndex + 1}`, endsAt: Date.now() + step.timer_seconds! * 1000, done: false },
    ]);
  }

  function dismissTimer(id: string) {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }

  function goNext() {
    if (isLastStep) {
      onExit();
      return;
    }
    haptic("tap");
    setStepIndex((i) => i + 1);
  }

  function goPrevious() {
    haptic("tap");
    setStepIndex((i) => Math.max(0, i - 1));
  }

  useBackButton(onExit);
  useMainButton(isLastStep ? "Finish" : "Next step →", goNext);

  if (!step) {
    return (
      <div className="screen center">
        <p className="muted">This recipe has no steps yet.</p>
        <button className="button secondary" onClick={onExit}>
          Back to recipe
        </button>
      </div>
    );
  }

  return (
    <div className="screen cooking-mode">
      {timers.length > 0 && (
        <div className="timer-tray">
          {timers.map((t) => (
            <div key={t.id} className={t.done ? "timer-chip done" : "timer-chip"}>
              <span>
                {t.label}: {t.done ? "Done! 🔔" : formatRemaining(t.endsAt - Date.now())}
              </span>
              <button type="button" onClick={() => dismissTimer(t.id)} aria-label="Dismiss timer">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="muted cooking-step-count">
        Step {stepIndex + 1} of {steps.length}
      </p>
      <p className="cooking-step-text">{step.text}</p>

      {stepIngredients.length > 0 && (
        <div className="card cooking-ingredients">
          <h2>For this step</h2>
          <ul className="ingredient-list">
            {stepIngredients.map((ing) => (
              <li key={ing.id}>
                {ing.qty != null && (
                  <strong>
                    {ing.qty}
                    {ing.unit ? ` ${ing.unit}` : ""}{" "}
                  </strong>
                )}
                {ing.item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.timer_seconds != null && (
        <button type="button" className="button secondary" onClick={startTimer}>
          ⏱ Start timer ({Math.round(step.timer_seconds / 60)} min)
        </button>
      )}

      <button
        type="button"
        className="button secondary"
        onClick={() => onAskAssistant(`About "${recipe.title}", step ${stepIndex + 1} ("${step.text}"): `)}
      >
        💬 Ask the assistant
      </button>

      <div className="cooking-nav">
        <button type="button" className="button secondary" onClick={goPrevious} disabled={stepIndex === 0}>
          ‹ Previous
        </button>
      </div>
    </div>
  );
}
