#!/usr/bin/env node
/**
 * MCP server over stdio, zero dependencies.
 *
 * calculate_schengen_days runs locally on this package's own counter. check_visa_requirement and
 * create_trip_plan forward to NomadPoint's public MCP server (no account or key), which holds the
 * entry-rule data and saves itineraries.
 *
 *   { "mcpServers": { "schengen": { "command": "npx", "args": ["-y", "github:eladkishon/schengen-calculator"] } } }
 */
import { countDays, SCHENGEN } from "./index.js";

// Node globals, declared here so the package needs no @types/node.
declare const process: {
  stdin: { setEncoding(e: string): void; on(ev: "data", cb: (chunk: string) => void): void };
  stdout: { write(s: string): void };
};

const REMOTE = "https://gxhdcvoveufbkthhendf.supabase.co/functions/v1/mcp-public";
const VERSION = "1.1.0";

const stayItems = {
  type: "object",
  properties: {
    entry: { type: "string", description: "Arrival date, YYYY-MM-DD. Counts as a full day." },
    exit: { type: "string", description: "Departure date, YYYY-MM-DD. Counts as a full day." },
  },
  required: ["entry", "exit"],
  additionalProperties: false,
};

const LOCAL_TOOLS = [
  {
    name: "calculate_schengen_days",
    title: "Calculate Schengen days",
    description:
      "Use this when someone wants to know how many days they have used or have left in the Schengen Area under the 90/180 rule, or whether a planned stay would overstay. Pass every stay in any Schengen country. Entry and exit days both count, and the window covers the whole area, not each country. Runs locally.",
    inputSchema: {
      type: "object",
      properties: {
        stays: { type: "array", items: stayItems, description: "Each stay in the Schengen Area, past or planned." },
        as_of: { type: "string", description: "Date to assess on, YYYY-MM-DD. Defaults to today." },
      },
      required: ["stays"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function schengen(args: Record<string, unknown>) {
  const stays = args.stays;
  if (!Array.isArray(stays) || stays.length === 0) throw new Error("stays must list at least one stay");
  const spans = stays.map((s, i) => {
    if (!ISO.test(s?.entry) || !ISO.test(s?.exit) || s.exit < s.entry) {
      throw new Error(`Stay ${i + 1} needs entry and exit as YYYY-MM-DD, exit on or after entry`);
    }
    return { start: new Date(`${s.entry}T00:00:00Z`), end: new Date(`${s.exit}T00:00:00Z`), code: "FR" };
  });
  const asOf = typeof args.as_of === "string" && ISO.test(args.as_of) ? new Date(`${args.as_of}T00:00:00Z`) : new Date();
  const r = countDays(spans, SCHENGEN, asOf);
  return {
    used: r?.used ?? 0,
    remaining: r?.remaining ?? 90,
    window_start: day(r?.windowStart ?? null),
    must_leave_by: day(r?.mustLeaveBy ?? null),
    rule: "90 days in any rolling 180-day window, across the whole Schengen Area. Entry and exit days both count.",
    calculator: "https://nomadpoint.app/schengen-calculator",
  };
}

async function remote(method: string, params?: unknown) {
  const res = await fetch(REMOTE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": `schengen-calculator-mcp/${VERSION}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

let remoteTools: Promise<unknown[]> | null = null;
const forwarded = () =>
  (remoteTools ??= remote("tools/list")
    .then((r) => r.tools.filter((t: { name: string }) => t.name !== "calculate_schengen_days"))
    .catch(() => []));

async function handle(msg: { id?: unknown; method?: string; params?: any }) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "schengen-calculator", version: VERSION },
        instructions:
          "Counts Schengen 90/180 days locally, checks visa rules for any passport, and saves a planned itinerary as a link the traveller opens and keeps (create_trip_plan, via NomadPoint).",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [...LOCAL_TOOLS, ...(await forwarded())] };
    case "tools/call": {
      const { name, arguments: args = {} } = msg.params ?? {};
      if (name === "calculate_schengen_days") {
        try {
          const result = schengen(args);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
        }
      }
      return await remote("tools/call", { name, arguments: args });
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg: { id?: unknown; method?: string; params?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (msg.id === undefined || msg.id === null) continue; // notification
    handle(msg).then(
      (result) => send({ jsonrpc: "2.0", id: msg.id, result }),
      (err) => send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: err.message } }),
    );
  }
});
