import { startTransition, useActionState, useCallback } from "react";

/**
 * A mutation's settled outcome. `status` is the discriminant rather than a second boolean beside
 * `data` and `error`, so a render cannot ask for a result the run did not produce.
 *
 * In-flight is deliberately *not* one of these states: React owns it, and `useMutation` returns it
 * separately. A `"pending"` member here would be a copy of that flag, free to disagree with it —
 * which is the drift this replaces.
 */
type MutationState<TResult> =
  | { status: "idle"; data: undefined; error: undefined }
  | { status: "success"; data: TResult; error: undefined }
  /**
   * A failure keeps the last successful `data`. A retry after a rejected save therefore still
   * carries the id the server handed back, instead of writing a second row beside the first.
   */
  | { status: "error"; data: TResult | undefined; error: string };

/**
 * What one call to `mutate` dispatches: the caller's input, plus the resolver for the promise it
 * handed back. React gives an action no return channel to its dispatcher, and the payload is the
 * only per-dispatch one there is — a ref would be shared by every queued run and resolve the
 * wrong promise when two are in flight.
 */
interface MutationRun<TInput, TResult> {
  input: TInput;
  settle: (state: MutationState<TResult>) => void;
}

const IDLE: MutationState<never> = { status: "idle", data: undefined, error: undefined };

/**
 * One mutation's in-flight flag, result and error, held by React's `useActionState` rather than by
 * a hand-rolled set of `useState` flags (PTR-71).
 *
 * `run` may reject; the rejection becomes the `"error"` state instead of an unhandled promise, so
 * a caller that ignores the result still returns to an interactive state with a message to show.
 * Its second argument is whatever the last *successful* run returned — the channel by which a
 * server-assigned id reaches the next run without being threaded back through component state.
 *
 * `mutate` returns the settled state and never rejects, so `void mutate(input)` is a complete call
 * site. Callers that drive another lifecycle — a form that owns its own submitting flag and error
 * map — await it and decide for themselves what a failure means there.
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
        // An empty message is as useless to a caller as no message: `if (error)` has to mean
        // "this run failed", so a blank one falls back too.
        error: error instanceof Error && error.message ? error.message : fallbackMessage,
      };
    }

    settle(next);
    return next;
  }, IDLE);

  // `useActionState`'s dispatcher does not open a transition of its own — React warns and leaves
  // `isPending` stuck at `false` when an async action is dispatched outside one. The wrapper is
  // what `<form action>` would otherwise supply; these mutations run from click handlers instead.
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
