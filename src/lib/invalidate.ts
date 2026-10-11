/** Skip the root match when re-reading page data. The root loader owns the session and chrome. */
export function skipRootFilter(match: { routeId: string }): boolean {
  return match.routeId !== "__root__";
}
