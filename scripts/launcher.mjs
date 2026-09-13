/**
 * Driving the launcher from an end-to-end script.
 *
 * The launcher asks one question — which language into which — and everything
 * else is behind progressive disclosure. That is the product decision, so the
 * E2E scripts open the disclosure the way a person would rather than reaching
 * past it: if the advanced panel ever stops containing these controls, these
 * scripts should fail.
 */

/** Dismiss the cloud disclosure by choosing local-only, when it is showing. */
export async function chooseLocalOnly(page) {
  const dialog = page.getByRole("dialog", { name: /This setup sends what is said/ });
  if (!(await dialog.isVisible().catch(() => false))) return false;
  await dialog.getByRole("button", { name: "Use local-only mode" }).click();
  await page.waitForTimeout(400);
  return true;
}

/** Open the launcher's advanced panel, if it is not already open. */
export async function openAdvanced(page) {
  const summary = page.getByText("고급 설정", { exact: false }).first();
  const open = await page.evaluate(() => {
    const details = document.querySelector("details");
    return details?.open ?? false;
  });
  if (!open) {
    await summary.click();
    await page.waitForTimeout(200);
  }
}

/** Pick the speech recogniser. `id` is an `SttProviderId`. */
export async function chooseRecogniser(page, id) {
  await openAdvanced(page);
  await page.getByLabel("인식", { exact: true }).selectOption(id);
  await page.waitForTimeout(200);
}

/** Pick the interpreter lag profile. */
export async function chooseLag(page, lag) {
  await openAdvanced(page);
  await page.getByLabel("지연", { exact: true }).selectOption(lag);
  await page.waitForTimeout(200);
}

/** Pick the language pair. Both are the launcher's primary control. */
export async function choosePair(page, source, target) {
  await page.getByLabel("말하는 언어", { exact: true }).selectOption(source);
  await page.getByLabel("통역할 언어", { exact: true }).selectOption(target);
  await page.waitForTimeout(200);
}

/** Press Start, whichever label it currently carries. */
export async function start(page) {
  await page.getByRole("button", { name: /데모 실행|통역 시작/ }).click();
}
