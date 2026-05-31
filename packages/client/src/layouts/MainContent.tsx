import type { ReactNode } from "react";

interface MainContentProps {
  children: ReactNode;
  isWideScreen: boolean;
  className?: string;
  innerClassName?: string;
}

function classNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function MainContent({
  children,
  isWideScreen,
  className,
  innerClassName,
}: MainContentProps) {
  return (
    <div
      className={classNames(
        isWideScreen ? "main-content-wrapper" : "main-content-mobile",
        className,
      )}
    >
      <div
        className={classNames(
          isWideScreen
            ? "main-content-constrained"
            : "main-content-mobile-inner",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
