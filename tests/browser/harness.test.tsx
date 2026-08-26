/**
 * The DOM harness, proving itself.
 *
 * Aira's other two Vitest projects are pure Node: they read files and compile
 * CSS. Neither can render a component, and the shell that follows has
 * acceptance criteria — a 44px touch target, a focus trap, a tooltip that must
 * appear on focus — that cannot be checked without a rendering engine. The
 * obvious substitute, jsdom, silently cannot do any of them:
 *
 *   - It does not evaluate `calc()`. Every Tailwind v4 spacing utility compiles
 *     to `calc(var(--spacing) * N)`, so `min-h-11` reads back as the literal
 *     string `"calc(var(--spacing) * 11)"` — never `44px`. happy-dom returns
 *     `"calc(4px * 11)"`, which is no more a number.
 *   - It does no layout. `getBoundingClientRect().height` is `0` in both.
 *   - A Base UI focus trap does not hold in it: focus escapes through Base UI's
 *     guard spans and reaches `<body>` within two or three tabs. That test
 *     would be red because of the environment, not because of the component.
 *
 * So this suite is not a set of unit tests. It is the evidence for the choice —
 * each case asserts a *measurement* the browser had to perform, never a class
 * string and never a source file. Read it as: here is the thing jsdom cannot
 * do, done.
 *
 * The suite also fails if the harness is dismantled. The `vitest/browser`
 * import below resolves in no other environment, so a silent fallback to a
 * simulated DOM cannot load this file. Deletion is caught by REQUIRED_SUITES in
 * `vitest.config.mts`, and unregistering the project is caught by
 * `tests/harness-registration.test.ts`, which runs over in the Node project.
 */
import { userEvent } from "vitest/browser";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// The application's real stylesheet, compiled by the same Tailwind pipeline the
// build uses. Nothing here hand-writes a pixel value; `min-h-11` below is what
// makes Tailwind emit the utility these tests then measure.
import "../../app/globals.css";

afterEach(cleanup);

/**
 * The rule as the browser received it, before it resolved anything. Tailwind v4
 * emits utilities inside `@layer utilities`, so this walks grouping rules
 * rather than reading the top level.
 */
function authoredDeclaration(selector: string): string {
  const found = findRule(Array.from(document.styleSheets), selector);
  if (found === null) throw new Error(`no stylesheet rule matched ${selector}`);
  return found;
}

function findRule(
  containers: Array<CSSStyleSheet | CSSGroupingRule>,
  selector: string,
): string | null {
  for (const container of containers) {
    let rules: CSSRule[];
    try {
      rules = Array.from(container.cssRules);
    } catch {
      continue; // cross-origin sheet; not ours
    }
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
        return rule.style.cssText;
      }
      if (rule instanceof CSSGroupingRule) {
        const nested = findRule([rule], selector);
        if (nested !== null) return nested;
      }
    }
  }
  return null;
}

describe("the environment", () => {
  it("is a real browser engine, not a simulation of one", () => {
    expect(navigator.userAgent).toMatch(/Chrome\//);
    // `happy-?dom`, not `happy-dom`: happy-dom's UA ends in `HappyDOM/20.0.0`,
    // so the hyphenated spelling never matched the one environment this file
    // argues hardest against.
    expect(navigator.userAgent).not.toMatch(/jsdom|happy-?dom/i);
    // A simulated DOM has no engine to answer this; it is the same engine that
    // resolves the calc() below.
    expect(CSS.supports("min-height", "calc(var(--spacing) * 11)")).toBe(true);
  });
});

describe("calc() resolution — what a simulated DOM returns as a string", () => {
  it("resolves a Tailwind-compiled min-h-11 to 44 real pixels", () => {
    render(<div data-testid="target" className="min-h-11" />);
    const computed = getComputedStyle(screen.getByTestId("target")).minHeight;

    // The negative control: the rule Tailwind actually shipped *is* a calc().
    // Without this the assertion below could be passing on a literal, and the
    // whole argument for a browser would evaporate unnoticed.
    expect(authoredDeclaration(".min-h-11")).toMatch(/calc\(/);

    expect(computed).not.toMatch(/calc\(/);
    expect(computed).toBe("44px");
    expect(Number.parseFloat(computed)).toBe(44);
  });
});

describe("layout — what a simulated DOM reports as zero", () => {
  it("gives a rendered element a non-zero box that matches its computed style", () => {
    render(<div data-testid="box" className="min-h-11 w-48" />);
    const el = screen.getByTestId("box");
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);

    expect(rect.height).toBeGreaterThan(0);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBe(Number.parseFloat(computed.height));
    expect(rect.width).toBe(Number.parseFloat(computed.width));
    // Both numbers are `calc(var(--spacing) * n)` with Tailwind's default 4px
    // unit: `min-h-11` is 11 x 4 = 44px, the touch-target minimum the shell has
    // to hit at <=1024px, and `w-48` is 48 x 4 = 192px.
    expect(rect.height).toBe(44);
    expect(rect.width).toBe(192);
  });
});

/** A Base UI overlay with more than one tab stop, so wrapping is observable. */
function TrapFixture() {
  return (
    <Dialog>
      <DialogTrigger data-testid="trigger">Buka menu</DialogTrigger>
      <DialogContent data-testid="popup">
        <DialogTitle>Ganti perusahaan</DialogTitle>
        <DialogDescription>Pilih perusahaan aktif.</DialogDescription>
        <button data-testid="first" type="button">
          Perusahaan satu
        </button>
        <button data-testid="last" type="button">
          Perusahaan dua
        </button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Presses `key` `times` times, asserting containment on a *single* reading of
 * `document.activeElement` after each press.
 *
 * Deliberately not `vi.waitFor`. A retrying assertion accepts focus that
 * escapes to `<body>` and is yanked back by a guard a few milliseconds later —
 * measured: a focus moved to `<body>` and restored after 50ms passes a
 * `vi.waitFor` containment check and fails a synchronous one. The spec says
 * focus never reaches `<body>`, so the assertion has to be able to see it get
 * there.
 */
async function traverse(
  within: HTMLElement,
  key: string,
  times: number,
): Promise<Element[]> {
  const visited: Element[] = [];
  for (let i = 0; i < times; i += 1) {
    await userEvent.keyboard(key);
    const active = document.activeElement;
    const where = `${key} #${i + 1}`;
    expect(active, `focus was lost entirely on ${where}`).not.toBeNull();
    expect(active, `focus reached <body> on ${where}`).not.toBe(document.body);
    expect(within.contains(active), `focus left the overlay on ${where}`).toBe(true);
    visited.push(active as Element);
  }
  return visited;
}

describe("focus trap — the case a simulated DOM gets wrong", () => {
  it("holds focus inside under repeated Tab, closes on Esc, returns to the trigger", async () => {
    render(<TrapFixture />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await userEvent.click(trigger);
    const popup = await screen.findByTestId("popup");

    // Eight steps each way: more than the overlay has tab stops, so a full
    // wrap has to happen in both directions. Backwards matters on its own —
    // escaping through Base UI's *leading* guard span is a different failure
    // from escaping through the trailing one, and catching escapes is the
    // entire reason this harness exists.
    const forwards = await traverse(popup, "{Tab}", 8);
    const backwards = await traverse(popup, "{Shift>}{Tab}{/Shift}", 8);

    for (const visited of [forwards, backwards]) {
      // "Never left the overlay" is also true of focus that never moved at
      // all, which is not a trap but a stuck page. These two say it really
      // cycled: several distinct stops, and at least one came round again.
      const distinct = new Set(visited);
      expect(distinct.size).toBeGreaterThanOrEqual(3);
      expect(distinct.size).toBeLessThan(visited.length);
    }

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(screen.queryByTestId("popup")).toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
