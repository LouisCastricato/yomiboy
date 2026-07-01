import { ocr } from "../server/api-core.mjs";

export default async function handler(req, res) {
  const { image, mediaType } = req.body || {};
  if (!image) return res.status(400).json({ error: "image required" });
  res.status(200).json(await ocr(image, mediaType));
}
