import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionUser } from "../api";

interface Member {
  id: string;
  display_name: string;
}

type DbCheck = { state: "checking" } | { state: "ok"; members: Member[] } | { state: "failed"; message: string };

export function RecipesScreen({ user, db }: { user: SessionUser; db: SupabaseClient }) {
  const [check, setCheck] = useState<DbCheck>({ state: "checking" });

  // Reads through RLS with our own JWT, which proves the whole auth chain works.
  useEffect(() => {
    db.from("users")
      .select("id, display_name")
      .order("created_at")
      .then(({ data, error }) => {
        if (error) setCheck({ state: "failed", message: error.message });
        else setCheck({ state: "ok", members: data });
      });
  }, [db]);

  return (
    <div className="screen">
      <h1>Hi, {user.displayName.split(" ")[0]} 👋</h1>
      <p className="muted">{user.householdName}</p>

      <section className="card">
        <h2>Recipes</h2>
        <p className="muted">Your recipe collection arrives in phase 2.</p>
      </section>

      <section className="card">
        <h2>Household</h2>
        {check.state === "checking" && <p className="muted">Checking the database…</p>}
        {check.state === "failed" && (
          <p className="error">
            Database check failed: {check.message}. See “Supabase JWT” in the README.
          </p>
        )}
        {check.state === "ok" && (
          <ul className="members">
            {check.members.map((m) => (
              <li key={m.id}>
                <span className="avatar">{m.display_name.charAt(0).toUpperCase()}</span>
                {m.display_name}
                {m.id === user.id && <span className="muted"> (you)</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
