import { createServerFn } from "@tanstack/react-start";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export function getSessionUser(
  session: {
    user?: { id: string; email: string; name?: string | null; image?: string | null };
  } | null
): SessionUser | null {
  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
  };
}

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { auth }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("#/lib/auth"),
  ]);

  const session = await auth.api.getSession({
    headers: getRequest().headers,
  });

  return getSessionUser(session);
});
