// Recompute and save the most-active universe now, then print the top of the list.
//   npm run universe
async function main() {
  const { refreshUniverse, getUniverse } = await import("../src/lib/universe");
  const t = Date.now();
  const r = await refreshUniverse({ force: true });
  const u = await getUniverse();
  console.log(`${r.count} symbols in ${((Date.now() - t) / 1000).toFixed(1)}s`, r.meta ?? "");
  console.log("top 40:", u?.symbols.slice(0, 40).join(" "));
  console.log("last 20:", u?.symbols.slice(-20).join(" "));
}
main().catch((e) => { console.error(e); process.exit(1); });
