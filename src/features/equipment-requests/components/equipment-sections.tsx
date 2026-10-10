import { ReservedCount } from "#/features/equipment-requests/components/reserved-count";
import {
  ArrangementLines,
  ArrangementsCompletion,
  AvailabilityCheck,
} from "#/features/equipment-requests/components/equipment-review-blocks";
import { EquipmentPanel } from "#/features/equipment-requests/components/equipment-panel";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EquipmentLineProjection } from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";

/** The stages with equipment lines to arrange: venue settled onward. */
const EQUIPMENT_STATUSES: readonly EventRequestStatus[] = [
  "approved",
  "planning",
  "confirmed",
  "completed",
];

/** Technical Support's blocks show for every event they can open. */
const alwaysVisible = () => true;

/** The organiser's read-only lines: what was asked for and what Technical Support made of it. */
function OrganiserEquipment({ lines }: { lines: EquipmentLineProjection[] }) {
  return (
    <div>
      <h2 className="display-h3">Equipment</h2>
      {lines.length === 0 ? (
        <p className="mt-4 body-sm text-muted-foreground">No equipment lines recorded.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {lines.map(item => (
            <li key={item.id} className="flex items-start justify-between gap-4 body-sm">
              <div>
                <span className="font-medium">{item.item}</span>
                <span className="text-muted-foreground"> × {item.quantity}</span>
                {typeof item.reservedQuantity === "number" && (
                  <ReservedCount
                    quantity={item.reservedQuantity}
                    className="text-muted-foreground"
                  />
                )}
                {item.notes && <p className="mt-0.5 text-muted-foreground">{item.notes}</p>}
              </div>
              <span>{arrangementStateLabel(item.arrangementStatus)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The coordinator's editable panel, as the old dashboard card passed it. */
function CoordinatorEquipment({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const { event } = data.event;
  return (
    <div>
      <h2 className="display-h3">Equipment</h2>
      <div className="mt-4">
        <EquipmentPanel
          eventId={event.id}
          lines={event.equipment ?? []}
          status={event.status}
          submittedAt={event.equipmentSubmittedAt ?? null}
          arrangementsCompletedAt={event.equipmentArrangementsCompletedAt ?? null}
        />
      </div>
    </div>
  );
}

/**
 * The equipment blocks: one shared arrangements list for the Organiser and the Coordinator, and
 * Technical Support's three working blocks — the lines, the completion, and the availability
 * checker.
 */
export function equipmentSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event") return [];
  if (data.event.access === "organiser" || data.event.access === "coordinator") {
    const { event } = data.event;
    return [
      {
        id: "equipment",
        label: "Equipment",
        visible: () =>
          EQUIPMENT_STATUSES.some(candidate => candidate === event.status) ||
          (event.equipment?.length ?? 0) > 0,
        render: body => {
          if (body.kind !== "event") return null;
          if (body.event.access === "coordinator") return <CoordinatorEquipment data={body} />;
          return <OrganiserEquipment lines={body.event.event.equipment ?? []} />;
        },
      },
    ];
  }
  if (data.event.access === "technical_support") {
    const { event } = data.event;
    const lines = event.equipment ?? [];
    return [
      {
        id: "lines",
        label: "Equipment lines",
        visible: alwaysVisible,
        render: () => (
          <div>
            <h2 className="display-h3">Equipment lines</h2>
            <div className="mt-4">
              <ArrangementLines eventId={event.id} lines={lines} />
            </div>
          </div>
        ),
      },
      {
        id: "arrangements",
        label: "Technical arrangements",
        visible: alwaysVisible,
        render: () => (
          <div>
            <h2 className="display-h3">Technical arrangements</h2>
            <div className="mt-3">
              <ArrangementsCompletion
                eventId={event.id}
                completedAt={event.equipmentArrangementsCompletedAt ?? null}
              />
            </div>
          </div>
        ),
      },
      {
        id: "availability",
        label: "Check availability",
        visible: alwaysVisible,
        render: body => (
          <div>
            <h2 className="display-h3">Check availability</h2>
            <div className="mt-3">
              <AvailabilityCheck
                eventId={event.id}
                equipmentTypes={body.kind === "event" ? (body.equipmentTypes ?? null) : null}
              />
            </div>
          </div>
        ),
      },
    ];
  }
  return [];
}
