import { describe, expect, it } from "vitest";
import { InitDataError, signInitData, validateInitData } from "./initData.js";
import { parseAllowlist } from "./env.js";

const BOT_TOKEN = "123456:TEST-token";
const now = new Date("2026-09-25T12:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 42, first_name: "Ann", language_code: "en" });

describe("validateInitData", () => {
  it("accepts correctly signed data", () => {
    const initData = signInitData(
      { auth_date: authDate, user, query_id: "q1", start_param: "recipe_abc", signature: "sig" },
      BOT_TOKEN,
    );
    const result = validateInitData(initData, BOT_TOKEN, now);
    expect(result.user.id).toBe(42);
    expect(result.user.first_name).toBe("Ann");
    expect(result.startParam).toBe("recipe_abc");
  });

  it("rejects data signed with another bot token", () => {
    const initData = signInitData({ auth_date: authDate, user }, "999:other");
    expect(() => validateInitData(initData, BOT_TOKEN, now)).toThrow(InitDataError);
  });

  it("rejects tampered fields", () => {
    const initData = signInitData({ auth_date: authDate, user }, BOT_TOKEN).replace(
      encodeURIComponent('"id":42'),
      encodeURIComponent('"id":43'),
    );
    expect(() => validateInitData(initData, BOT_TOKEN, now)).toThrow(/signature/);
  });

  it("rejects stale data", () => {
    const old = String(Math.floor(now.getTime() / 1000) - 2 * 24 * 60 * 60);
    const initData = signInitData({ auth_date: old, user }, BOT_TOKEN);
    expect(() => validateInitData(initData, BOT_TOKEN, now)).toThrow(/expired/);
  });

  it("rejects data without a hash", () => {
    expect(() => validateInitData(`auth_date=${authDate}`, BOT_TOKEN, now)).toThrow(/hash/);
  });
});

describe("parseAllowlist", () => {
  it("parses comma and space separated IDs", () => {
    expect([...parseAllowlist("111, 222 333")]).toEqual([111, 222, 333]);
  });

  it("rejects non-numeric entries", () => {
    expect(() => parseAllowlist("111,abc")).toThrow(/abc/);
  });
});
