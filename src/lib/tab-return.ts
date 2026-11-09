export function observeTabReturn(
  page: Pick<Document, "hidden" | "hasFocus" | "addEventListener" | "removeEventListener">,
  windowEvents: Pick<Window, "addEventListener" | "removeEventListener">,
  onReturn: (isCurrent: () => boolean) => void,
) {
  let away = page.hidden || !page.hasFocus();
  let version = 0;
  function leave() {
    away = true;
    version += 1;
  }
  function resume() {
    if (!away || page.hidden) return;
    away = false;
    const returnedVersion = version;
    onReturn(() => returnedVersion === version && !page.hidden);
  }
  function visibilityChanged() {
    if (page.hidden) leave();
    else resume();
  }
  windowEvents.addEventListener("blur", leave);
  windowEvents.addEventListener("focus", resume);
  page.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    leave();
    windowEvents.removeEventListener("blur", leave);
    windowEvents.removeEventListener("focus", resume);
    page.removeEventListener("visibilitychange", visibilityChanged);
  };
}

export function observeVisibleChecks(
  page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">,
  timers: Pick<Window, "setInterval" | "clearInterval">,
  check: (isCurrent: () => boolean) => Promise<void>,
) {
  let timer: number | undefined;
  let generation = 0;
  let running = false;

  async function tick() {
    if (page.hidden || running || timer === undefined) return;
    const started = generation;
    running = true;
    try {
      await check(() => started === generation && !page.hidden);
    } catch {
      // The next foreground check can retry a temporary failure.
    } finally {
      running = false;
    }
  }

  function stopTimer() {
    generation += 1;
    if (timer !== undefined) timers.clearInterval(timer);
    timer = undefined;
  }

  function visibilityChanged() {
    if (page.hidden) stopTimer();
    else if (timer === undefined) timer = timers.setInterval(() => void tick(), 15_000);
  }

  visibilityChanged();
  page.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    stopTimer();
    page.removeEventListener("visibilitychange", visibilityChanged);
  };
}
