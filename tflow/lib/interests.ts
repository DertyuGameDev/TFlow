import { TOPICS } from "./types";

export function parseInterests(value: string): string[] {
  const categories = new Map(TOPICS.map(category => [category.toLocaleLowerCase("ru"), category]));
  categories.set("ai", TOPICS[0]);
  categories.set("ии", TOPICS[0]);
  return Array.from(new Set(value.split(",").map(item => item.trim()).filter(Boolean).map(item => categories.get(item.toLocaleLowerCase("ru")) ?? item)));
}
