import { desc } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import { JournalButton } from "@/components/JournalButton";
import { Card } from "@/components/ui";
import { db, journal } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const entries = await db.select().from(journal).orderBy(desc(journal.day)).limit(30);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Journal</h1>
          <p className="mt-1 text-sm text-ink-2">Claude writes one entry after each close from the day&apos;s signals, fills and scoreboard.</p>
        </div>
        <JournalButton />
      </div>
      {entries.length === 0 && <p className="text-sm text-muted">No entries yet.</p>}
      {entries.map((e) => (
        <Card key={e.day} title={new Date(`${e.day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}>
          <div className="prose-journal text-sm leading-relaxed"><ReactMarkdown>{e.markdown}</ReactMarkdown></div>
        </Card>
      ))}
    </div>
  );
}
