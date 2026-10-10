import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { RegisteredAttendee } from "#/features/events/access";
import { formatInstant } from "#/features/event-requests/format";

/**
 * The features this table uses: clickable column sorting, a search box over name and email, and
 * the VIP/Standard type filter. Registered per the React quick start so the bundle carries only
 * these row models and functions.
 */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
  },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
});

function formatRegisteredAt(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : formatInstant(new Date(time));
}

/** The arrow a sorted column header shows; nothing while it is unsorted. */
function sortedArrow(direction: false | "asc" | "desc"): string | null {
  if (direction === "asc") return " ↑";
  return direction === "desc" ? " ↓" : null;
}

const baseColumns: Array<ColumnDef<typeof features, RegisteredAttendee>> = [
  {
    accessorKey: "name",
    header: "Name",
    cell: info => info.getValue<string>() || "Unnamed attendee",
    enableColumnFilter: false,
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: info => <span className="break-words">{info.getValue<string>()}</span>,
    enableColumnFilter: false,
  },
  {
    id: "type",
    accessorFn: row => (row.vip ? "VIP" : "Standard"),
    header: "Type",
    cell: info =>
      info.row.original.vip ? <Badge>VIP</Badge> : <Badge variant="outline">Standard</Badge>,
    filterFn: "equalsString",
    enableGlobalFilter: false,
  },
  {
    accessorKey: "registeredAt",
    header: "Registered",
    cell: info => formatRegisteredAt(info.getValue<string>()),
    enableColumnFilter: false,
    enableGlobalFilter: false,
  },
];

const TYPE_FILTERS = [
  { label: "All", value: undefined },
  { label: "VIP", value: "VIP" },
  { label: "Standard", value: "Standard" },
] as const;

/** The visually empty header of the row-action column, still named for assistive technology. */
function ActionsHeader() {
  return <span className="sr-only">Actions</span>;
}

/**
 * The Organiser/Coordinator attendee list, sorted, searched and filtered on the client. The
 * attendees page and the event page's registrations section share it. `tableActions` renders
 * beside the type filters, and `rowActions` renders a trailing action per row — an empty,
 * labelled header keeps the column named for assistive technology.
 */
export function AttendeeTable({
  attendees,
  tableActions,
  rowActions,
}: {
  attendees: RegisteredAttendee[];
  tableActions?: ReactNode;
  rowActions?: (attendee: RegisteredAttendee) => ReactNode;
}) {
  const columns = useMemo<Array<ColumnDef<typeof features, RegisteredAttendee>>>(() => {
    if (!rowActions) return baseColumns;
    return [
      ...baseColumns,
      {
        id: "actions",
        header: ActionsHeader,
        cell: info => rowActions(info.row.original),
        enableSorting: false,
        enableColumnFilter: false,
        enableGlobalFilter: false,
      },
    ];
  }, [rowActions]);
  const table = useTable({ features, columns, data: attendees, globalFilterFn: "includesString" });

  const typeColumn = table.getColumn("type");
  const typeFilter = typeColumn?.getFilterValue();
  const typeValue = typeof typeFilter === "string" ? typeFilter : "";
  const searchValue = typeof table.state.globalFilter === "string" ? table.state.globalFilter : "";
  const isFiltered = searchValue !== "" || typeValue !== "";
  const rows = table.getRowModel().rows;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Search attendees"
          placeholder="Search by name or email"
          value={searchValue}
          onChange={event => table.setGlobalFilter(event.target.value)}
          className="max-w-xs"
        />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Filter by type</legend>
          {TYPE_FILTERS.map(filter => (
            <Button
              key={filter.label}
              type="button"
              size="sm"
              variant={typeValue === (filter.value ?? "") ? "default" : "outline"}
              aria-pressed={typeValue === (filter.value ?? "")}
              onClick={() => typeColumn?.setFilterValue(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </fieldset>
        {tableActions}
      </div>

      {isFiltered ? (
        <p className="mt-3 body-sm text-muted-foreground">
          Showing {rows.length} of {attendees.length} attendees
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>
              {isFiltered ? "No attendees match this search." : "No attendees registered."}
            </EmptyTitle>
            {isFiltered ? (
              <EmptyDescription>Change the search or clear the type filter.</EmptyDescription>
            ) : null}
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-6">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1"
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden="true">{sortedArrow(header.column.getIsSorted())}</span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  {row.getAllCells().map(cell => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.id === "email" || cell.column.id === "registeredAt"
                          ? "whitespace-normal"
                          : undefined
                      }
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
