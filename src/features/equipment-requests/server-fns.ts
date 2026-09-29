import { createServerFn } from "@tanstack/react-start";
import { createElement } from "react";

import { requirePermission } from "#/features/auth/session";
import {
  parseEquipmentLineInput,
  parseRemoveEquipmentLineInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("equipment-requests");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./equipment.server` and `#/db` are both reached inside the
 * handlers, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/equipment-requests/equipment.server")]);
}

export const requireEquipmentManage = requirePermission({
  equipment_request: ["manage"],
});

export const requireEquipmentSubmit = requirePermission({
  equipment_request: ["submit"],
});

/** PTR-38 AC1/AC4: add a new line or update an existing one. */
export const saveEquipmentLine = createServerFn({ method: "POST" })
  .validator(parseEquipmentLineInput)
  .middleware([requireEquipmentManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEquipmentLine }] = await loadServer();
    const line = await handleSaveEquipmentLine(data, context.user, db);

    log.info("Equipment line saved", {
      lineId: line.id,
      eventId: line.eventId,
      actorId: context.user.id,
    });

    return line;
  });

export type SavedEquipmentLine = Awaited<ReturnType<typeof saveEquipmentLine>>;

/** PTR-38 AC4: remove one line. */
export const removeEquipmentLine = createServerFn({ method: "POST" })
  .validator(parseRemoveEquipmentLineInput)
  .middleware([requireEquipmentManage])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRemoveEquipmentLine }] = await loadServer();
    const line = await handleRemoveEquipmentLine(data, context.user, db);

    log.info("Equipment line removed", {
      lineId: line.id,
      eventId: line.eventId,
      actorId: context.user.id,
    });

    return line;
  });

/**
 * PTR-38 AC5: submit the full equipment list to Technical Support. Notifies every Technical
 * Support Staff member by email after the handler resolves. Refuses when no lines are recorded.
 * Mail failures are logged and swallowed, matching the best-effort pattern venue requests use.
 */
export const submitEquipmentRequest = createServerFn({ method: "POST" })
  .validator(parseSubmitEquipmentInput)
  .middleware([requireEquipmentSubmit])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSubmitEquipmentRequest }] = await loadServer();
    const { lines, recipientEmails } = await handleSubmitEquipmentRequest(data, context.user, db);

    if (recipientEmails.length === 0) {
      log.warn("No Technical Support Staff to notify of equipment request", {
        eventId: data.eventId,
      });
    } else {
      const [{ sendEmail }, { EquipmentRequestEmail }] = await Promise.all([
        import("#/lib/mailer.server"),
        import("#/features/emails/components/equipment-request-email"),
      ]);

      const results = await Promise.allSettled(
        recipientEmails.map(recipient =>
          sendEmail(
            recipient,
            `Equipment request for event ${data.eventId}`,
            createElement(EquipmentRequestEmail, { lines, eventId: data.eventId })
          )
        )
      );
      const failed = results.filter(r => r.status === "rejected").length;
      if (failed > 0) {
        log.warn("Equipment request notification failed", {
          failed,
          total: recipientEmails.length,
          eventId: data.eventId,
        });
      }
    }

    log.info("Equipment request submitted to Technical Support", {
      eventId: data.eventId,
      actorId: context.user.id,
      lineCount: lines.length,
    });

    return { lineCount: lines.length };
  });
