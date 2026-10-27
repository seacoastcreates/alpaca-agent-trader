import Link from "next/link";

/** Shown to visitors in place of owner-only controls. */
export function ReadOnlyNote({ next, children }: { next: string; children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink-2">
      {children} <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-accent hover:underline">Owner sign in</Link>
    </p>
  );
}
