interface BrandWordmarkProps {
  className?: string;
}

export function BrandWordmark({
  className = "",
}: BrandWordmarkProps) {
  return (
    <span className={`brand-wordmark brand-wordmark--yep ${className}`.trim()}>
      yep
    </span>
  );
}

export function isYepAnywhereBrandName(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "yepanywhere";
}
