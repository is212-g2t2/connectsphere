// oxlint-disable node/no-process-env, no-await-in-loop
import { deliverQueuedEmails } from "./notifications";

interface MailpitAddress {
  Address: string;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: MailpitAddress[];
}

/** Deliver queued mail, then poll Mailpit for a message with the exact subject and recipient.
 * Return its body. Mailpit lets E2E tests check real messages. The drain replaces the one-minute
 * scheduler during tests.
 */
export async function waitForEmail(recipient: string, subject: string): Promise<string> {
  await deliverQueuedEmails();
  const mailpitUrl = process.env.MAILPIT_URL ?? "http://localhost:8025";
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const listResponse = await fetch(`${mailpitUrl}/api/v1/messages`);
    const { messages } = (await listResponse.json()) as { messages: MailpitMessage[] };
    const message = messages.find(
      candidate =>
        candidate.Subject === subject && candidate.To.some(address => address.Address === recipient)
    );
    if (message) {
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as { Text?: string; HTML?: string };
      return detail.Text ?? detail.HTML ?? "";
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`No "${subject}" email captured for ${recipient} at ${mailpitUrl}`);
}
