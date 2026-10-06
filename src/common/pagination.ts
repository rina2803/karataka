/// Entier de query-string borné (page, limit…) : valeur par défaut si absent
/// ou invalide, puis ramené dans [min, max].
export function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
