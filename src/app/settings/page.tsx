import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
