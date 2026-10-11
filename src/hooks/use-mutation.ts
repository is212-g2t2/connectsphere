import { startTransition, useActionState, useCallback } from "react";

/**
 * The result after a mutation finishes.
 * `status` identifies the result instead of adding a boolean beside `data` and `error`.
 * This prevents a render from asking for a result that the run did not produce.
 *
 * React owns the in-flight state, and `useMutation` returns it separately.
 * Do not add a `"pending"` member here. It would duplicate React's flag and could drift.
 */
type MutationState<TResult> =
  | { status: "idle"; data: undefined; error: undefined }
  | { status: "success"; data: TResult; error: undefined }
  /**
   * A failure keeps the last successful `data`.
   * A retry after a rejected save still has the server id, so it does not create a second row.
   */
  | { status: "error"; data: TResult | undefined; error: string };

/**
 * Data for one `mutate` dispatch: the caller's input and the promise resolver.
 * React does not return the action result to its dispatcher, so this payload carries the result.
 * Do not use a ref. Queued runs would share it and could resolve the wrong promise.
 */
interface MutationRun<TInput, TResult> {
  input: TInput;
  settle: (state: MutationState<TResult>) => void;
}

const IDLE: MutationState<never> = { status: "idle", data: undefined, error: undefined };

/**
 * React's `useActionState` holds a mutation's in-flight flag, result, and error (PTR-71).
 * It replaces hand-written `useState` flags.
 *
 * `run` can reject. Store the rejection as the `"error"` state to prevent an unhandled promise.
 * A caller can ignore the result and still return to an interactive state with an error message.
 * Pass the last successful result as `run`'s second argument. This carries a server id to the next
 * run without component state.
 *
 * `mutate` returns the final state and never rejects. Use `void mutate(input)` when the caller does
 * not need to handle another lifecycle. A form that tracks its own submit flag and errors can
 * await `mutate` and handle failures itself.
 */
export function useMutation<TInput = void, TResult = void>(
  run: (input: TInput, previous: TResult | undefined) => Promise<TResult>,
  fallbackMessage: string
): [MutationState<TResult>, (input: TInput) => Promise<MutationState<TResult>>, boolean] {
  const [state, dispatch, isPending] = useActionState<
    MutationState<TResult>,
    MutationRun<TInput, TResult>
  >(async (previous, { input, settle }) => {
    let next: MutationState<TResult>;

    try {
      const data = await run(input, previous.data);
      next = { status: "success", data, error: undefined };
    } catch (error) {
      next = {
        status: "error",
        data: previous.data,
        // `if (error)` must mean this run failed. Treat an empty message like no message and use the fallback.
        error: error instanceof Error && error.message ? error.message : fallbackMessage,
      };
    }

    settle(next);
    return next;
  }, IDLE);

  // `useActionState` does not start a transition. Without one, React warns and keeps `isPending` false.
  // `<form action>` supplies this wrapper, but click handlers do not.
  const mutate = useCallback(
    (input: TInput) =>
      new Promise<MutationState<TResult>>(settle => {
        startTransition(() => {
          dispatch({ input, settle });
        });
      }),
    [dispatch]
  );

  return [state, mutate, isPending];
}
