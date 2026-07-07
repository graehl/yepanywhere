import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkActionBar } from "../BulkActionBar";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        bulkSelectAllFilteredTitle: "Select all {count} filtered sessions",
        bulkSelectAllFiltered: "Select all {count}",
        bulkSelectedCount: "{count} selected",
        bulkClearSelection: "Clear selection",
        bulkArchiveSelected: "Archive selected",
        bulkArchive: "Archive",
      };
      return (strings[key] ?? key).replace(
        "{count}",
        String(params?.count ?? ""),
      );
    },
  }),
}));

const noopAsync = async () => {};
const noop = () => {};

function renderBulkActionBar(
  props: Partial<ComponentProps<typeof BulkActionBar>> = {},
) {
  return render(
    <BulkActionBar
      selectedCount={0}
      onArchive={noopAsync}
      onUnarchive={noopAsync}
      onStar={noopAsync}
      onUnstar={noopAsync}
      onMarkRead={noopAsync}
      onMarkUnread={noopAsync}
      onClearSelection={noop}
      canUnarchive={false}
      canStar={false}
      canUnstar={false}
      canMarkRead={false}
      canMarkUnread={false}
      {...props}
    />,
  );
}

describe("BulkActionBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("selects all filtered sessions instead of archiving from the filtered shortcut", () => {
    const onSelectAllFiltered = vi.fn();
    const onArchive = vi.fn(async () => {});

    renderBulkActionBar({
      onArchive,
      onSelectAllFiltered,
      filteredCount: 100,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Select all 100",
      }),
    );

    expect(onSelectAllFiltered).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("keeps the normal selected archive action after selection", () => {
    const onArchive = vi.fn(async () => {});

    renderBulkActionBar({
      selectedCount: 2,
      onArchive,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive",
      }),
    );

    expect(onArchive).toHaveBeenCalledTimes(1);
  });
});
