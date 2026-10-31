export function normalizeInterest(text) {
  return text.trim().toLocaleLowerCase("ru").replaceAll("ё", "е");
}

export function interestMatches(category, group, query) {
  const normalized = normalizeInterest(query);
  if (!normalized) return false;
  if (normalized === "ии" || normalized === "ai") return category === "Искусственный интеллект";
  const aliases = category === "Искусственный интеллект" ? " ии ai нейросети" : "";
  return normalizeInterest(`${category} ${group}${aliases}`).includes(normalized);
}
