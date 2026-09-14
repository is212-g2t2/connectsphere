import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMutation } from "#/hooks/use-mutation";

/** A promise the test settles by hand, so a run can be observed while it is still in flight. */
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * PTR-71: the lifecycle these assertions stand on is React's, not a set of `useState` flags moved
 * in step by hand. Each one names a way the hand-rolled version drifted — a flag left set after a
 * rejection, an unhandled promise, an id that only reached the next run if a caller remembered to
 * put it there.
 */
describe("useMutation", () => {
  it("starts idle with nothing in flight", () => {
    const { result } = renderHook(() => useMutation(async (input: string) => input, "Failed"));

    expect(result.current[0]).toEqual({ status: "idle", data: undefined, error: undefined });
    expect(result.current[2]).toBe(false);
  });

  it("reports in flight for exactly as long as the run takes", async () => {
    const running = gate<string>();
    const { result } = renderHook(() =>
      useMutation(async (input: string) => `${input}:${await running.promise}`, "Failed")
    );

    let settled!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      settled = result.current[1]("key");
    });

    await waitFor(() => expect(result.current[2]).toBe(true));
    // Still the previous state while the run is open: a half-written state is never rendered.
    expect(result.current[0].status).toBe("idle");

    await act(async () => {
      running.resolve("stored");
      await settled;
    });

    expect(result.current[2]).toBe(false);
    expect(result.current[0]).toEqual({
      status: "success",
      data: "key:stored",
      error: undefined,
    });
  });

  it("turns a rejection into error state instead of an unhandled promise", async () => {
    const { result } = renderHook(() =>
      useMutation(async () => {
        await Promise.resolve();
        throw new Error("Storage refused the upload");
      }, "Failed")
    );

    let settled!: ReturnType<(typeof result.current)[1]>;
    await act(async () => {
      settled = result.current[1]();
      await settled;
    });

    // Resolved, not rejected: `void mutate()` at a call site cannot strand a rejection.
    await expect(settled).resolves.toEqual({
      status: "error",
      data: undefined,
      error: "Storage refused the upload",
    });
    expect(result.current[0].error).toBe("Storage refused the upload");
    expect(result.current[2]).toBe(false);
  });

  it("falls back to the supplied message when the rejection is not an Error", async () => {
    const { result } = renderHook(() =>
      useMutation(async () => {
        await Promise.resolve();
        throw "not an error";
      }, "Could not save this draft. Try again.")
    );

    await act(async () => {
      await result.current[1]();
    });

    expect(result.current[0].error).toBe("Could not save this draft. Try again.");
  });

  it("falls back when the rejection carries an empty message", async () => {
    const { result } = renderHook(() =>
      useMutation(async () => {
        await Promise.resolve();
        throw new Error("");
      }, "Upload failed")
    );

    await act(async () => {
      await result.current[1]();
    });

    // `if (error)` at a call site has to mean "this run failed", so a blank message is no message.
    expect(result.current[0].error).toBe("Upload failed");
  });

  it("hands the last successful result to the next run", async () => {
    const run = vi
      .fn<(input: string, previous: string | undefined) => Promise<string>>()
      .mockImplementation(async (input, previous) =>
        previous === undefined ? `created:${input}` : `updated:${previous}`
      );
    const { result } = renderHook(() => useMutation(run, "Failed"));

    await act(async () => {
      await result.current[1]("draft");
    });
    expect(result.current[0].data).toBe("created:draft");

    await act(async () => {
      await result.current[1]("draft");
    });

    expect(run).toHaveBeenLastCalledWith("draft", "created:draft");
    expect(result.current[0].data).toBe("updated:created:draft");
  });

  it("keeps the last successful result through a failure, so a retry updates the same row", async () => {
    const run = vi
      .fn<(input: string, previous: string | undefined) => Promise<string>>()
      .mockResolvedValueOnce("row-1")
      .mockRejectedValueOnce(new Error("Unauthorized"))
      .mockResolvedValueOnce("row-1");
    const { result } = renderHook(() => useMutation(run, "Failed"));

    await act(async () => {
      await result.current[1]("first");
    });
    await act(async () => {
      await result.current[1]("second");
    });

    expect(result.current[0]).toEqual({ status: "error", data: "row-1", error: "Unauthorized" });

    await act(async () => {
      await result.current[1]("third");
    });

    // The retry still carried the row, so it was an update rather than a second insert.
    expect(run).toHaveBeenLastCalledWith("third", "row-1");
    expect(result.current[0]).toEqual({ status: "success", data: "row-1", error: undefined });
  });

  it("resolves each caller's promise with its own run when two are queued", async () => {
    const run = vi
      .fn<(input: string, previous: string | undefined) => Promise<string>>()
      .mockImplementation(async input => input);
    const { result } = renderHook(() => useMutation(run, "Failed"));

    let first!: ReturnType<(typeof result.current)[1]>;
    let second!: ReturnType<(typeof result.current)[1]>;
    await act(async () => {
      first = result.current[1]("one");
      second = result.current[1]("two");
      await Promise.all([first, second]);
    });

    expect((await first).data).toBe("one");
    expect((await second).data).toBe("two");
    expect(result.current[0].data).toBe("two");
  });
});
