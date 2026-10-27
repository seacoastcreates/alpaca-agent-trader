import { ReadOnlyNote } from "@/components/ReadOnlyNote";
import { SettingsForm } from "@/components/SettingsForm";
import { isOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getUniverse } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Refresh now" recomputes the universe from ~12k symbols

export default async function SettingsPage() {
  const [settings, u, owner] = await Promise.all([getSettings(), getUniverse(), isOwner()]);
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      {!owner && <ReadOnlyNote next="/settings">Viewing read-only.</ReadOnlyNote>}
      <SettingsForm
        canEdit={owner}
        initial={settings}
        universe={u ? { count: u.symbols.length, etfs: u.meta.etfs?.length ?? 0, computedAt: u.computedAt.toISOString(), preview: u.symbols.slice(0, 60) } : null}
      />
    </div>
  );
}
