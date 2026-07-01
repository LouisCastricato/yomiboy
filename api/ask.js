import { ask } from "../server/api-core.mjs";

export default async function handler(req, res) {
  const { japanese, translation, messages } = req.body || {};
  res.status(200).json(await ask(japanese, translation, messages));
}
