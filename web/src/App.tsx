import { useEffect, useState } from "react";
import { signIn, type AuthResult } from "./api";
import { getStartParam, haptic } from "./telegram";
import { RecipesTab } from "./screens/recipes/RecipesTab";
import { GroceryListsTab } from "./screens/lists/GroceryListsTab";
import { Placeholder } from "./screens/Placeholder";
import { DevActionBar } from "./DevActionBar";

type Tab = "recipes" | "lists" | "assistant" | "import";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "recipes", label: "Recipes", icon: "📖" },
  { id: "lists", label: "Lists", icon: "🛒" },
  { id: "assistant", label: "Assistant", icon: "💬" },
  { id: "import", label: "Import", icon: "📥" },
];

/** Maps deep links (recipe_<id>, list_<id>, review_<cookbook_id>) to a tab. */
function tabForStartParam(param: string | undefined): Tab {
  if (param?.startsWith("list_")) return "lists";
  if (param?.startsWith("review_")) return "import";
  return "recipes";
}

export function App() {
  const [auth, setAuth] = useState<AuthResult | "loading">("loading");
  const [tab, setTab] = useState<Tab>(() => tabForStartParam(getStartParam()));

  const load = () => {
    setAuth("loading");
    signIn().then(setAuth);
  };
  useEffect(load, []);

  if (auth === "loading") {
    return <div className="center muted">Loading…</div>;
  }
  if (auth.status === "not_allowed") {
    return (
      <div className="center">
        <div className="emoji">🔒</div>
        <h1>Private app</h1>
        <p className="muted">Cooky is a private app for one household and isn't available to this account.</p>
      </div>
    );
  }
  if (auth.status === "no_telegram") {
    return (
      <div className="center">
        <div className="emoji">🍪</div>
        <h1>Open in Telegram</h1>
        <p className="muted">Cooky runs inside Telegram. Open it from the bot's menu button.</p>
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
          <RecipesTab db={auth.db} householdId={auth.user.householdId} myUserId={auth.user.id} />
        )}
        {tab === "lists" && (
          <GroceryListsTab db={auth.db} householdId={auth.user.householdId} myUserId={auth.user.id} />
        )}
        {tab === "assistant" && <Placeholder icon="💬" title="Assistant" text="Your cooking assistant arrives in phase 6." />}
        {tab === "import" && <Placeholder icon="📥" title="Import" text="Cookbook PDF import arrives in phase 3." />}
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
