import { safeNext } from "@/lib/auth";

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't allowed to sign in.",
  expired: "The sign-in expired. Try again.",
  google: "Google sign-in failed. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-3 rounded-lg border border-line bg-panel p-6">
      <h1 className="font-semibold">Sign in</h1>
      <p className="text-sm text-ink-2">Only the owner can sign in. The Strategies page is open to everyone.</p>
      {error && <p className="text-sm text-bad">{ERRORS[error] ?? "Sign-in failed."}</p>}
      <a
        href={`/api/auth/google?next=${encodeURIComponent(safeNext(next))}`}
        className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-white dark:text-black"
      >Sign in with Google</a>
    </div>
  );
}
