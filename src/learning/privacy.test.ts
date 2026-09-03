import { describe, expect, it } from "vitest";
import { redactForLearning } from "./privacy";

describe("learning redaction", () => {
  it("removes common identity-bearing values before storage", () => {
    const result = redactForLearning(
      "연락처는 010-1234-5678이고 이메일은 person@example.com, 등록번호는 900101-1234567입니다.",
    );
    expect(result.text).not.toContain("010-1234-5678");
    expect(result.text).not.toContain("person@example.com");
    expect(result.text).not.toContain("900101-1234567");
    expect(result.redacted).toBe(true);
  });

  it("keeps ordinary language intact", () => {
    const result = redactForLearning("체류기간 연장 신청을 하셨나요?");
    expect(result.text).toBe("체류기간 연장 신청을 하셨나요?");
  });

  it("replaces URLs rather than retaining query-string identifiers", () => {
    const result = redactForLearning("https://example.com/case?id=ABC1234567 에서 확인하세요.");
    expect(result.text).toContain("[URL]");
    expect(result.text).not.toContain("ABC1234567");
  });

  it("removes labelled Hangul names and honorific forms", () => {
    const result = redactForLearning("제 이름은 김민수이고 박서연 씨가 보호자입니다.");
    expect(result.text).not.toContain("김민수");
    expect(result.text).not.toContain("박서연");
    expect(result.text.match(/\[NAME\]/g)).toHaveLength(2);
    expect(result.kinds).toContain("name");
  });
});
