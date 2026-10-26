// PublicLayout only. Every destination remains a normal link; enhancement is optional.
const pageRoot = document.documentElement;
if (!pageRoot.dataset.publicMotionReady) {
  pageRoot.dataset.publicMotionReady = "true";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dialog = document.querySelector<HTMLDialogElement>("#signup-motion");
  const wash = dialog?.querySelector<HTMLElement>(".signup-motion-wash");
  const brand = dialog?.querySelector<HTMLElement>(".signup-motion-brand");
  const skip = dialog?.querySelector<HTMLButtonElement>(".signup-motion-skip");
  const sessionKey = "chiro.signup-motion.seen.v1";
  let seen = false;
  let destination: string | null = null;
  let navigating = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: HTMLElement | null = null;
  const signupAnimations = new Set<Animation>();
  const reveals = new Map<HTMLElement, Animation>();
  const go = () => {
    if (!destination || navigating) return;
    navigating = true;
    clearTimeout(timer);
    window.location.assign(destination);
  };
  const reset = () => {
    destination = null;
    navigating = false;
    clearTimeout(timer);
    signupAnimations.forEach(animation => animation.cancel());
    signupAnimations.clear();
    reveals.forEach(animation => animation.cancel()); reveals.clear();
    flight?.remove(); flight = null;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    document.body.classList.remove("signup-motion-open");
    pageRoot.style.removeProperty("--signup-motion-gutter");
  };
  const play = (element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = element.animate(frames, options);
    signupAnimations.add(animation);
    return animation;
  };

  skip?.addEventListener("click", go);
  dialog?.addEventListener("cancel", event => { event.preventDefault(); go(); });
  dialog?.addEventListener("keydown", event => {
    if (event.key === "Tab" && skip) { event.preventDefault(); skip.focus(); }
  });
  dialog?.addEventListener("close", () => { if (destination) go(); });
  window.addEventListener("pagehide", reset);
  window.addEventListener("pageshow", event => { if (event.persisted) reset(); });
  window.addEventListener("resize", () => { if (destination) go(); });
  reduced.addEventListener("change", () => {
    if (!reduced.matches) return;
    reveals.forEach(animation => animation.cancel()); reveals.clear();
    if (destination) go();
  });

  // Capture the mobile link's rectangle before the existing menu closes it.
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || reduced.matches) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-signup-motion]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || link.relList.contains("external")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !["http:", "https:"].includes(url.protocol) || url.pathname !== "/inschrijven.html" || url.pathname === location.pathname) return;
    if (!dialog || !wash || !brand || !skip || typeof dialog.showModal !== "function" || typeof link.animate !== "function") return;
    if (destination) { event.preventDefault(); return; }
    const rect = link.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault();
    destination = url.href;
    try {
      try { seen ||= sessionStorage.getItem(sessionKey) === "1"; } catch { /* In-memory fallback. */ }
      const duration = seen ? 180 : 3000;
      // Independent watchdog: an animation error must never strand this navigation.
      timer = setTimeout(go, duration);
      document.body.classList.add("signup-motion-open");
      pageRoot.style.setProperty("--signup-motion-gutter", getComputedStyle(document.body).getPropertyValue("--burgundy"));
      dialog.showModal();
      skip.focus({ preventScroll: true });
      if (seen) {
        play(wash, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "forwards" });
        play(brand, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "forwards" });
      } else {
        const style = getComputedStyle(link);
        flight = document.createElement("div");
        flight.className = "signup-motion-flight";
        flight.setAttribute("aria-hidden", "true");
        flight.textContent = link.textContent?.trim() ?? "Inschrijven";
        Object.assign(flight.style, {
          left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
          color: style.color, backgroundColor: style.backgroundColor, border: style.border,
          borderRadius: style.borderRadius, boxShadow: style.boxShadow, font: style.font, fontWeight: style.fontWeight
        });
        dialog.append(flight);
        const x = innerWidth / 2 - rect.left - rect.width / 2;
        const y = innerHeight / 2 - rect.top - rect.height / 2;
        const scale = Math.min(1.8, (innerWidth - 32) / rect.width);
        const center = `translate(${x}px, ${y}px)`;
        play(flight, [
          { transform: "translate(0, 0) rotate(0deg) scale(1)", offset: 0, easing: "cubic-bezier(.22,.85,.3,1)" },
          { transform: `${center} rotate(0deg) scale(1)`, offset: .4, easing: "cubic-bezier(.4,0,.2,1)" },
          { transform: `${center} rotate(360deg) scale(${scale})`, offset: 1 }
        ], { duration: 1500, fill: "forwards" });
        play(flight, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 1500, fill: "forwards" });
        play(wash, [{ opacity: 0 }, { opacity: .35, offset: .4 }, { opacity: 1 }], { duration: 1500, fill: "forwards" });
        play(brand, [
          { opacity: 0, transform: "translateY(16px) scale(.96)", offset: 0 },
          { opacity: 1, transform: "translateY(0) scale(1)", offset: .2 },
          { opacity: 1, transform: "translateY(0) scale(1)", offset: .533 },
          { opacity: .25, transform: "translateY(-8px) scale(1.02)", offset: 1 }
        ], { duration: 1500, delay: 1500, fill: "forwards" });
      }
      seen = true;
      try { sessionStorage.setItem(sessionKey, "1"); } catch { /* Storage can be disabled. */ }
    } catch { go(); }
  }, { capture: true });

  // Content is visible by default. Animate only after a successful intersection;
  // no pre-hidden classes, scroll handlers, or animation-dependent layout.
  if (!reduced.matches && typeof IntersectionObserver === "function") {
    const targets = document.querySelectorAll<HTMLElement>("main .home-section-heading, main .home-intro-heading, main .home-intro-body, main .home-photo-collage figure, main .home-department, main .department-preview, main .activities-info-panel, main .post-card, main .registration-merch, main .info-location");
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        if (reduced.matches || element.contains(document.activeElement)) continue;
        try {
          const photo = element.tagName === "FIGURE";
          const cards = element.parentElement?.classList.contains("home-department-grid");
          const index = cards ? [...element.parentElement!.children].indexOf(element) % 6 : 0;
          const animation = element.animate([
            { opacity: .15, translate: photo ? `${index % 2 ? 14 : -14}px 0` : "0 18px", scale: cards ? ".985" : "1" },
            { opacity: 1, translate: "0 0", scale: "1" }
          ], { duration: photo ? 650 : 550, delay: index * 55, easing: "cubic-bezier(.2,.75,.25,1)" });
          reveals.set(element, animation);
          animation.onfinish = animation.oncancel = () => reveals.delete(element);
        } catch { /* Leave the normal, visible content intact. */ }
      }
    }, { threshold: .12 });
    targets.forEach(element => {
      if (element.getBoundingClientRect().top >= innerHeight) observer.observe(element);
    });
    document.addEventListener("focusin", event => {
      reveals.forEach((animation, element) => {
        if (event.target instanceof Node && element.contains(event.target)) animation.cancel();
      });
    });
  }
}
