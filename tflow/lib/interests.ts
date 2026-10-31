import { TOPICS } from "./types";

export function parseInterests(value: string): string[] {
  const categories = new Map(
    TOPICS.map((category) => [category.toLocaleLowerCase("ru"), category]),
  );
  categories.set("ai", "Искусственный интеллект");
  categories.set("ии", "Искусственный интеллект");
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => categories.get(item.toLocaleLowerCase("ru")) ?? item),
    ),
  );
}
