import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as alpaca from "@/lib/alpaca";
import { companyInfo } from "@/lib/company";
import { db, positions, signals, trades } from "@/lib/db";
import { priorHigh, priorLow, round, rsi, sma } from "@/lib/indicators";
import { FUND_NAME } from "@/lib/universe";

export const dynamic = "force-dynamic";

// Session-protected by middleware. Everything the ticker popup shows, in one request.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const symbol = (await params).symbol.toUpperCase();
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return NextResponse.json({ error: "bad symbol" }, { status: 400 });

  const asset = await alpaca.getAsset(symbol).catch(() => null);
  const isEtf = asset ? FUND_NAME.test(asset.name) : false;
  const [company, barsBySymbol, snaps, news, position, recentSignals, closed] = await Promise.all([
    companyInfo(symbol, isEtf),
    alpaca.getDailyBars([symbol]).catch(() => ({} as Record<string, never[]>)),
    alpaca.getSnapshots([symbol]).catch(() => ({} as Awaited<ReturnType<typeof alpaca.getSnapshots>>)),
    alpaca.getNews(symbol, 14, 5).catch(() => []),
    db.query.positions.findFirst({ where: eq(positions.symbol, symbol) }),
    db.select().from(signals).where(eq(signals.symbol, symbol)).orderBy(desc(signals.createdAt)).limit(8),
    db.select().from(trades).where(eq(trades.symbol, symbol)).orderBy(desc(trades.closedAt)).limit(20),
  ]);

  const bars = barsBySymbol[symbol] ?? [];
  const closes = bars.map((b) => b.c);
  const snap = snaps[symbol];
  const price = snap?.latestTrade?.p ?? closes.at(-1) ?? null;
  const prevClose = snap?.prevDailyBar?.c ?? null;
  const r = (n: number | null) => (n == null ? null : round(n));

  return NextResponse.json({
    symbol,
    name: asset?.name ?? null,
    exchange: asset?.exchange ?? null,
    isEtf,
    company,
    quote: {
      price,
      changePct: price && prevClose ? round((price / prevClose - 1) * 100) : null,
      sma50: r(sma(closes, 50)),
      sma200: r(sma(closes, 200)),
      rsi14: r(rsi(closes, 14)),
      rsi2: r(rsi(closes, 2)),
      high20: r(priorHigh(bars, 20)),
      low20: r(priorLow(bars, 20)),
    },
    news: news.map((n) => ({ headline: n.headline, source: n.source, at: n.created_at, url: n.url ?? null })),
    bot: {
      position: position && {
        instrument: position.instrument, contract: position.contract, state: position.state, qty: position.qty,
        strategyId: position.strategyId, entryPrice: position.entryPrice, strike: position.strike,
        expiration: position.expiration, stopPrice: position.stopPrice, takeProfitPrice: position.takeProfitPrice,
        openedAt: position.entryFilledAt ?? position.openedAt,
      },
      signals: recentSignals.map((s) => ({
        at: s.createdAt, strategyId: s.strategyId, kind: s.kind, status: s.status,
        reason: s.review?.reason ?? s.reason, decision: s.review?.decision ?? null,
      })),
      trades: {
        count: closed.length,
        wins: closed.filter((t) => t.pnl > 0).length,
        totalPnl: round(closed.reduce((a, t) => a + t.pnl, 0)),
        last: closed.slice(0, 5).map((t) => ({
          closedAt: t.closedAt, strategyId: t.strategyId, instrument: t.instrument, pnl: t.pnl, pnlPct: t.pnlPct, exitReason: t.exitReason,
        })),
      },
    },
  });
}
