import { useEffect, useState } from "react";
import { signIn, type AuthResult } from "./api";
import { getStartParam, haptic } from "./telegram";
import { RecipesTab } from "./screens/recipes/RecipesTab";
import { GroceryListsTab } from "./screens/lists/GroceryListsTab";
import { AssistantScreen } from "./screens/assistant/AssistantScreen";
import { CalendarTab } from "./screens/calendar/CalendarTab";
import { ImportTab } from "./screens/import/ImportTab";
import { DevActionBar } from "./DevActionBar";
import { setAssistantPrefill } from "./hooks/assistantPrefill";

type Tab = "recipes" | "lists" | "calendar" | "assistant" | "import";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "recipes", label: "Recipes", icon: "📖" },
  { id: "lists", label: "Lists", icon: "🛒" },
  { id: "calendar", label: "Calendar", icon: "📅" },
  { id: "assistant", label: "Assistant", icon: "💬" },
  { id: "import", label: "Import", icon: "📥" },
];

/** Maps deep links (recipe_<id>, list_<id>, review_<cookbook_id>) to a tab. */
function tabForStartParam(param: string | undefined): Tab {
  if (param?.startsWith("list_")) return "lists";
  if (param?.startsWith("review_")) return "import";
  return "recipes";
}

/** For a `review_<cookbook_id>` deep link, the cookbook id to open straight into. */
function cookbookIdForStartParam(param: string | undefined): string | undefined {
  return param?.startsWith("review_") ? param.slice("review_".length) : undefined;
}

export function App() {
  const [auth, setAuth] = useState<AuthResult | "loading">("loading");
  const [tab, setTab] = useState<Tab>(() => tabForStartParam(getStartParam()));
  const [initialCookbookId] = useState<string | undefined>(() => cookbookIdForStartParam(getStartParam()));

  const load = () => {
    setAuth("loading");
    signIn().then(setAuth);
  };
  useEffect(load, []);

  /** Cooking mode's "Ask the assistant" hands off a starter question and switches tabs. */
  function askAssistant(prefill: string) {
    setAssistantPrefill(prefill);
    setTab("assistant");
  }

  if (auth === "loading") {
    return <div className="center muted">Loading…</div>;
  }
  if (auth.status === "not_allowed") {
    return (
      <div className="center">
        <div className="emoji">🔒</div>
        <h1>Private app</h1>
        <p className="muted">Cookie is a private app for one household and isn't available to this account.</p>
      </div>
    );
  }
  if (auth.status === "no_telegram") {
    return (
      <div className="center">
        <div className="emoji">🍪</div>
        <h1>Open in Telegram</h1>
        <p className="muted">Cookie runs inside Telegram. Open it from the bot's menu button.</p>
      </div>
    );
  }
  if (auth.status === "error") {
    return (
      <div className="center">
        <div className="emoji">⚠️</div>
        <h1>Something went wrong</h1>
        <p className="muted">{auth.message}</p>
        <button className="button" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="content">
        {tab === "recipes" && (
          <RecipesTab
            db={auth.db}
            householdId={auth.user.householdId}
            myUserId={auth.user.id}
            onAskAssistant={askAssistant}
          />
        )}
        {tab === "lists" && (
          <GroceryListsTab db={auth.db} householdId={auth.user.householdId} myUserId={auth.user.id} />
        )}
        {tab === "calendar" && (
          <CalendarTab db={auth.db} householdId={auth.user.householdId} myUserId={auth.user.id} />
        )}
        {tab === "assistant" && <AssistantScreen db={auth.db} />}
        {tab === "import" && (
          <ImportTab
            db={auth.db}
            householdId={auth.user.householdId}
            myUserId={auth.user.id}
            initialCookbookId={initialCookbookId}
          />
        )}
      </main>
      <DevActionBar />
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? "tab active" : "tab"}
            onClick={() => {
              if (t.id !== tab) haptic("tap");
              setTab(t.id);
            }}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
