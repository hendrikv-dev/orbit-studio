import { BookOpen, Play, X } from "lucide-react";
import type { LibraryCategory, LibraryItem, LibraryItemId } from "../../data/productFlow";

interface LibraryViewProps {
  categories: LibraryCategory[];
  items: LibraryItem[];
  storyItem: LibraryItem | null;
  onLaunchGuided: (itemId: LibraryItemId) => void;
  onReadStory: (item: LibraryItem) => void;
  onCloseStory: () => void;
}

function itemsForCategory(category: LibraryCategory, items: LibraryItem[]): LibraryItem[] {
  return category.itemIds
    .map((itemId) => items.find((item) => item.id === itemId))
    .filter((item): item is LibraryItem => Boolean(item));
}

function LibraryCard({
  item,
  featured = false,
  onLaunchGuided,
  onReadStory,
}: {
  item: LibraryItem;
  featured?: boolean;
  onLaunchGuided: (itemId: LibraryItemId) => void;
  onReadStory: (item: LibraryItem) => void;
}) {
  return (
    <article className={`library-card ${featured ? "featured-card" : ""}`}>
      <img className={`library-card-image tone-${item.imageTone}`} src={item.image} alt="" />
      <div className="library-card-scrim" />
      <div className="library-card-copy">
        <span>{item.eyebrow}</span>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
      </div>
      <div className="library-card-actions">
        <button type="button" onClick={() => onReadStory(item)}>
          <BookOpen size={16} />
          <span>Read Story</span>
        </button>
        <button className="primary" type="button" onClick={() => onLaunchGuided(item.id)}>
          <Play size={16} />
          <span>Launch Guided Mode</span>
        </button>
      </div>
    </article>
  );
}

export function LibraryView({
  categories,
  items,
  storyItem,
  onLaunchGuided,
  onReadStory,
  onCloseStory,
}: LibraryViewProps) {
  const heroItem = items.find((item) => item.id === "apollo-11") ?? items[0];

  return (
    <main className="library-shell">
      <header className="library-header">
        <div className="library-brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>Orbit Studio</strong>
            <span>Library</span>
          </div>
        </div>
      </header>

      <section className="library-hero" aria-label="Featured">
        <img className="library-hero-image" src={heroItem.image} alt="" />
        <div className="library-hero-scrim" />
        <div className="library-hero-copy">
          <span>{heroItem.eyebrow}</span>
          <h1>{heroItem.title}</h1>
          <p>{heroItem.summary}</p>
          <div className="library-hero-actions">
            <button type="button" onClick={() => onReadStory(heroItem)}>
              <BookOpen size={17} />
              <span>Read Story</span>
            </button>
            <button className="primary" type="button" onClick={() => onLaunchGuided(heroItem.id)}>
              <Play size={17} />
              <span>Launch Guided Mode</span>
            </button>
          </div>
        </div>
      </section>

      <div className="library-rows">
        {categories.map((category) => (
          <section className="library-row" key={category.id} aria-labelledby={`${category.id}-row`}>
            <h2 id={`${category.id}-row`}>{category.title}</h2>
            <div className="library-card-strip">
              {itemsForCategory(category, items).map((item) => (
                <LibraryCard
                  featured={category.id === "featured"}
                  item={item}
                  key={`${category.id}-${item.id}`}
                  onLaunchGuided={onLaunchGuided}
                  onReadStory={onReadStory}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {storyItem && (
        <div className="story-dialog-backdrop" role="presentation" onClick={onCloseStory}>
          <section
            className="story-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="icon-button story-dialog-close" type="button" onClick={onCloseStory}>
              <X size={17} />
            </button>
            <span>{storyItem.eyebrow}</span>
            <h2 id="story-dialog-title">{storyItem.title}</h2>
            <p>
              Story mode is reserved for the editorial reading experience. The primary flow now
              continues through Guided Mode and into Orbit Mode.
            </p>
            <button className="primary" type="button" onClick={() => onLaunchGuided(storyItem.id)}>
              <Play size={16} />
              <span>Launch Guided Mode</span>
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
