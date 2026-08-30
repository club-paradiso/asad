import { describe, expect, it } from "vitest";
import { privacyAcknowledgementKey } from "@/features/live/PrivacyDisclosure";
import {
  prepPhasePermitsCloud,
  resolvePrepConsent,
} from "./usePrepCloudConsent";

const provider = {
  label: "Example AI",
  note: "May use submitted content to improve products.",
};

describe("Prep cloud consent", () => {
  it("keeps live and Prep acknowledgement scopes separate", () => {
    expect(privacyAcknowledgementKey("prep")).not.toBe(
      privacyAcknowledgementKey("live"),
    );
  });

  it("waits while cloud routing is still unknown", () => {
    expect(
      resolvePrepConsent({
        acknowledged: false,
        modelAvailable: undefined,
        disclosure: undefined,
      }),
    ).toBe("checking");
  });

  it("requires disclosure when a configured provider may train on submissions", () => {
    expect(
      resolvePrepConsent({
        acknowledged: false,
        modelAvailable: true,
        disclosure: [provider],
      }),
    ).toBe("needed");
  });

  it("does not block a deterministic local brief when no model exists", () => {
    expect(
      resolvePrepConsent({
        acknowledged: false,
        modelAvailable: false,
        disclosure: [],
      }),
    ).toBe("clear");
  });

  it("allows a cloud provider that has nothing to disclose", () => {
    expect(
      resolvePrepConsent({
        acknowledged: false,
        modelAvailable: true,
        disclosure: [],
      }),
    ).toBe("clear");
  });

  it("only permits cloud work after a clear or granted decision", () => {
    expect(prepPhasePermitsCloud("checking")).toBe(false);
    expect(prepPhasePermitsCloud("needed")).toBe(false);
    expect(prepPhasePermitsCloud("declined")).toBe(false);
    expect(prepPhasePermitsCloud("clear")).toBe(true);
    expect(prepPhasePermitsCloud("granted")).toBe(true);
  });
});
