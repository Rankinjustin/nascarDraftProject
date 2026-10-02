import { describe, expect, it } from "vitest";
import { roundForPick, snakeOrder, whoseTurn } from "./draft";

const nine = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"];

describe("snakeOrder", () => {
  it("2 users: forward, reverse, forward", () => {
    expect(snakeOrder(["a", "b"], 3)).toEqual(["a", "b", "b", "a", "a", "b"]);
  });

  it("3 users: forward, reverse, forward", () => {
    expect(snakeOrder(["a", "b", "c"], 3)).toEqual(["a", "b", "c", "c", "b", "a", "a", "b", "c"]);
  });

  it("9 users: 27 slots, round 2 reversed", () => {
    const snake = snakeOrder(nine, 3);
    expect(snake).toHaveLength(27);
    expect(snake.slice(0, 9)).toEqual(nine);
    expect(snake.slice(9, 18)).toEqual([...nine].reverse());
    expect(snake.slice(18, 27)).toEqual(nine);
  });

  it("does not mutate its input", () => {
    const order = ["a", "b", "c"];
    snakeOrder(order, 3);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("whoseTurn", () => {
  const snake = snakeOrder(nine, 3);

  it("first pick goes to the first user", () => {
    expect(whoseTurn(snake, 0)).toBe("u1");
  });

  it("mid-draft", () => {
    expect(whoseTurn(snake, 4)).toBe("u5");
    expect(whoseTurn(snake, 12)).toBe("u6");
  });

  it("round 1 to 2 boundary: the last user picks twice in a row", () => {
    expect(whoseTurn(snake, 8)).toBe("u9");
    expect(whoseTurn(snake, 9)).toBe("u9");
  });

  it("round 2 to 3 boundary: the first user picks twice in a row", () => {
    expect(whoseTurn(snake, 17)).toBe("u1");
    expect(whoseTurn(snake, 18)).toBe("u1");
  });

  it("returns null once the draft is complete", () => {
    expect(whoseTurn(snake, 26)).toBe("u9");
    expect(whoseTurn(snake, 27)).toBeNull();
    expect(whoseTurn(snake, 30)).toBeNull();
  });
});

describe("roundForPick", () => {
  it.each([
    [1, 1],
    [9, 1],
    [10, 2],
    [18, 2],
    [19, 3],
    [27, 3],
  ])("pick %i with 9 users is round %i", (pick, round) => {
    expect(roundForPick(pick, 9)).toBe(round);
  });
});
