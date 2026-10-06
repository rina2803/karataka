/// « 35 000 Ar » (espaces simples, lisibles dans une notification).
export function formatAr(value: unknown) {
  const n = Math.round(Number(value) || 0);
  return `${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ar`.replace(/^/, n < 0 ? '-' : '');
}
