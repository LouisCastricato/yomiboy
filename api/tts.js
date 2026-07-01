import { tts } from "../server/api-core.mjs";

export default async function handler(req, res) {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });
  const r = await tts(text);
  if (r.useBrowser) return res.status(200).json({ useBrowser: true });
  res.setHeader("Content-Type", r.contentType);
  res.status(200).send(Buffer.from(r.audio));
}
