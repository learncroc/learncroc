import { describe, expect, test } from "bun:test";
import { API_ROUTES } from "@learncroc/core";
import { api, assetUrl } from "../src/api/client";
import { mockPack, mockResponse } from "../src/api/mock";

describe("api client", () => {
  test("has one function per contract route", () => {
    expect(Object.keys(api)).toHaveLength(API_ROUTES.length);
  });
  test("assetUrl keeps slashes in the asset path", () => {
    expect(assetUrl("mini-pack", "assets/img/clock-and-road.svg")).toBe(
      "/api/packs/mini-pack/assets/assets/img/clock-and-road.svg",
    );
  });
  test("mock answers GET routes from fixtures", () => {
    expect(mockResponse("GET /packs", {})[0]?.id).toBe(mockPack.manifest.id);
    expect(mockResponse("GET /packs/:id", { id: "mini-pack" }).manifest.title).toBe("Mini pack");
  });
});
