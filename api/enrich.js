import { enrich } from "../server/api-core.mjs";

export default async function handler(req, res) {
  res.status(200).json(await enrich(req.body?.japanese));
}
