import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "./app-sidebar";

describe("AppSidebar", () => {
  it("shows only milestone A destinations", () => {
    render(<AppSidebar exceptionCount={2} />);

    expect(screen.getByRole("link", { name: "今天" })).toBeVisible();
    expect(screen.getByRole("link", { name: "采集记录" })).toBeVisible();
    expect(screen.getByRole("link", { name: "异常 2" })).toBeVisible();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();
    expect(screen.queryByText("知识卡片")).toBeNull();
  });
});
