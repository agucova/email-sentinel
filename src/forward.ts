import { createMimeMessage, MIMEMessage } from 'mimetext';
import { ParsedMessage } from '@protontech/jsmimeparser';
import { head, mapValues, pick } from 'es-toolkit';

export function craftForwardedEmail(
	originalEmail: ParsedMessage,
	sentinelEmail: string,
	targetEmail: string,
	workerRoute: string
): MIMEMessage {
	// Craft new email to forward the original email
	// We need to be careful about headers here, to maintain standards compliance.
	const msg = createMimeMessage();
	msg.setSender({
		name: originalEmail.from!.name,
		addr: sentinelEmail, // TODO: Figure out how to preserve the sender
	});

	// Flatten groups if present, as it can be either an Address or Group
	// Groups have a name and a 'group' field, which is an array of addresses
	// const toMimeAddresses = (addrOrGroups: AddressOrGroup[]) =>
	// 	addrOrGroups
	// 		.flatMap((recipient) =>
	// 			match(recipient)
	// 				.with({ group: P._ }, (group) => group.group)
	// 				.with({ email: P.string }, (email) => [email])
	// 				.exhaustive()
	// 		)
	// 		.map((recipient) => ({
	// 			name: recipient.name,
	// 			addr: recipient.email,
	// 		}));

	// const toRecipients = toMimeAddresses(originalEmail.to ?? []);
	// const ccRecipients = toMimeAddresses(originalEmail.cc ?? []);
	// const bccRecipients = toMimeAddresses(originalEmail.bcc ?? []);

	// const recipients: MailboxAddrObject[] = [
	// 	...toRecipients.map((recipient) => ({
	// 		addr: recipient.addr,
	// 		name: recipient.name,
	// 		type: 'To' as MailboxType,
	// 	})),
	// 	...ccRecipients.map((recipient) => ({
	// 		addr: recipient.addr,
	// 		name: recipient.name,
	// 		type: 'Cc' as MailboxType,
	// 	})),
	// 	...bccRecipients.map((recipient) => ({
	// 		addr: recipient.addr,
	// 		name: recipient.name,
	// 		type: 'Bcc' as MailboxType,
	// 	})),
	// ];

	msg.setRecipient({
		addr: targetEmail,
		type: 'To',
	});

	const allowedHeaders = [
		'Subject',
		'Date',
		'In-Reply-To',
		'Date',
		'References',
		'Thread-Topic',
		'Thread-Index',
		// 'ARC-Authentication-Results',
		// 'ARC-Message-Signature',
		// 'ARC-Seal',
	].map((header) => header.toLowerCase());

	const filteredHeaders = pick(originalEmail.headers, allowedHeaders);
	let newHeaders: Record<string, string> = mapValues(
		filteredHeaders,
		// We're only keeping the first value of each header
		(value) => head(value) ?? ''
	);

	newHeaders['Message-ID'] = `<${crypto.randomUUID()}@${workerRoute}>`;
	newHeaders['Reply-To'] = `${originalEmail.from!.name} <${originalEmail.from!.email}>`;

	// Add Resent- headers
	newHeaders['Resent-From'] = `Sentinel System <${sentinelEmail}>`;
	newHeaders['Resent-To'] = targetEmail;
	newHeaders['Resent-Message-ID'] = `<${crypto.randomUUID()}@${workerRoute}>`;
	newHeaders['Resent-Date'] = new Date().toUTCString();

	// TODO: Check if we need to do ARC/DMARC checks
	msg.setHeaders(newHeaders);

	// Copy body parts from original email
	if (originalEmail.body.text) {
		msg.addMessage({
			contentType: 'text/plain',
			data: originalEmail.body.text,
		});
	}
	if (originalEmail.body.html) {
		msg.addMessage({
			contentType: 'text/html',
			data: originalEmail.body.html,
		});
	}
	// Copy attachments from original email
	for (const attachment of originalEmail.attachments) {
		msg.addAttachment({
			filename: attachment.fileName ?? '',
			contentType: attachment.contentType ?? '',
			// We need to convert the Uint8Array to base64
			data: btoa(String.fromCharCode(...attachment.content)),
		});
	}

	return msg;
}
