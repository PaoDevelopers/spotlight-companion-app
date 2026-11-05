import { Link } from "react-router-dom";

const CARDS: [string, string, string][] = [
  ["/hunts", "🧪 Scavenger hunts", "Follow the clues from station to station and race to finish first."],
  ["/library", "📚 Library", "Recommended books. Mark the ones you've read and share what you thought."],
  ["/exhibits", "🔭 Exhibits", "Every installation, with the ones you have visited ticked off."],
];

export function More() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">More to explore</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {CARDS.map(([to, title, text]) => (
          <Link key={to} to={to} className="block rounded-lg bg-card p-4 shadow-sm hover:bg-accent">
            <div className="text-lg font-semibold">{title}</div>
            <p className="text-sm text-muted-foreground">{text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
