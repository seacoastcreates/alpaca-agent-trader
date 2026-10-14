import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";
import { getUniverse } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Refresh now" recomputes the universe from ~12k symbols

export default async function SettingsPage() {
  const [settings, u] = await Promise.all([getSettings(), getUniverse()]);
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <SettingsForm
        initial={settings}
        universe={u ? { count: u.symbols.length, computedAt: u.computedAt.toISOString(), preview: u.symbols.slice(0, 60) } : null}
      />
    </div>
  );
}
