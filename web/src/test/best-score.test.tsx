import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../components/Game", () => ({ Game: () => null }));

import App from "../App";

describe("best score persistence", () => {
  it("treats a corrupt stored best as 0 instead of NaN", () => {
    localStorage.setItem("freeplatformer-best", "garbage");
    render(<App />);
    expect(screen.queryByText("NaN")).toBeNull();
  });
});
