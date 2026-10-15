import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Review } from "./db";
import type { Bar } from "./indicators";
import type { NewsItem } from "./alpaca";

const client = new Anthropic();

const ReviewSchema = z.object({
  decision: z.enum(["approve", "veto"]),
  confidence: z.number().describe("0 to 1"),
  reason: z.string().describe("One or two sentences"),
  risks: z.array(z.string()).describe("Up to 3 short risk notes"),
});

const REVIEW_SYSTEM = `You are the risk reviewer for a rules-based swing-trading bot running on a paper account.
A deterministic strategy has already produced a buy signal. Your job is NOT to second-guess the strategy's technical logic;
it is to catch situations where the rule is likely firing on something the rule can't see:
- the drop or spike is explained by news that changes the thesis (earnings miss, guidance cut, fraud, lawsuit, FDA rejection, downgrade cascade, M&A announcement pinning the price)
- earnings or another binary event is imminent (within ~2 trading days)
- the data looks broken (gap from a split, halted stock, stale prices)
Approve by default. Veto only with a concrete reason drawn from the inputs. Never invent news that isn't in the headlines.`;

export async function reviewEntry(input: {
  model: string;
  symbol: string;
  strategyName: string;
  rules: string;
  indicators: Record<string, number>;
  bars: Bar[];
  news: NewsItem[];
  instrumentNote?: string; // e.g. the call contract being bought
}): Promise<Review> {
  const recent = input.bars.slice(-15).map((b) => `${b.t.slice(0, 10)} o${b.o} h${b.h} l${b.l} c${b.c} v${b.v}`).join("\n");
  const news = input.news.length
    ? input.news.map((n) => `- [${n.created_at.slice(0, 16)}] ${n.headline}${n.summary ? ` - ${n.summary.slice(0, 240)}` : ""}`).join("\n")
    : "(no headlines in the last 4 days)";

  const response = await client.messages.parse({
    model: input.model,
    max_tokens: 2000,
    system: REVIEW_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ReviewSchema) },
    messages: [
      {
        role: "user",
        content: `Strategy: ${input.strategyName}
Rules: ${input.rules}

Candidate: BUY ${input.symbol}${input.instrumentNote ? `\nInstrument: ${input.instrumentNote}` : ""}
Signal indicators: ${JSON.stringify(input.indicators)}

Last 15 daily bars (the last one is today, in progress):
${recent}

Recent headlines for ${input.symbol}:
${news}`,
      },
    ],
  });

  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out) {
    throw new Error(`Reviewer returned no verdict (stop_reason=${response.stop_reason})`);
  }
  return {
    ...out,
    confidence: Math.max(0, Math.min(1, out.confidence)),
    model: input.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function writeJournal(model: string, day: string, facts: unknown): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: `You write a short end-of-day trading journal for a rules-based paper-trading bot that runs several strategies side by side.
Use markdown with these sections: **Summary** (2-3 sentences), **Trades** (bullets), **Signals the reviewer vetoed** (bullets, skip if none),
**Strategy scoreboard** (one line per strategy), **Things to watch** (1-3 bullets about rule behavior worth tuning).
Be factual and only use the data provided. Under 300 words.`,
    messages: [{ role: "user", content: `Trading day ${day}. Data:\n${JSON.stringify(facts, null, 1)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Journal request was refused");
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}
