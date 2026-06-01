// api/entries.js
// Tiny "middleman" between your app and Notion. It runs on Vercel (free) and
// holds your secret Notion token, which must NEVER live in the browser code.
//
// Set two Environment Variables in your Vercel project:
//   NOTION_TOKEN  -> your Notion integration secret (starts with "ntn_" or "secret_")
//   NOTION_DB     -> c0ac6a59023548cd89a6d7846f9f7e95   (your database id)

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB           = process.env.NOTION_DB;
const NOTION_VER   = "2022-06-28";

const headers = () => ({
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": NOTION_VER,
  "Content-Type": "application/json",
});

async function notion(path, method, body) {
  const r = await fetch("https://api.notion.com/v1" + path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || ("Notion error " + r.status));
  return data;
}

// Notion page -> app entry
function pageToEntry(p) {
  const pr = p.properties;
  const num = k => (pr[k] && pr[k].number != null) ? pr[k].number : null;
  const date =
    (pr["Day"] && pr["Day"].title[0] && pr["Day"].title[0].plain_text) ||
    (pr["Date"] && pr["Date"].date && pr["Date"].date.start) || null;
  return {
    date,
    arm: num("Arm"),
    leg: num("Leg"),
    sleep: num("Sleep Quality"),
    latency: num("Sleep Latency (min)"),
    notes: (pr["Notes"] && pr["Notes"].rich_text[0] && pr["Notes"].rich_text[0].plain_text) || "",
    activities: ((pr["Activities"] && pr["Activities"].multi_select) || []).map(o => o.name),
  };
}

// app entry -> Notion properties
function entryToProps(e) {
  return {
    "Day":  { title: [{ text: { content: e.date } }] },
    "Date": { date: { start: e.date } },
    "Arm":  { number: (e.arm  == null ? null : Number(e.arm)) },
    "Leg":  { number: (e.leg  == null ? null : Number(e.leg)) },
    "Sleep Quality": { number: (e.sleep == null ? null : Number(e.sleep)) },
    "Sleep Latency (min)": { number: (e.latency === "" || e.latency == null ? null : Number(e.latency)) },
    "Notes": { rich_text: e.notes ? [{ text: { content: String(e.notes) } }] : [] },
    "Activities": { multi_select: (e.activities || []).map(name => ({ name })) },
  };
}

async function findPageId(date) {
  const found = await notion(`/databases/${DB}/query`, "POST", {
    filter: { property: "Day", title: { equals: date } },
    page_size: 1,
  });
  return found.results.length ? found.results[0].id : null;
}

module.exports = async (req, res) => {
  if (!NOTION_TOKEN || !DB) {
    return res.status(500).json({ error: "Server is missing NOTION_TOKEN or NOTION_DB environment variables." });
  }
  try {
    if (req.method === "GET") {
      let entries = [], cursor;
      do {
        const data = await notion(`/databases/${DB}/query`, "POST",
          cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 });
        entries = entries.concat(data.results.map(pageToEntry));
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);
      return res.status(200).json({ entries });
    }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch { body = {}; } }
    body = body || {};

    if (req.method === "POST") {
      if (!body.date) return res.status(400).json({ error: "date is required" });
      const props = entryToProps(body);
      const id = await findPageId(body.date);
      if (id) await notion(`/pages/${id}`, "PATCH", { properties: props });
      else    await notion(`/pages`, "POST", { parent: { database_id: DB }, properties: props });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (!body.date) return res.status(400).json({ error: "date is required" });
      const id = await findPageId(body.date);
      if (id) await notion(`/pages/${id}`, "PATCH", { archived: true });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
