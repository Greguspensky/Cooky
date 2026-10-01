import { useState } from "react";
import cookieAvatar from "../../assets/cookie-avatar.jpg";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";

interface Slide {
  title: string;
  text: string;
}

const SLIDES: Slide[] = [
  {
    title: "Hi, I'm Cookie! 🍪",
    text: "I'll keep your recipes, grocery lists and cooking all in one place, just for the two of you.",
  },
  {
    title: "📖 Recipes",
    text: "Save your recipes, search them, and favorite or rate the ones you love — each of you has your own ratings.",
  },
  {
    title: "🛒 Grocery lists",
    text: "Build a shared list from any recipe. Check things off together in real time, then send it to chat for offline use at the store.",
  },
  {
    title: "👩‍🍳 Cooking mode & Calendar",
    text: "Cook step by step with built-in timers, and schedule what you're making on the Calendar — it tracks what you've cooked and when.",
  },
  {
    title: "💬 Assistant & 📥 Import",
    text: "Chat with me for meal ideas or to update a list — and import recipes straight from a cookbook PDF.",
  },
];

const STORAGE_KEY = "cookie_onboarding_seen";

/** True only the first time this device opens the app — wrapped in try/catch since some
 * Telegram WebViews (private mode, blocked storage) can throw on access. */
export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

function markOnboardingSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Nothing we can do if storage is blocked — onboarding just reappears next time.
  }
}

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  function finish() {
    markOnboardingSeen();
    onDone();
  }

  function next() {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }

  useBackButton(() => setIndex((i) => i - 1), index > 0);
  useMainButton(isLast ? "Get started" : "Next", next);

  return (
    <div className="screen onboarding">
      <img src={cookieAvatar} alt="Cookie" className="onboarding-avatar" />
      <h1>{slide.title}</h1>
      <p className="onboarding-text">{slide.text}</p>

      <div className="onboarding-dots">
        {SLIDES.map((_, i) => (
          <span key={i} className={i === index ? "onboarding-dot active" : "onboarding-dot"} />
        ))}
      </div>

      {!isLast && (
        <button type="button" className="button secondary" onClick={finish}>
          Skip
        </button>
      )}
    </div>
  );
}
