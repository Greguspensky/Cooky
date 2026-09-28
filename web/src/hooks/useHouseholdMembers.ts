import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Member {
  id: string;
  display_name: string;
}

/** The household's members, fetched once. Small and static enough to load eagerly and share. */
export function useHouseholdMembers(db: SupabaseClient): Member[] {
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    let cancelled = false;
    db.from("users")
      .select("id, display_name")
      .order("created_at")
      .then(({ data }) => {
        if (!cancelled && data) setMembers(data);
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  return members;
}
