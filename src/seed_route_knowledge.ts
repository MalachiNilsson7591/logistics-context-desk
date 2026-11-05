import { writeFile } from "node:fs/promises";
import { knowledgeFile } from "./local_knowledge.js";
import { InfraiKnowledge } from "./infrai_knowledge.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before seeding.");

const articles = [
  { id: "pod-review", text: "A delivered shipment needs proof of delivery with signer and capture time before support closes the case." },
  { id: "weather-hold", text: "For a weather exception, operations confirms the next depot scan before giving a revised arrival window." },
];

const knowledge = new InfraiKnowledge(apiKey);
const vectors = await Promise.all(articles.map(async (article) => ({
  id: article.id,
  values: await knowledge.embedding(article.text),
  metadata: { text: article.text, kind: "operations-note" },
})));
await writeFile(knowledgeFile, JSON.stringify(vectors), { flag: "wx" });
console.log(JSON.stringify({ file: knowledgeFile.pathname, indexed: vectors.length }));
