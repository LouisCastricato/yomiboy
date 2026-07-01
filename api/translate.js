import { translate } from "../server/api-core.mjs";

export default async function handler(req, res) {
  res.status(200).json(await translate(req.body?.japanese));
}
