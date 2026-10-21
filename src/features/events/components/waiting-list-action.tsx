import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { isWaitingListRefusal } from "#/features/events/registration";
import { joinWaitingList, leaveWaitingList } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * Join the waiting list of a full event with an open window. The page shows the action only
 * while the event is full. The server still states why it refuses.
 */
export function JoinWaitingListAction({
  eventId,
  eventName,
}: {
  eventId: number;
  eventName: string;
}) {
  const router = useRouter();
  const [state, join, joining] = useMutation(async () => {
    try {
      await joinWaitingList({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      await router.invalidate({ filter: skipRootFilter });
      throw isWaitingListRefusal(message) ? error : new Error();
    }
    toast.success(`You are on the waiting list for ${eventName}.`);
    // Joining raises no notice, but the bell count lives in the root context. Refresh it too.
    await router.invalidate();
  }, "Could not join the waiting list. Try again.");

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <Button size="sm" disabled={joining} onClick={() => void join()}>
        {joining ? "Joining…" : "Join the waiting list"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/** Leave the waiting list. Leaving frees no place, so it needs no confirmation. */
export function LeaveWaitingListAction({ eventId }: { eventId: number }) {
  const router = useRouter();
  const [state, leave, leaving] = useMutation(async () => {
    try {
      await leaveWaitingList({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      await router.invalidate({ filter: skipRootFilter });
      throw isWaitingListRefusal(message) ? error : new Error();
    }
    toast.success("You have left the waiting list.");
    await router.invalidate();
  }, "Could not leave the waiting list. Try again.");

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <Button variant="outline" size="sm" disabled={leaving} onClick={() => void leave()}>
        {leaving ? "Leaving…" : "Leave the waiting list"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
