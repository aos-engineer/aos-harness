import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { validatePlatformUrl } from "../../cli/src/utils";

describe("validatePlatformUrl (spec D5)", () => {
  beforeEach(() => {
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });

  test("accepts https URL", () => {
    const u = validatePlatformUrl("https://api.example.com/v1");
    expect(u.protocol).toBe("https:");
  });

  test("accepts http://localhost and http://127.0.0.1", () => {
    expect(validatePlatformUrl("http://localhost:8080").hostname).toBe("localhost");
    expect(validatePlatformUrl("http://127.0.0.1:8080").hostname).toBe("127.0.0.1");
  });

  test("rejects plain http to a non-loopback host", () => {
    expect(() => validatePlatformUrl("http://api.example.com")).toThrow(/scheme.*not allowed/);
  });

  test("rejects file://, ftp://, and other schemes", () => {
    expect(() => validatePlatformUrl("file:///etc/passwd")).toThrow(/scheme/);
    expect(() => validatePlatformUrl("ftp://example.com")).toThrow(/scheme/);
  });

  test("rejects link-local / metadata addresses", () => {
    expect(() => validatePlatformUrl("http://169.254.169.254/")).toThrow(/link-local|metadata/);
    expect(() => validatePlatformUrl("http://169.254.0.1/")).toThrow(/link-local|metadata/);
  });

  test("rejects garbage input", () => {
    expect(() => validatePlatformUrl("not a url")).toThrow();
    expect(() => validatePlatformUrl("")).toThrow();
  });

  test("AOS_ALLOW_INSECURE_PLATFORM_URL bypass works", () => {
    process.env.AOS_ALLOW_INSECURE_PLATFORM_URL = "1";
    expect(() => validatePlatformUrl("http://10.0.0.1/")).not.toThrow();
    expect(() => validatePlatformUrl("file:///tmp/x")).not.toThrow();
    delete process.env.AOS_ALLOW_INSECURE_PLATFORM_URL;
  });
});
