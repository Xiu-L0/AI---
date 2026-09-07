import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppSidebar } from "./app-sidebar";

describe("AppSidebar", () => {
  it("shows capture, knowledge review and exception destinations", () => {
    render(<AppSidebar exceptionCount={2} reviewCount={3} />);

    expect(screen.getByRole("link", { name: "今天" })).toBeVisible();
    expect(screen.getByRole("link", { name: "采集记录" })).toBeVisible();
    expect(screen.getByRole("link", { name: "知识审核 3" })).toBeVisible();
    expect(screen.getByRole("link", { name: "异常 2" })).toBeVisible();
    expect(screen.getByRole("link", { name: "设置" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /共享/ })).toBeNull();
  });
});
