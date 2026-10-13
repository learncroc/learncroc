import { describe, expect, test } from "bun:test";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { agreementClashes, joinTiles, tileBuilderSpec as spec } from "../src/tile-builder/spec";
import TileBuilderView from "../src/tile-builder/View";
import { expectAxeClean, flush, renderWidget } from "./_lang-physics-code.harness";

const ex = (i: number) => {
  const e = spec.examples[i];
  if (!e) throw new Error(`missing example ${i}`);
  return e;
};

describe("tile-builder spec", () => {
  test("joins punctuation snugly", () => {
    expect(joinTiles(["Una", "cerveza", ",", "por", "favor", "."])).toBe("Una cerveza, por favor.");
    expect(joinTiles(["¿", "Más", "despacio", "?"])).toBe("¿Más despacio?");
  });
  test("agreement clashes: gender and number between neighbours", () => {
    const tiles = ex(0).props.tiles;
    expect(agreementClashes(tiles, ["las", "casas", "rojas"])).toEqual([]);
    expect(agreementClashes(tiles, ["las", "casas", "rojos"])).toEqual([[1, 2]]);
    expect(agreementClashes(tiles, ["la", "casas"])).toEqual([[0, 1]]);
  });
  test("validate catches unknown tiles, duplicate use, misplaced indents and contradictory tags", () => {
    const e = ex(0);
    expect(spec.validate(e.props, { kind: "sequence", accept: [["las", "nope"]] }).join()).toContain(
      'unknown tile "nope"',
    );
    expect(spec.validate(e.props, { kind: "sequence", accept: [["las", "las"]] }).join()).toContain("twice");
    expect(spec.validate(e.props, { kind: "sequence", accept: [["las"]], indents: [[0]] }).join()).toContain(
      "only apply in lines mode",
    );
    expect(
      spec
        .validate({
          ...e.props,
          tiles: [
            { id: "x", text: "x", tags: ["m", "f"] },
            { id: "y", text: "y" },
          ],
        })
        .join(),
    ).toContain("both masculine and feminine");
    expect(spec.validate({ ...e.props, lang: undefined }).join()).toContain("speak needs lang");
    const p = ex(2);
    expect(spec.validate(p.props, { kind: "sequence", accept: [["total", "for"]], indents: [[0]] }).join()).toContain(
      "one entry per line",
    );
  });
  test("lines mode: right order with wrong indent gets a nudge, not a pass", () => {
    const p = ex(2);
    const r = spec.grade({ props: p.props, goal: p.goal, answer: p.wrongAnswer });
    expect(r.correct).toBe(false);
    expect(r.feedback).toContain("indentation");
  });
});

describe("tile-builder view", () => {
  test("keyboard: add tiles, carry one into place, read back the sentence", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(TileBuilderView, { props: e.props, goal: e.goal });
    const tray = screen.getByRole("list", { name: "Tiles to use" });
    // Add in the wrong order: las, rojas, casas.
    for (const word of ["las", "rojas", "casas"]) {
      within(tray)
        .getByRole("button", { name: `Add ${word}` })
        .focus();
      await user.keyboard("{Enter}");
    }
    expect(h.last()?.sequence).toEqual(["las", "rojas", "casas"]);
    // Carry "casas" one step left: Space, ←, Space.
    const casas = screen.getByRole("button", { name: /^casas, position 3 of 3/ });
    casas.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard(" ");
    expect(h.last()?.sequence).toEqual(["las", "casas", "rojas"]);
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? { sequence: [] } }).correct).toBe(true);
    expect(h.announcements.some((a) => a.includes("Picked up casas"))).toBe(true);
    expect(h.announcements.at(-1)).toContain("Dropped casas at position 2");
  });

  test("a carried tile keeps keyboard focus while it moves both ways", async () => {
    const user = userEvent.setup();
    const e = ex(0);
    const h = renderWidget(TileBuilderView, {
      props: e.props,
      goal: e.goal,
      value: { sequence: ["rojas", "las", "casas"] },
    });
    screen.getByRole("button", { name: /^rojas, position 1 of 3/ }).focus();
    await user.keyboard(" {ArrowRight}{ArrowRight}");
    expect(document.activeElement?.textContent).toContain("rojas");
    await user.keyboard("{ArrowLeft} ");
    expect(h.last()?.sequence).toEqual(["las", "rojas", "casas"]);
    expect(document.activeElement?.textContent).toContain("rojas");
  });

  test("a clashing neighbour is described (shape and colour are not the only cue)", async () => {
    const e = ex(0);
    renderWidget(TileBuilderView, { props: e.props, goal: e.goal, value: { sequence: ["las", "casas", "rojos"] } });
    expect(screen.getByRole("button", { name: /rojos, position 3 of 3, doesn't agree with casas/ })).toBeTruthy();
  });

  test("Escape puts a carried tile back; Delete returns it to the tray", async () => {
    const user = userEvent.setup();
    const e = ex(1);
    const h = renderWidget(TileBuilderView, {
      props: e.props,
      goal: e.goal,
      value: { sequence: ["una", "cerveza", "comma", "por", "favor", "dot"] },
    });
    const una = screen.getByRole("button", { name: /^Una, position 1/ });
    una.focus();
    await user.keyboard(" {ArrowRight}{ArrowRight}");
    expect(h.last()?.sequence[2]).toBe("una");
    await user.keyboard("{Escape}");
    expect(h.last()?.sequence[0]).toBe("una");
    screen.getByRole("button", { name: /^Una, position 1/ }).focus();
    await user.keyboard("{Delete}");
    expect(h.last()?.sequence).toEqual(["cerveza", "comma", "por", "favor", "dot"]);
  });

  test("lines mode: order and indent from the keyboard", async () => {
    const user = userEvent.setup();
    const e = ex(2);
    const h = renderWidget(TileBuilderView, { props: e.props, goal: e.goal });
    for (const line of ["total = 0", "for n in range(1, 4):", "total = total + n", "print(total)"]) {
      const tray = screen.getByRole("list", { name: "Unused lines" });
      await user.click(within(tray).getByRole("button", { name: `Add ${line}` }));
    }
    const add = screen.getByRole("button", { name: /^total = total \+ n, indent 0/ });
    add.focus();
    await user.keyboard("{ArrowRight}");
    expect(h.last()).toEqual({ sequence: ["total", "for", "add", "print"], indents: [0, 0, 1, 0] });
    expect(spec.grade({ props: e.props, goal: e.goal, answer: h.last() ?? { sequence: [] } }).correct).toBe(true);
  });

  test("pointer tap removes a placed tile", async () => {
    const e = ex(0);
    const h = renderWidget(TileBuilderView, { props: e.props, goal: e.goal, value: { sequence: ["las", "casas"] } });
    const las = screen.getByRole("button", { name: /^las, position 1/ });
    fireEvent.pointerDown(las, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(h.last()?.sequence).toEqual(["casas"]);
  });

  test("review shows a working answer; axe clean throughout", async () => {
    for (const e of spec.examples) {
      const a = renderWidget(TileBuilderView, { props: e.props, goal: e.goal, value: e.wrongAnswer });
      await expectAxeClean(a.container);
      a.container.remove();
      const r = renderWidget(TileBuilderView, {
        props: e.props,
        goal: e.goal,
        mode: "review",
        value: e.wrongAnswer,
        solution: e.correctAnswer,
      });
      await flush(10);
      expect(r.container.querySelector("[data-solution]")).not.toBeNull();
      await expectAxeClean(r.container);
      r.container.remove();
    }
  });
});
