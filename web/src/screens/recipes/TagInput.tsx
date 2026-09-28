import { useMemo, useState } from "react";

export function TagInput({
  tags,
  onChange,
  suggestions,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [text, setText] = useState("");

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return suggestions.filter((s) => s.toLowerCase().includes(q) && !tags.includes(s)).slice(0, 5);
  }, [text, suggestions, tags]);

  function addTag(raw: string) {
    const tag = raw.trim();
    setText("");
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="tag-input">
      {tags.length > 0 && (
        <div className="tag-chips">
          {tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={text}
        placeholder="Add a tag"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(text);
          }
        }}
      />
      {matches.length > 0 && (
        <ul className="tag-suggestions">
          {matches.map((m) => (
            <li key={m}>
              <button type="button" onClick={() => addTag(m)}>
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
