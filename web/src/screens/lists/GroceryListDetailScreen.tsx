import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STORE_SECTION_LABELS,
  STORE_SECTION_ORDER,
  guessStoreSection,
  type GroceryItem,
  type GroceryList,
  type StoreSection,
} from "../../../../lib/grocery";
import type { Member } from "../../hooks/useHouseholdMembers";
import { useBackButton, useMainButton } from "../../hooks/useTelegramButtons";
import {
  addGroceryItem,
  deleteGroceryItem,
  fetchGroceryList,
  sendListToChat,
  setItemChecked,
  setItemSection,
  setListStatus,
  sortItems,
} from "../../lib/groceryApi";
import { haptic } from "../../telegram";

export function GroceryListDetailScreen({
  db,
  listId,
  myUserId,
  members,
  onBack,
}: {
  db: SupabaseClient;
  listId: string;
  myUserId: string;
  members: Member[];
  onBack: () => void;
}) {
  const [list, setList] = useState<GroceryList | null>(null);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [newItem, setNewItem] = useState("");

  function reload() {
    fetchGroceryList(db, listId)
      .then(({ list, items }) => {
        setList(list);
        setItems(items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this list."));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [db, listId]);

  // Live updates: when your partner checks something off, it updates here too.
  useEffect(() => {
    const channel = db
      .channel(`grocery-items-${listId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "grocery_items", filter: `list_id=eq.${listId}` }, reload)
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, listId]);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const grouped = useMemo(() => groupBySection(items), [items]);

  async function toggle(item: GroceryItem) {
    haptic("tap");
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked, checked_by: !i.checked ? myUserId : null } : i)),
    );
    try {
      await setItemChecked(db, item.id, !item.checked, myUserId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that item.");
      reload();
    }
  }

  async function changeSection(item: GroceryItem, section: StoreSection) {
    setItems((prev) => sortItems(prev.map((i) => (i.id === item.id ? { ...i, store_section: section } : i))));
    try {
      await setItemSection(db, item.id, section);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't move that item.");
      reload();
    }
  }

  async function removeItem(item: GroceryItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await deleteGroceryItem(db, item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that item.");
      reload();
    }
  }

  async function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    try {
      await addGroceryItem(db, listId, myUserId, {
        item: text,
        qty: null,
        unit: null,
        store_section: guessStoreSection(text),
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that item.");
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      await sendListToChat(listId);
      haptic("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the list.");
      haptic("error");
    } finally {
      setSending(false);
    }
  }

  async function toggleDone() {
    if (!list) return;
    const status = list.status === "active" ? "done" : "active";
    setList({ ...list, status });
    await setListStatus(db, listId, status).catch(reload);
  }

  useBackButton(onBack);
  useMainButton(sending ? "Sending…" : "Send to chat", send, !!list && list.status === "active");

  if (error && !list) return <p className="error screen">{error}</p>;
  if (!list) return <p className="muted screen">Loading…</p>;

  return (
    <div className="screen">
      <div className="row-between">
        <h1>{list.name}</h1>
        <button className="button secondary compact" onClick={toggleDone}>
          {list.status === "active" ? "Mark as done" : "Reopen"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="add-item-row">
        <input
          placeholder="Add an item…"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
        />
        <button type="button" className="button secondary compact" onClick={addItem}>
          Add
        </button>
      </div>

      {items.length === 0 && <p className="muted">No items yet.</p>}

      {grouped.map(([section, sectionItems]) => (
        <section className="card" key={section}>
          <h2>{STORE_SECTION_LABELS[section]}</h2>
          <ul className="grocery-item-list">
            {sectionItems.map((item) => (
              <li key={item.id} className={item.checked ? "grocery-item checked" : "grocery-item"}>
                <label className="grocery-item-main">
                  <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
                  <span>
                    {item.qty != null && (
                      <strong>
                        {item.qty}
                        {item.unit ? ` ${item.unit}` : ""}{" "}
                      </strong>
                    )}
                    {item.item}
                  </span>
                </label>
                <div className="grocery-item-meta">
                  {item.checked_by && membersById.get(item.checked_by) && (
                    <span className="avatar small" title={membersById.get(item.checked_by)!.display_name}>
                      {membersById.get(item.checked_by)!.display_name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <select value={item.store_section} onChange={(e) => changeSection(item, e.target.value as StoreSection)}>
                    {STORE_SECTION_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STORE_SECTION_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="remove" onClick={() => removeItem(item)} aria-label="Remove item">
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupBySection(items: GroceryItem[]): [StoreSection, GroceryItem[]][] {
  const bySection = new Map<StoreSection, GroceryItem[]>();
  for (const item of items) {
    const list = bySection.get(item.store_section) ?? [];
    list.push(item);
    bySection.set(item.store_section, list);
  }
  return STORE_SECTION_ORDER.filter((s) => bySection.has(s)).map((s) => [s, bySection.get(s)!]);
}
