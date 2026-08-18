export function formatTitleCase(str: string | null | undefined): string {
  if (!str) return '';

  return str
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'hr') return 'HR';
      return word.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
