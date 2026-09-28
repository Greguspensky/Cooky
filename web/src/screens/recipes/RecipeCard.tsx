import type { Member } from "../../hooks/useHouseholdMembers";
import type { RecipeWithMeta } from "../../lib/recipesApi";

export function RecipeCard({
  recipe,
  members,
  imageUrl,
  onClick,
}: {
  recipe: RecipeWithMeta;
  members: Member[];
  imageUrl?: string;
  onClick: () => void;
}) {
  const metaByUser = new Map(recipe.recipe_user_meta.map((m) => [m.user_id, m]));

  return (
    <button className="recipe-card" onClick={onClick}>
      <div className="recipe-card-image">
        {imageUrl ? <img src={imageUrl} alt="" /> : <span className="recipe-card-placeholder">🍽️</span>}
      </div>
      <div className="recipe-card-body">
        <h3>{recipe.title}</h3>
        <p className="muted recipe-card-meta">
          {[recipe.total_minutes > 0 ? `${recipe.total_minutes} min` : null, recipe.cuisine]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {recipe.tags.length > 0 && (
          <div className="chips">
            {recipe.tags.slice(0, 3).map((t) => (
              <span key={t} className="chip-static">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="recipe-card-people">
          {members.map((m) => {
            const meta = metaByUser.get(m.id);
            return (
              <span key={m.id} className={meta?.is_favorite ? "person favorite" : "person"}>
                {meta?.is_favorite ? "♥" : "♡"} {m.display_name.split(" ")[0]}
                {meta?.rating ? ` ${"★".repeat(meta.rating)}` : ""}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}
